import type { DocumentFile } from '../types/document'
import { AgentProviderError, type AgentProviderErrorCode } from './openAiCompatibleProvider'

export interface ControlledProviderOperationContext {
  signal: AbortSignal
  attempt: number
}

export type ControlledProviderOperation<T> = (context: ControlledProviderOperationContext) => Promise<T>

export interface ProviderRetryOptions {
  /** Total attempts, including the first try. */
  maxAttempts?: number
  baseDelayMs?: number
  backoffMultiplier?: number
  maxDelayMs?: number
  jitterRatio?: number
  random?: () => number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}

export interface RunProviderWithControlsInput<T> {
  operation: ControlledProviderOperation<T>
  signal?: AbortSignal
  timeoutMs?: number
  retry?: ProviderRetryOptions
  redactions?: Array<string | undefined>
  providerId?: string
  modelId?: string
}

export interface AgentContextBudgetInput {
  systemPrompt: string
  userPrompt: string
  currentDocument?: DocumentFile | null
  documentText?: string | null
  modelContextWindow: number
  reservedOutputTokens: number
  estimateTokens?: (text: string) => number
  redactions?: Array<string | undefined>
}

export interface AgentContextBudgetResult {
  withinBudget: true
  modelContextWindow: number
  reservedOutputTokens: number
  availableInputTokens: number
  estimatedInputTokens: number
  systemPromptTokens: number
  userPromptTokens: number
  documentTokens: number
}

const DEFAULT_MAX_ATTEMPTS = 1
const MAX_RETRY_ATTEMPTS = 10
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_BACKOFF_MULTIPLIER = 2
const MAX_BACKOFF_MULTIPLIER = 10
const DEFAULT_MAX_DELAY_MS = 5_000
const MAX_RETRY_DELAY_MS = 60_000
const DEFAULT_JITTER_RATIO = 0
const MAX_JITTER_RATIO = 1
const RETRYABLE_CODES = new Set<AgentProviderErrorCode>([
  'AGENT_PROVIDER_NETWORK_ERROR',
  'AGENT_PROVIDER_TIMEOUT',
  'AGENT_RATE_LIMITED',
  'AGENT_PROVIDER_SERVER_ERROR',
])

export async function runProviderWithControls<T>(input: RunProviderWithControlsInput<T>): Promise<T> {
  if (typeof input.operation !== 'function') {
    throw createRuntimeError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: 'Provider runtime requires an injected operation; it never uses global network access by default.',
      retryable: false,
      input,
    })
  }

  const retry = normalizeRetryOptions(input.retry)
  let attempt = 1
  let lastError: AgentProviderError | null = null

  while (attempt <= retry.maxAttempts) {
    if (input.signal?.aborted) {
      throw createCancelledError(input)
    }

    try {
      return await runSingleAttempt(input, attempt)
    } catch (error) {
      const providerError = normalizeRuntimeError(error, input)
      lastError = providerError
      if (attempt >= retry.maxAttempts || !shouldRetry(providerError)) {
        throw providerError
      }

      const delayMs = calculateRetryDelay(attempt, retry)
      await retry.sleep(delayMs, input.signal ?? new AbortController().signal).catch((sleepError: unknown) => {
        if (input.signal?.aborted || isAbortError(sleepError)) {
          throw createCancelledError(input)
        }
        throw normalizeRuntimeError(sleepError, input)
      })
      attempt += 1
    }
  }

  throw lastError ?? createRuntimeError({
    code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
    message: 'Provider runtime did not execute because retry attempts were exhausted before start.',
    retryable: false,
    input,
  })
}

