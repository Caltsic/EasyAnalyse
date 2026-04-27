// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_HASH_ALGORITHM, hashDocument } from '../../lib/documentHash'
import { createEmptyBlueprintWorkspace } from '../../lib/blueprintWorkspace'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import type { BlueprintRecord } from '../../types/blueprint'
import type { DocumentFile } from '../../types/document'
import { ApplyBlueprintDialog } from './ApplyBlueprintDialog'

vi.mock('./BlueprintPreviewCanvas', () => ({
  BlueprintPreviewCanvas: ({ document, className }: { document: DocumentFile; className?: string }) => (
    <div aria-label="Blueprint preview canvas" className={className} data-document-title={document.document.title} />
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-ui',
      title: 'UI Reference Circuit',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T01:00:00.000Z',
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
      networkLines: {},
    },
    ...overrides,
  }
}

function resetStores(document = createDocument()) {
  useEditorStore.setState({
    document,
    filePath: null,
    dirty: false,
    locale: 'en-US',
  })
  useBlueprintStore.setState({
    workspace: createEmptyBlueprintWorkspace({
      mainDocument: {
        documentId: document.document.id,
        hash: 'current-main-hash',
      },
    }),
    sidecarPath: null,
    dirty: false,
    selectedBlueprintId: null,
    loadError: null,
    saveError: null,
    validationError: null,
  })
}

async function renderPanel() {
  const { BlueprintsPanel } = await import('./BlueprintsPanel')
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<BlueprintsPanel />)
  })
  return container
}

function firstButtonByText(host: ParentNode, text: string) {
  return Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes(text))
}

function cardByTitle(host: ParentNode, title: string) {
  return Array.from(host.querySelectorAll('article')).find((card) => card.textContent?.includes(title))
}

async function createBlueprintRecord(overrides: Partial<BlueprintRecord> = {}): Promise<BlueprintRecord> {
  const document = createDocument({ document: { ...createDocument().document, title: 'Blueprint Candidate' } })
  return {
    id: 'bp-modal-safety',
    title: 'Modal safety blueprint',
    lifecycleStatus: 'active',
    validationState: 'valid',
    validationReport: { detectedFormat: 'semantic-v4', schemaValid: true, semanticValid: true, issueCount: 0, issues: [] },
    document,
    documentHash: await hashDocument(document),
    baseMainDocumentHash: await hashDocument(createDocument()),
    source: 'manual_snapshot',
    createdAt: '2026-04-27T02:00:00.000Z',
    updatedAt: '2026-04-27T02:00:00.000Z',
    ...overrides,
  }
}

