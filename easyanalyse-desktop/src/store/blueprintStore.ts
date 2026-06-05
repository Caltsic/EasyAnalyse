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
import { getErrorMessage } from '../lib/errors'
import { isRecord } from '../lib/guards'
import type { LiveBlueprintDraftResult } from '../lib/liveBlueprintDraft'
import type {
  AgentBlueprintCandidate,
  AgentResponseParseIssue,
} from '../types/agent'
import type { AgentThreadWorkspace } from '../types/agentThread'
import type {
  BlueprintAppliedInfo,
  BlueprintMainDocumentRef,
  BlueprintRecord,
  BlueprintWorkspaceFile,
} from '../types/blueprint'
import type { DocumentFile, ValidationReport } from '../types/document'
import {
  SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION,
  type SimulationArtifact,
  type SimulationWorkerManifest,
} from '../types/simulation'

const MAX_SIMULATION_WORKER_SCRIPT_CHARS = 80_000

interface AgentCandidateInsertionContext {
  mainDocument: DocumentFile
  filePath: string | null
  issues?: AgentResponseParseIssue[]
}

interface AcceptLiveDraftContext {
  mainDocument: DocumentFile
  filePath: string | null
  title?: string
  description?: string
}

interface LiveDraftSessionOptions {
  sessionId?: string | null
}

interface ClearLiveDraftOptions {
  suppressCurrentSession?: boolean
}

export interface BlueprintLiveDraftState {
  status: 'idle' | LiveBlueprintDraftResult['status']
  sessionId: string | null
  raw: string
  markerFound: boolean
  hasCompleteJson: boolean
  displayDocument: DocumentFile | null
  lastGoodDocument: DocumentFile | null
  updatedAt: string | null
  error?: LiveBlueprintDraftResult['error']
}

