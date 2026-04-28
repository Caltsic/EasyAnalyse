import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentFile } from '../types/document'
import { AgentProviderError, type AgentProviderErrorCode } from './openAiCompatibleProvider'
import {
  checkAgentContextBudget,
  runProviderWithControls,
  type ControlledProviderOperation,
  type ProviderRetryOptions,
} from './agentProviderRuntime'

const secret = ['sk', 'runtime', 'm5'].join('-')

function providerError(code: AgentProviderErrorCode, retryable: boolean, message: string = code): AgentProviderError {
  return new AgentProviderError({
    code,
    retryable,
    message,
    status: code === 'AGENT_RATE_LIMITED' ? 429 : code === 'AGENT_PROVIDER_SERVER_ERROR' ? 502 : undefined,
    providerId: 'provider-runtime-test',
    modelId: 'model-runtime-test',
  })
}

function createSleepMock() {
  return vi.fn<NonNullable<ProviderRetryOptions['sleep']>>(async () => undefined)
}

function createDocument(): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-runtime',
      title: 'Runtime context budget fixture',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T01:00:00.000Z',
      tags: ['runtime'],
    },
    devices: [
      {
        id: 'u1',
        name: 'U1',
        kind: 'ic',
        terminals: [
          { id: 'u1-vin', name: 'VIN', label: 'VIN', direction: 'input' },
          { id: 'u1-vout', name: 'VOUT', label: 'VOUT', direction: 'output' },
        ],
      },
    ],
    view: {
      canvas: { units: 'px', grid: { enabled: true, size: 16 } },
      devices: { u1: { position: { x: 10, y: 20 }, shape: 'rectangle' } },
      networkLines: { vin: { label: 'VIN', position: { x: 5, y: 20 } } },
    },
  }
}

function hangingOperation(): ControlledProviderOperation<string> {
  return ({ signal }) =>
    new Promise<string>((resolve, reject) => {
      if (signal.aborted) {
        reject(providerError('AGENT_PROVIDER_CANCELLED', false, 'cancelled before start'))
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          reject(providerError('AGENT_PROVIDER_CANCELLED', false, 'provider observed abort'))
        },
        { once: true },
      )
      // Intentionally never resolves unless aborted.
      void resolve
    })
}

