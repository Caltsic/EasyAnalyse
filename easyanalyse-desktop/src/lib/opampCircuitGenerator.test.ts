import { describe, expect, it } from 'vitest'
import { generateOpAmpCircuit } from './opampCircuitGenerator'

describe('opampCircuitGenerator', () => {
  describe('non-inverting amplifier', () => {
    it('generates with gain from default R1 anchor', () => {
      const result = generateOpAmpCircuit({ circuitType: 'non-inverting-amplifier', gain: 10 })
      expect(result.candidate.document.schemaVersion).toBe('4.0.0')
      expect(result.calculatedValues.topology).toBe('non-inverting-amplifier')
      const actualGain = result.calculatedValues.actualGain as number
      expect(actualGain).toBeGreaterThan(8)
      expect(actualGain).toBeLessThan(12)
      const r1Ohms = result.calculatedValues.r1Ohms as number
      const rfOhms = result.calculatedValues.rfOhms as number
      expect(r1Ohms).toBeGreaterThan(0)
      expect(rfOhms).toBeGreaterThan(r1Ohms) // Rf should be larger for gain > 2
    })

    it('generates with explicit resistors', () => {
      const result = generateOpAmpCircuit({
        circuitType: 'non-inverting-amplifier',
        r1Ohms: 1_000,
        rfOhms: 4_700,
      })
      const actualGain = result.calculatedValues.actualGain as number
      // gain = 1 + 4700/1000 = 5.7
      expect(actualGain).toBeGreaterThan(5)
      expect(actualGain).toBeLessThan(6.5)
    })

    it('generates valid document structure', () => {
      const result = generateOpAmpCircuit({ circuitType: 'non-inverting-amplifier', gain: 5 })
      const doc = result.candidate.document
      expect(doc.schemaVersion).toBe('4.0.0')
      expect(Array.isArray(doc.devices)).toBe(true)

      const deviceIds = doc.devices.map((d) => d.id)
      expect(deviceIds).toEqual(expect.arrayContaining(['j1', 'u1', 'r1', 'rf', 'tp1', 'vcc1', 'gnd1']))

      // Op-amp should have 5 terminals
      const opamp = doc.devices.find((d) => d.id === 'u1')!
      expect(opamp.terminals.length).toBe(5)
      expect(opamp.terminals.map((t) => t.name)).toEqual(expect.arrayContaining(['IN+', 'IN-', 'OUT', 'V+', 'V-']))

      // Verify connectivity
      const allLabels = doc.devices.flatMap((d) => d.terminals.map((t) => t.label))
      expect(allLabels).toEqual(expect.arrayContaining(['VIN', 'VOUT', 'FB', 'VCC', 'GND']))

      // Every device has valid terminals
      for (const device of doc.devices) {
        for (const terminal of device.terminals) {
          expect(terminal.id).toBeTruthy()
          expect(['input', 'output']).toContain(terminal.direction)
        }
      }

      // View has positions
      expect(doc.view.devices).toBeTruthy()
      for (const deviceId of deviceIds) {
        expect(doc.view.devices![deviceId]).toBeTruthy()
      }
    })
  })

  describe('inverting amplifier', () => {
    it('generates with gain calculation', () => {
      const result = generateOpAmpCircuit({ circuitType: 'inverting-amplifier', gain: 5 })
      expect(result.calculatedValues.topology).toBe('inverting-amplifier')
      const actualGain = result.calculatedValues.actualGain as number
      expect(actualGain).toBeGreaterThan(3)
      expect(actualGain).toBeLessThan(7)
    })

    it('has SUM node for virtual ground', () => {
      const result = generateOpAmpCircuit({ circuitType: 'inverting-amplifier', gain: 10 })
      const allLabels = result.candidate.document.devices.flatMap((d) => d.terminals.map((t) => t.label))
      expect(allLabels).toContain('SUM')
      expect(allLabels).toContain('VIN')
      expect(allLabels).toContain('VOUT')
    })

    it('connects IN+ to GND', () => {
      const result = generateOpAmpCircuit({ circuitType: 'inverting-amplifier', gain: 5 })
      const opamp = result.candidate.document.devices.find((d) => d.id === 'u1')!
      const inPlus = opamp.terminals.find((t) => t.name === 'IN+')!
      expect(inPlus.label).toBe('GND')
    })

    it('includes input impedance in calculated values', () => {
      const result = generateOpAmpCircuit({ circuitType: 'inverting-amplifier', gain: 5, r1Ohms: 10_000 })
      const inputImpedance = result.calculatedValues.inputImpedanceOhms as number
      expect(inputImpedance).toBeGreaterThan(9_000)
      expect(inputImpedance).toBeLessThan(11_000)
    })
  })

  describe('voltage follower', () => {
    it('generates without gain resistors', () => {
      const result = generateOpAmpCircuit({ circuitType: 'voltage-follower' })
      expect(result.calculatedValues.topology).toBe('voltage-follower')
      expect(result.calculatedValues.gain).toBe(1)

      const deviceIds = result.candidate.document.devices.map((d) => d.id)
      expect(deviceIds).not.toContain('r1')
      expect(deviceIds).not.toContain('rf')
      expect(deviceIds).toEqual(expect.arrayContaining(['j1', 'u1', 'tp1', 'vcc1', 'gnd1']))
    })

    it('connects IN- directly to VOUT', () => {
      const result = generateOpAmpCircuit({ circuitType: 'voltage-follower' })
      const opamp = result.candidate.document.devices.find((d) => d.id === 'u1')!
      const inMinus = opamp.terminals.find((t) => t.name === 'IN-')!
      expect(inMinus.label).toBe('VOUT')
    })
  })

  describe('common', () => {
    it('uses custom supply labels', () => {
      const result = generateOpAmpCircuit({
        circuitType: 'non-inverting-amplifier',
        gain: 2,
        positiveSupplyLabel: '+15V',
        negativeSupplyLabel: '-15V',
      })
      const allLabels = result.candidate.document.devices.flatMap((d) => d.terminals.map((t) => t.label))
      expect(allLabels).toContain('+15V')
      expect(allLabels).toContain('-15V')
    })

    it('warns about high gain', () => {
      const result = generateOpAmpCircuit({ circuitType: 'non-inverting-amplifier', gain: 500 })
      const warningMessages = result.warnings.join(' ')
      expect(warningMessages).toMatch(/high|gain-bandwidth|bandwidth/i)
    })

    it('is deterministic (excluding timestamps)', () => {
      const input = { circuitType: 'non-inverting-amplifier' as const, gain: 10 }
      const result1 = generateOpAmpCircuit(input)
      const result2 = generateOpAmpCircuit(input)
      // Strip timestamps before comparison since new Date() differs between calls
      const stripTimestamps = (candidate: unknown): unknown =>
        JSON.parse(JSON.stringify(candidate).replace(/"createdAt":"[^"]+"/g, '"createdAt":""').replace(/"updatedAt":"[^"]+"/g, '"updatedAt":""'))
      expect(stripTimestamps(result1.candidate)).toEqual(stripTimestamps(result2.candidate))
    })

    it('all three topologies produce valid documents', () => {
      const configs = [
        { circuitType: 'non-inverting-amplifier' as const, gain: 10 },
        { circuitType: 'inverting-amplifier' as const, gain: 5 },
        { circuitType: 'voltage-follower' as const },
      ]
      for (const config of configs) {
        const result = generateOpAmpCircuit(config)
        const doc = result.candidate.document
        expect(doc.schemaVersion).toBe('4.0.0')
        expect(doc.document.id).toBeTruthy()
        expect(doc.document.title).toBeTruthy()
        expect(doc.devices.length).toBeGreaterThan(0)
        // All terminals must have valid direction
        for (const device of doc.devices) {
          for (const terminal of device.terminals) {
            expect(['input', 'output']).toContain(terminal.direction)
            expect(terminal.id).toBeTruthy()
            expect(terminal.name).toBeTruthy()
          }
        }
      }
    })

    it('returns assumptions and tradeoffs', () => {
      const result = generateOpAmpCircuit({ circuitType: 'non-inverting-amplifier', gain: 10 })
      expect(result.assumptions.length).toBeGreaterThan(0)
      expect(result.assumptions.join(' ')).toMatch(/non-inverting|amplifier/i)
      expect(result.candidate.tradeoffs.length).toBeGreaterThan(0)
    })
  })
})
