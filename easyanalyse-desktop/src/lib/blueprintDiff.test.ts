import { describe, expect, it } from 'vitest'
import { diffBlueprintDocument } from './blueprintDiff'
import type { DocumentFile } from '../types/document'

function doc(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: { id: 'doc-1', title: 'Original', updatedAt: '2026-04-27T00:00:00.000Z' },
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
      networkLines: { net1: { label: 'VIN', position: { x: 1, y: 2 } } },
    },
    ...overrides,
  }
}

describe('diffBlueprintDocument', () => {
  it('summarizes added, removed, and changed devices', () => {
    const before = doc()
    const after = doc({
      devices: [
        { ...before.devices[0], name: 'R1 Prime', kind: 'resistor' },
        { id: 'c1', name: 'C1', kind: 'capacitor', terminals: [] },
      ],
    })

    const diff = diffBlueprintDocument(before, after)

    expect(diff.devices.added).toEqual(['C1'])
    expect(diff.devices.removed).toEqual([])
    expect(diff.devices.changed).toEqual(['R1'])
    expect(diff.hasChanges).toBe(true)
    expect(diff.summaryLines).toContain('Devices: +1 / -0 / ~1')
  })

  it('summarizes terminal and network label changes', () => {
    const before = doc()
    const after = doc({
      devices: [
        {
          ...before.devices[0],
          terminals: [
            { ...before.devices[0].terminals[0], label: 'VBUS' },
            before.devices[0].terminals[1],
            { id: 'r1-c', name: 'C', label: 'GND', direction: 'input' },
          ],
        },
      ],
      view: {
        ...before.view,
        networkLines: { net1: { label: 'VBUS', position: { x: 1, y: 2 } } },
      },
    })

    const diff = diffBlueprintDocument(before, after)

    expect(diff.terminals.added).toContain('R1 / C')
    expect(diff.terminals.labelChanged).toContain('R1 / A: VIN → VBUS')
    expect(diff.labels.changed).toContain('net1: VIN → VBUS')
    expect(diff.summaryLines).toContain('Terminals: +1 / -0 / ~1 / label changes 1')
    expect(diff.summaryLines).toContain('Labels: network label changes 1')
  })

  it('summarizes non-label terminal changes with a changed terminal count', () => {
    const before = doc()
    const after = doc({
      devices: [
        {
          ...before.devices[0],
          terminals: [
            { ...before.devices[0].terminals[0], direction: 'output' },
            before.devices[0].terminals[1],
          ],
        },
      ],
    })

    const diff = diffBlueprintDocument(before, after)

    expect(diff.terminals.changed).toEqual(['R1 / A'])
    expect(diff.terminals.labelChanged).toEqual([])
    expect(diff.summaryLines).toContain('Terminals: +0 / -0 / ~1 / label changes 0')
  })

  it('detects view, document meta, and raw JSON changes', () => {
    const before = doc()
    const after = doc({
      document: { ...before.document, title: 'Renamed', language: 'en' },
      view: {
        ...before.view,
        canvas: { units: 'px', grid: { enabled: true, size: 32 } },
        devices: { r1: { position: { x: 20, y: 20 }, shape: 'rectangle' } },
      },
      extensions: { imported: true },
    })

    const diff = diffBlueprintDocument(before, after)

    expect(diff.viewChanged).toBe(true)
    expect(diff.documentMetaChanged).toBe(true)
    expect(diff.rawJsonChanged).toBe(true)
    expect(diff.summaryLines).toContain('View/layout changed')
    expect(diff.summaryLines).toContain('Document metadata changed')
    expect(diff.summaryLines).toContain('Raw JSON changed')
  })
})