describe('agentProviderRuntime request controls', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('real network must never be used by provider runtime tests')
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('passes an AbortSignal to the operation and maps external cancel to a non-retryable error without retrying', async () => {
    const controller = new AbortController()
    const sleep = createSleepMock()
    const operation = vi.fn<ControlledProviderOperation<string>>(hangingOperation())

    const promise = runProviderWithControls({
      operation,
      signal: controller.signal,
      timeoutMs: 5_000,
      retry: { maxAttempts: 3, baseDelayMs: 10, sleep },
      redactions: [secret],
    })

    expect(operation).toHaveBeenCalledTimes(1)
    const operationSignal = operation.mock.calls[0][0].signal
    expect(operationSignal.aborted).toBe(false)
    controller.abort()

    await expect(promise).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_CANCELLED',
      retryable: false,
    })
    expect(operation).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('maps its own timeout to a retryable timeout error and clears success timers', async () => {
    vi.useFakeTimers()
    const timeoutPromise = runProviderWithControls({
      operation: hangingOperation(),
      timeoutMs: 25,
      retry: { maxAttempts: 1, baseDelayMs: 1, sleep: async () => undefined },
    })
    const timeoutExpectation = expect(timeoutPromise).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_TIMEOUT',
      retryable: true,
    })

    await vi.advanceTimersByTimeAsync(25)
    await timeoutExpectation

    const success = await runProviderWithControls({
      operation: async ({ signal }) => {
        expect(signal.aborted).toBe(false)
        return 'ok'
      },
      timeoutMs: 1_000,
    })
    expect(success).toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('enforces timeout at the deadline even when the operation ignores abort and resolves late', async () => {
    vi.useFakeTimers()
    const operation = vi.fn<ControlledProviderOperation<string>>(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('late-provider-value'), 100)
        }),
    )
    const observed = vi.fn()

    const promise = runProviderWithControls({
      operation,
      timeoutMs: 25,
      retry: { maxAttempts: 1, baseDelayMs: 1, sleep: async () => undefined },
    })
    void promise.then(
      (value) => observed({ status: 'resolved', value }),
      (error) =>
        observed({
          status: 'rejected',
          code: (error as AgentProviderError).code,
          retryable: (error as AgentProviderError).retryable,
        }),
    )

    await vi.advanceTimersByTimeAsync(25)
    await Promise.resolve()

    expect(observed).toHaveBeenCalledTimes(1)
    expect(observed).toHaveBeenCalledWith({
      status: 'rejected',
      code: 'AGENT_PROVIDER_TIMEOUT',
      retryable: true,
    })
    await expect(promise).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_TIMEOUT',
      retryable: true,
    })

    await vi.advanceTimersByTimeAsync(75)
    await Promise.resolve()

    expect(observed).toHaveBeenCalledTimes(1)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('retries runtime timeouts without accepting late values from timed-out attempts', async () => {
    vi.useFakeTimers()
    const sleep = createSleepMock()
    const operation = vi.fn<ControlledProviderOperation<string>>(({ attempt }) => {
      if (attempt === 1) {
        return new Promise((resolve) => {
          setTimeout(() => resolve('late-first-attempt'), 100)
        })
      }
      return Promise.resolve('second-attempt-ok')
    })
    const observed = vi.fn()

    const promise = runProviderWithControls({
      operation,
      timeoutMs: 25,
      retry: { maxAttempts: 2, baseDelayMs: 0, sleep },
    })
    void promise.then(
      (value) => observed({ status: 'resolved', value }),
      (error) => observed({ status: 'rejected', code: (error as AgentProviderError).code }),
    )

    await vi.advanceTimersByTimeAsync(25)
    await Promise.resolve()

    expect(observed).toHaveBeenCalledTimes(1)
    expect(observed).toHaveBeenCalledWith({ status: 'resolved', value: 'second-attempt-ok' })
    await expect(promise).resolves.toBe('second-attempt-ok')
    expect(operation.mock.calls.map(([context]) => context.attempt)).toEqual([1, 2])
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(0, expect.any(AbortSignal))

    await vi.advanceTimersByTimeAsync(75)
    await Promise.resolve()

    expect(observed).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('retries only retryable provider failures with deterministic backoff', async () => {
    const sleep = createSleepMock()
    const retryableCases: Array<[AgentProviderErrorCode, boolean]> = [
      ['AGENT_PROVIDER_NETWORK_ERROR', true],
      ['AGENT_PROVIDER_TIMEOUT', true],
      ['AGENT_RATE_LIMITED', true],
      ['AGENT_PROVIDER_SERVER_ERROR', true],
    ]

    for (const [code] of retryableCases) {
      const operation = vi
        .fn<ControlledProviderOperation<string>>()
        .mockRejectedValueOnce(providerError(code, true, `${code} ${secret}`))
        .mockResolvedValueOnce('ok')

      await expect(
        runProviderWithControls({
          operation,
          retry: { maxAttempts: 3, baseDelayMs: 100, backoffMultiplier: 2, jitterRatio: 0, sleep },
          redactions: [secret],
        }),
      ).resolves.toBe('ok')
      expect(operation).toHaveBeenCalledTimes(2)
    }

    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual([100, 100, 100, 100])
  })

  it('falls back to one attempt when maxAttempts is non-finite to avoid unbounded retries', async () => {
    for (const maxAttempts of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const sleep = createSleepMock()
      const operation = vi
        .fn<ControlledProviderOperation<string>>()
        .mockRejectedValueOnce(providerError('AGENT_PROVIDER_SERVER_ERROR', true, 'first failure'))
        .mockResolvedValueOnce('unexpected retry success')

      await expect(
        runProviderWithControls({
          operation,
          retry: { maxAttempts, baseDelayMs: 0, sleep },
        }),
      ).rejects.toMatchObject({
        code: 'AGENT_PROVIDER_SERVER_ERROR',
        retryable: true,
      })
      expect(operation).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
    }
  })

  it('normalizes non-finite retry delay, backoff, and jitter settings before sleeping', async () => {
    const cases: Array<{
      name: string
      retry: ProviderRetryOptions
      failuresBeforeSuccess: number
      expectedDelays: number[]
    }> = [
      {
        name: 'NaN base delay falls back to the default delay',
        retry: { baseDelayMs: Number.NaN },
        failuresBeforeSuccess: 1,
        expectedDelays: [250],
      },
      {
        name: 'Infinity base delay falls back to the default delay',
        retry: { baseDelayMs: Number.POSITIVE_INFINITY },
        failuresBeforeSuccess: 1,
        expectedDelays: [250],
      },
      {
        name: 'NaN max delay falls back to the default cap',
        retry: { baseDelayMs: 250, maxDelayMs: Number.NaN },
        failuresBeforeSuccess: 1,
        expectedDelays: [250],
      },
      {
        name: 'Infinity max delay falls back to the default cap',
        retry: { baseDelayMs: 250, maxDelayMs: Number.POSITIVE_INFINITY },
        failuresBeforeSuccess: 1,
        expectedDelays: [250],
      },
      {
        name: 'NaN backoff falls back to the default multiplier',
        retry: { baseDelayMs: 100, backoffMultiplier: Number.NaN },
        failuresBeforeSuccess: 2,
        expectedDelays: [100, 200],
      },
      {
        name: 'Infinity backoff falls back to the default multiplier',
        retry: { baseDelayMs: 100, backoffMultiplier: Number.POSITIVE_INFINITY },
        failuresBeforeSuccess: 2,
        expectedDelays: [100, 200],
      },
      {
        name: 'NaN jitter falls back to no jitter',
        retry: { baseDelayMs: 100, jitterRatio: Number.NaN, random: () => 1 },
        failuresBeforeSuccess: 1,
        expectedDelays: [100],
      },
      {
        name: 'Infinity jitter falls back to no jitter',
        retry: { baseDelayMs: 100, jitterRatio: Number.POSITIVE_INFINITY, random: () => 1 },
        failuresBeforeSuccess: 1,
        expectedDelays: [100],
      },
    ]

    for (const { name, retry, failuresBeforeSuccess, expectedDelays } of cases) {
      const sleep = createSleepMock()
      const operation = vi.fn<ControlledProviderOperation<string>>(async ({ attempt }) => {
        if (attempt <= failuresBeforeSuccess) {
          throw providerError('AGENT_PROVIDER_NETWORK_ERROR', true, name)
        }
        return 'ok'
      })

      await expect(
        runProviderWithControls({
          operation,
          retry: { maxAttempts: failuresBeforeSuccess + 1, ...retry, sleep },
        }),
      ).resolves.toBe('ok')
      expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual(expectedDelays)
      expect(sleep.mock.calls.every(([delayMs]) => Number.isFinite(delayMs))).toBe(true)
    }
  })

  it('does not retry non-retryable provider failures or user cancellation', async () => {
    const sleep = createSleepMock()
    const nonRetryableCases: Array<AgentProviderErrorCode> = [
      'AGENT_PROVIDER_CONFIGURATION_ERROR',
      'AGENT_PROVIDER_AUTH_FAILED',
      'AGENT_PROVIDER_MODEL_UNAVAILABLE',
      'AGENT_PROVIDER_BAD_REQUEST',
      'AGENT_PROVIDER_PARSE_ERROR',
      'AGENT_PROVIDER_PROTOCOL_ERROR',
      'AGENT_PROVIDER_SCHEMA_ERROR',
      'AGENT_PROVIDER_CONTEXT_TOO_LARGE',
      'AGENT_PROVIDER_CANCELLED',
    ]

    for (const code of nonRetryableCases) {
      const operation = vi
        .fn<ControlledProviderOperation<string>>()
        .mockRejectedValue(providerError(code, false, `${code} ${secret}`))

      await expect(
        runProviderWithControls({
          operation,
          retry: { maxAttempts: 3, baseDelayMs: 1, sleep },
          redactions: [secret],
        }),
      ).rejects.toMatchObject({ code, retryable: false })
      expect(operation).toHaveBeenCalledTimes(1)
    }

    expect(sleep).not.toHaveBeenCalled()
  })

  it('redacts configured secrets from returned provider errors and retry metadata', async () => {
    const operation = vi.fn<ControlledProviderOperation<string>>().mockRejectedValue(
      providerError('AGENT_PROVIDER_SERVER_ERROR', true, `upstream echoed ${secret}`),
    )

    try {
      await runProviderWithControls({
        operation,
        retry: { maxAttempts: 1 },
        redactions: [secret],
      })
      throw new Error('expected redacted provider error')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentProviderError)
      expect(String(error)).not.toContain(secret)
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(secret)
      expect(JSON.stringify((error as AgentProviderError).toJSON())).not.toContain(secret)
      expect((error as AgentProviderError).message).toContain('[redacted-api-key]')
    }
  })
})

