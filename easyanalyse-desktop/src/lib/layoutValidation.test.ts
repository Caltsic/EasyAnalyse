import { describe, expect, it } from 'vitest'
import { checkLayoutOverlaps } from './layoutValidation'
import type { DocumentFile } from '../types/document'

function doc(positions: Record<string, { x: number; y: number; width?: number; height?: number }>): DocumentFile {
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
      networkLines: {},
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
    expect(report.issues.map((issue) => [issue.details.leftDeviceId, issue.details.rightDeviceId])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
    expect(report.issues[1]!.details.overlapArea).toBe(9375)
  })

  it('treats touching edges as non-overlap by default and warning when requested', () => {
    const input = doc({ a: { x: 0, y: 0, width: 100, height: 100 }, b: { x: 150, y: 0, width: 100, height: 100 } })
    expect(checkLayoutOverlaps(input).issueCount).toBe(0)
    const report = checkLayoutOverlaps(input, { includeTouching: true })
    expect(report.issueCount).toBe(1)
    expect(report.issues[0]!.details.overlapWidth).toBe(0)
  })

  it('uses padding and derived default canvas sizes', () => {
    const report = checkLayoutOverlaps(doc({ a: { x: 0, y: 0 }, b: { x: 130, y: 0 } }), { padding: 8 })
    expect(report.issueCount).toBe(1)
    expect(report.issues[0]!.details.leftBounds.width).toBeGreaterThanOrEqual(150)
  })

  it('limits returned issues with maxPairs without changing checkedPairCount', () => {
    const report = checkLayoutOverlaps(doc({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } }), { maxPairs: 2 })
    expect(report.checkedPairCount).toBe(3)
    expect(report.issueCount).toBe(2)
    expect(report.truncated).toBe(true)
  })
})