async function renderApplyDialog(props: Partial<ComponentProps<typeof ApplyBlueprintDialog>> = {}) {
  const mainDocument = createDocument()
  const record = props.record ?? await createBlueprintRecord()
  const currentMainHash = props.currentMainHash ?? await hashDocument(mainDocument)
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  const onCancel = props.onCancel ?? vi.fn()
  const onConfirm = props.onConfirm ?? vi.fn()
  await act(async () => {
    root?.render(
      <ApplyBlueprintDialog
        record={record}
        mainDocument={props.mainDocument ?? mainDocument}
        currentMainHash={currentMainHash}
        applying={props.applying ?? false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
  })
  return { host: container, onCancel, onConfirm }
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

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  root = null
  container = null
})

beforeEach(() => {
  resetStores()
})

describe('BlueprintsPanel', () => {
  it('does not focus the destructive confirm action by default or apply from root Enter/Space', async () => {
    const { host, onConfirm } = await renderApplyDialog()
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement
    const confirmButton = firstButtonByText(host, 'Confirm apply') as HTMLButtonElement
    const cancelButton = firstButtonByText(host, 'Cancel') as HTMLButtonElement

    expect(window.document.activeElement).not.toBe(confirmButton)
    expect(window.document.activeElement).toBe(cancelButton)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('traps Tab focus inside the apply dialog controls', async () => {
    const { host } = await renderApplyDialog()
    const closeButton = host.querySelector('[aria-label="Close apply blueprint dialog"]') as HTMLButtonElement
    const confirmButton = firstButtonByText(host, 'Confirm apply') as HTMLButtonElement

    confirmButton.focus()
    await act(async () => {
      confirmButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(window.document.activeElement).toBe(closeButton)

    await act(async () => {
      closeButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    })
    expect(window.document.activeElement).toBe(confirmButton)
  })

  it('handles Escape locally when not applying and blocks backdrop cancellation while applying', async () => {
    const documentKeydown = vi.fn()
    window.document.addEventListener('keydown', documentKeydown)
    const { host, onCancel } = await renderApplyDialog()
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(documentKeydown).not.toHaveBeenCalled()
    window.document.removeEventListener('keydown', documentKeydown)

    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null

    const applyingDialog = await renderApplyDialog({ applying: true })
    await act(async () => {
      applyingDialog.host.querySelector('.apply-blueprint-dialog__backdrop')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(applyingDialog.onCancel).not.toHaveBeenCalled()
  })

  it('disables background blueprint actions while an apply confirmation modal is open', async () => {
    const main = createDocument()
    const mainHash = await hashDocument(main)
    const base = await createBlueprintRecord({ baseMainDocumentHash: mainHash })
    resetStores(main)
    useBlueprintStore.setState({
      workspace: {
        ...createEmptyBlueprintWorkspace(),
        mainDocument: { documentId: main.document.id, hash: mainHash, hashAlgorithm: DOCUMENT_HASH_ALGORITHM },
        blueprints: [
          { ...base, id: 'bp-open', title: 'Open modal blueprint' },
          { ...base, id: 'bp-background', title: 'Background blueprint' },
        ],
      },
    })
    const host = await renderPanel()

    await act(async () => {
      firstButtonByText(cardByTitle(host, 'Open modal blueprint')!, 'Apply')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const backgroundCard = cardByTitle(host, 'Background blueprint')!
    expect((firstButtonByText(backgroundCard, 'Select') as HTMLButtonElement).disabled).toBe(true)
    expect((firstButtonByText(backgroundCard, 'Validate') as HTMLButtonElement).disabled).toBe(true)
    expect((firstButtonByText(backgroundCard, 'Apply') as HTMLButtonElement).disabled).toBe(true)
    expect((firstButtonByText(backgroundCard, 'Archive') as HTMLButtonElement).disabled).toBe(true)
    expect((firstButtonByText(backgroundCard, 'Delete') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows empty in-memory sidecar state and creates a snapshot without changing the main document canonical hash', async () => {
    const document = createDocument()
    resetStores(document)
    const beforeHash = await hashDocument(document)
    const host = await renderPanel()

    expect(host.textContent).toContain('Blueprints')
    expect(host.textContent).toContain('In-memory workspace')
    expect(host.textContent).toContain('Sidecar: not available until the main document is saved')
    expect(host.textContent).toContain('No blueprints yet')
    expect(host.textContent).toContain('Workspace clean')

    await act(async () => {
      firstButtonByText(host, 'Create snapshot')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(host.textContent).toContain('UI Reference Circuit')
    expect(host.textContent).toContain('manual_snapshot')
    expect(host.textContent).toContain('active')
    expect(host.textContent).toContain('unknown')
    expect(host.textContent).toContain('Current main document')
    expect(host.textContent).toContain('Workspace dirty')
    expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1)
    await expect(hashDocument(document)).resolves.toBe(beforeHash)
  })

  it('renders lifecycle, validation, issue, applied, current, archived, deleted, and dirty state on cards', async () => {
    const document = createDocument()
    const currentHash = await hashDocument(document)
    resetStores(document)
    const active: BlueprintRecord = {
      id: 'bp-active',
      title: 'Validated snapshot',
      description: 'ready for review',
      lifecycleStatus: 'active',
      validationState: 'invalid',
      validationReport: {
        detectedFormat: 'semantic-v4',
        schemaValid: true,
        semanticValid: false,
        issueCount: 3,
        issues: [
          { severity: 'error', code: 'E1', message: 'error one' },
          { severity: 'warning', code: 'W1', message: 'warning one' },
          { severity: 'warning', code: 'W2', message: 'warning two' },
        ],
      },
      document,
      documentHash: currentHash,
      baseMainDocumentHash: 'old-main-hash',
      source: 'manual_snapshot',
      appliedInfo: {
        appliedAt: '2026-04-27T02:00:00.000Z',
        appliedToMainDocumentHash: 'applied-main-hash',
        sourceBlueprintDocumentHash: currentHash,
      },
      createdAt: '2026-04-27T02:00:00.000Z',
      updatedAt: '2026-04-27T02:00:00.000Z',
    }
    useBlueprintStore.setState({
      workspace: {
        ...createEmptyBlueprintWorkspace(),
        mainDocument: {
          documentId: document.document.id,
          hash: currentHash,
          hashAlgorithm: 'easyanalyse-document-canonical-sha256-v1',
        },
        blueprints: [
          active,
          { ...active, id: 'bp-archived', title: 'Archived snapshot', lifecycleStatus: 'archived', validationState: 'valid' },
          { ...active, id: 'bp-deleted', title: 'Deleted snapshot', lifecycleStatus: 'deleted', validationState: 'unknown' },
        ],
      },
      sidecarPath: '/tmp/ui.easyanalyse-blueprints.json',
      dirty: true,
      selectedBlueprintId: 'bp-active',
    })

    const host = await renderPanel()

    expect(host.textContent).toContain('Sidecar: /tmp/ui.easyanalyse-blueprints.json')
    expect(host.textContent).toContain('Workspace dirty')
    expect(host.textContent).toContain('Validated snapshot')
    expect(host.textContent).toContain('ready for review')
    expect(host.textContent).toContain('active')
    expect(host.textContent).toContain('invalid')
    expect(host.textContent).toContain('Issues: 3')
    expect(host.textContent).toContain('Warnings: 2')
    expect(host.textContent).toContain('Applied 2026-04-27')
    expect(host.textContent).toContain('Current main document')
    expect(host.textContent).toContain('Base hash differs')
    expect(host.textContent).toContain('Archived snapshot')
    expect(host.textContent).toContain('archived')
    expect(host.textContent).toContain('Deleted snapshot')
    expect(host.textContent).toContain('deleted')
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('Validated snapshot')
  })

  it('prevents duplicate top-level async actions while one is already in flight', async () => {
    const pendingCreate = deferred<BlueprintRecord>()
    const createSnapshotFromDocument = vi.fn(() => pendingCreate.promise)
    const saveWorkspace = vi.fn(async () => undefined)
    const loadForMainDocument = vi.fn(async () => undefined)
    useBlueprintStore.setState({ createSnapshotFromDocument, saveWorkspace, loadForMainDocument })
    const host = await renderPanel()

    const createButton = firstButtonByText(host, 'Create snapshot') as HTMLButtonElement
    await act(async () => {
      createButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      createButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(createSnapshotFromDocument).toHaveBeenCalledTimes(1)
    expect(createButton.disabled).toBe(true)
    expect((firstButtonByText(host, 'Save workspace') as HTMLButtonElement).disabled).toBe(true)
    expect((firstButtonByText(host, 'Reload') as HTMLButtonElement).disabled).toBe(true)
    pendingCreate.resolve({} as BlueprintRecord)
    await act(async () => pendingCreate.promise)

    await act(async () => {
      firstButtonByText(host, 'Save workspace')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      firstButtonByText(host, 'Reload')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(saveWorkspace).toHaveBeenCalledTimes(1)
    expect(loadForMainDocument).toHaveBeenCalledTimes(1)
  })

  it('prevents duplicate validation per card and renders validation errors', async () => {
    const document = createDocument()
    const currentHash = await hashDocument(document)
    resetStores(document)
    const pendingValidation = deferred<void>()
    const validateBlueprint = vi.fn(() => pendingValidation.promise)
    useBlueprintStore.setState({
      validateBlueprint,
      workspace: {
        ...createEmptyBlueprintWorkspace(),
        mainDocument: { documentId: document.document.id, hash: currentHash, hashAlgorithm: DOCUMENT_HASH_ALGORITHM },
        blueprints: [
          {
            id: 'bp-active',
            title: 'Active snapshot',
            lifecycleStatus: 'active',
            validationState: 'unknown',
            document,
            documentHash: currentHash,
            source: 'manual_snapshot',
            createdAt: '2026-04-27T02:00:00.000Z',
            updatedAt: '2026-04-27T02:00:00.000Z',
          },
        ],
      },
      validationError: 'previous validation failed',
    })
    const host = await renderPanel()
    const validateButton = firstButtonByText(cardByTitle(host, 'Active snapshot')!, 'Validate') as HTMLButtonElement

    await act(async () => {
      validateButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      validateButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(validateBlueprint).toHaveBeenCalledTimes(1)
    expect(validateButton.disabled).toBe(true)
    expect(host.textContent).toContain('Validation error: previous validation failed')
    pendingValidation.reject(new Error('validator still failed'))
    await act(async () => {
      await expect(pendingValidation.promise).rejects.toThrow('validator still failed')
    })
    expect(host.textContent).toContain('Action error: validator still failed')
  })

  it('disables invalid lifecycle card actions', async () => {
    const document = createDocument()
    const currentHash = await hashDocument(document)
    resetStores(document)
    const base: BlueprintRecord = {
      id: 'bp-active',
      title: 'Active snapshot',
      lifecycleStatus: 'active',
      validationState: 'unknown',
      document,
      documentHash: currentHash,
      source: 'manual_snapshot',
      createdAt: '2026-04-27T02:00:00.000Z',
      updatedAt: '2026-04-27T02:00:00.000Z',
    }
    useBlueprintStore.setState({
      workspace: {
        ...createEmptyBlueprintWorkspace(),
        mainDocument: { documentId: document.document.id, hash: currentHash, hashAlgorithm: DOCUMENT_HASH_ALGORITHM },
        blueprints: [
          base,
          { ...base, id: 'bp-archived', title: 'Archived snapshot', lifecycleStatus: 'archived' },
          { ...base, id: 'bp-deleted', title: 'Deleted snapshot', lifecycleStatus: 'deleted' },
        ],
      },
    })

    const host = await renderPanel()
    expect((firstButtonByText(cardByTitle(host, 'Active snapshot')!, 'Archive') as HTMLButtonElement).disabled).toBe(false)
    expect((firstButtonByText(cardByTitle(host, 'Active snapshot')!, 'Delete') as HTMLButtonElement).disabled).toBe(false)
    expect((firstButtonByText(cardByTitle(host, 'Archived snapshot')!, 'Archive') as HTMLButtonElement).disabled).toBe(true)
    expect((firstButtonByText(cardByTitle(host, 'Deleted snapshot')!, 'Archive') as HTMLButtonElement).disabled).toBe(true)
    expect((firstButtonByText(cardByTitle(host, 'Deleted snapshot')!, 'Delete') as HTMLButtonElement).disabled).toBe(true)
    expect((firstButtonByText(cardByTitle(host, 'Deleted snapshot')!, 'Select') as HTMLButtonElement).disabled).toBe(true)
    expect((firstButtonByText(cardByTitle(host, 'Deleted snapshot')!, 'Validate') as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains unsaved main document snapshot and sidecar persistence behavior', async () => {
    resetStores(createDocument())
    useEditorStore.setState({ dirty: true, filePath: null })
    const host = await renderPanel()

    expect(host.textContent).toContain('Snapshots capture the current unsaved editor state')
    expect(host.textContent).toContain('Save the main document to enable a persistent sidecar path')
  })

  it('opens valid blueprint confirmation and renders non-label terminal changes in the diff summary', async () => {
    const main = createDocument()
    const blueprintDoc = createDocument({
      devices: [
        {
          ...main.devices[0],
          terminals: [
            { ...main.devices[0].terminals[0], direction: 'output' },
            main.devices[0].terminals[1],
          ],
        },
      ],
    })
    const mainHash = await hashDocument(main)
    const blueprintHash = await hashDocument(blueprintDoc)
    resetStores(main)
    useBlueprintStore.setState({
      workspace: {
        ...createEmptyBlueprintWorkspace(),
        mainDocument: { documentId: main.document.id, hash: mainHash, hashAlgorithm: DOCUMENT_HASH_ALGORITHM },
        blueprints: [{
          id: 'bp-valid-terminal-change',
          title: 'Valid terminal change blueprint',
          lifecycleStatus: 'active',
          validationState: 'valid',
          validationReport: { detectedFormat: 'semantic-v4', schemaValid: true, semanticValid: true, issueCount: 0, issues: [] },
          document: blueprintDoc,
          documentHash: blueprintHash,
          baseMainDocumentHash: mainHash,
          source: 'manual_snapshot',
          createdAt: '2026-04-27T02:00:00.000Z',
          updatedAt: '2026-04-27T02:00:00.000Z',
        }],
      },
    })
    const host = await renderPanel()

    await act(async () => {
      firstButtonByText(cardByTitle(host, 'Valid terminal change blueprint')!, 'Apply')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const dialogText = host.querySelector('[role="dialog"]')?.textContent
    expect(dialogText).toContain('Apply blueprint')
    expect(dialogText).toContain('State: valid')
    expect(dialogText).not.toContain('Strong risk warning')
    expect(dialogText).toContain('Terminals: +0 / -0 / ~1 / label changes 0')
    expect(dialogText).toContain('Changed terminals')
    expect(dialogText).toContain('R1 / A')
  })

  it('opens unknown blueprint confirmation and shows a strong risk warning', async () => {
    const main = createDocument()
    const blueprintDoc = createDocument({ document: { ...main.document, title: 'Unknown Replacement' } })
    const mainHash = await hashDocument(main)
    const blueprintHash = await hashDocument(blueprintDoc)
    resetStores(main)
    useBlueprintStore.setState({
      workspace: {
        ...createEmptyBlueprintWorkspace(),
        mainDocument: { documentId: main.document.id, hash: mainHash, hashAlgorithm: DOCUMENT_HASH_ALGORITHM },
        blueprints: [{
          id: 'bp-unknown-warning',
          title: 'Unknown warning blueprint',
          lifecycleStatus: 'active',
          validationState: 'unknown',
          document: blueprintDoc,
          documentHash: blueprintHash,
          baseMainDocumentHash: mainHash,
          source: 'manual_snapshot',
          createdAt: '2026-04-27T02:00:00.000Z',
          updatedAt: '2026-04-27T02:00:00.000Z',
        }],
      },
    })
    const host = await renderPanel()

    await act(async () => {
      firstButtonByText(cardByTitle(host, 'Unknown warning blueprint')!, 'Apply')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const dialogText = host.querySelector('[role="dialog"]')?.textContent
    expect(dialogText).toContain('Apply blueprint')
    expect(dialogText).toContain('State: unknown')
    expect(dialogText).toContain('Strong risk warning')
    expect(dialogText).toContain('this blueprint is unknown')
  })

  it('opens confirmation and applies valid, invalid, and unknown blueprints without saving to disk', async () => {
    const main = createDocument()
    const blueprintDoc = createDocument({
      document: { ...main.document, title: 'Blueprint Applied Title' },
      devices: [...main.devices, { id: 'c1', name: 'C1', kind: 'capacitor', terminals: [] }],
    })
    const mainHash = await hashDocument(main)
    const blueprintHash = await hashDocument(blueprintDoc)
    const base: BlueprintRecord = {
      id: 'bp-valid',
      title: 'Valid apply blueprint',
      lifecycleStatus: 'active',
      validationState: 'valid',
      validationReport: { detectedFormat: 'semantic-v4', schemaValid: true, semanticValid: true, issueCount: 0, issues: [] },
      document: blueprintDoc,
      documentHash: blueprintHash,
      baseMainDocumentHash: mainHash,
      source: 'manual_snapshot',
      createdAt: '2026-04-27T02:00:00.000Z',
      updatedAt: '2026-04-27T02:00:00.000Z',
    }
    const markApplied = vi.fn(useBlueprintStore.getState().markApplied)
    const saveWorkspace = vi.fn(async () => undefined)
    resetStores(main)
    useBlueprintStore.setState({
      saveWorkspace,
      markApplied,
      workspace: {
        ...createEmptyBlueprintWorkspace(),
        mainDocument: { documentId: main.document.id, hash: mainHash, hashAlgorithm: DOCUMENT_HASH_ALGORITHM },
        blueprints: [
          base,
          {
            ...base,
            id: 'bp-invalid',
            title: 'Invalid apply blueprint',
            validationState: 'invalid',
            validationReport: {
              detectedFormat: 'semantic-v4',
              schemaValid: false,
              semanticValid: false,
              issueCount: 2,
              issues: [
                { severity: 'error', code: 'E_SCHEMA', message: 'schema issue' },
                { severity: 'warning', code: 'W_SEM', message: 'semantic warning' },
              ],
            },
          },
          { ...base, id: 'bp-unknown', title: 'Unknown apply blueprint', validationState: 'unknown', validationReport: undefined },
        ],
      },
    })
    const applyBlueprintDocument = vi.spyOn(useEditorStore.getState(), 'applyBlueprintDocument')
    const host = await renderPanel()

    expect(firstButtonByText(cardByTitle(host, 'Valid apply blueprint')!, 'Apply')).toBeTruthy()
    expect(firstButtonByText(cardByTitle(host, 'Invalid apply blueprint')!, 'Apply')).toBeTruthy()
    expect(firstButtonByText(cardByTitle(host, 'Unknown apply blueprint')!, 'Apply')).toBeTruthy()

    await act(async () => {
      firstButtonByText(cardByTitle(host, 'Invalid apply blueprint')!, 'Apply')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Apply blueprint')
    expect(host.textContent).toContain('Errors: 1')
    expect(host.textContent).toContain('Warnings: 1')
    expect(host.textContent).toContain('Strong risk warning')
    expect(host.textContent).toContain('save to disk may fail')
    expect(host.textContent).toContain('Devices: +1 / -0 / ~0')

    await act(async () => {
      firstButtonByText(host, 'Confirm apply')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(applyBlueprintDocument).toHaveBeenCalledWith(blueprintDoc)
    expect(markApplied).toHaveBeenCalledWith('bp-invalid', expect.objectContaining({
      sourceBlueprintDocumentHash: blueprintHash,
      appliedToMainDocumentHash: expect.stringMatching(/^easyanalyse-document-canonical-sha256-v1:/),
    }))
    const appliedInfo = markApplied.mock.calls[0]?.[1]
    expect(appliedInfo?.appliedToMainDocumentHash).toBe(await hashDocument(useEditorStore.getState().document))
    expect(saveWorkspace).not.toHaveBeenCalled()
    expect(useEditorStore.getState().document.document.title).toBe('Blueprint Applied Title')
    expect(useEditorStore.getState().dirty).toBe(true)
    const appliedRecord = useBlueprintStore.getState().workspace?.blueprints.find((record) => record.id === 'bp-invalid')
    expect(appliedRecord?.lifecycleStatus).toBe('active')
    expect(appliedRecord).not.toHaveProperty('status', 'applied')
    await act(async () => {
      useEditorStore.getState().undo()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(useEditorStore.getState().document.document.title).toBe('UI Reference Circuit')
  })

  it('runs the no-Agent blueprint UI loop from sidecar list through preview, validate, diff, apply, dirty main, and undo', async () => {
    const main = createDocument()
    const blueprintDoc = createDocument({
      document: { ...main.document, title: 'Accepted Blueprint Replacement' },
      devices: [...main.devices, { id: 'l1', name: 'L1', kind: 'inductor', terminals: [] }],
    })
    const mainHash = await hashDocument(main)
    const blueprintHash = await hashDocument(blueprintDoc)
    const record = await createBlueprintRecord({
      id: 'bp-m2-acceptance',
      title: 'M2 acceptance blueprint',
      validationState: 'unknown',
      validationReport: undefined,
      document: blueprintDoc,
      documentHash: blueprintHash,
      baseMainDocumentHash: mainHash,
    })
    const unknownRecord = await createBlueprintRecord({
      id: 'bp-unknown-allowance',
      title: 'Unknown allowance blueprint',
      validationState: 'unknown',
      validationReport: undefined,
      document: blueprintDoc,
      documentHash: blueprintHash,
      baseMainDocumentHash: mainHash,
    })
    const validateBlueprint = vi.fn(async (id: string) => {
      useBlueprintStore.setState((state) => ({
        workspace: state.workspace
          ? {
            ...state.workspace,
            blueprints: state.workspace.blueprints.map((item) => item.id === id
              ? {
                ...item,
                validationState: 'invalid',
                validationReport: {
                  detectedFormat: 'semantic-v4',
                  schemaValid: false,
                  semanticValid: false,
                  issueCount: 2,
                  issues: [
                    { severity: 'error', code: 'E_M2_ACCEPTANCE', message: 'accepted invalid blueprint warning' },
                    { severity: 'warning', code: 'W_M2_ACCEPTANCE', message: 'accepted warning' },
                  ],
                },
              }
              : item),
          }
          : state.workspace,
        dirty: true,
      }))
    })
    const saveWorkspace = vi.fn(async () => undefined)
    resetStores(main)
    useEditorStore.setState({ filePath: '/tmp/m2-acceptance.json' })
    useBlueprintStore.setState({
      sidecarPath: '/tmp/m2-acceptance.easyanalyse-blueprints.json',
      saveWorkspace,
      validateBlueprint,
      workspace: {
        ...createEmptyBlueprintWorkspace(),
        mainDocument: { documentId: main.document.id, hash: mainHash, hashAlgorithm: DOCUMENT_HASH_ALGORITHM },
        blueprints: [record, unknownRecord],
      },
    })
    const host = await renderPanel()

    expect(host.textContent).toContain('Sidecar: /tmp/m2-acceptance.easyanalyse-blueprints.json')
    expect(firstButtonByText(cardByTitle(host, 'Unknown allowance blueprint')!, 'Apply')).toBeTruthy()

    await act(async () => {
      firstButtonByText(cardByTitle(host, 'M2 acceptance blueprint')!, 'Select')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('M2 acceptance blueprint')
    const previewCanvas = host.querySelector('[aria-label="Blueprint preview canvas"]') as HTMLElement | null
    expect(previewCanvas).toBeTruthy()
    expect(previewCanvas?.dataset.documentTitle).toBe('Accepted Blueprint Replacement')
    expect(await hashDocument(useEditorStore.getState().document)).toBe(mainHash)

    await act(async () => {
      firstButtonByText(cardByTitle(host, 'M2 acceptance blueprint')!, 'Validate')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(validateBlueprint).toHaveBeenCalledWith('bp-m2-acceptance')
    expect(cardByTitle(host, 'M2 acceptance blueprint')?.textContent).toContain('Validation: invalid')
    expect(cardByTitle(host, 'M2 acceptance blueprint')?.textContent).toContain('Issues: 2')
    expect(cardByTitle(host, 'M2 acceptance blueprint')?.textContent).toContain('Warnings: 1')

    await act(async () => {
      firstButtonByText(cardByTitle(host, 'M2 acceptance blueprint')!, 'Apply')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const dialogText = host.querySelector('[role="dialog"]')?.textContent
    expect(dialogText).toContain('Strong risk warning')
    expect(dialogText).toContain('Devices: +1 / -0 / ~0')

    await act(async () => {
      firstButtonByText(host, 'Confirm apply')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(useEditorStore.getState().document.document.title).toBe('Accepted Blueprint Replacement')
    expect(useEditorStore.getState().dirty).toBe(true)
    expect(saveWorkspace).not.toHaveBeenCalled()
    expect(JSON.parse(JSON.stringify(useEditorStore.getState().document))).not.toHaveProperty('blueprints')
    expect(JSON.parse(JSON.stringify(useEditorStore.getState().document))).not.toHaveProperty('agent')
    expect(JSON.parse(JSON.stringify(useEditorStore.getState().document))).not.toHaveProperty('workspace')
    const appliedRecord = useBlueprintStore.getState().workspace?.blueprints.find((item) => item.id === 'bp-m2-acceptance')
    expect(appliedRecord?.lifecycleStatus).toBe('active')
    expect(appliedRecord?.appliedInfo?.sourceBlueprintDocumentHash).toBe(blueprintHash)
    expect(appliedRecord).not.toHaveProperty('status', 'applied')

    await act(async () => {
      useEditorStore.getState().undo()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(useEditorStore.getState().document.document.title).toBe('UI Reference Circuit')
    expect(useEditorStore.getState().document.devices.map((device) => device.id)).toEqual(['r1'])
  })

  it('warns about whole-document replacement when the base main document hash mismatches', async () => {
    const main = createDocument()
    const blueprintDoc = createDocument({ document: { ...main.document, title: 'Replacement' } })
    const blueprintHash = await hashDocument(blueprintDoc)
    resetStores(main)
    useBlueprintStore.setState({
      workspace: {
        ...createEmptyBlueprintWorkspace(),
        mainDocument: { documentId: main.document.id, hash: await hashDocument(main), hashAlgorithm: DOCUMENT_HASH_ALGORITHM },
        blueprints: [{
          id: 'bp-mismatch',
          title: 'Mismatched blueprint',
          lifecycleStatus: 'active',
          validationState: 'unknown',
          document: blueprintDoc,
          documentHash: blueprintHash,
          baseMainDocumentHash: 'different-base-hash',
          source: 'manual_snapshot',
          createdAt: '2026-04-27T02:00:00.000Z',
          updatedAt: '2026-04-27T02:00:00.000Z',
        }],
      },
    })
    const host = await renderPanel()

    await act(async () => {
      firstButtonByText(cardByTitle(host, 'Mismatched blueprint')!, 'Apply')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('whole-document replacement')
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('no merge will be attempted')
  })
})