describe('agentProviderRuntime context budget', () => {
  it('estimates prompt and document context without mutating the source document', () => {
    const document = createDocument()
    const before = structuredClone(document)

    const result = checkAgentContextBudget({
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
      currentDocument: document,
      modelContextWindow: 200,
      reservedOutputTokens: 20,
      estimateTokens: (text) => Math.ceil(text.length / 10),
    })

    expect(result.withinBudget).toBe(true)
    expect(result.availableInputTokens).toBe(180)
    expect(result.estimatedInputTokens).toBeGreaterThan(0)
    expect(result.documentTokens).toBeGreaterThan(0)
    expect(document).toEqual(before)
  })

  it('rejects oversized prompts and documents with non-retryable context-too-large errors and useful metadata', () => {
    const document = createDocument()
    const before = structuredClone(document)

    try {
      checkAgentContextBudget({
        systemPrompt: 'system prompt',
        userPrompt: 'x'.repeat(120),
        currentDocument: document,
        modelContextWindow: 12,
        reservedOutputTokens: 4,
        estimateTokens: (text) => text.length,
      })
      throw new Error('expected context budget rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentProviderError)
      expect(error).toMatchObject({
        code: 'AGENT_PROVIDER_CONTEXT_TOO_LARGE',
        retryable: false,
      })
      expect((error as AgentProviderError).message).toContain('Context budget exceeded')
      expect((error as AgentProviderError).toJSON()).toMatchObject({
        code: 'AGENT_PROVIDER_CONTEXT_TOO_LARGE',
        retryable: false,
      })
    }

    expect(document).toEqual(before)
  })
})
