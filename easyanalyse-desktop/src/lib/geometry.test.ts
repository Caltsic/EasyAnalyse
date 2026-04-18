import { describe, expect, it } from 'vitest'
import { getSignalPoint } from './geometry'

describe('geometry', () => {
  it('keeps op-amp terminals outside the dedicated triangle body', () => {
    const bounds = { x: 0, y: 0, width: 244, height: 168 }
    const leftInput = getSignalPoint(bounds, 'triangle', 'left', 0, 2, 'op-amp')
    const lowerInput = getSignalPoint(bounds, 'triangle', 'left', 1, 2, 'op-amp')
    const output = getSignalPoint(bounds, 'triangle', 'right', 0, 1, 'op-amp')
    const vcc = getSignalPoint(bounds, 'triangle', 'top', 0, 1, 'op-amp')
    const vee = getSignalPoint(bounds, 'triangle', 'bottom', 0, 1, 'op-amp')

    expect(leftInput.x).toBe(18)
    expect(lowerInput.x).toBe(18)
    expect(leftInput.y).toBeLessThan(lowerInput.y)
    expect(output.x).toBe(226)
    expect(vcc.y).toBeLessThan(28)
    expect(vee.y).toBeGreaterThan(114)
  })
})
