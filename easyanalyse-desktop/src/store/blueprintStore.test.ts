import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashDocument } from '../lib/documentHash'
import type { BlueprintWorkspaceFile } from '../types/blueprint'
import type { DocumentFile, ValidationReport } from '../types/document'
import { useBlueprintStore } from './blueprintStore'
import { useEditorStore } from './editorStore'
import { createEmptyBlueprintWorkspace } from '../lib/blueprintWorkspace'

const tauriMocks = vi.hoisted(() => ({
  getBlueprintSidecarPathCommand: vi.fn(),
  loadBlueprintWorkspaceFromPath: vi.fn(),
  saveBlueprintWorkspaceToPath: vi.fn(),
  validateDocumentCommand: vi.fn(),
}))

vi.mock('../lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/tauri')>()),
  getBlueprintSidecarPathCommand: tauriMocks.getBlueprintSidecarPathCommand,
  loadBlueprintWorkspaceFromPath: tauriMocks.loadBlueprintWorkspaceFromPath,
  saveBlueprintWorkspaceToPath: tauriMocks.saveBlueprintWorkspaceToPath,
  validateDocumentCommand: tauriMocks.validateDocumentCommand,
}))

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-1',
      title: 'Reference circuit',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T01:00:00.000Z',
      tags: ['demo'],
    },
    devices: [
      {
        id: 'r1',
        name: 'R1',
        kind: 'resistor',
        terminals: [
          { id: 'r1-a', name: 'A', label: 'VIN', direction: 'input' },
          { id: 'r1-b', name: 'B', label: 'VOUT', direction: 'output' },
        ],
      },
    ],
    view: {
      canvas: { units: 'px', grid: { enabled: true, size: 16 } },
      devices: { r1: { position: { x: 10, y: 20 }, shape: 'rectangle' } },
    },
    ...overrides,
  }
}

