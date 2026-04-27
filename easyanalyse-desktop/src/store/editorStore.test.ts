import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentFile, ValidationReport } from '../types/document'
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
}))

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-main',
      title: 'Main circuit',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T01:00:00.000Z',
      tags: ['editor'],
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

function validationReport(document: DocumentFile, overrides: Partial<ValidationReport> = {}): ValidationReport {
  return {
    detectedFormat: 'semantic-v4',
    schemaValid: true,
    semanticValid: true,
    issueCount: 0,
    issues: [],
    normalizedDocument: document,
    ...overrides,
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

beforeEach(() => {
  vi.clearAllMocks()
  tauriMocks.isTauriRuntime.mockReturnValue(false)
  useEditorStore.setState({
    document: createDocument(),
    filePath: '/tmp/main.easyanalyse.json',
    dirty: false,
    validationReport: null,
    selection: { entityType: 'device', id: 'r1' },
    pendingDeviceShape: 'circle',
    pendingDeviceTemplateKey: 'module',
    focusedDeviceId: 'r1',
    focusedLabelKey: 'VIN',
    focusedNetworkLineId: 'net-vin',
    viewportAnimationTarget: { center: { x: 100, y: 200 }, zoom: 2, sequence: 3 },
    history: [],
    future: [createDocument({ document: { id: 'doc-future', title: 'Future' } })],
    statusMessage: 'before apply',
  })
})

describe('editorStore.applyBlueprintDocument', () => {
  it('applies a blueprint document in memory without saving, marks dirty, resets transient editor state, and supports undo/redo', () => {
    const original = createDocument()
    const blueprint = createDocument({
      document: { id: 'doc-blueprint', title: 'Blueprint candidate' },
      devices: [
        {
          id: 'u1',
          name: 'U1',
          kind: 'mcu',
          reference: 'U1',
          terminals: [{ id: 'u1-vin', name: 'VIN', label: 'VIN', direction: 'input' }],
        },
      ],
      view: {
        canvas: { units: 'px', grid: { enabled: true, size: 24 } },
        devices: { u1: { position: { x: 80, y: 120 }, shape: 'rectangle' } },
      },
    })
    useEditorStore.setState({ document: original })

    useEditorStore.getState().applyBlueprintDocument(blueprint)

    const appliedDocument = useEditorStore.getState().document
    expect(appliedDocument.document.id).toBe('doc-blueprint')
    expect(appliedDocument.devices.map((device) => device.id)).toEqual(['u1'])
    expect(appliedDocument).not.toBe(blueprint)
    expect(useEditorStore.getState().dirty).toBe(true)
    expect(useEditorStore.getState().history).toEqual([original])
    expect(useEditorStore.getState().future).toEqual([])
    expect(useEditorStore.getState().selection).toEqual({ entityType: 'document' })
    expect(useEditorStore.getState().pendingDeviceShape).toBeNull()
    expect(useEditorStore.getState().pendingDeviceTemplateKey).toBeNull()
    expect(useEditorStore.getState().focusedDeviceId).toBeNull()
    expect(useEditorStore.getState().focusedLabelKey).toBeNull()
    expect(useEditorStore.getState().focusedNetworkLineId).toBeNull()
    expect(useEditorStore.getState().viewportAnimationTarget).toBeNull()
    expect(tauriMocks.saveDocumentToPath).not.toHaveBeenCalled()

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().document.document.id).toBe(original.document.id)
    expect(useEditorStore.getState().document.devices.map((device) => device.id)).toEqual(['r1'])
    expect(useEditorStore.getState().future).toEqual([appliedDocument])

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().document.document.id).toBe(appliedDocument.document.id)
    expect(useEditorStore.getState().document.devices.map((device) => device.id)).toEqual(['u1'])
  })

  it('invalidates a pending openDocument result before applying a blueprint document', async () => {
    const staleOpenDocument = createDocument({ document: { id: 'doc-stale-open', title: 'Stale open' } })
    const blueprint = createDocument({ document: { id: 'doc-blueprint-pending-open', title: 'Blueprint wins' } })
    const pendingOpen = deferred<{
      path: string
      document: DocumentFile
      report: ValidationReport
    }>()
    dialogMocks.open.mockResolvedValue('/tmp/stale.easyanalyse.json')
    tauriMocks.openDocumentFromPath.mockReturnValueOnce(pendingOpen.promise)

    const openPromise = useEditorStore.getState().openDocument()
    await vi.waitFor(() => expect(tauriMocks.openDocumentFromPath).toHaveBeenCalledWith('/tmp/stale.easyanalyse.json'))

    useEditorStore.getState().applyBlueprintDocument(blueprint)
    expect(useEditorStore.getState().document.document.id).toBe('doc-blueprint-pending-open')
    expect(useEditorStore.getState().dirty).toBe(true)

    pendingOpen.resolve({
      path: '/tmp/stale.easyanalyse.json',
      document: staleOpenDocument,
      report: validationReport(staleOpenDocument),
    })
    await openPromise
    await Promise.resolve()

    expect(useEditorStore.getState().document.document.id).toBe('doc-blueprint-pending-open')
    expect(useEditorStore.getState().dirty).toBe(true)
  })

  it('does not block invalid blueprint documents and keeps stale validation results from replacing newer validation state', async () => {
    tauriMocks.isTauriRuntime.mockReturnValue(true)
    const invalidBlueprint = createDocument({
      document: { id: 'doc-invalid-blueprint', title: '' },
      devices: [],
    })
    const newerBlueprint = createDocument({ document: { id: 'doc-newer-blueprint', title: 'Newer blueprint' } })
    const invalidValidation = deferred<ValidationReport>()
    const newerValidation = deferred<ValidationReport>()
    tauriMocks.validateDocumentCommand
      .mockReturnValueOnce(invalidValidation.promise)
      .mockReturnValueOnce(newerValidation.promise)

    useEditorStore.getState().applyBlueprintDocument(invalidBlueprint)

    expect(useEditorStore.getState().document.document.id).toBe('doc-invalid-blueprint')
    expect(useEditorStore.getState().dirty).toBe(true)
    expect(tauriMocks.saveDocumentToPath).not.toHaveBeenCalled()
    expect(tauriMocks.validateDocumentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ id: 'doc-invalid-blueprint' }),
        devices: [],
      }),
    )

    useEditorStore.getState().applyBlueprintDocument(newerBlueprint)
    newerValidation.resolve(validationReport(newerBlueprint))
    await vi.waitFor(() => expect(useEditorStore.getState().validationReport?.semanticValid).toBe(true))

    invalidValidation.resolve(
      validationReport(invalidBlueprint, {
        schemaValid: false,
        semanticValid: false,
        issueCount: 1,
        issues: [{ severity: 'error', code: 'E_INVALID_BLUEPRINT', message: 'invalid but applicable' }],
      }),
    )
    await Promise.resolve()

    expect(useEditorStore.getState().document.document.id).toBe('doc-newer-blueprint')
    expect(useEditorStore.getState().validationReport).toEqual(validationReport(newerBlueprint))
    expect(tauriMocks.validateDocumentCommand).toHaveBeenCalledTimes(2)
  })
})
