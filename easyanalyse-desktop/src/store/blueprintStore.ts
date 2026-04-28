import { create } from 'zustand'
import {
  createBlueprintFromDocument,
  createEmptyBlueprintWorkspace,
  normalizeBlueprintWorkspace,
} from '../lib/blueprintWorkspace'
import { DOCUMENT_HASH_ALGORITHM, hashDocument } from '../lib/documentHash'
import {
  getBlueprintSidecarPathCommand,
  loadBlueprintWorkspaceFromPath,
  saveBlueprintWorkspaceToPath,
  validateDocumentCommand,
} from '../lib/tauri'
import type {
  AgentBlueprintCandidate,
  AgentResponseParseIssue,
} from '../types/agent'
import type {
  BlueprintAppliedInfo,
  BlueprintMainDocumentRef,
  BlueprintRecord,
  BlueprintWorkspaceFile,
} from '../types/blueprint'
import type { DocumentFile, ValidationReport } from '../types/document'

export interface BlueprintState {
  workspace: BlueprintWorkspaceFile | null
  sidecarPath: string | null
  dirty: boolean
  selectedBlueprintId: string | null
  loadError: string | null
  saveError: string | null
  validationError: string | null
  addAgentBlueprintCandidates(
    candidates: AgentBlueprintCandidate[],
    context: { mainDocument: DocumentFile; filePath: string | null; issues?: AgentResponseParseIssue[] },
  ): Promise<BlueprintRecord[]>
  loadForMainDocument(filePath: string | null, mainDocument: DocumentFile): Promise<void>
  saveWorkspace(): Promise<void>
  createSnapshotFromDocument(
    document: DocumentFile,
    options?: { title?: string; description?: string },
  ): Promise<BlueprintRecord>
  validateBlueprint(id: string): Promise<void>
  archiveBlueprint(id: string): void
  deleteBlueprint(id: string): void
  selectBlueprint(id: string | null): void
  markApplied(id: string, info: BlueprintAppliedInfo): void
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getMainDocumentRef(filePath: string | null, mainDocument: DocumentFile, hash: string): BlueprintMainDocumentRef {
  const ref: BlueprintMainDocumentRef = {
    documentId: mainDocument.document.id,
    hash,
    hashAlgorithm: DOCUMENT_HASH_ALGORITHM,
  }
  if (filePath !== null) {
    ref.path = filePath
  }
  if (mainDocument.document.updatedAt !== undefined) {
    ref.updatedAt = mainDocument.document.updatedAt
  }
  return ref
}

function createWorkspaceForDocument(filePath: string | null, mainDocument: DocumentFile, hash: string) {
  return createEmptyBlueprintWorkspace({
    mainDocument: getMainDocumentRef(filePath, mainDocument, hash),
  })
}

function withUpdatedMainDocumentRef(
  workspace: BlueprintWorkspaceFile,
  filePath: string | null,
  mainDocument: DocumentFile,
  hash: string,
): BlueprintWorkspaceFile {
  return {
    ...workspace,
    mainDocument: getMainDocumentRef(filePath, mainDocument, hash),
  }
}

function updateBlueprint(
  workspace: BlueprintWorkspaceFile,
  id: string,
  updater: (record: BlueprintRecord) => BlueprintRecord,
): BlueprintWorkspaceFile {
  let changed = false
  const blueprints = workspace.blueprints.map((record) => {
    if (record.id !== id) {
      return record
    }
    changed = true
    return updater(record)
  })

  if (!changed) {
    return workspace
  }

  return {
    ...workspace,
    updatedAt: new Date().toISOString(),
    blueprints,
  }
}

function isReportValid(report: ValidationReport): boolean {
  const snakeReport = report as ValidationReport & { schema_valid?: boolean; semantic_valid?: boolean }
  const schemaValid = snakeReport.schemaValid ?? snakeReport.schema_valid
  const semanticValid = snakeReport.semanticValid ?? snakeReport.semantic_valid
  return schemaValid === true && semanticValid === true
}

let loadRequestVersion = 0
let validationRequestVersion = 0
let candidateInsertionVersion = 0
const validationTokensById = new Map<string, number>()

export const useBlueprintStore = create<BlueprintState>((set, get) => ({
  workspace: null,
  sidecarPath: null,
  dirty: false,
  selectedBlueprintId: null,
  loadError: null,
  saveError: null,
  validationError: null,

  addAgentBlueprintCandidates: async (candidates, context) => {
    const insertionVersion = ++candidateInsertionVersion
    const mainHash = await hashDocument(context.mainDocument)
    if (insertionVersion !== candidateInsertionVersion) {
      return []
    }

    const records = await Promise.all(
      candidates.map((candidate, index) =>
        createBlueprintFromDocument({
          document: candidate.document,
          title: candidate.title,
          description: candidate.summary,
          baseMainDocumentHash: mainHash,
          source: 'agent',
          validationState: candidate.issues.some((issue) => issue.severity === 'error') ? 'invalid' : 'unknown',
          tags: ['agent'],
          notes: [candidate.rationale, ...candidate.tradeoffs.map((tradeoff) => `Tradeoff: ${tradeoff}`), ...(candidate.notes ?? [])]
            .filter(Boolean)
            .join('\n'),
          extensions: {
            agentCandidate: {
              highlightedLabels: candidate.highlightedLabels ?? [],
              issues: candidate.issues,
              parseIssues: (context.issues ?? []).filter((issue) => issue.candidateIndex === index),
            },
          },
        }),
      ),
    )
    if (insertionVersion !== candidateInsertionVersion) {
      return []
    }

    let inserted: BlueprintRecord[] = []
    set((state) => {
      const currentWorkspace = state.workspace
      const workspace = currentWorkspace ?? createWorkspaceForDocument(context.filePath, context.mainDocument, mainHash)
      const mainDocument = workspace.mainDocument
      const pathMatches = (mainDocument?.path ?? null) === context.filePath
      const idMatches = mainDocument?.documentId === context.mainDocument.document.id
      const hashMatches = mainDocument?.hash === mainHash

      if (currentWorkspace !== null && (!pathMatches || !idMatches || !hashMatches)) {
        inserted = []
        return {}
      }

      inserted = records
      return {
        workspace: {
          ...workspace,
          updatedAt: new Date().toISOString(),
          blueprints: [...workspace.blueprints, ...records],
        },
        selectedBlueprintId: records.at(-1)?.id ?? state.selectedBlueprintId,
        dirty: records.length > 0 ? true : state.dirty,
      }
    })

    return inserted
  },

  loadForMainDocument: async (filePath, mainDocument) => {
    const requestVersion = ++loadRequestVersion
    ++candidateInsertionVersion
    const mainHash = await hashDocument(mainDocument)
    if (requestVersion !== loadRequestVersion) {
      return
    }

    if (filePath === null) {
      if (requestVersion !== loadRequestVersion) {
        return
      }
      set({
        workspace: createWorkspaceForDocument(null, mainDocument, mainHash),
        sidecarPath: null,
        dirty: false,
        selectedBlueprintId: null,
        loadError: null,
      })
      return
    }

    let sidecarPath: string | null = null
    try {
      sidecarPath = await getBlueprintSidecarPathCommand(filePath)
      if (requestVersion !== loadRequestVersion) {
        return
      }
      const loaded = await loadBlueprintWorkspaceFromPath(sidecarPath)
      if (requestVersion !== loadRequestVersion) {
        return
      }
      const workspace = loaded === null ? createWorkspaceForDocument(filePath, mainDocument, mainHash) : normalizeBlueprintWorkspace(loaded)

      set({
        workspace: withUpdatedMainDocumentRef(workspace, filePath, mainDocument, mainHash),
        sidecarPath,
        dirty: false,
        selectedBlueprintId: null,
        loadError: null,
      })
    } catch (error) {
      if (requestVersion !== loadRequestVersion) {
        return
      }
      set({
        workspace: createWorkspaceForDocument(filePath, mainDocument, mainHash),
        sidecarPath,
        dirty: false,
        selectedBlueprintId: null,
        loadError: getErrorMessage(error),
      })
    }
  },

  saveWorkspace: async () => {
    const { workspace, sidecarPath } = get()
    if (workspace === null) {
      return
    }

    if (sidecarPath === null) {
      set((state) =>
        state.workspace === workspace && state.sidecarPath === sidecarPath ? { dirty: false, saveError: null } : { saveError: null },
      )
      return
    }

    try {
      await saveBlueprintWorkspaceToPath(sidecarPath, workspace)
      set((state) =>
        state.workspace === workspace && state.sidecarPath === sidecarPath ? { dirty: false, saveError: null } : { saveError: null },
      )
    } catch (error) {
      set({ saveError: getErrorMessage(error) })
      throw error
    }
  },

  createSnapshotFromDocument: async (document, options) => {
    const { workspace } = get()
    const mainHash = workspace?.mainDocument?.hash ?? (await hashDocument(document))
    const currentWorkspace = workspace ?? createWorkspaceForDocument(null, document, mainHash)
    const blueprint = await createBlueprintFromDocument({
      document,
      title: options?.title,
      description: options?.description,
      baseMainDocumentHash: currentWorkspace.mainDocument?.hash,
    })
    set((state) => {
      const latestWorkspace = state.workspace ?? currentWorkspace
      const nextWorkspace: BlueprintWorkspaceFile = {
        ...latestWorkspace,
        updatedAt: new Date().toISOString(),
        blueprints: [...latestWorkspace.blueprints, blueprint],
      }

      return {
        workspace: nextWorkspace,
        selectedBlueprintId: blueprint.id,
        dirty: true,
      }
    })

    return blueprint
  },

  validateBlueprint: async (id) => {
    const workspace = get().workspace
    const record = workspace?.blueprints.find((item) => item.id === id)
    if (workspace === null || record === undefined || record.lifecycleStatus === 'deleted') {
      return
    }

    const validationToken = ++validationRequestVersion
    validationTokensById.set(id, validationToken)
    const documentHash = record.documentHash

    let report: ValidationReport
    try {
      report = await validateDocumentCommand(record.document)
    } catch (error) {
      if (validationTokensById.get(id) === validationToken) {
        set({ validationError: getErrorMessage(error) })
      }
      throw error
    }

    set((state) => {
      if (state.workspace === null || validationTokensById.get(id) !== validationToken) {
        return {}
      }

      const current = state.workspace.blueprints.find((item) => item.id === id)
      if (current === undefined || current !== record || current.documentHash !== documentHash) {
        return {}
      }

      return {
        workspace: updateBlueprint(state.workspace, id, (currentRecord) => ({
          ...currentRecord,
          validationState: isReportValid(report) ? 'valid' : 'invalid',
          validationReport: report,
          updatedAt: new Date().toISOString(),
        })),
        dirty: true,
        validationError: null,
      }
    })
  },

  archiveBlueprint: (id) => {
    set((state) => {
      const target = state.workspace?.blueprints.find((record) => record.id === id)
      if (state.workspace === null || target === undefined || target.lifecycleStatus !== 'active') {
        return {}
      }
      return {
        workspace: updateBlueprint(state.workspace, id, (record) => ({
          ...record,
          lifecycleStatus: 'archived',
          updatedAt: new Date().toISOString(),
        })),
        dirty: true,
      }
    })
  },

  deleteBlueprint: (id) => {
    set((state) => {
      const target = state.workspace?.blueprints.find((record) => record.id === id)
      if (state.workspace === null || target === undefined || target.lifecycleStatus === 'deleted') {
        return {}
      }
      return {
        workspace: updateBlueprint(state.workspace, id, (record) => ({
          ...record,
          lifecycleStatus: 'deleted',
          updatedAt: new Date().toISOString(),
        })),
        selectedBlueprintId: state.selectedBlueprintId === id ? null : state.selectedBlueprintId,
        dirty: true,
      }
    })
  },

  selectBlueprint: (id) => {
    set({ selectedBlueprintId: id })
  },

  markApplied: (id, info) => {
    set((state) => {
      if (state.workspace === null || !state.workspace.blueprints.some((record) => record.id === id)) {
        return {}
      }
      return {
        workspace: updateBlueprint(state.workspace, id, (record) => ({
          ...record,
          appliedInfo: info,
          updatedAt: new Date().toISOString(),
        })),
        dirty: true,
      }
    })
  },
}))
