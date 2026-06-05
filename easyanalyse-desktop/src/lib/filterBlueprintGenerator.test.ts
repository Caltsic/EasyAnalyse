import { describe, expect, it } from 'vitest'
import type { SimulationWorkerOutput } from '../types/simulation'
import { SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION } from '../types/simulation'
import { generateFilterBlueprint, type GenerateFilterBlueprintInput } from './filterBlueprintGenerator'

interface GeneratedSimulationApi {
  run?: (input: unknown) => SimulationWorkerOutput
}

function runGeneratedSimulation(input: GenerateFilterBlueprintInput, parameters: Record<string, number>) {
  const generated = generateFilterBlueprint(input)
  const script = generated.candidate.simulation?.workerScript
  if (!script) {
    throw new Error('expected generated filter blueprint to include a simulation script')
  }
  const run = loadGeneratedRunFunction(script)
  return {
    generated,
    output: run({ parameters }),
  }
}

function loadGeneratedRunFunction(script: string): NonNullable<GeneratedSimulationApi['run']> {
  const module = { exports: {} as Record<string, unknown> }
  const factory = new Function(
    'module',
    'exports',
    'self',
    `"use strict";\n${script}\nreturn { run: typeof run !== "undefined" ? run : module.exports.run };`,
  ) as (module: { exports: Record<string, unknown> }, exports: Record<string, unknown>, self: object) => GeneratedSimulationApi
  const api = factory(module, module.exports, Object.freeze({}))
  if (typeof api.run !== 'function') {
    throw new Error('generated simulation script did not expose run')
  }
  return api.run
}

function numericPoint(output: SimulationWorkerOutput, index: number) {
  const point = output.points[index]
  if (!point) throw new Error(`missing simulation point ${index}`)
  const frequencyHz = point.frequencyHz
  const magnitudeDb = point.magnitudeDb
  if (typeof frequencyHz !== 'number' || typeof magnitudeDb !== 'number') {
    throw new Error('simulation point must include numeric frequencyHz and magnitudeDb')
  }
  return { frequencyHz, magnitudeDb }
}

describe('generateFilterBlueprint simulation artifacts', () => {
  it('attaches an executable ideal low-pass frequency-response simulation artifact', () => {
    const { generated, output } = runGeneratedSimulation(
      { filterType: 'lowpass', topology: 'passive-rc', cutoffFrequencyHz: 5_000 },
      { startFrequencyHz: 50, stopFrequencyHz: 500_000, pointCount: 32 },
    )

    expect(generated.candidate.simulation).toMatchObject({
      schemaVersion: SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION,
      manifest: {
        schemaVersion: SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION,
        capabilities: expect.arrayContaining(['frequency-response', 'parameter-sweep']),
      },
      scriptLanguage: 'javascript',
    })
    expect(output.points).toHaveLength(32)
    expect(numericPoint(output, 0).frequencyHz).toBeCloseTo(50)
    expect(numericPoint(output, output.points.length - 1).frequencyHz).toBeCloseTo(500_000)
    expect(numericPoint(output, 0).magnitudeDb).toBeGreaterThan(numericPoint(output, output.points.length - 1).magnitudeDb)
    expect(output.summary).toContain('passive-rc lowpass preview')
  })

  it('attaches an executable ideal high-pass frequency-response simulation artifact', () => {
    const { output } = runGeneratedSimulation(
      { filterType: 'highpass', topology: 'passive-rc', cutoffFrequencyHz: 5_000 },
      { startFrequencyHz: 50, stopFrequencyHz: 500_000, pointCount: 32 },
    )

    expect(output.points).toHaveLength(32)
    expect(numericPoint(output, 0).magnitudeDb).toBeLessThan(numericPoint(output, output.points.length - 1).magnitudeDb)
    expect(output.summary).toContain('passive-rc highpass preview')
  })

  it('includes Sallen-Key Q and gain controls in the generated simulation artifact', () => {
    const generated = generateFilterBlueprint({
      filterType: 'lowpass',
      topology: 'sallen-key',
      cutoffFrequencyHz: 5_000,
      q: 2,
    })
    const simulation = generated.candidate.simulation

    expect(simulation?.manifest.inputSchema).toMatchObject({
      properties: {
        q: { type: 'number' },
        gain: { type: 'number' },
      },
    })
    const run = loadGeneratedRunFunction(simulation?.workerScript ?? '')
    const output = run({
      parameters: {
        cutoffFrequencyHz: 5_000,
        startFrequencyHz: 50,
        stopFrequencyHz: 500_000,
        pointCount: 48,
        q: 2,
        gain: 1.6,
      },
    })
    expect(output.points).toHaveLength(48)
    expect(output.metadata).toMatchObject({ topology: 'sallen-key', q: 2, gain: 1.6 })
  })
})