function resetBlueprintStore() {
  useBlueprintStore.setState({
    workspace: null,
    sidecarPath: null,
    dirty: false,
    selectedBlueprintId: null,
    loadError: null,
    saveError: null,
    validationError: null,
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetBlueprintStore()
  useEditorStore.setState({ dirty: false })
})

describe('blueprintStore', () => {
  it('createSnapshotFromDocument does not mutate the source document or change the main document hash', async () => {
    const document = createDocument()
    const beforeJson = JSON.stringify(document)
    const beforeHash = await hashDocument(document)

    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document, {
      title: 'Safe snapshot',
      description: 'Must be immutable',
    })

    expect(JSON.stringify(document)).toBe(beforeJson)
    expect(await hashDocument(document)).toBe(beforeHash)
    expect(snapshot.document).toEqual(document)
    expect(snapshot.document).not.toBe(document)
    expect(snapshot.title).toBe('Safe snapshot')
    expect(snapshot.description).toBe('Must be immutable')
    expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1)
    expect(useBlueprintStore.getState().selectedBlueprintId).toBe(snapshot.id)
    expect(useBlueprintStore.getState().dirty).toBe(true)
  })

  it('retains both snapshots created concurrently', async () => {
    const document = createDocument()

    const [firstSnapshot, secondSnapshot] = await Promise.all([
      useBlueprintStore.getState().createSnapshotFromDocument(document, { title: 'Concurrent one' }),
      useBlueprintStore.getState().createSnapshotFromDocument(document, { title: 'Concurrent two' }),
    ])

    const state = useBlueprintStore.getState()
    const snapshotIds = state.workspace?.blueprints.map((record) => record.id) ?? []
    expect(snapshotIds).toHaveLength(2)
    expect(snapshotIds).toEqual(expect.arrayContaining([firstSnapshot.id, secondSnapshot.id]))
    expect([firstSnapshot.id, secondSnapshot.id]).toContain(state.selectedBlueprintId)
    expect(state.dirty).toBe(true)
  })

  it('saveWorkspace only clears blueprint dirty and never clears editorStore dirty', async () => {
    const document = createDocument()
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue('/tmp/circuit.easyanalyse-blueprints.json')
    tauriMocks.loadBlueprintWorkspaceFromPath.mockResolvedValue(null)
    tauriMocks.saveBlueprintWorkspaceToPath.mockResolvedValue(undefined)

    await useBlueprintStore.getState().loadForMainDocument('/tmp/circuit.easyanalyse.json', document)
    await useBlueprintStore.getState().createSnapshotFromDocument(document)
    useEditorStore.setState({ dirty: true })

    await useBlueprintStore.getState().saveWorkspace()

    expect(tauriMocks.saveBlueprintWorkspaceToPath).toHaveBeenCalledTimes(1)
    expect(useBlueprintStore.getState().dirty).toBe(false)
    expect(useEditorStore.getState().dirty).toBe(true)
  })

  it('records readable sidecar load errors without affecting the main document and permits future in-memory operations', async () => {
    const document = createDocument()
    const beforeJson = JSON.stringify(document)
    const beforeHash = await hashDocument(document)
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue('/tmp/circuit.easyanalyse-blueprints.json')
    tauriMocks.loadBlueprintWorkspaceFromPath.mockRejectedValue(new Error('sidecar JSON is malformed'))

    await expect(
      useBlueprintStore.getState().loadForMainDocument('/tmp/circuit.easyanalyse.json', document),
    ).resolves.toBeUndefined()

    expect(JSON.stringify(document)).toBe(beforeJson)
    expect(await hashDocument(document)).toBe(beforeHash)
    expect(useBlueprintStore.getState().sidecarPath).toBe('/tmp/circuit.easyanalyse-blueprints.json')
    expect(useBlueprintStore.getState().loadError).toContain('sidecar JSON is malformed')
    expect(useBlueprintStore.getState().workspace?.blueprints).toEqual([])

    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document, { title: 'Recovered' })

    expect(snapshot.title).toBe('Recovered')
    expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1)
    expect(useBlueprintStore.getState().dirty).toBe(true)
  })

  it('keeps unsaved main documents in memory with sidecarPath=null and save does not write to disk', async () => {
    const document = createDocument()

    await useBlueprintStore.getState().loadForMainDocument(null, document)
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)

    expect(useBlueprintStore.getState().sidecarPath).toBeNull()
    expect(useBlueprintStore.getState().workspace?.blueprints[0]?.id).toBe(snapshot.id)
    expect(useBlueprintStore.getState().dirty).toBe(true)

    await expect(useBlueprintStore.getState().saveWorkspace()).rejects.toThrow('main document is saved')

    expect(tauriMocks.getBlueprintSidecarPathCommand).not.toHaveBeenCalled()
    expect(tauriMocks.saveBlueprintWorkspaceToPath).not.toHaveBeenCalled()
    expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1)
    expect(useBlueprintStore.getState().dirty).toBe(true)
    expect(useBlueprintStore.getState().saveError).toContain('main document')
  })

  it('refuses to save over a sidecar that failed to load', async () => {
    const document = createDocument()
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue('/tmp/circuit.easyanalyse-blueprints.json')
    tauriMocks.loadBlueprintWorkspaceFromPath.mockRejectedValue(new Error('sidecar JSON is malformed'))

    await useBlueprintStore.getState().loadForMainDocument('/tmp/circuit.easyanalyse.json', document)
    await useBlueprintStore.getState().createSnapshotFromDocument(document)

    await expect(useBlueprintStore.getState().saveWorkspace()).rejects.toThrow('sidecar failed to load')

    expect(tauriMocks.saveBlueprintWorkspaceToPath).not.toHaveBeenCalled()
    expect(useBlueprintStore.getState().dirty).toBe(true)
    expect(useBlueprintStore.getState().loadError).toContain('sidecar JSON is malformed')
    expect(useBlueprintStore.getState().saveError).toContain('sidecar failed to load')
  })

  it('validates invalid blueprints in place without discarding or blocking them', async () => {
    const document = createDocument()
    const report: ValidationReport = {
      detectedFormat: 'semantic-v4',
      schemaValid: true,
      semanticValid: false,
      issueCount: 1,
      issues: [{ severity: 'error', code: 'E_TEST', message: 'invalid fixture' }],
    }
    tauriMocks.validateDocumentCommand.mockResolvedValue(report)
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)

    await useBlueprintStore.getState().validateBlueprint(snapshot.id)

    const record = useBlueprintStore.getState().workspace?.blueprints[0]
    expect(record?.id).toBe(snapshot.id)
    expect(record?.validationState).toBe('invalid')
    expect(record?.validationReport).toBe(report)
    expect(useBlueprintStore.getState().dirty).toBe(true)
  })

  it('normalizes loaded sidecars and updates main document reference metadata', async () => {
    const document = createDocument({ document: { id: 'doc-loaded', title: 'Loaded circuit' } })
    const currentHash = await hashDocument(document)
    const sidecar: BlueprintWorkspaceFile = {
      blueprintWorkspaceVersion: '1.0.0',
      workspaceId: 'bpw-loaded',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
      blueprints: [],
      mainDocument: { path: '/old/path.json', hash: 'old-hash', hashAlgorithm: 'easyanalyse-document-canonical-sha256-v1' },
    }
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue('/tmp/circuit.easyanalyse-blueprints.json')
    tauriMocks.loadBlueprintWorkspaceFromPath.mockResolvedValue(sidecar)

    await useBlueprintStore.getState().loadForMainDocument('/tmp/circuit.easyanalyse.json', document)

    expect(useBlueprintStore.getState().workspace?.mainDocument).toMatchObject({
      documentId: 'doc-loaded',
      path: '/tmp/circuit.easyanalyse.json',
      hash: currentHash,
      hashAlgorithm: 'easyanalyse-document-canonical-sha256-v1',
    })
    expect(useBlueprintStore.getState().dirty).toBe(false)
    expect(useBlueprintStore.getState().loadError).toBeNull()
  })

  it('ignores stale overlapping load results so older loads cannot replace the current document workspace', async () => {
    const olderDocument = createDocument({ document: { id: 'doc-old', title: 'Old circuit' } })
    const newerDocument = createDocument({ document: { id: 'doc-new', title: 'New circuit' } })
    const olderLoad = deferred<BlueprintWorkspaceFile | null>()
    const newerLoad = deferred<BlueprintWorkspaceFile | null>()

    tauriMocks.getBlueprintSidecarPathCommand.mockImplementation(async (path: string) => `${path}.blueprints.json`)
    tauriMocks.loadBlueprintWorkspaceFromPath.mockImplementation((path: string) => {
      if (path.includes('old')) return olderLoad.promise
      if (path.includes('new')) return newerLoad.promise
      throw new Error(`unexpected sidecar path ${path}`)
    })

    const olderPromise = useBlueprintStore.getState().loadForMainDocument('/tmp/old.easyanalyse.json', olderDocument)
    const newerPromise = useBlueprintStore.getState().loadForMainDocument('/tmp/new.easyanalyse.json', newerDocument)

    newerLoad.resolve(null)
    await newerPromise
    expect(useBlueprintStore.getState().workspace?.mainDocument?.documentId).toBe('doc-new')

    olderLoad.resolve(null)
    await olderPromise

    expect(useBlueprintStore.getState().workspace?.mainDocument?.documentId).toBe('doc-new')
    expect(useBlueprintStore.getState().sidecarPath).toBe('/tmp/new.easyanalyse.json.blueprints.json')
    expect(useBlueprintStore.getState().dirty).toBe(false)
  })

  it('keeps dirty true when save completes after concurrent blueprint edits', async () => {
    const document = createDocument()
    const save = deferred<void>()
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue('/tmp/circuit.easyanalyse-blueprints.json')
    tauriMocks.loadBlueprintWorkspaceFromPath.mockResolvedValue(null)
    tauriMocks.saveBlueprintWorkspaceToPath.mockReturnValue(save.promise)

    await useBlueprintStore.getState().loadForMainDocument('/tmp/circuit.easyanalyse.json', document)
    await useBlueprintStore.getState().createSnapshotFromDocument(document, { title: 'Saved version' })
    const savePromise = useBlueprintStore.getState().saveWorkspace()
    await useBlueprintStore.getState().createSnapshotFromDocument(document, { title: 'Concurrent edit' })

    save.resolve(undefined)
    await savePromise

    expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(2)
    expect(useBlueprintStore.getState().dirty).toBe(true)
    expect(useBlueprintStore.getState().saveError).toBeNull()
  })

  it('records save failures in readable state without clearing dirty or loadError', async () => {
    const document = createDocument()
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue('/tmp/circuit.easyanalyse-blueprints.json')
    tauriMocks.loadBlueprintWorkspaceFromPath.mockResolvedValue(null)
    tauriMocks.saveBlueprintWorkspaceToPath.mockRejectedValue(new Error('disk is full'))

    await useBlueprintStore.getState().loadForMainDocument('/tmp/circuit.easyanalyse.json', document)
    await useBlueprintStore.getState().createSnapshotFromDocument(document)

    await expect(useBlueprintStore.getState().saveWorkspace()).rejects.toThrow('disk is full')
    expect(useBlueprintStore.getState().dirty).toBe(true)
    expect(useBlueprintStore.getState().loadError).toBeNull()
    expect(useBlueprintStore.getState().saveError).toContain('disk is full')
  })

  it('does not apply stale validation results when a blueprint changes while validation is in flight', async () => {
    const document = createDocument()
    const validation = deferred<ValidationReport>()
    const report: ValidationReport = {
      detectedFormat: 'semantic-v4',
      schemaValid: true,
      semanticValid: true,
      issueCount: 0,
      issues: [],
    }
    tauriMocks.validateDocumentCommand.mockReturnValue(validation.promise)
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)
    const validationPromise = useBlueprintStore.getState().validateBlueprint(snapshot.id)

    useBlueprintStore.setState((state) => ({
      workspace: state.workspace
        ? {
            ...state.workspace,
            blueprints: state.workspace.blueprints.map((record) =>
              record.id === snapshot.id ? { ...record, documentHash: 'changed-after-validation-start' } : record,
            ),
          }
        : state.workspace,
      dirty: true,
    }))

    validation.resolve(report)
    await validationPromise

    const record = useBlueprintStore.getState().workspace?.blueprints[0]
    expect(record?.documentHash).toBe('changed-after-validation-start')
    expect(record?.validationState).toBe('unknown')
    expect(record?.validationReport).toBeUndefined()
    expect(useBlueprintStore.getState().dirty).toBe(true)
  })

  it('does not apply stale validation results when a blueprint is deleted while validation is in flight', async () => {
    const document = createDocument()
    const validation = deferred<ValidationReport>()
    tauriMocks.validateDocumentCommand.mockReturnValue(validation.promise)
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)
    useBlueprintStore.setState({ dirty: false })

    const validationPromise = useBlueprintStore.getState().validateBlueprint(snapshot.id)
    useBlueprintStore.getState().deleteBlueprint(snapshot.id)
    useBlueprintStore.setState({ dirty: false })

    validation.resolve({ detectedFormat: 'semantic-v4', schemaValid: true, semanticValid: true, issueCount: 0, issues: [] })
    await validationPromise

    const record = useBlueprintStore.getState().workspace?.blueprints[0]
    expect(record?.lifecycleStatus).toBe('deleted')
    expect(record?.validationState).toBe('unknown')
    expect(record?.validationReport).toBeUndefined()
    expect(useBlueprintStore.getState().dirty).toBe(false)
  })

  it('does not dirty the store when validation completes after the matching blueprint was removed', async () => {
    const document = createDocument()
    const validation = deferred<ValidationReport>()
    tauriMocks.validateDocumentCommand.mockReturnValue(validation.promise)
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)
    useBlueprintStore.setState({ dirty: false })

    const validationPromise = useBlueprintStore.getState().validateBlueprint(snapshot.id)
    useBlueprintStore.setState((state) => ({
      workspace: state.workspace ? { ...state.workspace, blueprints: [] } : state.workspace,
      dirty: false,
    }))

    validation.resolve({ detectedFormat: 'semantic-v4', schemaValid: true, semanticValid: true, issueCount: 0, issues: [] })
    await validationPromise

    expect(useBlueprintStore.getState().workspace?.blueprints).toEqual([])
    expect(useBlueprintStore.getState().dirty).toBe(false)
  })

  it('records validation failures in readable state without dirtying the store', async () => {
    const document = createDocument()
    tauriMocks.validateDocumentCommand.mockRejectedValue(new Error('validator crashed'))
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)
    useBlueprintStore.setState({ dirty: false })

    await expect(useBlueprintStore.getState().validateBlueprint(snapshot.id)).rejects.toThrow('validator crashed')
    expect(useBlueprintStore.getState().dirty).toBe(false)
    expect(useBlueprintStore.getState().validationError).toContain('validator crashed')
  })

  it('validates archived blueprints instead of treating the visible card action as a store-layer no-op', async () => {
    const document = createDocument()
    const report: ValidationReport = {
      detectedFormat: 'semantic-v4',
      schemaValid: true,
      semanticValid: true,
      issueCount: 0,
      issues: [],
    }
    tauriMocks.validateDocumentCommand.mockResolvedValue(report)
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)

    useBlueprintStore.getState().archiveBlueprint(snapshot.id)
    useBlueprintStore.setState({ dirty: false })

    await useBlueprintStore.getState().validateBlueprint(snapshot.id)

    const record = useBlueprintStore.getState().workspace?.blueprints.find((item) => item.id === snapshot.id)
    expect(tauriMocks.validateDocumentCommand).toHaveBeenCalledTimes(1)
    expect(tauriMocks.validateDocumentCommand).toHaveBeenCalledWith(snapshot.document)
    expect(record?.lifecycleStatus).toBe('archived')
    expect(record?.validationState).toBe('valid')
    expect(record?.validationReport).toBe(report)
    expect(useBlueprintStore.getState().dirty).toBe(true)
  })

  it('treats direct validation of a deleted blueprint as a store-layer no-op', async () => {
    const document = createDocument()
    tauriMocks.validateDocumentCommand.mockResolvedValue({
      detectedFormat: 'semantic-v4',
      schemaValid: true,
      semanticValid: true,
      issueCount: 0,
      issues: [],
    })
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)

    useBlueprintStore.getState().deleteBlueprint(snapshot.id)
    useBlueprintStore.setState({ dirty: false })
    const beforeWorkspace = useBlueprintStore.getState().workspace
    const beforeRecord = beforeWorkspace?.blueprints.find((record) => record.id === snapshot.id)

    await useBlueprintStore.getState().validateBlueprint(snapshot.id)

    expect(tauriMocks.validateDocumentCommand).not.toHaveBeenCalled()
    expect(useBlueprintStore.getState().workspace).toBe(beforeWorkspace)
    expect(useBlueprintStore.getState().workspace?.blueprints.find((record) => record.id === snapshot.id)).toEqual(beforeRecord)
    expect(useBlueprintStore.getState().dirty).toBe(false)
  })

  it('treats missing-id operations as no-ops that do not dirty the store', async () => {
    const document = createDocument()
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)
    useBlueprintStore.setState({ dirty: false, selectedBlueprintId: snapshot.id })
    const beforeWorkspace = useBlueprintStore.getState().workspace

    useBlueprintStore.getState().archiveBlueprint('missing-id')
    useBlueprintStore.getState().deleteBlueprint('missing-id')
    useBlueprintStore.getState().markApplied('missing-id', {
      appliedAt: '2026-04-27T00:00:00.000Z',
      appliedToMainDocumentHash: 'main-hash',
      sourceBlueprintDocumentHash: 'source-hash',
    })
    await useBlueprintStore.getState().validateBlueprint('missing-id')

    expect(tauriMocks.validateDocumentCommand).not.toHaveBeenCalled()
    expect(useBlueprintStore.getState().workspace).toBe(beforeWorkspace)
    expect(useBlueprintStore.getState().selectedBlueprintId).toBe(snapshot.id)
    expect(useBlueprintStore.getState().dirty).toBe(false)
  })

  it('treats repeated archive/delete lifecycle operations as no-ops without dirtying or updating timestamps', async () => {
    const document = createDocument()
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)
    useBlueprintStore.setState((state) => ({
      workspace: state.workspace
        ? {
            ...state.workspace,
            blueprints: [
              { ...snapshot, lifecycleStatus: 'archived', updatedAt: '2026-04-27T03:00:00.000Z' },
              { ...snapshot, id: 'deleted-bp', lifecycleStatus: 'deleted', updatedAt: '2026-04-27T04:00:00.000Z' },
            ],
          }
        : state.workspace,
      dirty: false,
    }))
    const beforeWorkspace = useBlueprintStore.getState().workspace

    useBlueprintStore.getState().archiveBlueprint(snapshot.id)
    useBlueprintStore.getState().archiveBlueprint('deleted-bp')
    useBlueprintStore.getState().deleteBlueprint('deleted-bp')

    expect(useBlueprintStore.getState().workspace).toBe(beforeWorkspace)
    expect(useBlueprintStore.getState().workspace?.blueprints[0]?.updatedAt).toBe('2026-04-27T03:00:00.000Z')
    expect(useBlueprintStore.getState().workspace?.blueprints[1]?.updatedAt).toBe('2026-04-27T04:00:00.000Z')
    expect(useBlueprintStore.getState().dirty).toBe(false)
  })

  it('creates snapshots with main document metadata and base hash after explicit workspace initialization', async () => {
    const document = createDocument({ document: { id: 'doc-initialized', title: 'Initialized circuit' } })
    const mainHash = await hashDocument(document)

    await useBlueprintStore.getState().loadForMainDocument(null, document)
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)

    expect(useBlueprintStore.getState().workspace?.mainDocument).toMatchObject({
      documentId: 'doc-initialized',
      hash: mainHash,
    })
    expect(snapshot.baseMainDocumentHash).toBe(mainHash)
  })

  it('uses the current dirty main document hash as snapshot base hash', async () => {
    const savedDocument = createDocument({ document: { id: 'doc-main', title: 'Saved' } })
    const dirtyDocument = createDocument({
      document: { id: 'doc-main', title: 'Dirty title' },
      devices: [
        ...savedDocument.devices,
        { id: 'c1', name: 'C1', kind: 'capacitor', terminals: [] },
      ],
    })
    const savedHash = await hashDocument(savedDocument)
    const dirtyHash = await hashDocument(dirtyDocument)

    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue('/tmp/main.easyanalyse-blueprints.json')
    tauriMocks.loadBlueprintWorkspaceFromPath.mockResolvedValue(null)
    await useBlueprintStore.getState().loadForMainDocument('/tmp/main.easyanalyse.json', savedDocument)
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(dirtyDocument)

    expect(snapshot.baseMainDocumentHash).toBe(dirtyHash)
    expect(snapshot.baseMainDocumentHash).not.toBe(savedHash)
    expect(useBlueprintStore.getState().workspace?.mainDocument).toMatchObject({
      documentId: 'doc-main',
      path: '/tmp/main.easyanalyse.json',
      hash: dirtyHash,
    })
  })

  it('creates snapshots with main document metadata and base hash when workspace is null', async () => {
    const document = createDocument({ document: { id: 'doc-null-workspace', title: 'Null workspace circuit' } })
    const mainHash = await hashDocument(document)

    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)

    expect(useBlueprintStore.getState().workspace?.mainDocument).toMatchObject({
      documentId: 'doc-null-workspace',
      hash: mainHash,
      hashAlgorithm: 'easyanalyse-document-canonical-sha256-v1',
    })
    expect(useBlueprintStore.getState().workspace?.mainDocument?.path).toBeUndefined()
    expect(snapshot.baseMainDocumentHash).toBe(mainHash)
  })

  it('isolates blueprint dirty changes from editor dirty state', async () => {
    const document = createDocument()
    useBlueprintStore.setState({
      workspace: createEmptyBlueprintWorkspace({ mainDocument: { documentId: document.document.id, hash: await hashDocument(document) } }),
      dirty: false,
    })
    const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(document)
    useBlueprintStore.setState({ dirty: false })
    useEditorStore.setState({ dirty: false })

    useBlueprintStore.getState().archiveBlueprint(snapshot.id)

    expect(useBlueprintStore.getState().dirty).toBe(true)
    expect(useEditorStore.getState().dirty).toBe(false)
  })
})
