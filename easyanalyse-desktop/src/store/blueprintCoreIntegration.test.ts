import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlueprintFromDocument } from '../lib/blueprintWorkspace'
import { hashDocument } from '../lib/documentHash'
import type { BlueprintWorkspaceFile } from '../types/blueprint'
import type { DocumentFile, OpenDocumentResult, ValidationReport } from '../types/document'
import { useBlueprintStore } from './blueprintStore'
import { useEditorStore } from './editorStore'

const dialogMocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}))

const tauriMocks = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(),
  openDocumentFromPath: vi.fn(),
  saveDocumentToPath: vi.fn(),
  validateDocumentCommand: vi.fn(),
  getBlueprintSidecarPathCommand: vi.fn(),
  loadBlueprintWorkspaceFromPath: vi.fn(),
  saveBlueprintWorkspaceToPath: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: dialogMocks.open,
  save: dialogMocks.save,
}))

vi.mock('../lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/tauri')>()),
  isTauriRuntime: tauriMocks.isTauriRuntime,
  openDocumentFromPath: tauriMocks.openDocumentFromPath,
  saveDocumentToPath: tauriMocks.saveDocumentToPath,
  validateDocumentCommand: tauriMocks.validateDocumentCommand,
  getBlueprintSidecarPathCommand: tauriMocks.getBlueprintSidecarPathCommand,
  loadBlueprintWorkspaceFromPath: tauriMocks.loadBlueprintWorkspaceFromPath,
  saveBlueprintWorkspaceToPath: tauriMocks.saveBlueprintWorkspaceToPath,
}))

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-integration',
      title: 'Integration Circuit',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T01:00:00.000Z',
      tags: ['acceptance'],
    },
    devices: [
      {
        id: 'r1',
        name: 'R1',
        kind: 'resistor',
        reference: 'R1',
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

function validationReport(document: DocumentFile): ValidationReport {
  return {
    detectedFormat: 'semantic-v4',
    schemaValid: true,
    semanticValid: true,
    issueCount: 0,
    issues: [],
    normalizedDocument: document,
  }
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

function resetStores() {
  useBlueprintStore.setState({
    workspace: null,
    sidecarPath: null,
    dirty: false,
    selectedBlueprintId: null,
    loadError: null,
    saveError: null,
    validationError: null,
  })
  useEditorStore.setState({
    document: createDocument(),
    filePath: null,
    dirty: false,
    validationReport: null,
    selection: { entityType: 'document' },
    history: [],
    future: [],
    statusMessage: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStores()
  tauriMocks.isTauriRuntime.mockReturnValue(false)
})

describe('M1 blueprint core integration acceptance', () => {
  it('reopens a main document, restores its blueprint list, then creates and saves a sidecar-only snapshot', async () => {
    const mainPath = '/a/b/foo.json'
    const sidecarPath = '/a/b/foo.easyanalyse-blueprints.json'
    const document = createDocument()
    const existingBlueprint = await createBlueprintFromDocument({
      id: 'bp-existing',
      title: 'Existing reopened blueprint',
      document,
      validationState: 'invalid',
      validationReport: {
        detectedFormat: 'semantic-v4',
        schemaValid: true,
        semanticValid: false,
        issueCount: 1,
        issues: [{ severity: 'error', code: 'E_ACCEPTANCE', message: 'kept for later fixes' }],
      },
      now: '2026-04-26T02:00:00.000Z',
    })
    const sidecar: BlueprintWorkspaceFile = {
      blueprintWorkspaceVersion: '1.0.0',
      workspaceId: 'bpw-reopen',
      createdAt: '2026-04-26T02:00:00.000Z',
      updatedAt: '2026-04-26T02:00:00.000Z',
      blueprints: [existingBlueprint],
    }
    const openResult: OpenDocumentResult = {
      path: mainPath,
      document,
      report: validationReport(document),
    }
    dialogMocks.open.mockResolvedValue(mainPath)
    tauriMocks.openDocumentFromPath.mockResolvedValue(openResult)
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue(sidecarPath)
    tauriMocks.loadBlueprintWorkspaceFromPath.mockResolvedValue(sidecar)
    tauriMocks.saveBlueprintWorkspaceToPath.mockResolvedValue(undefined)

    await useEditorStore.getState().openDocument()

    expect(useEditorStore.getState().filePath).toBe(mainPath)
    expect(useEditorStore.getState().dirty).toBe(false)
    expect(tauriMocks.getBlueprintSidecarPathCommand).toHaveBeenCalledWith(mainPath)
    expect(useBlueprintStore.getState().sidecarPath).toBe(sidecarPath)
    expect(useBlueprintStore.getState().workspace?.blueprints.map((record) => record.id)).toEqual(['bp-existing'])
    expect(useBlueprintStore.getState().workspace?.blueprints[0]?.validationState).toBe('invalid')

    const snapshot = await useBlueprintStore
      .getState()
      .createSnapshotFromDocument(useEditorStore.getState().document, { title: 'Manual acceptance snapshot' })
    await useBlueprintStore.getState().saveWorkspace()

    expect(snapshot.source).toBe('manual_snapshot')
    expect(snapshot.lifecycleStatus).toBe('active')
    expect(snapshot.validationState).toBe('unknown')
    expect(tauriMocks.saveBlueprintWorkspaceToPath).toHaveBeenCalledTimes(1)
    const [savedPath, savedWorkspace] = tauriMocks.saveBlueprintWorkspaceToPath.mock.calls[0] as [string, BlueprintWorkspaceFile]
    expect(savedPath).toBe(sidecarPath)
    expect(savedWorkspace.blueprints.map((record) => record.id)).toEqual(['bp-existing', snapshot.id])
    expect(JSON.parse(JSON.stringify(useEditorStore.getState().document))).not.toHaveProperty('blueprints')
    expect(tauriMocks.saveDocumentToPath).not.toHaveBeenCalled()
    expect(useEditorStore.getState().dirty).toBe(false)
    expect(useBlueprintStore.getState().dirty).toBe(false)
  })

  it('resets a brand-new document to an empty blueprint workspace instead of carrying a previous sidecar', async () => {
    const mainPath = '/a/b/previous.json'
    const previousDocument = createDocument({ document: { id: 'doc-previous', title: 'Previous Circuit' } })
    const existingBlueprint = await createBlueprintFromDocument({
      id: 'bp-previous',
      title: 'Must not leak',
      document: previousDocument,
    })
    dialogMocks.open.mockResolvedValue(mainPath)
    tauriMocks.openDocumentFromPath.mockResolvedValue({
      path: mainPath,
      document: previousDocument,
      report: validationReport(previousDocument),
    })
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue('/a/b/previous.easyanalyse-blueprints.json')
    tauriMocks.loadBlueprintWorkspaceFromPath.mockResolvedValue({
      blueprintWorkspaceVersion: '1.0.0',
      workspaceId: 'bpw-previous',
      createdAt: '2026-04-26T02:00:00.000Z',
      updatedAt: '2026-04-26T02:00:00.000Z',
      blueprints: [existingBlueprint],
    })

    await useEditorStore.getState().openDocument()
    expect(useBlueprintStore.getState().workspace?.blueprints.map((record) => record.id)).toEqual(['bp-previous'])

    await useEditorStore.getState().newDocument()

    const editorDocument = useEditorStore.getState().document
    expect(useEditorStore.getState().filePath).toBeNull()
    expect(useBlueprintStore.getState().sidecarPath).toBeNull()
    expect(useBlueprintStore.getState().workspace?.mainDocument?.documentId).toBe(editorDocument.document.id)
    expect(useBlueprintStore.getState().workspace?.blueprints).toEqual([])
    expect(useBlueprintStore.getState().dirty).toBe(false)
    expect(useBlueprintStore.getState().loadError).toBeNull()
  })

  it('opens a main document with a malformed sidecar as a clean empty blueprint workspace', async () => {
    const mainPath = '/a/b/malformed.json'
    const sidecarPath = '/a/b/malformed.easyanalyse-blueprints.json'
    const document = createDocument({ document: { id: 'doc-malformed', title: 'Malformed Sidecar' } })
    dialogMocks.open.mockResolvedValue(mainPath)
    tauriMocks.openDocumentFromPath.mockResolvedValue({ path: mainPath, document, report: validationReport(document) })
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue(sidecarPath)
    tauriMocks.loadBlueprintWorkspaceFromPath.mockRejectedValue(new Error('sidecar JSON is malformed'))

    await useEditorStore.getState().openDocument()

    expect(useEditorStore.getState().filePath).toBe(mainPath)
    expect(useEditorStore.getState().document.document.id).toBe('doc-malformed')
    expect(useBlueprintStore.getState().sidecarPath).toBe(sidecarPath)
    expect(useBlueprintStore.getState().workspace?.mainDocument?.documentId).toBe('doc-malformed')
    expect(useBlueprintStore.getState().workspace?.blueprints).toEqual([])
    expect(useBlueprintStore.getState().loadError).toContain('sidecar JSON is malformed')
  })

  it('uses the normalized editor document when recording blueprint main-document metadata after open', async () => {
    const mainPath = '/a/b/normalizes.json'
    const rawDocument = createDocument({
      document: { id: 'doc-normalized', title: 'Normalizes on Open' },
      view: { canvas: { units: 'px', grid: { enabled: true, size: 16 } }, devices: {} },
    })
    dialogMocks.open.mockResolvedValue(mainPath)
    tauriMocks.openDocumentFromPath.mockResolvedValue({ path: mainPath, document: rawDocument, report: validationReport(rawDocument) })
    tauriMocks.getBlueprintSidecarPathCommand.mockResolvedValue('/a/b/normalizes.easyanalyse-blueprints.json')
    tauriMocks.loadBlueprintWorkspaceFromPath.mockResolvedValue(null)

    await useEditorStore.getState().openDocument()

    const normalizedEditorDocument = useEditorStore.getState().document
    expect(useBlueprintStore.getState().workspace?.mainDocument?.hash).toBe(await hashDocument(normalizedEditorDocument))
    expect(useBlueprintStore.getState().workspace?.mainDocument?.hash).not.toBe(await hashDocument(rawDocument))
  })

  it('ignores stale editor-level open results when two document opens overlap', async () => {
    const olderPath = '/a/b/older.json'
    const newerPath = '/a/b/newer.json'
    const olderDocument = createDocument({ document: { id: 'doc-older', title: 'Older' } })
    const newerDocument = createDocument({ document: { id: 'doc-newer', title: 'Newer' } })
    const olderOpen = deferred<OpenDocumentResult>()
    const newerOpen = deferred<OpenDocumentResult>()

    dialogMocks.open.mockResolvedValueOnce(olderPath).mockResolvedValueOnce(newerPath)
    tauriMocks.openDocumentFromPath.mockImplementation((path: string) => {
      if (path === olderPath) return olderOpen.promise
      if (path === newerPath) return newerOpen.promise
      throw new Error(`unexpected path ${path}`)
    })
    tauriMocks.getBlueprintSidecarPathCommand.mockImplementation(async (path: string) => `${path}.blueprints.json`)
    tauriMocks.loadBlueprintWorkspaceFromPath.mockResolvedValue(null)

    const olderPromise = useEditorStore.getState().openDocument()
    const newerPromise = useEditorStore.getState().openDocument()

    newerOpen.resolve({ path: newerPath, document: newerDocument, report: validationReport(newerDocument) })
    await newerPromise
    expect(useEditorStore.getState().filePath).toBe(newerPath)
    expect(useEditorStore.getState().document.document.id).toBe('doc-newer')

    olderOpen.resolve({ path: olderPath, document: olderDocument, report: validationReport(olderDocument) })
    await olderPromise

    expect(useEditorStore.getState().filePath).toBe(newerPath)
    expect(useEditorStore.getState().document.document.id).toBe('doc-newer')
    expect(useBlueprintStore.getState().workspace?.mainDocument?.documentId).toBe('doc-newer')
    expect(useBlueprintStore.getState().sidecarPath).toBe(`${newerPath}.blueprints.json`)
  })
})
