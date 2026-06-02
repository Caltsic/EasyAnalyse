import {
  SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION,
  type SimulationScalar,
  type SimulationWorkerErrorCode,
  type SimulationWorkerErrorPayload,
  type SimulationWorkerManifest,
  type SimulationWorkerPoint,
  type SimulationWorkerRunResult,
} from '../types/simulation'
import { isRecord } from './guards'

const DEFAULT_TIMEOUT_MS = 3_000
const DEFAULT_MAX_OUTPUT_POINTS = 5_000
const INJECTED_WORKER_SOURCE_URL = 'easyanalyse-simulation-worker://injected'

type SimulationWorkerRequest = {
  type: 'run'
  script: string
  input: unknown
  maxOutputPoints: number
}

type MessageEventLike<T> = {
  data: T
}

type WorkerErrorEventLike = {
  message?: unknown
  error?: unknown
  filename?: unknown
  lineno?: unknown
  colno?: unknown
}

export interface SimulationWorkerLike {
  onmessage: ((event: MessageEventLike<unknown>) => void) | null
  onerror: ((event: WorkerErrorEventLike) => void) | null
  postMessage(message: SimulationWorkerRequest): void
  terminate(): void
}

export type SimulationWorkerNetworkPolicy = 'disabled'

export type SimulationWorkerFactory = (workerScriptUrl: string, workerSource: string) => SimulationWorkerLike

export interface RunSimulationWorkerOptions {
  timeoutMs?: number
  maxOutputPoints?: number
  networkPolicy?: SimulationWorkerNetworkPolicy
  signal?: AbortSignal
  workerFactory?: SimulationWorkerFactory
  now?: () => number
}

export class SimulationWorkerSandboxError extends Error {
  code: SimulationWorkerErrorCode
  detail: unknown

  constructor(error: SimulationWorkerErrorPayload) {
    super(error.message)
    this.name = 'SimulationWorkerSandboxError'
    this.code = error.code
    this.detail = error.detail
    if (error.stack) {
      this.stack = error.stack
    }
  }
}

export async function runSimulationWorker(
  script: string,
  input: unknown,
  options: RunSimulationWorkerOptions = {},
): Promise<SimulationWorkerRunResult> {
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs')
  const maxOutputPoints = normalizePositiveInteger(
    options.maxOutputPoints,
    DEFAULT_MAX_OUTPUT_POINTS,
    'maxOutputPoints',
  )
  const now = options.now ?? (() => performance.now())
  const startMs = now()
  const workerHandle = createWorker(options.workerFactory)
  const worker = workerHandle.worker

  return new Promise<SimulationWorkerRunResult>((resolve, reject) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      options.signal?.removeEventListener('abort', onAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      workerHandle.revokeUrl?.()
    }

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const fail = (error: SimulationWorkerErrorPayload) => {
      finish(() => reject(new SimulationWorkerSandboxError(error)))
    }

    const onAbort = () => {
      fail({
        code: 'aborted',
        message: `Simulation worker aborted${formatAbortReason(options.signal?.reason)}.`,
        detail: options.signal?.reason,
      })
    }

    if (options.signal?.aborted) {
      onAbort()
      return
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (event) => {
      const message = event.data
      if (!isRecord(message) || typeof message.type !== 'string') {
        fail({
          code: 'protocol-error',
          message: 'Simulation worker returned an unreadable protocol message.',
          detail: message,
        })
        return
      }

      if (message.type === 'error') {
        fail(normalizeWorkerError(message.error))
        return
      }

      try {
        const durationMs = Math.max(0, now() - startMs)
        const result = normalizeWorkerResult(message.result, maxOutputPoints, durationMs)
        finish(() => resolve(result))
      } catch (error) {
        fail(toSandboxError(error, 'invalid-output'))
      }
    }

    worker.onerror = (event) => {
      fail({
        code: 'script-error',
        message: formatWorkerErrorEvent(event),
        detail: event,
      })
    }

    timeoutId = setTimeout(() => {
      fail({
        code: 'timeout',
        message: `Simulation worker timed out after ${timeoutMs} ms.`,
        detail: { timeoutMs },
      })
    }, timeoutMs)

    try {
      worker.postMessage({
        type: 'run',
        script,
        input,
        maxOutputPoints,
      })
    } catch (error) {
      fail(toSandboxError(error, 'protocol-error'))
    }
  })
}

