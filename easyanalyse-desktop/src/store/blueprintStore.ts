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
const validationTokensById = new Map<string, number>()

export const useBlueprintStore = create<BlueprintState>((set, get) => ({
  workspace: null,
  sidecarPath: null,
  dirty: false,
  selectedBlueprintId: null,
  loadError: null,
  saveError: null,
  validationError: null,

  loadForMainDocument: async (filePath, mainDocument) => {
    const requestVersion = ++loadRequestVersion
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
    const currentWorkspace = workspace ?? createEmptyBlueprintWorkspace()
    const blueprint = await createBlueprintFromDocument({
      document,
      title: options?.title,
      description: options?.description,
      baseMainDocumentHash: currentWorkspace.mainDocument?.hash,
    })
    set((state) => {
      const latestWorkspace = state.workspace ?? createEmptyBlueprintWorkspace()
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
    if (workspace === null || record === undefined) {
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
      if (state.workspace === null || !state.workspace.blueprints.some((record) => record.id === id)) {
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
      if (state.workspace === null || !state.workspace.blueprints.some((record) => record.id === id)) {
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
