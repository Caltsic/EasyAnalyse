// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_HASH_ALGORITHM, hashDocument } from '../../lib/documentHash'
import { createEmptyBlueprintWorkspace } from '../../lib/blueprintWorkspace'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import type { BlueprintRecord } from '../../types/blueprint'
import type { DocumentFile } from '../../types/document'

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
})
