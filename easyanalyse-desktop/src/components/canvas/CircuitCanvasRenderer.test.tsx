import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import rendererSource from './CircuitCanvasRenderer.tsx?raw'
import canvasViewSource from '../CanvasView.tsx?raw'
import type { DocumentFile } from '../../types/document'
import type { ReactNode } from 'react'

interface KonvaMockProps {
  children?: ReactNode
  text?: ReactNode
  draggable?: boolean
}

vi.mock('react-konva', async () => {
  const React = await import('react')
  const create = (tag: string) => ({ children, text, draggable }: KonvaMockProps) =>
    React.createElement(
      tag,
      { 'data-draggable': draggable === undefined ? undefined : String(draggable) },
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

vi.mock('../DeviceSymbolGlyph', async () => {
  const React = await import('react')
  return {
    DeviceSymbolGlyph: ({ visualKind }: { visualKind: string }) =>
      React.createElement('span', { 'data-symbol': visualKind }, visualKind),
  }
})

function createPreviewDocument(): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'preview-doc',
      title: 'Preview document',
    },
    devices: [
      {
        id: 'r-preview',
        name: 'Preview Resistor',
        kind: 'resistor',
        reference: 'RPRE',
        properties: { value: '10k' },
        terminals: [
          { id: 'r-preview-a', name: 'A', label: 'VIN', direction: 'input', side: 'left' },
          { id: 'r-preview-b', name: 'B', label: 'VOUT', direction: 'output', side: 'right' },
        ],
      },
    ],
    view: {
      canvas: { units: 'px', grid: { enabled: false, size: 24 } },
      devices: {
        'r-preview': {
          position: { x: 42, y: 64 },
          size: { width: 180, height: 96 },
          shape: 'rectangle',
        },
      },
      networkLines: {
        VIN: { label: 'VIN', position: { x: 20, y: 40 }, length: 120, orientation: 'horizontal' },
      },
    },
  }
}

describe('CircuitCanvasRenderer', () => {
  it('renders a static preview from the provided document without editorStore callbacks', async () => {
    const { CircuitCanvasRenderer } = await import('./CircuitCanvasRenderer')

    const markup = renderToStaticMarkup(
      <CircuitCanvasRenderer document={createPreviewDocument()} theme="light" locale="en-US" />,
    )

    expect(markup).toContain('RPRE')
    expect(markup).toContain('Preview Resistor')
    expect(markup).toContain('VIN')
  })

  it('defaults to preview-safe non-draggable Konva nodes when mutation callbacks are omitted', async () => {
    const { CircuitCanvasRenderer } = await import('./CircuitCanvasRenderer')

    const markup = renderToStaticMarkup(
      <CircuitCanvasRenderer document={createPreviewDocument()} theme="light" locale="en-US" />,
    )

    expect(markup).toContain('data-draggable="false"')
    expect(markup).not.toContain('data-draggable="true"')
  })

  it('keeps drag affordances available for the interactive CanvasView integration', async () => {
    const { CircuitCanvasRenderer } = await import('./CircuitCanvasRenderer')

    const markup = renderToStaticMarkup(
      <CircuitCanvasRenderer
        document={createPreviewDocument()}
        theme="light"
        locale="en-US"
        interactive
        onMoveDevice={vi.fn()}
        onMoveDevices={vi.fn()}
        onRepositionTerminal={vi.fn()}
        onUpdateNetworkLine={vi.fn()}
      />,
    )

    expect(markup).toContain('data-draggable="true"')
    expect(canvasViewSource).toContain('interactive')
  })

  it('keeps editorStore and main document mutations out of the renderer source', () => {
    expect(rendererSource).not.toContain('useEditorStore')
    expect(rendererSource).not.toContain('../store/editorStore')
    expect(rendererSource).not.toMatch(/\b(moveDevice|moveDevices|repositionTerminal|updateNetworkLine|placePendingDevice|deleteSelection|updateDevice|updateTerminal)\s*\(/)
  })
})
