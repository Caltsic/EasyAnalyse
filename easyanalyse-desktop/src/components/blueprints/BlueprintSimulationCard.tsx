import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertCircle, Play, Square } from 'lucide-react'
import { getErrorMessage } from '../../lib/errors'
import { isRecord } from '../../lib/guards'
import { runSimulationWorker, SimulationWorkerSandboxError } from '../../lib/simulationWorkerSandbox'
import type { TranslationKey } from '../../lib/i18n'
import type { BlueprintRecord } from '../../types/blueprint'
import type {
  SimulationArtifact,
  SimulationScalar,
  SimulationWorkerInput,
  SimulationWorkerPoint,
  SimulationWorkerRunResult,
} from '../../types/simulation'

interface BlueprintSimulationCardProps {
  record: BlueprintRecord
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

interface NumericParameterControl {
  name: string
  min?: number
  max?: number
  step?: number
}

type SimulationStatus = 'idle' | 'running' | 'success' | 'error'

export function BlueprintSimulationCard({ record, t }: BlueprintSimulationCardProps) {
  const artifact = record.extensions?.simulation
  const controls = useMemo(() => (artifact ? getNumericParameterControls(artifact) : []), [artifact])
  const [status, setStatus] = useState<SimulationStatus>('idle')
  const [result, setResult] = useState<SimulationWorkerRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parameters, setParameters] = useState<Record<string, number>>(() => getInitialParameters(artifact))
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setParameters(getInitialParameters(artifact))
    setStatus('idle')
    setResult(null)
    setError(null)
    return () => {
      abortControllerRef.current?.abort('Blueprint simulation changed.')
      abortControllerRef.current = null
    }
  }, [artifact, record.id])

  if (!artifact) {
    return null
  }

  const running = status === 'running'

  const runPreview = async () => {
    if (running) return
    abortControllerRef.current?.abort('Restarting simulation.')
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setStatus('running')
    setError(null)
    setResult(null)
    try {
      const runInput = createRunInput(record, artifact, parameters)
      const nextResult = await runSimulationWorker(artifact.workerScript, runInput, {
        timeoutMs: 5_000,
        maxOutputPoints: 1_000,
        signal: abortController.signal,
      })
      if (abortControllerRef.current !== abortController) {
        return
      }
      setResult(nextResult)
      setStatus('success')
    } catch (runError) {
      if (abortControllerRef.current !== abortController) {
        return
      }
      setError(formatSimulationError(runError))
      setStatus('error')
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
    }
  }

  const cancelPreview = () => {
    abortControllerRef.current?.abort('Simulation cancelled by user.')
    abortControllerRef.current = null
    setStatus('idle')
  }

  return (
    <section className="blueprint-simulation-card" aria-label={t('simulationPreview')}>
      <div className="blueprint-simulation-card__header">
        <div>
          <h4>
            <Activity size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{artifact.manifest.name}</span>
          </h4>
          {artifact.manifest.description ? <p>{artifact.manifest.description}</p> : null}
        </div>
        <button className="ghost-button" type="button" onClick={running ? cancelPreview : () => void runPreview()}>
          {running ? (
            <Square size={14} strokeWidth={2.1} aria-hidden="true" />
          ) : (
            <Play size={14} strokeWidth={2.1} aria-hidden="true" />
          )}
          <span>{running ? t('cancel') : t('runSimulation')}</span>
        </button>
      </div>

      <p className="blueprint-simulation-card__summary">{t('simulationPreviewCaution')}</p>

      {controls.length > 0 ? (
        <div className="blueprint-simulation-card__parameters" aria-label={t('simulationParameters')}>
          {controls.map((control) => (
            <label key={control.name}>
              <span>{control.name}</span>
              {control.min !== undefined && control.max !== undefined ? (
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step ?? getDefaultStep(control.min, control.max)}
                  value={parameters[control.name] ?? 0}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value)
                    setParameters((current) => ({ ...current, [control.name]: value }))
                  }}
                />
              ) : (
                <span />
              )}
              <input
                type="number"
                step={control.step ?? 'any'}
                value={parameters[control.name] ?? 0}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value)
                  setParameters((current) => ({ ...current, [control.name]: Number.isFinite(value) ? value : 0 }))
                }}
              />
            </label>
          ))}
        </div>
      ) : null}

      <div className={`blueprint-simulation-card__status is-${status}`}>
        {status === 'error' ? <AlertCircle size={14} strokeWidth={2.1} aria-hidden="true" /> : null}
        <span>{formatSimulationStatus(status, t)}</span>
        {result ? (
          <span>
            {t('simulationPointCount', { count: result.points.length })} /{' '}
            {t('simulationDuration', { ms: Math.round(result.durationMs) })}
          </span>
        ) : null}
      </div>

      {error ? <p className="blueprint-simulation-card__error">{error}</p> : null}
      {result?.summary ? <p className="blueprint-simulation-card__summary">{result.summary}</p> : null}
      {result ? <SimulationChart points={result.points} emptyLabel={t('simulationNoNumericSeries')} /> : null}
      {result?.truncated ? <p className="blueprint-simulation-card__summary">{t('simulationTruncated')}</p> : null}
    </section>
  )
}