export interface BlueprintState {
  workspace: BlueprintWorkspaceFile | null
  sidecarPath: string | null
  dirty: boolean
  selectedBlueprintId: string | null
  loadError: string | null
  saveError: string | null
  validationError: string | null
  liveDraft: BlueprintLiveDraftState
  suppressedLiveDraftSessionId: string | null
  startLiveBlueprintDraft(options?: LiveDraftSessionOptions): boolean
  updateLiveBlueprintDraft(result: LiveBlueprintDraftResult, raw: string, options?: LiveDraftSessionOptions): boolean
  clearLiveBlueprintDraft(options?: ClearLiveDraftOptions): void
  acceptLiveBlueprintDraft(context: AcceptLiveDraftContext): Promise<BlueprintRecord | null>
  isLiveBlueprintDraftSessionSuppressed(sessionId: string | null | undefined): boolean
  setWorkspaceAgentThreads(agentThreads: AgentThreadWorkspace): void
  addAgentBlueprintCandidates(
    candidates: AgentBlueprintCandidate[],
    context: AgentCandidateInsertionContext,
  ): Promise<BlueprintRecord[]>
  loadForMainDocument(filePath: string | null, mainDocument: DocumentFile): Promise<void>
  rebindForSavedDocument(filePath: string, mainDocument: DocumentFile): Promise<void>
  saveWorkspace(): Promise<void>
  createSnapshotFromDocument(
    document: DocumentFile,
    options?: { title?: string; description?: string },
  ): Promise<BlueprintRecord>
  replaceBlueprintFromDocument(
    id: string,
    document: DocumentFile,
    options?: { title?: string; description?: string; notes?: string },
  ): Promise<BlueprintRecord | null>
  validateBlueprint(id: string): Promise<void>
  archiveBlueprint(id: string): void
  deleteBlueprint(id: string): void
  selectBlueprint(id: string | null): void
  markApplied(id: string, info: BlueprintAppliedInfo): void
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

function withWorkspaceAgentThreads(
  workspace: BlueprintWorkspaceFile,
  agentThreads: AgentThreadWorkspace,
): BlueprintWorkspaceFile {
  return {
    ...workspace,
    updatedAt: new Date().toISOString(),
    extensions: {
      ...(workspace.extensions ?? {}),
      agentThreads,
    },
  }
}

function isReportValid(report: ValidationReport): boolean {
  const snakeReport = report as ValidationReport & { schema_valid?: boolean; semantic_valid?: boolean }
  const schemaValid = snakeReport.schemaValid ?? snakeReport.schema_valid
  const semanticValid = snakeReport.semanticValid ?? snakeReport.semantic_valid
  return schemaValid === true && semanticValid === true
}

function cloneDocumentSnapshot(document: DocumentFile): DocumentFile {
  return JSON.parse(JSON.stringify(document)) as DocumentFile
}

function getCandidateSimulationArtifact(candidate: AgentBlueprintCandidate): SimulationArtifact | undefined {
  if (candidate.simulation !== undefined) {
    return normalizeSimulationArtifact(candidate.simulation)
  }

  return normalizeSimulationArtifact(candidate.document.extensions?.simulation)
}

function normalizeSimulationArtifact(value: unknown): SimulationArtifact | undefined {
  if (!isRecord(value) || value.schemaVersion !== SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION) {
    return undefined
  }
  if (
    !isRecord(value.manifest) ||
    typeof value.workerScript !== 'string' ||
    value.workerScript.length === 0 ||
    value.workerScript.length > MAX_SIMULATION_WORKER_SCRIPT_CHARS
  ) {
    return undefined
  }
  if (value.scriptLanguage !== undefined && value.scriptLanguage !== 'javascript') {
    return undefined
  }

  const manifest = normalizeSimulationManifest(value.manifest)
  if (manifest === null) {
    return undefined
  }

  return {
    schemaVersion: SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION,
    manifest,
    workerScript: value.workerScript,
    ...(value.scriptLanguage === 'javascript' ? { scriptLanguage: 'javascript' } : {}),
    ...(value.defaultInput === undefined ? {} : { defaultInput: JSON.parse(JSON.stringify(value.defaultInput)) }),
    ...(Array.isArray(value.notes) ? { notes: value.notes.filter((item): item is string => typeof item === 'string') } : {}),
  }
}

function normalizeSimulationManifest(value: Record<string, unknown>): SimulationWorkerManifest | null {
  if (
    value.schemaVersion !== SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0
  ) {
    return null
  }

  return {
    schemaVersion: SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION,
    name: value.name.trim(),
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(Array.isArray(value.capabilities)
      ? { capabilities: value.capabilities.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(value.inputSchema === undefined ? {} : { inputSchema: JSON.parse(JSON.stringify(value.inputSchema)) }),
    ...(value.outputSchema === undefined ? {} : { outputSchema: JSON.parse(JSON.stringify(value.outputSchema)) }),
  }
}

function createIdleLiveDraft(): BlueprintLiveDraftState {
  return {
    status: 'idle',
    sessionId: null,
    raw: '',
    markerFound: false,
    hasCompleteJson: false,
    displayDocument: null,
    lastGoodDocument: null,
    updatedAt: null,
  }
}

function isDefinitelyDifferentMainDocument(
  workspace: BlueprintWorkspaceFile,
  context: AgentCandidateInsertionContext,
): boolean {
  const workspaceDocumentId = workspace.mainDocument?.documentId
  if (workspaceDocumentId === undefined || workspaceDocumentId === context.mainDocument.document.id) {
    return false
  }

  const workspacePath = workspace.mainDocument?.path ?? null
  const contextPath = context.filePath ?? null
  return workspacePath !== contextPath
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
  liveDraft: createIdleLiveDraft(),
  suppressedLiveDraftSessionId: null,

  startLiveBlueprintDraft: (options = {}) => {
    const sessionId = options.sessionId ?? null
    if (sessionId !== null && get().suppressedLiveDraftSessionId === sessionId) {
      return false
    }
    set((state) => ({
      suppressedLiveDraftSessionId: state.suppressedLiveDraftSessionId === sessionId ? null : state.suppressedLiveDraftSessionId,
      liveDraft: {
        ...createIdleLiveDraft(),
        status: 'waiting-for-json',
        sessionId,
        markerFound: true,
        updatedAt: new Date().toISOString(),
      },
    }))
    return true
  },

  updateLiveBlueprintDraft: (result, raw, options = {}) => {
    const sessionId = options.sessionId ?? null
    let updated = false
    set((state) => {
      if (sessionId !== null && state.suppressedLiveDraftSessionId === sessionId) {
        return {}
      }
      const activeSessionId = state.liveDraft.sessionId
      if (activeSessionId !== null && sessionId !== null && activeSessionId !== sessionId) {
        return {}
      }
      const nextSessionId = sessionId ?? activeSessionId
      const displayDocument = result.displayDocument
        ? cloneDocumentSnapshot(result.displayDocument)
        : state.liveDraft.displayDocument
      const lastGoodDocument = result.lastGood
        ? cloneDocumentSnapshot(result.lastGood)
        : state.liveDraft.lastGoodDocument

      updated = true
      return {
        liveDraft: {
          ...state.liveDraft,
          status: result.status,
          sessionId: nextSessionId,
          raw,
          markerFound: result.markerFound,
          hasCompleteJson: result.hasCompleteJson,
          displayDocument,
          lastGoodDocument,
          updatedAt: new Date().toISOString(),
          ...(result.error === undefined ? { error: undefined } : { error: result.error }),
        },
      }
    })
    return updated
  },

  clearLiveBlueprintDraft: (options = {}) => {
    set((state) => {
      const sessionId = state.liveDraft.sessionId
      return {
        liveDraft: createIdleLiveDraft(),
        suppressedLiveDraftSessionId: options.suppressCurrentSession && sessionId !== null ? sessionId : null,
      }
    })
  },

  acceptLiveBlueprintDraft: async (context) => {
    const liveDocument = get().liveDraft.displayDocument
    if (liveDocument === null) {
      return null
    }

    const mainHash = await hashDocument(context.mainDocument)
    const record = await createBlueprintFromDocument({
      document: liveDocument,
      title: context.title ?? liveDocument.document.title,
      description: context.description,
      baseMainDocumentHash: mainHash,
      source: 'agent',
      validationState: 'unknown',
      tags: ['agent', 'live-draft'],
      notes: 'Accepted from a recovered or in-progress live blueprint draft.',
      extensions: {
        liveDraft: {
          acceptedAt: new Date().toISOString(),
        },
      },
    })

    let accepted: BlueprintRecord | null = null
    set((state) => {
      const latestLiveDocument = state.liveDraft.displayDocument
      if (latestLiveDocument === null) {
        accepted = null
        return {}
      }

      const sessionId = state.liveDraft.sessionId
      const currentWorkspace = state.workspace ?? createWorkspaceForDocument(context.filePath, context.mainDocument, mainHash)
      const reboundWorkspace = withUpdatedMainDocumentRef(currentWorkspace, context.filePath, context.mainDocument, mainHash)
      accepted = record
      return {
        workspace: {
          ...reboundWorkspace,
          updatedAt: new Date().toISOString(),
          blueprints: [...reboundWorkspace.blueprints, record],
        },
        selectedBlueprintId: record.id,
        dirty: true,
        liveDraft: createIdleLiveDraft(),
        suppressedLiveDraftSessionId: sessionId,
      }
    })

    return accepted
  },

  isLiveBlueprintDraftSessionSuppressed: (sessionId) => {
    return sessionId !== null && sessionId !== undefined && get().suppressedLiveDraftSessionId === sessionId
  },

  setWorkspaceAgentThreads: (agentThreads) => {
    set((state) => {
      if (state.workspace === null || state.workspace.extensions?.agentThreads === agentThreads) {
        return {}
      }

      return {
        workspace: withWorkspaceAgentThreads(state.workspace, agentThreads),
        dirty: true,
      }
    })
  },

  addAgentBlueprintCandidates: async (candidates, context) => {
    const insertionVersion = candidateInsertionVersion
    const mainHash = await hashDocument(context.mainDocument)
    if (insertionVersion !== candidateInsertionVersion) {
      return []
    }

    const records = await Promise.all(
      candidates.map((candidate, index) => {
        const simulation = getCandidateSimulationArtifact(candidate)
        return createBlueprintFromDocument({
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
              selfCheck: candidate.selfCheck,
              toolIssues: candidate.toolIssues ?? [],
            },
            ...(simulation === undefined ? {} : { simulation }),
          },
        })
      }),
    )
    if (insertionVersion !== candidateInsertionVersion) {
      return []
    }

    let inserted: BlueprintRecord[] = []
    set((state) => {
      const currentWorkspace = state.workspace
      const workspace = currentWorkspace ?? createWorkspaceForDocument(context.filePath, context.mainDocument, mainHash)
      if (currentWorkspace !== null && isDefinitelyDifferentMainDocument(workspace, context)) {
        inserted = []
        return {}
      }

      const reboundWorkspace = withUpdatedMainDocumentRef(workspace, context.filePath, context.mainDocument, mainHash)
      inserted = records
      return {
        workspace: {
          ...reboundWorkspace,
          updatedAt: new Date().toISOString(),
          blueprints: [...reboundWorkspace.blueprints, ...records],
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
        liveDraft: createIdleLiveDraft(),
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
        liveDraft: createIdleLiveDraft(),
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
        liveDraft: createIdleLiveDraft(),
      })
    }
  },

  rebindForSavedDocument: async (filePath, mainDocument) => {
    const requestVersion = ++loadRequestVersion
    ++candidateInsertionVersion
    const mainHash = await hashDocument(mainDocument)
    if (requestVersion !== loadRequestVersion) {
      return
    }

    const sidecarPath = await getBlueprintSidecarPathCommand(filePath)
    if (requestVersion !== loadRequestVersion) {
      return
    }

    set((state) => {
      const currentWorkspace = state.workspace ?? createWorkspaceForDocument(filePath, mainDocument, mainHash)
      const nextWorkspace = withUpdatedMainDocumentRef(currentWorkspace, filePath, mainDocument, mainHash)
      return {
        workspace: nextWorkspace,
        sidecarPath,
        dirty: state.dirty || nextWorkspace.blueprints.length > 0,
        loadError: null,
        saveError: null,
        selectedBlueprintId: state.selectedBlueprintId,
        liveDraft: createIdleLiveDraft(),
      }
    })
  },

  saveWorkspace: async () => {
    const { workspace, sidecarPath, loadError } = get()
    if (workspace === null) {
      return
    }

    if (sidecarPath === null) {
      const message = 'Cannot save blueprint workspace until the main document is saved.'
      set({ saveError: message })
      throw new Error(message)
    }

    if (loadError !== null) {
      const message = `Cannot save blueprint workspace because the sidecar failed to load: ${loadError}`
      set({ saveError: message })
      throw new Error(message)
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
    const mainHash = await hashDocument(document)
    const currentWorkspace = workspace ?? createWorkspaceForDocument(null, document, mainHash)
    const blueprint = await createBlueprintFromDocument({
      document,
      title: options?.title,
      description: options?.description,
      baseMainDocumentHash: mainHash,
    })
    set((state) => {
      const latestWorkspace = state.workspace ?? currentWorkspace
      const reboundWorkspace = withUpdatedMainDocumentRef(
        latestWorkspace,
        latestWorkspace.mainDocument?.path ?? null,
        document,
        mainHash,
      )
      const nextWorkspace: BlueprintWorkspaceFile = {
        ...reboundWorkspace,
        updatedAt: new Date().toISOString(),
        blueprints: [...reboundWorkspace.blueprints, blueprint],
      }

      return {
        workspace: nextWorkspace,
        selectedBlueprintId: blueprint.id,
        dirty: true,
      }
    })

    return blueprint
  },

  replaceBlueprintFromDocument: async (id, document, options) => {
    const { workspace } = get()
    const target = workspace?.blueprints.find((record) => record.id === id)
    if (workspace === null || target === undefined || target.lifecycleStatus === 'deleted') {
      return null
    }

    const documentSnapshot = cloneDocumentSnapshot(document)
    const documentHash = await hashDocument(documentSnapshot)
    const mainHash = await hashDocument(document)
    let updatedRecord: BlueprintRecord | null = null

    set((state) => {
      if (state.workspace === null) return {}
      const current = state.workspace.blueprints.find((record) => record.id === id)
      if (current === undefined || current.lifecycleStatus === 'deleted') return {}
      const updatedAt = new Date().toISOString()
      return {
        workspace: updateBlueprint(state.workspace, id, (record) => {
          updatedRecord = {
            ...record,
            title: options?.title ?? record.title,
            ...(options?.description !== undefined ? { description: options.description } : {}),
            document: documentSnapshot,
            documentHash,
            baseMainDocumentHash: mainHash,
            validationState: 'unknown',
            validationReport: undefined,
            notes: options?.notes ?? record.notes,
            updatedAt,
          }
          return updatedRecord
        }),
        selectedBlueprintId: id,
        dirty: true,
      }
    })

    return updatedRecord
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
