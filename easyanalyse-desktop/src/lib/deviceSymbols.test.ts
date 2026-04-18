import { describe, expect, it } from 'vitest'
import {
  getDefaultShapeForKind,
  getDeviceVisualPreset,
  hasDedicatedDeviceSymbol,
} from './deviceSymbols'

describe('deviceSymbols', () => {
  it('maps passive and semiconductor kinds to dedicated symbols', () => {
    expect(getDeviceVisualPreset('resistor').key).toBe('resistor')
    expect(getDeviceVisualPreset('ferrite bead').key).toBe('ferrite-bead')
    expect(getDeviceVisualPreset('electrolytic capacitor').key).toBe('electrolytic-capacitor')
    expect(getDeviceVisualPreset('LED indicator').key).toBe('led')
    expect(getDeviceVisualPreset('rectifier diode').key).toBe('rectifier-diode')
    expect(getDeviceVisualPreset('push button').key).toBe('push-button')
    expect(getDeviceVisualPreset('n-channel mosfet').key).toBe('nmos')
    expect(getDeviceVisualPreset('npn transistor').key).toBe('npn-transistor')
    expect(getDeviceVisualPreset('op-amp').key).toBe('op-amp')
  })

  it('maps common Chinese aliases to the existing templates', () => {
    expect(getDeviceVisualPreset('磁珠').key).toBe('ferrite-bead')
    expect(getDeviceVisualPreset('晶振').key).toBe('crystal')
    expect(getDeviceVisualPreset('运放').key).toBe('op-amp')
    expect(getDeviceVisualPreset('MOS管').key).toBe('nmos')
    expect(getDeviceVisualPreset('三极管').key).toBe('npn-transistor')
    expect(getDeviceVisualPreset('续流二极管').key).toBe('flyback-diode')
  })

  it('recognizes canonical hyphenated kinds even when the display name is abbreviated', () => {
    expect(getDeviceVisualPreset({ kind: 'ferrite-bead', name: 'FB1', category: 'passive', tags: [] }).key).toBe(
      'ferrite-bead',
    )
    expect(getDeviceVisualPreset({ kind: 'npn-transistor', name: 'Q1', category: 'discrete', tags: [] }).key).toBe(
      'npn-transistor',
    )
    expect(getDeviceVisualPreset({ kind: 'op-amp', name: 'U2', category: 'analog', tags: [] }).key).toBe('op-amp')
  })

  it('keeps generic connector and sensor fallbacks', () => {
    expect(getDeviceVisualPreset('board connector').key).toBe('connector')
    expect(getDefaultShapeForKind('board connector')).toBe('circle')
    expect(getDeviceVisualPreset('temperature sensor').key).toBe('sensor')
    expect(getDefaultShapeForKind('temperature sensor')).toBe('triangle')
  })

  it('marks only template-backed kinds as dedicated symbols', () => {
    expect(hasDedicatedDeviceSymbol('resistor')).toBe(true)
    expect(hasDedicatedDeviceSymbol('switch')).toBe(true)
    expect(hasDedicatedDeviceSymbol('controller')).toBe(false)
    expect(hasDedicatedDeviceSymbol('connector')).toBe(false)
  })
})
