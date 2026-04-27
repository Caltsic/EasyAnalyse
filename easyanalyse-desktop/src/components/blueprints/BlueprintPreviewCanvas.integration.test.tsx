// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentFile } from '../../types/document'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface KonvaMockProps {
  children?: ReactNode
  text?: ReactNode
  draggable?: boolean
  onMouseDown?: (event: { evt: MouseEvent; target: { getType: () => string } }) => void
  onMouseMove?: (event: { evt: MouseEvent; target: { getType: () => string } }) => void
  onMouseUp?: (event: { evt: MouseEvent; target: { getType: () => string } }) => void
  onMouseLeave?: (event: { evt: MouseEvent; target: { getType: () => string } }) => void
  onClick?: (event: { evt: MouseEvent; target: { getType: () => string } }) => void
  onWheel?: (event: { evt: WheelEvent; target: { getType: () => string } }) => void
}

vi.mock('react-konva', async () => {
  const React = await import('react')
  const target = { getType: () => 'Stage' }
  const create = (tag: string) => ({
    children,
    text,
    draggable,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    onClick,
    onWheel,
  }: KonvaMockProps) =>
    React.createElement(
      tag,
      {
        'data-konva-node': tag,
        'data-draggable': draggable === undefined ? undefined : String(draggable),
        onMouseDown: onMouseDown ? (event: React.MouseEvent<HTMLElement>) => onMouseDown({ evt: event.nativeEvent, target }) : undefined,
        onMouseMove: onMouseMove ? (event: React.MouseEvent<HTMLElement>) => onMouseMove({ evt: event.nativeEvent, target }) : undefined,
        onMouseUp: onMouseUp ? (event: React.MouseEvent<HTMLElement>) => onMouseUp({ evt: event.nativeEvent, target }) : undefined,
        onMouseLeave: onMouseLeave
          ? (event: React.MouseEvent<HTMLElement>) => onMouseLeave({ evt: event.nativeEvent, target })
          : undefined,
        onClick: onClick ? (event: React.MouseEvent<HTMLElement>) => onClick({ evt: event.nativeEvent, target }) : undefined,
        onWheel: onWheel ? (event: React.WheelEvent<HTMLElement>) => onWheel({ evt: event.nativeEvent, target }) : undefined,
      },
      children ?? text ?? null,
    )

  return {
    Stage: create('section'),
    Layer: create('div'),
    Group: create('div'),
    Rect: create('div'),
    Circle: create('i'),
    Line: create('i'),
    Text: create('span'),
  }
})

class ResizeObserverMock implements ResizeObserver {
  private callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: { width: 800, height: 480, x: 0, y: 0, top: 0, right: 800, bottom: 480, left: 0, toJSON: () => ({}) },
        } as ResizeObserverEntry,
      ],
      this,
    )
  }

  unobserve() {}
  disconnect() {}
}

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

let mountedRoot: Root | null = null
let mountedContainer: HTMLDivElement | null = null

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount()
    })
  }
  mountedContainer?.remove()
  mountedRoot = null
  mountedContainer = null
  vi.unstubAllGlobals()
})

describe('BlueprintPreviewCanvas renderer integration', () => {
  it('keeps real renderer non-interactive preview pointer events local and leaves the main document hash unchanged', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    const { hashDocument } = await import('../../lib/documentHash')
    const { BlueprintPreviewCanvas } = await import('./BlueprintPreviewCanvas')
    const mainDocument = createDocument({ document: { id: 'main-doc', title: 'Main document' } })
    const blueprintDocument = createDocument({ document: { id: 'blueprint-doc', title: 'Blueprint candidate' } })
    const beforeHash = await hashDocument(mainDocument)

    mountedContainer = window.document.createElement('div')
    window.document.body.appendChild(mountedContainer)
    mountedRoot = createRoot(mountedContainer)

    await act(async () => {
      mountedRoot?.render(<BlueprintPreviewCanvas document={blueprintDocument} locale="en-US" theme="dark" />)
    })

    const previewRoot = window.document.querySelector('[aria-label="Blueprint preview canvas"]')
    const stage = window.document.querySelector('[data-konva-node="section"]')
    expect(previewRoot).toBeInstanceOf(HTMLElement)
    expect(stage).toBeInstanceOf(HTMLElement)
    expect(mountedContainer.querySelector('[data-draggable="true"]')).toBeNull()

    await act(async () => {
      stage?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 }))
      stage?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, clientX: 180, clientY: 140 }))
      stage?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: 180, clientY: 140 }))
      stage?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, clientX: 180, clientY: 140 }))
    })

    await expect(hashDocument(mainDocument)).resolves.toBe(beforeHash)
  })
})
