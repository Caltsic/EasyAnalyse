import type { DocumentFile } from './document'

export const SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION = 'easyanalyse-simulation-v1'

export type SimulationWorkerManifestSchemaVersion = typeof SIMULATION_WORKER_MANIFEST_SCHEMA_VERSION

export type SimulationScalar = number | string | boolean | null

export type SimulationWorkerPoint = Record<string, SimulationScalar>

export interface SimulationWorkerManifest {
  schemaVersion: SimulationWorkerManifestSchemaVersion
  name: string
  version?: string
  description?: string
  capabilities?: string[]
  inputSchema?: unknown
  outputSchema?: unknown
}

export interface SimulationWorkerInput<TParameters = Record<string, unknown>> {
  document?: DocumentFile | null
  parameters?: TParameters
  signals?: Record<string, SimulationScalar | SimulationScalar[]>
}

export interface SimulationWorkerOutput {
  manifest?: SimulationWorkerManifest
  points: SimulationWorkerPoint[]
  summary?: string
  logs?: string[]
  metadata?: Record<string, unknown>
}

export interface SimulationWorkerRunResult extends SimulationWorkerOutput {
  truncated: boolean
  durationMs: number
}

export interface SimulationArtifact {
  schemaVersion: SimulationWorkerManifestSchemaVersion
  manifest: SimulationWorkerManifest
  workerScript: string
  scriptLanguage?: 'javascript'
  defaultInput?: SimulationWorkerInput
  notes?: string[]
}

export type SimulationWorkerErrorCode =
  | 'worker-unavailable'
  | 'invalid-options'
  | 'timeout'
  | 'aborted'
  | 'script-error'
  | 'protocol-error'
  | 'invalid-output'

export interface SimulationWorkerErrorPayload {
  code: SimulationWorkerErrorCode
  message: string
  detail?: unknown
  stack?: string
}