export function checkAgentContextBudget(input: AgentContextBudgetInput): AgentContextBudgetResult {
  const modelContextWindow = positiveInteger(input.modelContextWindow, 'modelContextWindow', input.redactions)
  const reservedOutputTokens = nonNegativeInteger(input.reservedOutputTokens, 'reservedOutputTokens', input.redactions)
  const availableInputTokens = modelContextWindow - reservedOutputTokens
  if (availableInputTokens <= 0) {
    throw createRuntimeError({
      code: 'AGENT_PROVIDER_CONTEXT_TOO_LARGE',
      message: `Context budget exceeded before request: reserved output tokens (${reservedOutputTokens}) leave no input capacity in context window (${modelContextWindow}).`,
      retryable: false,
      redactions: input.redactions,
    })
  }

  const estimateTokens = input.estimateTokens ?? estimateTokensApproximately
  const documentText = input.documentText ?? (input.currentDocument ? JSON.stringify(input.currentDocument) : '')
  const systemPromptTokens = safeEstimateTokens(input.systemPrompt, estimateTokens)
  const userPromptTokens = safeEstimateTokens(input.userPrompt, estimateTokens)
  const documentTokens = safeEstimateTokens(documentText, estimateTokens)
  const estimatedInputTokens = systemPromptTokens + userPromptTokens + documentTokens

  if (estimatedInputTokens > availableInputTokens) {
    throw createRuntimeError({
      code: 'AGENT_PROVIDER_CONTEXT_TOO_LARGE',
      message:
        `Context budget exceeded: estimated input ${estimatedInputTokens} tokens exceeds available ${availableInputTokens} ` +
        `(context ${modelContextWindow}, reserved output ${reservedOutputTokens}; system ${systemPromptTokens}, user ${userPromptTokens}, document ${documentTokens}).`,
      retryable: false,
      redactions: input.redactions,
    })
  }

  return {
    withinBudget: true,
    modelContextWindow,
    reservedOutputTokens,
    availableInputTokens,
    estimatedInputTokens,
    systemPromptTokens,
    userPromptTokens,
    documentTokens,
  }
}

async function runSingleAttempt<T>(input: RunProviderWithControlsInput<T>, attempt: number): Promise<T> {
  const controller = new AbortController()
  const racePromises: Array<Promise<T>> = []
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  let cancelled = false
  let rejectExternalCancel: ((error: AgentProviderError) => void) | null = null

  const abortFromExternalSignal = () => {
    cancelled = true
    controller.abort(createAbortReason('cancelled'))
    rejectExternalCancel?.(createCancelledError(input))
  }

  if (input.signal?.aborted) {
    throw createCancelledError(input)
  }
  input.signal?.addEventListener('abort', abortFromExternalSignal, { once: true })

  if (input.timeoutMs !== undefined && input.timeoutMs > 0 && Number.isFinite(input.timeoutMs)) {
    racePromises.push(
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true
          controller.abort(createAbortReason('timeout'))
          reject(createTimeoutError(input))
        }, input.timeoutMs)
      }),
    )
  }

  if (input.signal) {
    racePromises.push(
      new Promise<never>((_, reject) => {
        rejectExternalCancel = reject
      }),
    )
  }

  try {
    const operationPromise = Promise.resolve(input.operation({ signal: controller.signal, attempt }))
    return await Promise.race([operationPromise, ...racePromises])
  } catch (error) {
    if (timedOut) throw createTimeoutError(input)
    if (cancelled || input.signal?.aborted) throw createCancelledError(input)
    throw error
  } finally {
    rejectExternalCancel = null
    if (timeoutId !== null) clearTimeout(timeoutId)
    input.signal?.removeEventListener('abort', abortFromExternalSignal)
  }
}

function normalizeRetryOptions(options: ProviderRetryOptions | undefined): Required<ProviderRetryOptions> {
  return {
    maxAttempts: normalizeFiniteInteger(options?.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, MAX_RETRY_ATTEMPTS),
    baseDelayMs: normalizeFiniteNumber(options?.baseDelayMs, DEFAULT_BASE_DELAY_MS, 0, MAX_RETRY_DELAY_MS),
    backoffMultiplier: normalizeFiniteNumber(
      options?.backoffMultiplier,
      DEFAULT_BACKOFF_MULTIPLIER,
      1,
      MAX_BACKOFF_MULTIPLIER,
    ),
    maxDelayMs: normalizeFiniteNumber(options?.maxDelayMs, DEFAULT_MAX_DELAY_MS, 0, MAX_RETRY_DELAY_MS),
    jitterRatio: normalizeFiniteNumber(options?.jitterRatio, DEFAULT_JITTER_RATIO, 0, MAX_JITTER_RATIO),
    random: options?.random ?? Math.random,
    sleep: options?.sleep ?? sleepWithAbort,
  }
}

function normalizeFiniteInteger(value: number | undefined, defaultValue: number, min: number, max: number): number {
  const normalized = normalizeFiniteNumber(value, defaultValue, min, max)
  return Math.min(max, Math.max(min, Math.floor(normalized)))
}

function normalizeFiniteNumber(value: number | undefined, defaultValue: number, min: number, max: number): number {
  const candidate = value ?? defaultValue
  if (!Number.isFinite(candidate)) return defaultValue
  return Math.min(max, Math.max(min, candidate))
}

function shouldRetry(error: AgentProviderError): boolean {
  return error.retryable && RETRYABLE_CODES.has(error.code)
}