function createWorker(workerFactory: SimulationWorkerFactory | undefined): {
  worker: SimulationWorkerLike
  revokeUrl?: () => void
} {
  if (workerFactory) {
    return {
      worker: workerFactory(INJECTED_WORKER_SOURCE_URL, SIMULATION_WORKER_SOURCE),
    }
  }

  if (
    typeof Worker === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    throw new SimulationWorkerSandboxError({
      code: 'worker-unavailable',
      message: 'Web Worker and Blob are required to run a simulation worker sandbox.',
    })
  }

  const workerUrl = URL.createObjectURL(new Blob([SIMULATION_WORKER_SOURCE], { type: 'text/javascript' }))
  try {
    return {
      worker: new Worker(workerUrl) as unknown as SimulationWorkerLike,
      revokeUrl: () => URL.revokeObjectURL(workerUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(workerUrl)
    throw error
  }
}

function normalizeWorkerResult(
  value: unknown,
  maxOutputPoints: number,
  durationMs: number,
): SimulationWorkerRunResult {
  if (!isRecord(value)) {
    throw new Error('Simulation worker result must be an object.')
  }

  if (!Array.isArray(value.points)) {
    throw new Error('Simulation worker result.points must be an array.')
  }

  const sourcePoints = value.points.slice(0, maxOutputPoints)
  const points = sourcePoints.map((point, index) => normalizePoint(point, index))
  const droppedPointCount = value.points.length - points.length

  return {
    ...(value.manifest === undefined ? {} : { manifest: normalizeManifest(value.manifest) }),
    points,
    ...(typeof value.summary === 'string' ? { summary: value.summary } : {}),
    ...(Array.isArray(value.logs) ? { logs: value.logs.map((item) => String(item)) } : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
    truncated: value.truncated === true || droppedPointCount > 0,
    durationMs,
  }
}

function normalizeManifest(value: unknown): SimulationWorkerManifest {
  if (!isRecord(value)) {
    throw new Error('Simulation worker manifest must be an object.')
  }

  if (value.schemaVersion !== SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Simulation worker manifest.schemaVersion must be ${SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION}.`)
  }

  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new Error('Simulation worker manifest.name must be a non-empty string.')
  }

  return {
    schemaVersion: SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION,
    name: value.name,
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(Array.isArray(value.capabilities)
      ? { capabilities: value.capabilities.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(value.inputSchema === undefined ? {} : { inputSchema: value.inputSchema }),
    ...(value.outputSchema === undefined ? {} : { outputSchema: value.outputSchema }),
  }
}

function normalizePoint(value: unknown, index: number): SimulationWorkerPoint {
  if (!isRecord(value)) {
    throw new Error(`Simulation worker point at index ${index} must be an object.`)
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, raw]) => [key, normalizeScalar(raw, `points[${index}].${key}`)]),
  )
}

function normalizeScalar(value: unknown, path: string): SimulationScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  throw new Error(`${path} must be a finite number, string, boolean, or null.`)
}

function normalizePositiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new SimulationWorkerSandboxError({
      code: 'invalid-options',
      message: `${label} must be a positive finite number.`,
      detail: { [label]: value },
    })
  }

  return Math.floor(value)
}

function normalizeWorkerError(value: unknown): SimulationWorkerErrorPayload {
  if (!isRecord(value)) {
    return {
      code: 'script-error',
      message: 'Simulation worker failed with an unreadable error payload.',
      detail: value,
    }
  }

  const code = isSimulationWorkerErrorCode(value.code) ? value.code : 'script-error'
  return {
    code,
    message: typeof value.message === 'string' && value.message.length > 0 ? value.message : 'Simulation worker failed.',
    ...(value.detail === undefined ? {} : { detail: value.detail }),
    ...(typeof value.stack === 'string' ? { stack: value.stack } : {}),
  }
}

function isSimulationWorkerErrorCode(value: unknown): value is SimulationWorkerErrorCode {
  return (
    value === 'worker-unavailable' ||
    value === 'invalid-options' ||
    value === 'timeout' ||
    value === 'aborted' ||
    value === 'script-error' ||
    value === 'protocol-error' ||
    value === 'invalid-output'
  )
}

function toSandboxError(error: unknown, fallbackCode: SimulationWorkerErrorCode): SimulationWorkerErrorPayload {
  if (error instanceof SimulationWorkerSandboxError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail,
      stack: error.stack,
    }
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    code: fallbackCode,
    message: String(error),
    detail: error,
  }
}

function formatWorkerErrorEvent(event: WorkerErrorEventLike): string {
  const message = typeof event.message === 'string' && event.message.length > 0 ? event.message : 'Simulation worker script error.'
  const filename = typeof event.filename === 'string' && event.filename.length > 0 ? event.filename : ''
  const line = typeof event.lineno === 'number' && event.lineno > 0 ? event.lineno : null
  const column = typeof event.colno === 'number' && event.colno > 0 ? event.colno : null
  const location = filename || line !== null ? ` (${[filename, line, column].filter((item) => item !== '' && item !== null).join(':')})` : ''
  return `${message}${location}`
}

function formatAbortReason(reason: unknown): string {
  if (reason === undefined) {
    return ''
  }
  if (typeof reason === 'string' && reason.length > 0) {
    return `: ${reason}`
  }
  return ''
}

const SIMULATION_WORKER_SOURCE = `
const MANIFEST_SCHEMA_VERSION = ${JSON.stringify(SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION)};

disableUnsafeGlobals();

self.onmessage = async (event) => {
  const request = event.data || {};
  if (request.type !== 'run') return;

  try {
    const api = loadUserSimulationApi(String(request.script || ''));
    const runner = api.run || api.simulate || api.defaultExport;
    if (typeof runner !== 'function') {
      throw new Error('Simulation script must export run/simulate or define a run/simulate function.');
    }

    const rawOutput = await runner(request.input, {
      maxOutputPoints: request.maxOutputPoints,
      manifest: api.manifest || null,
    });
    self.postMessage({
      type: 'result',
      result: normalizeOutput(rawOutput, api.manifest, request.maxOutputPoints),
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: normalizeError(error),
    });
  }
};

function disableUnsafeGlobals() {
  const blocked = function blockedCapability() {
    throw new Error('Simulation worker network, import, DOM, and host capabilities are disabled.');
  };
  try { self.fetch = blocked; } catch (_) {}
  try { self.XMLHttpRequest = blocked; } catch (_) {}
  try { self.WebSocket = blocked; } catch (_) {}
  try { self.EventSource = blocked; } catch (_) {}
  try { self.importScripts = blocked; } catch (_) {}
  try { self.Worker = blocked; } catch (_) {}
}

function loadUserSimulationApi(script) {
  const module = { exports: {} };
  const exports = module.exports;
  const factory = new Function(
    'module',
    'exports',
    'self',
    '"use strict";\\n' +
      script +
      '\\nreturn {\\n' +
      '  manifest: typeof manifest !== "undefined" ? manifest : module.exports.manifest,\\n' +
      '  run: typeof run !== "undefined" ? run : module.exports.run,\\n' +
      '  simulate: typeof simulate !== "undefined" ? simulate : module.exports.simulate,\\n' +
      '  defaultExport: module.exports.default,\\n' +
      '};'
  );
  return factory(module, exports, self);
}

function normalizeOutput(rawOutput, fallbackManifest, maxOutputPoints) {
  const output = isRecord(rawOutput) && !Array.isArray(rawOutput) ? rawOutput : { points: rawOutput };
  const sourcePoints = Array.isArray(output.points) ? output.points : [];
  const normalizedMax = normalizePositiveInteger(maxOutputPoints, 5000);
  const truncated = sourcePoints.length > normalizedMax || output.truncated === true;
  const result = {
    points: sourcePoints.slice(0, normalizedMax),
    truncated,
  };

  const manifest = output.manifest || fallbackManifest;
  if (manifest !== undefined && manifest !== null) result.manifest = manifest;
  if (typeof output.summary === 'string') result.summary = output.summary;
  if (Array.isArray(output.logs)) result.logs = output.logs.map((item) => String(item));
  if (isRecord(output.metadata)) result.metadata = output.metadata;
  return result;
}

function normalizePositiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeError(error) {
  if (error && typeof error === 'object') {
    return {
      code: 'script-error',
      message: typeof error.message === 'string' ? error.message : String(error),
      stack: typeof error.stack === 'string' ? error.stack : undefined,
    };
  }
  return {
    code: 'script-error',
    message: String(error),
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
`;