function createRunInput(
  record: BlueprintRecord,
  artifact: SimulationArtifact,
  parameters: Record<string, number>,
): SimulationWorkerInput {
  const defaultInput = isRecord(artifact.defaultInput)
    ? structuredClone(artifact.defaultInput) as SimulationWorkerInput
    : {}
  const defaultParameters = isRecord(defaultInput.parameters) ? defaultInput.parameters : {}
  return {
    ...defaultInput,
    document: record.document,
    parameters: {
      ...defaultParameters,
      ...parameters,
    },
  }
}

function getInitialParameters(artifact: SimulationArtifact | undefined): Record<string, number> {
  if (!artifact) return {}
  const fromDefaultInput = isRecord(artifact.defaultInput?.parameters)
    ? Object.fromEntries(
      Object.entries(artifact.defaultInput.parameters)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
    )
    : {}

  return getNumericParameterControls(artifact).reduce<Record<string, number>>((parameters, control) => {
    parameters[control.name] = parameters[control.name] ?? fromDefaultInput[control.name] ?? control.min ?? 0
    return parameters
  }, { ...fromDefaultInput })
}

function getNumericParameterControls(artifact: SimulationArtifact): NumericParameterControl[] {
  const controls = new Map<string, NumericParameterControl>()
  if (isRecord(artifact.defaultInput?.parameters)) {
    Object.entries(artifact.defaultInput.parameters).forEach(([name, value]) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        controls.set(name, { name })
      }
    })
  }

  const schema = artifact.manifest.inputSchema
  const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : null
  if (properties) {
    Object.entries(properties).forEach(([name, value]) => {
      if (!isRecord(value)) return
      const type = value.type
      if (type !== 'number' && type !== 'integer') return
      controls.set(name, {
        name,
        min: readFiniteNumber(value.minimum),
        max: readFiniteNumber(value.maximum),
        step: readFiniteNumber(value.multipleOf),
      })
    })
  }

  return Array.from(controls.values())
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getDefaultStep(min: number, max: number): number {
  const range = Math.abs(max - min)
  return range > 0 ? range / 100 : 1
}

function formatSimulationStatus(
  status: SimulationStatus,
  t: BlueprintSimulationCardProps['t'],
): string {
  if (status === 'running') return t('simulationRunning')
  if (status === 'success') return t('simulationReady')
  if (status === 'error') return t('simulationFailed')
  return t('simulationIdle')
}

function formatSimulationError(error: unknown): string {
  if (error instanceof SimulationWorkerSandboxError) {
    return `${error.code}: ${error.message}`
  }
  return getErrorMessage(error)
}

function SimulationChart({ points, emptyLabel }: { points: SimulationWorkerPoint[]; emptyLabel: string }) {
  const series = getFirstNumericSeries(points)
  if (!series) {
    return <p className="blueprint-simulation-card__summary">{emptyLabel}</p>
  }

  const width = 320
  const height = 120
  const padding = 12
  const xRange = series.xMax - series.xMin || 1
  const yRange = series.yMax - series.yMin || 1
  const polyline = series.points
    .map((point) => {
      const x = padding + ((point.x - series.xMin) / xRange) * (width - padding * 2)
      const y = height - padding - ((point.y - series.yMin) / yRange) * (height - padding * 2)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <div className="blueprint-simulation-card__chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.xKey} to ${series.yKey}`}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} />
        <polyline points={polyline} />
      </svg>
      <div>
        <span>{series.xKey}</span>
        <span>{series.yKey}</span>
      </div>
    </div>
  )
}

function getFirstNumericSeries(points: SimulationWorkerPoint[]) {
  const usablePoints = points
    .map((point) => {
      const numericEntries = Object.entries(point).filter((entry): entry is [string, number] => (
        typeof entry[1] === 'number' && Number.isFinite(entry[1])
      ))
      return { point, numericEntries }
    })
    .filter((entry) => entry.numericEntries.length >= 2)

  if (usablePoints.length < 2) return null

  const firstKeys = usablePoints[0]?.numericEntries.map(([key]) => key) ?? []
  const xKey = firstKeys.find((key) => key.toLowerCase() === 't' || key.toLowerCase().includes('time')) ?? firstKeys[0]
  const yKey = firstKeys.find((key) => key !== xKey) ?? firstKeys[1]
  if (!xKey || !yKey) return null

  const numericPoints = usablePoints
    .map(({ point }) => ({
      x: normalizeNumeric(point[xKey]),
      y: normalizeNumeric(point[yKey]),
    }))
    .filter((point): point is { x: number; y: number } => point.x !== null && point.y !== null)

  if (numericPoints.length < 2) return null

  return {
    xKey,
    yKey,
    points: numericPoints,
    xMin: Math.min(...numericPoints.map((point) => point.x)),
    xMax: Math.max(...numericPoints.map((point) => point.x)),
    yMin: Math.min(...numericPoints.map((point) => point.y)),
    yMax: Math.max(...numericPoints.map((point) => point.y)),
  }
}

function normalizeNumeric(value: SimulationScalar | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
