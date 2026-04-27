// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import previewSource from './BlueprintPreviewCanvas.tsx?raw'
import type { DocumentFile } from '../../types/document'
import type { CircuitCanvasRenderer } from '../canvas/CircuitCanvasRenderer'

type RendererProps = ComponentProps<typeof CircuitCanvasRenderer>

const rendererCalls: RendererProps[] = []
let mountedRoot: Root | null = null
let mountedContainer: HTMLDivElement | null = null

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../canvas/CircuitCanvasRenderer', async () => {
  const React = await import('react')
  return {
    CircuitCanvasRenderer: (props: RendererProps) => {
      rendererCalls.push(props)
      return React.createElement(
        'div',
        {
          'data-testid': 'circuit-renderer',
          'data-interactive': String(props.interactive),
          className: 'mock-circuit-renderer',
        },
        props.document.document.title,
      )
    },
  }
})

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-preview',
      title: 'Blueprint preview candidate',
    },
    devices: [
      {
        id: 'r1',
        name: 'Preview Resistor',
        kind: 'resistor',
        reference: 'RPRE',
        properties: { value: '10k' },
        terminals: [
          { id: 'a', name: 'A', label: 'VIN', direction: 'input', side: 'left' },
          { id: 'b', name: 'B', label: 'VOUT', direction: 'output', side: 'right' },
        ],
      },
    ],
    view: {
      canvas: { units: 'px', grid: { enabled: false, size: 24 } },
      devices: {
        r1: {
          position: { x: 42, y: 64 },
          size: { width: 180, height: 96 },
          shape: 'rectangle',
        },
      },
      networkLines: {},
    },
    ...overrides,
  }
}

async function renderPreview(document: DocumentFile) {
  const { BlueprintPreviewCanvas } = await import('./BlueprintPreviewCanvas')
  mountedContainer = window.document.createElement('div')
  window.document.body.appendChild(mountedContainer)
  mountedRoot = createRoot(mountedContainer)

  await act(async () => {
    mountedRoot?.render(<BlueprintPreviewCanvas document={document} locale="en-US" theme="dark" className="preview-shell" />)
  })

  const previewRoot = window.document.querySelector('[aria-label="Blueprint preview canvas"]')
  expect(previewRoot).toBeInstanceOf(HTMLElement)
  return previewRoot as HTMLElement
}

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount()
    })
  }
  mountedContainer?.remove()
  mountedRoot = null
  mountedContainer = null
  rendererCalls.length = 0
})