function calculateRetryDelay(attempt: number, retry: Required<ProviderRetryOptions>): number {
  const exponentialDelay = retry.baseDelayMs * retry.backoffMultiplier ** Math.max(0, attempt - 1)
  const cappedDelay = Math.min(exponentialDelay, retry.maxDelayMs)
  if (retry.jitterRatio <= 0 || cappedDelay === 0) return cappedDelay
  const jitter = cappedDelay * retry.jitterRatio * (retry.random() * 2 - 1)
  return Math.max(0, Math.round(Math.min(retry.maxDelayMs, cappedDelay + jitter)))
}

function normalizeRuntimeError(error: unknown, input: RunProviderWithControlsInput<unknown>): AgentProviderError {
  if (input.signal?.aborted || isAbortError(error)) {
    return createCancelledError(input)
  }
  if (error instanceof AgentProviderError) {
    return sanitizeProviderError(error, input.redactions)
  }
  const detail = sanitizeMessage(errorMessage(error), input.redactions)
  return createRuntimeError({
    code: 'AGENT_PROVIDER_NETWORK_ERROR',
    message: detail ? `Provider runtime operation failed. Details: ${detail}` : 'Provider runtime operation failed.',
    retryable: true,
    input,
  })
}

function createTimeoutError(input: RunProviderWithControlsInput<unknown>): AgentProviderError {
  return createRuntimeError({
    code: 'AGENT_PROVIDER_TIMEOUT',
    message: `Provider request timed out after ${input.timeoutMs} ms.`,
    retryable: true,
    input,
  })
}

function createCancelledError(input: RunProviderWithControlsInput<unknown>): AgentProviderError {
  return createRuntimeError({
    code: 'AGENT_PROVIDER_CANCELLED',
    message: 'Provider request was cancelled before completion.',
    retryable: false,
    input,
  })
}

function createRuntimeError(init: {
  code: AgentProviderErrorCode
  message: string
  retryable: boolean
  input?: Pick<RunProviderWithControlsInput<unknown>, 'providerId' | 'modelId' | 'redactions'>
  redactions?: Array<string | undefined>
}): AgentProviderError {
  return new AgentProviderError({
    code: init.code,
    message: sanitizeMessage(init.message, init.redactions ?? init.input?.redactions),
    retryable: init.retryable,
    providerId: init.input?.providerId,
    modelId: init.input?.modelId,
  })
}

function sanitizeProviderError(error: AgentProviderError, redactions: Array<string | undefined> = []): AgentProviderError {
  const sanitizedMessage = sanitizeMessage(error.message, redactions)
  if (sanitizedMessage === error.message) return error
  return new AgentProviderError({
    code: error.code,
    message: sanitizedMessage,
    retryable: error.retryable,
    status: error.status,
    providerId: error.providerId,
    modelId: error.modelId,
  })
}

function sanitizeMessage(message: string, redactions: Array<string | undefined> = []): string {
  let sanitized = message
  redactions.forEach((redaction) => {
    const trimmed = redaction?.trim()
    if (!trimmed) return
    sanitized = sanitized.split(trimmed).join('[redacted-api-key]')
  })
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted-api-key]')
  return sanitized.length > 800 ? `${sanitized.slice(0, 797)}...` : sanitized
}

function positiveInteger(value: number, name: string, redactions: Array<string | undefined> = []): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw createRuntimeError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: `Provider context budget ${name} must be a positive number.`,
      retryable: false,
      redactions,
    })
  }
  return Math.floor(value)
}

function nonNegativeInteger(value: number, name: string, redactions: Array<string | undefined> = []): number {
  if (!Number.isFinite(value) || value < 0) {
    throw createRuntimeError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: `Provider context budget ${name} must be a non-negative number.`,
      retryable: false,
      redactions,
    })
  }
  return Math.floor(value)
}

function safeEstimateTokens(text: string, estimateTokens: (text: string) => number): number {
  const tokens = estimateTokens(text)
  if (!Number.isFinite(tokens) || tokens < 0) return 0
  return Math.ceil(tokens)
}

function estimateTokensApproximately(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

function sleepWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortReason('cancelled'))
      return
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    const abort = () => {
      clearTimeout(timeout)
      reject(createAbortReason('cancelled'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function createAbortReason(kind: 'cancelled' | 'timeout'): DOMException {
  return new DOMException(kind === 'timeout' ? 'Provider request timed out.' : 'Provider request cancelled.', 'AbortError')
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (!isRecord(error)) return false
  return error.name === 'AbortError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
