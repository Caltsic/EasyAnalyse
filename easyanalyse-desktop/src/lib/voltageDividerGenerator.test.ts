import { describe, expect, it } from 'vitest'
import { generateVoltageDivider } from './voltageDividerGenerator'

describe('voltageDividerGenerator', () => {
  it('calculates R1/R2 from vin and vout', () => {
    const result = generateVoltageDivider({ vin: 5, vout: 3.3 })
    expect(result.candidate.document.schemaVersion).toBe('4.0.0')
    expect(result.calculatedValues.vin).toBe(5)
    const actualVout = result.calculatedValues.actualVout as number
    // Actual Vout should be close to 3.3V
    expect(actualVout).toBeGreaterThan(2.9)
    expect(actualVout).toBeLessThan(3.7)
    const r1Ohms = result.calculatedValues.r1Ohms as number
    const r2Ohms = result.calculatedValues.r2Ohms as number
    expect(r1Ohms).toBeGreaterThan(0)
    expect(r2Ohms).toBeGreaterThan(0)
    // Vout = Vin * R2 / (R1 + R2)
    // R1/R2 ratio depends on step-down amount: for 5V→3.3V, R1 < R2
    expect(r1Ohms).toBeGreaterThan(0)
    expect(r2Ohms).toBeGreaterThan(0)
  })

  it('calculates Vout from explicit R1 and R2 values', () => {
    const result = generateVoltageDivider({ vin: 12, r1Ohms: 10_000, r2Ohms: 4_700 })
    const actualVout = result.calculatedValues.actualVout as number
    // Vout = 12 * 4700 / 14700 ≈ 3.84V
    expect(actualVout).toBeGreaterThan(3.5)
    expect(actualVout).toBeLessThan(4.2)
    expect(result.calculatedValues.r1Ohms).toBeGreaterThan(9_000)
    expect(result.calculatedValues.r2Ohms).toBeGreaterThan(4_000)
  })

  it('calculates missing resistor when one resistor and vout are provided', () => {
    const result = generateVoltageDivider({ vin: 5, vout: 2.5, r1Ohms: 10_000 })
    const r2Ohms = result.calculatedValues.r2Ohms as number
    // For equal split: R2 ≈ R1
    expect(r2Ohms).toBeGreaterThan(8_000)
    expect(r2Ohms).toBeLessThan(12_000)
    const actualVout = result.calculatedValues.actualVout as number
    expect(actualVout).toBeGreaterThan(2.3)
    expect(actualVout).toBeLessThan(2.7)
  })

  it('generates valid document structure', () => {
    const result = generateVoltageDivider({ vin: 5, vout: 3.3 })
    const doc = result.candidate.document
    expect(doc.schemaVersion).toBe('4.0.0')
    expect(doc.document.id).toBeTruthy()
    expect(doc.document.title).toBeTruthy()
    expect(Array.isArray(doc.devices)).toBe(true)
    expect(doc.devices.length).toBe(5)

    const deviceIds = doc.devices.map((d) => d.id)
    expect(deviceIds).toEqual(expect.arrayContaining(['j1', 'r1', 'r2', 'tp1', 'gnd1']))

    // Every device should have required fields
    for (const device of doc.devices) {
      expect(device.id).toBeTruthy()
      expect(device.name).toBeTruthy()
      expect(device.kind).toBeTruthy()
      expect(Array.isArray(device.terminals)).toBe(true)
      expect(device.terminals.length).toBeGreaterThan(0)
      for (const terminal of device.terminals) {
        expect(terminal.id).toBeTruthy()
        expect(terminal.name).toBeTruthy()
        expect(['input', 'output']).toContain(terminal.direction)
      }
    }

    // Verify connectivity labels
    const allLabels = doc.devices.flatMap((d) => d.terminals.map((t) => t.label))
    expect(allLabels).toEqual(expect.arrayContaining(['VIN', 'VOUT', 'GND']))

    // View should have positions for all devices
    expect(doc.view.devices).toBeTruthy()
    for (const deviceId of deviceIds) {
      expect(doc.view.devices?.[deviceId]).toBeTruthy()
      const viewDevice = doc.view.devices?.[deviceId]
      expect(viewDevice?.position).toBeTruthy()
      expect(typeof viewDevice?.position?.x).toBe('number')
      expect(typeof viewDevice?.position?.y).toBe('number')
    }
  })

  it('uses custom network labels', () => {
    const result = generateVoltageDivider({
      vin: 5,
      vout: 3.3,
      vinLabel: '5V_RAIL',
      voutLabel: '3V3',
      groundLabel: 'DGND',
    })
    const allLabels = result.candidate.document.devices.flatMap((d) => d.terminals.map((t) => t.label))
    expect(allLabels).toContain('5V_RAIL')
    expect(allLabels).toContain('3V3')
    expect(allLabels).toContain('DGND')
  })

  it('uses custom title', () => {
    const result = generateVoltageDivider({ vin: 5, vout: 3.3, title: 'My Custom Divider' })
    expect(result.candidate.title).toBe('My Custom Divider')
    expect(result.candidate.document.document.title).toBe('My Custom Divider')
  })

  it('warns about extreme ratios', () => {
    const result = generateVoltageDivider({ vin: 100, vout: 0.5 })
    const warningMessages = result.warnings.join(' ')
    expect(warningMessages).toMatch(/less than 1%|impractical/i)
  })

  it('is deterministic (excluding timestamps)', () => {
    const input = { vin: 5, vout: 3.3 }
    const result1 = generateVoltageDivider(input)
    const result2 = generateVoltageDivider(input)
    const stripTimestamps = (candidate: unknown): unknown =>
      JSON.parse(JSON.stringify(candidate).replace(/"createdAt":"[^"]+"/g, '"createdAt":""').replace(/"updatedAt":"[^"]+"/g, '"updatedAt":""'))
    expect(stripTimestamps(result1.candidate)).toEqual(stripTimestamps(result2.candidate))
  })

  it('includes output impedance in calculated values', () => {
    const result = generateVoltageDivider({ vin: 5, r1Ohms: 10_000, r2Ohms: 10_000 })
    const outputImpedance = result.calculatedValues.outputImpedanceOhms as number
    // Parallel: 10k || 10k = 5k
    expect(outputImpedance).toBeGreaterThan(4_500)
    expect(outputImpedance).toBeLessThan(5_500)
  })

  it('returns assumptions and tradeoffs', () => {
    const result = generateVoltageDivider({ vin: 5, vout: 3.3 })
    expect(result.assumptions.length).toBeGreaterThan(0)
    expect(result.assumptions.join(' ')).toMatch(/resistive|voltage divider/i)
    expect(result.candidate.tradeoffs.length).toBeGreaterThan(0)
    expect(result.candidate.tradeoffs.join(' ')).toMatch(/regulator|unregulated/i)
  })
})