describe('BlueprintPreviewCanvas', () => {
  it('renders the supplied blueprint document through the pure renderer without changing the main document hash', async () => {
    const { hashDocument } = await import('../../lib/documentHash')
    const { BlueprintPreviewCanvas } = await import('./BlueprintPreviewCanvas')
    const mainDocument = createDocument({ document: { id: 'main-doc', title: 'Main document' } })
    const blueprintDocument = createDocument({ document: { id: 'blueprint-doc', title: 'Blueprint candidate' } })
    const beforeHash = await hashDocument(mainDocument)

    const markup = renderToStaticMarkup(
      <BlueprintPreviewCanvas document={blueprintDocument} locale="en-US" theme="dark" className="preview-shell" />,
    )

    expect(markup).toContain('Blueprint candidate')
    expect(markup).toContain('role="region"')
    expect(rendererCalls).toHaveLength(1)
    expect(rendererCalls[0].document).toBe(blueprintDocument)
    expect(rendererCalls[0].locale).toBe('en-US')
    expect(rendererCalls[0].theme).toBe('dark')
    await expect(hashDocument(mainDocument)).resolves.toBe(beforeHash)
  })

  it('forces non-interactive preview mode and does not pass mutation callbacks to the renderer', async () => {
    rendererCalls.length = 0
    const { BlueprintPreviewCanvas } = await import('./BlueprintPreviewCanvas')

    renderToStaticMarkup(<BlueprintPreviewCanvas document={createDocument()} />)

    expect(rendererCalls).toHaveLength(1)
    expect(rendererCalls[0].interactive).toBe(false)
    expect(rendererCalls[0].selection).toEqual({ entityType: 'document' })
    expect(rendererCalls[0].pendingDeviceShape).toBeNull()
    expect(rendererCalls[0].pendingDeviceTemplateKey).toBeNull()
    expect(rendererCalls[0].focusedDeviceId).toBeNull()
    expect(rendererCalls[0].focusedLabelKey).toBeNull()
    expect(rendererCalls[0].focusedNetworkLineId).toBeNull()

    const forbiddenCallbacks: Array<keyof RendererProps> = [
      'onMoveDevice',
      'onMoveDevices',
      'onRepositionTerminal',
      'onUpdateNetworkLine',
      'onSetSelection',
      'onSetDeviceGroupSelection',
      'onPlacePendingDevice',
      'onFocusDevice',
      'onFocusNetworkLine',
      'onClearFocus',
      'onResetViewportToOrigin',
    ]

    for (const callbackName of forbiddenCallbacks) {
      expect(rendererCalls[0]).not.toHaveProperty(callbackName)
    }
  })

  it('isolates focused preview editing keys and global shortcuts from main editor window handlers', async () => {
    const { hashDocument } = await import('../../lib/documentHash')
    const mainDocument = createDocument({ document: { id: 'main-doc', title: 'Main document' } })
    const blueprintDocument = createDocument({ document: { id: 'blueprint-doc', title: 'Blueprint candidate' } })
    const beforeHash = await hashDocument(mainDocument)
    let editorMutationCount = 0
    const previewRoot = await renderPreview(blueprintDocument)

    const leakedEvents: string[] = []
    const simulateMainEditorMutation = (event: KeyboardEvent) => {
      leakedEvents.push(event.key)
      editorMutationCount += 1
      mainDocument.document.title = `${mainDocument.document.title} mutated-by-${event.key}`
    }
    window.addEventListener('keydown', simulateMainEditorMutation)

    const shortcutEvents = [
      new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'Home', code: 'Home', bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', metaKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', metaKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: '0', code: 'Digit0', ctrlKey: true, bubbles: true, cancelable: true }),
    ]

    previewRoot.focus()
    expect(window.document.activeElement).toBe(previewRoot)

    try {
      for (const event of shortcutEvents) {
        previewRoot.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
      }
    } finally {
      window.removeEventListener('keydown', simulateMainEditorMutation)
    }

    expect(leakedEvents).toEqual([])
    expect(editorMutationCount).toBe(0)
    await expect(hashDocument(mainDocument)).resolves.toBe(beforeHash)
  })

  it('does not expose preview drag interactions to renderer mutation callbacks or change the main document hash', async () => {
    const { hashDocument } = await import('../../lib/documentHash')
    const mainDocument = createDocument({ document: { id: 'main-doc', title: 'Main document' } })
    const blueprintDocument = createDocument({ document: { id: 'blueprint-doc', title: 'Blueprint candidate' } })
    const beforeHash = await hashDocument(mainDocument)
    const previewRoot = await renderPreview(blueprintDocument)
    const renderer = previewRoot.querySelector('[data-testid="circuit-renderer"]')

    expect(renderer).toBeInstanceOf(HTMLElement)
    renderer?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 42, clientY: 64 }))
    renderer?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 96, clientY: 112 }))
    renderer?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 96, clientY: 112 }))

    expect(rendererCalls).toHaveLength(1)
    expect(rendererCalls[0].interactive).toBe(false)
    expect(rendererCalls[0]).not.toHaveProperty('onMoveDevice')
    expect(rendererCalls[0]).not.toHaveProperty('onMoveDevices')
    expect(rendererCalls[0]).not.toHaveProperty('onRepositionTerminal')
    expect(rendererCalls[0]).not.toHaveProperty('onUpdateNetworkLine')
    await expect(hashDocument(mainDocument)).resolves.toBe(beforeHash)
  })

  it('keeps editorStore and mutation actions out of the preview component source', () => {
    expect(previewSource).not.toContain('useEditorStore')
    expect(previewSource).not.toContain('editorStore')
    expect(previewSource).not.toMatch(/\b(moveDevice|moveDevices|repositionTerminal|updateNetworkLine|placePendingDevice|deleteSelection|applyBlueprintDocument)\b/)
  })
})
