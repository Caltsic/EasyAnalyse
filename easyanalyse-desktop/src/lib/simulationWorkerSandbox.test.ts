import { afterEach, describe, expect, it, vi } from 'vitest'
import { SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION } from '../types/simulation'
import {
  type SimulationWorkerFactory,
  type SimulationWorkerLike,
  runSimulationWorker,
} from './simulationWorkerSandbox'

type WorkerRequest = Parameters<SimulationWorkerLike['postMessage']>[0]
type WorkerResponse = Parameters<NonNullable<SimulationWorkerLike['onmessage']>>[0]['data']

class MockWorker implements SimulationWorkerLike {
  onmessage: SimulationWorkerLike['onmessage'] = null
  onerror: SimulationWorkerLike['onerror'] = null
  requests: WorkerRequest[] = []
  respond: ((message: WorkerRequest, worker: MockWorker) => void) | undefined
  terminated = false

  constructor(respond?: (message: WorkerRequest, worker: MockWorker) => void) {
    this.respond = respond
  }

  postMessage(message: WorkerRequest): void {
    this.requests.push(message)
    this.respond?.(message, this)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(response: WorkerResponse): void {
    this.onmessage?.({ data: response })
  }
}

function factoryFor(worker: MockWorker): SimulationWorkerFactory {
  return (_workerScriptUrl, workerSource) => {
    expect(workerSource).toContain('loadUserSimulationApi')
    expect(workerSource).toContain('hostPostMessage')
    expect(workerSource).toContain('createUserSelf')
    expect(workerSource).toContain('direct postMessage is disabled')
    return worker
  }
}

describe('runSimulationWorker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs through an injected worker factory, preserves manifest data, and truncates output points', async () => {
    const worker = new MockWorker((message, currentWorker) => {
      expect(message.type).toBe('run')
      expect(message.script).toContain('simulate')
      expect(message.input).toEqual({ cycles: 2 })
      expect(message.maxOutputPoints).toBe(3)
      currentWorker.emit({
        type: 'result',
        result: {
          manifest: {
            schemaVersion: SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION,
            name: 'rc-step',
            version: '0.1.0',
            capabilities: ['time-domain'],
          },
          points: [
            { t: 0, vout: 0 },
            { t: 1, vout: 0.4 },
            { t: 2, vout: 0.7 },
            { t: 3, vout: 0.9 },
          ],
          summary: 'ok',
          logs: ['simulated'],
        },
      })
    })

    const result = await runSimulationWorker('function simulate() { return { points: [] } }', { cycles: 2 }, {
      maxOutputPoints: 3,
      workerFactory: factoryFor(worker),
      now: () => 10,
    })

    expect(result.manifest).toMatchObject({ name: 'rc-step', version: '0.1.0' })
    expect(result.points).toHaveLength(3)
    expect(result.truncated).toBe(true)
    expect(result.summary).toBe('ok')
    expect(worker.terminated).toBe(true)
  })

  it('rejects worker error messages with readable sandbox errors', async () => {
    const worker = new MockWorker((_message, currentWorker) => {
      currentWorker.emit({
        type: 'error',
        error: {
          code: 'script-error',
          message: 'boom from user simulation',
        },
      })
    })

    await expect(
      runSimulationWorker('throw new Error("boom")', {}, { workerFactory: factoryFor(worker) }),
    ).rejects.toMatchObject({
      code: 'script-error',
      message: 'boom from user simulation',
    })
    expect(worker.terminated).toBe(true)
  })

  it('rejects invalid output points with an invalid-output code', async () => {
    const worker = new MockWorker((_message, currentWorker) => {
      currentWorker.emit({
        type: 'result',
        result: {
          points: [{ t: Number.NaN }],
        },
      })
    })

    await expect(
      runSimulationWorker('function simulate() {}', {}, { workerFactory: factoryFor(worker) }),
    ).rejects.toMatchObject({
      code: 'invalid-output',
      message: expect.stringContaining('finite number'),
    })
  })

  it('rejects unsupported typed protocol messages before treating them as results', async () => {
    const worker = new MockWorker((_message, currentWorker) => {
      currentWorker.emit({
        type: 'progress',
        result: {
          points: [{ t: 0, vout: 0 }],
        },
      })
    })

    await expect(
      runSimulationWorker('function simulate() {}', {}, { workerFactory: factoryFor(worker) }),
    ).rejects.toMatchObject({
      code: 'protocol-error',
      message: expect.stringContaining('unsupported protocol message type'),
    })
    expect(worker.terminated).toBe(true)
  })

  it('terminates and rejects when the worker exceeds timeoutMs', async () => {
    vi.useFakeTimers()
    const worker = new MockWorker()
    const promise = runSimulationWorker('function simulate() {}', {}, {
      timeoutMs: 25,
      workerFactory: factoryFor(worker),
    })
    const rejection = expect(promise).rejects.toMatchObject({ code: 'timeout' })

    await vi.advanceTimersByTimeAsync(25)

    await rejection
    expect(worker.terminated).toBe(true)
  })
})
