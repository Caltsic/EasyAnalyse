import { describe, expect, it } from 'vitest'
import { checkLayoutOverlaps, type LayoutDeviceOverlapIssue, type LayoutNetworkLineDeviceOverlapIssue, type LayoutTextDeviceOverlapIssue } from './layoutValidation'
import type { DocumentFile, NetworkLineViewDefinition } from '../types/document'

function doc(
  positions: Record<string, { x: number; y: number; width?: number; height?: number }>,
  networkLines: Record<string, NetworkLineViewDefinition> = {},
): DocumentFile {
  const ids = Object.keys(positions)
  return {
    schemaVersion: '4.0.0',
    document: { id: 'd1', title: 'Layout test' },
    devices: ids.map((id) => ({ id, name: id.toUpperCase(), kind: 'resistor', terminals: [] })),
    view: {
      canvas: { units: 'px' },
      devices: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            position: { x: positions[id]!.x, y: positions[id]!.y },
            ...(positions[id]!.width ? { size: { width: positions[id]!.width!, height: positions[id]!.height ?? 100 } } : {}),
          },
        ]),
      ),
      networkLines,
    },
  }
}

describe('checkLayoutOverlaps', () => {
  it('reports no issues for separated devices and does not mutate input', () => {
    const input = doc({ a: { x: 0, y: 0, width: 100, height: 100 }, b: { x: 170, y: 0, width: 100, height: 100 } })
    const before = structuredClone(input)
    const report = checkLayoutOverlaps(input)
    expect(report).toMatchObject({ ok: true, issueCount: 0, checkedDeviceCount: 2, checkedPairCount: 1, truncated: false })
    expect(input).toEqual(before)
  })

  it('reports complete and partial overlaps with stable sorted pairs', () => {
    const report = checkLayoutOverlaps(doc({ c: { x: 25, y: 25, width: 50, height: 50 }, a: { x: 0, y: 0, width: 100, height: 100 }, b: { x: 80, y: 0, width: 100, height: 100 } }))
    expect(report.ok).toBe(false)
    const deviceIssues = report.issues.filter((issue): issue is LayoutDeviceOverlapIssue => issue.code === 'layout.device.overlap')
    expect(deviceIssues.map((issue) => [issue.details.leftDeviceId, issue.details.rightDeviceId])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
    expect(deviceIssues[1]!.details.overlapArea).toBe(9375)
  })

  it('treats touching edges as non-overlap by default and warning when requested', () => {
    const input = doc({ a: { x: 0, y: 0, width: 100, height: 100 }, b: { x: 150, y: 0, width: 100, height: 100 } })
    expect(checkLayoutOverlaps(input).issueCount).toBe(0)
    const report = checkLayoutOverlaps(input, { includeTouching: true })
    expect(report.issueCount).toBe(1)
    const issue = report.issues[0]!
    expect(issue.code).toBe('layout.device.overlap')
    if (issue.code !== 'layout.device.overlap') throw new Error('expected device overlap')
    expect(issue.details.overlapWidth).toBe(0)
  })

  it('uses padding and derived default canvas sizes', () => {
    const report = checkLayoutOverlaps(doc({ a: { x: 0, y: 0 }, b: { x: 130, y: 0 } }), { padding: 8 })
    expect(report.issueCount).toBe(1)
    const issue = report.issues[0]!
    expect(issue.code).toBe('layout.device.overlap')
    if (issue.code !== 'layout.device.overlap') throw new Error('expected device overlap')
    expect(issue.details.leftBounds.width).toBeGreaterThanOrEqual(150)
  })

  it('limits returned issues with maxPairs without changing checkedPairCount', () => {
    const report = checkLayoutOverlaps(doc({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } }), { maxPairs: 2 })
    expect(report.checkedPairCount).toBe(3)
    expect(report.issueCount).toBe(2)
    expect(report.truncated).toBe(true)
  })

  it('reports visual network lines that run through device bounds', () => {
    const report = checkLayoutOverlaps(
      doc(
        { a: { x: 100, y: 100, width: 100, height: 100 }, b: { x: 300, y: 100, width: 100, height: 100 } },
        {
          vout: { label: 'VOUT', position: { x: 200, y: 150 }, length: 360, orientation: 'horizontal' },
          safe: { label: 'SAFE', position: { x: 200, y: 40 }, length: 360, orientation: 'horizontal' },
        },
      ),
    )
    const lineIssues = report.issues.filter((issue): issue is LayoutNetworkLineDeviceOverlapIssue => issue.code === 'layout.network-line.device-overlap')
    expect(report.checkedNetworkLineCount).toBe(2)
    expect(report.checkedNetworkLineDevicePairCount).toBe(4)
    expect(lineIssues.map((issue) => [issue.details.networkLineId, issue.details.deviceId])).toEqual([
      ['vout', 'a'],
      ['vout', 'b'],
    ])
    expect(lineIssues[0]!.path).toBe('view.networkLines.vout')
  })

  it('does not report network lines placed outside device bounds', () => {
    const report = checkLayoutOverlaps(
      doc(
        { a: { x: 100, y: 100, width: 100, height: 100 }, b: { x: 300, y: 100, width: 100, height: 100 } },
        {
          topRail: { label: 'VCC', position: { x: 240, y: 60 }, length: 420, orientation: 'horizontal' },
          sideRail: { label: 'GND', position: { x: 520, y: 150 }, length: 180, orientation: 'vertical' },
        },
      ),
    )
    expect(report.issues.filter((issue) => issue.code === 'layout.network-line.device-overlap')).toEqual([])
  })

  it('reports terminal and network-line text labels that overlap other device bounds with coordinates', () => {
    const input: DocumentFile = {
      schemaVersion: '4.0.0',
      document: { id: 'd-text', title: 'Text overlap test' },
      devices: [
        {
          id: 'left',
          name: 'LEFT',
          kind: 'resistor',
          terminals: [{ id: 'left-out', name: 'OUT', label: 'SIGNAL_LONG', direction: 'output', side: 'right' }],
        },
        {
          id: 'right',
          name: 'RIGHT',
          kind: 'capacitor',
          terminals: [],
        },
      ],
      view: {
        canvas: { units: 'px' },
        devices: {
          left: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } },
          right: { position: { x: 135, y: 40 }, size: { width: 100, height: 100 } },
        },
        networkLines: {
          rail: { label: 'RAIL_TEXT', position: { x: 135, y: 78 }, length: 80, orientation: 'horizontal' },
        },
      },
    }

    const report = checkLayoutOverlaps(input, { includeTextDeviceOverlaps: true })
    const textIssues = report.issues.filter((issue): issue is LayoutTextDeviceOverlapIssue => issue.code === 'layout.text.device-overlap')
    expect(report.checkedTextBoxCount).toBe(2)
    expect(report.checkedTextDevicePairCount).toBe(3)
    expect(textIssues.map((issue) => [issue.details.textKind, issue.details.deviceId])).toEqual([
      ['network-line-label', 'left'],
      ['network-line-label', 'right'],
      ['terminal-label', 'right'],
    ])
    expect(textIssues[2]!.details).toMatchObject({
      textId: 'terminal-label:left-out',
      ownerDeviceId: 'left',
      textBounds: expect.objectContaining({ width: 172, height: 18 }),
      deviceBounds: expect.objectContaining({ x: 135, y: 40 }),
      overlapArea: expect.any(Number),
    })
  })
})
