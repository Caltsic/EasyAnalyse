import { parseAgentResponse } from './agentResponse'
import type { AgentResponseParseResult } from '../types/agent'
import type { DocumentFile } from '../types/document'
import {
  AgentProviderError,
  type AgentModelConfig,
  type AgentProviderAdapter,
  type AgentProviderConfig,
  type AgentProviderErrorCode,
  type ProviderBuildInput,
  type ProviderHttpMethod,
  type ProviderHttpRequest,
  type ProviderParseInput,
  type ProviderParseResult,
  type ProviderResponseMetadata,
  type ProviderUsageMetadata,
} from './openAiCompatibleProvider'

export const ANTHROPIC_ADAPTER_ID = 'anthropic'
export const ANTHROPIC_MESSAGES_REQUEST_FORMAT = 'anthropic-messages'
export const ANTHROPIC_VERSION = '2023-06-01'

export interface AnthropicFetchInit {
  method: ProviderHttpMethod
  headers: Record<string, string>
  body: string
  signal?: AbortSignal
}

export type AnthropicFetch = (url: string, init: AnthropicFetchInit) => Promise<Response>

export interface AnthropicRunInput extends ProviderBuildInput {
  fetch: AnthropicFetch
  currentDocument?: DocumentFile | null
  signal?: AbortSignal
}

interface AnthropicErrorDetails {
  message?: string
  type?: string
  code?: string
  param?: string
}

interface ErrorContext {
  provider?: AgentProviderConfig
  model?: AgentModelConfig
  apiKey?: string
}

type JsonRecord = Record<string, unknown>

const DEFAULT_TEMPERATURE = 0.2
const DEFAULT_TOP_P = 1
const DEFAULT_MAX_TOKENS = 8192

export function createAnthropicProviderAdapter(): AgentProviderAdapter {
  return {
    id: ANTHROPIC_ADAPTER_ID,
    requestFormat: ANTHROPIC_MESSAGES_REQUEST_FORMAT,
    buildPayload: buildAnthropicPayload,
    parseResponse: parseAnthropicResponse,
    supports: supportsAnthropicProvider,
  }
}

export const anthropicProviderAdapter = createAnthropicProviderAdapter()

export function buildAnthropicPayload(input: ProviderBuildInput): ProviderHttpRequest {
  const providerId = requireNonEmptyString(input.provider.id, 'provider.id')
  const modelId = requireNonEmptyString(input.model.id, 'model.id')
  const apiKey = requireNonEmptyString(input.apiKey, 'apiKey')
  const body = {
    model: modelId,
    system: input.systemPrompt,
    messages: [{ role: 'user', content: input.userPrompt }],
    temperature: input.generation?.temperature ?? DEFAULT_TEMPERATURE,
    top_p: input.generation?.topP ?? DEFAULT_TOP_P,
    max_tokens: input.generation?.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: false,
  }

  return {
    url: buildMessagesUrl(input.provider.baseUrl, input.provider, input.model),
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    metadata: {
      adapterId: ANTHROPIC_ADAPTER_ID,
      requestFormat: ANTHROPIC_MESSAGES_REQUEST_FORMAT,
      providerId,
      modelId,
      endpoint: 'messages',
    },
  }
}

export function parseAnthropicResponse(input: ProviderParseInput): ProviderParseResult {
  const root = parseAnthropicRoot(input.responseBody, input)
  const content = getTextContent(root, input)
  const metadata = buildResponseMetadata(root, input)

  try {
    const parsed: AgentResponseParseResult = parseAgentResponse(content, { mainDocument: input.mainDocument ?? null })
    return { ...parsed, metadata }
  } catch (error) {
    const message = errorMessage(error)
    const code: AgentProviderErrorCode = /json/i.test(message)
      ? 'AGENT_PROVIDER_PARSE_ERROR'
      : 'AGENT_PROVIDER_SCHEMA_ERROR'
    throw createError({
      code,
      message: `Anthropic provider returned an invalid AgentResponse: ${message}`,
      retryable: false,
      status: input.status,
      provider: input.provider,
      model: input.model,
    })
  }
}

export async function runAnthropicProvider(input: AnthropicRunInput): Promise<ProviderParseResult> {
  if (typeof input.fetch !== 'function') {
    throw createError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: 'Anthropic provider requires an injected fetch implementation; global network access is never used by default.',
      retryable: false,
      provider: input.provider,
      model: input.model,
    })
  }

  const request = buildAnthropicPayload(input)
  let response: Response
  try {
    response = await input.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      ...(input.signal ? { signal: input.signal } : {}),
    })
  } catch (error) {
    throw mapNetworkError(error, input)
  }

  const body = await readResponseBody(response, input)

  if (!response.ok) {
    throw mapHttpError(response.status, body, input)
  }

  return parseAnthropicResponse({
    responseBody: body,
    mainDocument: input.currentDocument ?? null,
    provider: input.provider,
    model: input.model,
    status: response.status,
  })
}

export function supportsAnthropicProvider(config: AgentProviderConfig, model: AgentModelConfig): boolean {
  if (config.kind !== 'anthropic') return false
  const baseUrl = config.baseUrl.trim()
  const modelId = model.id.trim()
  if (!baseUrl || !modelId) return false
  const configuredModels = config.models ?? []
  if (configuredModels.length === 0) return true
  return configuredModels.includes(modelId)
}

function buildMessagesUrl(baseUrl: string, provider: AgentProviderConfig, model: AgentModelConfig): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw createError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: 'Anthropic provider baseUrl is required.',
      retryable: false,
      provider,
      model,
    })
  }
  if (/\/v1\/messages$/i.test(trimmed)) return trimmed
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

function requireNonEmptyString(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw createError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: `Anthropic provider ${field} is required.`,
      retryable: false,
    })
  }
  return trimmed
}

function parseAnthropicRoot(value: unknown, input: ProviderParseInput): JsonRecord {
  if (!isRecord(value)) {
    throw protocolError('Anthropic provider response must be a JSON object with a content array of text blocks.', input)
  }
  return value
}

function getTextContent(root: JsonRecord, input: ProviderParseInput): string {
  if (!Array.isArray(root.content)) {
    throw protocolError('Anthropic provider response did not include a content array of text blocks.', input)
  }

  const chunks: string[] = []
  for (const block of root.content) {
    if (!isRecord(block)) {
      throw protocolError('Anthropic provider response content blocks must be objects with text content.', input)
    }
    if (block.type !== 'text') continue
    if (typeof block.text !== 'string') {
      throw protocolError('Anthropic provider response text content blocks must include a text string.', input)
    }
    chunks.push(block.text)
  }

  const content = chunks.join('')
  if (content.trim().length === 0) {
    throw protocolError('Anthropic provider response content array did not include any non-empty text blocks.', input)
  }
  return content
}

function protocolError(message: string, input: ProviderParseInput): AgentProviderError {
  return createError({
    code: 'AGENT_PROVIDER_PROTOCOL_ERROR',
    message,
    retryable: false,
    status: input.status,
    provider: input.provider,
    model: input.model,
  })
}

function buildResponseMetadata(root: JsonRecord, input: ProviderParseInput): ProviderResponseMetadata {
  const metadata: ProviderResponseMetadata = {
    adapterId: ANTHROPIC_ADAPTER_ID,
    requestFormat: ANTHROPIC_MESSAGES_REQUEST_FORMAT,
  }
  if (input.provider?.id) metadata.providerId = input.provider.id
  if (input.model?.id) metadata.modelId = input.model.id
  if (typeof root.id === 'string') metadata.responseId = root.id
  if (typeof root.stop_reason === 'string') {
    metadata.stopReason = root.stop_reason
    metadata.finishReason = root.stop_reason
  }
  if (typeof root.finish_reason === 'string') metadata.finishReason = root.finish_reason
  const usage = normalizeUsage(root.usage)
  if (usage) metadata.usage = usage
  return metadata
}

function normalizeUsage(value: unknown): ProviderUsageMetadata | undefined {
  if (!isRecord(value)) return undefined
  const usage: ProviderUsageMetadata = {}
  if (typeof value.input_tokens === 'number') usage.promptTokens = value.input_tokens
  if (typeof value.output_tokens === 'number') usage.completionTokens = value.output_tokens
  if (usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
    usage.totalTokens = usage.promptTokens + usage.completionTokens
  } else if (typeof value.total_tokens === 'number') {
    usage.totalTokens = value.total_tokens
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}

async function readResponseBody(response: Response, context: ErrorContext): Promise<unknown> {
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    throw mapNetworkError(error, context)
  }

  if (text.trim().length === 0) return null

  if (!response.ok) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    throw createError({
      code: 'AGENT_PROVIDER_PARSE_ERROR',
      message: `Anthropic provider returned invalid JSON (HTTP ${response.status}). ${errorMessage(error)}`,
      retryable: false,
      status: response.status,
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
    })
  }
}

function mapHttpError(status: number, body: unknown, context: ErrorContext): AgentProviderError {
  const details = extractAnthropicErrorDetails(body)
  const providerSuffix = providerDetailSuffix(details, body, context.apiKey)

  if (status === 401 || status === 403) {
    return createError({
      code: 'AGENT_PROVIDER_AUTH_FAILED',
      message: `Anthropic provider authentication failed (HTTP ${status}). Check the API key for this provider.${providerSuffix}`,
      retryable: false,
      status,
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
    })
  }

  if (status === 429) {
    return createError({
      code: 'AGENT_RATE_LIMITED',
      message: `Anthropic provider rate limited the request (HTTP 429). Try again later.${providerSuffix}`,
      retryable: true,
      status,
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
    })
  }

  if (status >= 500) {
    return createError({
      code: 'AGENT_PROVIDER_SERVER_ERROR',
      message: `Anthropic provider returned a server error (HTTP ${status}). Retry later.${providerSuffix}`,
      retryable: true,
      status,
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
    })
  }

  if (looksLikeModelUnavailable(details)) {
    const modelId = context.model?.id ? ` "${context.model.id}"` : ''
    return createError({
      code: 'AGENT_PROVIDER_MODEL_UNAVAILABLE',
      message: `Anthropic provider model${modelId} is unavailable (HTTP ${status}). Choose a supported model or provider endpoint.${providerSuffix}`,
      retryable: false,
      status,
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
    })
  }

  return createError({
    code: 'AGENT_PROVIDER_BAD_REQUEST',
    message: `Anthropic provider rejected the request (HTTP ${status}).${providerSuffix}`,
    retryable: false,
    status,
    provider: context.provider,
    model: context.model,
    apiKey: context.apiKey,
  })
}

function mapNetworkError(error: unknown, context: ErrorContext): AgentProviderError {
  const detail = sanitizeMessage(errorMessage(error), [context.apiKey])
  const suffix = detail ? ` Details: ${detail}` : ' Check connectivity and retry.'
  return createError({
    code: 'AGENT_PROVIDER_NETWORK_ERROR',
    message: `Anthropic provider network request failed.${suffix}`,
    retryable: true,
    provider: context.provider,
    model: context.model,
    apiKey: context.apiKey,
  })
}

function extractAnthropicErrorDetails(body: unknown): AnthropicErrorDetails {
  if (isRecord(body)) {
    if (isRecord(body.error)) {
      return {
        message: optionalString(body.error.message),
        type: optionalString(body.error.type),
        code: optionalString(body.error.code),
        param: optionalString(body.error.param),
      }
    }
    return {
      message: optionalString(body.message),
      type: optionalString(body.type),
      code: optionalString(body.code),
      param: optionalString(body.param),
    }
  }
  if (typeof body === 'string') return { message: body }
  return {}
}

function providerDetailSuffix(details: AnthropicErrorDetails, body: unknown, apiKey?: string): string {
  const detail = details.message ?? safeStringify(body)
  if (!detail) return ''
  return ` Provider message: ${sanitizeMessage(detail, [apiKey])}`
}

function looksLikeModelUnavailable(details: AnthropicErrorDetails): boolean {
  const fields = [details.code, details.type, details.param, details.message].filter((value): value is string =>
    Boolean(value),
  )
  const explicitModelSignal = fields.some((field) =>
    /model[_ -]?(not[_ -]?found|not[_ -]?available|unavailable|unknown|unsupported)|not[_ -]?found[_ -]?model/i.test(field),
  )
  if (explicitModelSignal) return true

  const message = details.message ?? ''
  const messageHasModelUnavailable =
    /\bmodel\b[\s\S]{0,120}\b(not\s*found|does\s*not\s*exist|unavailable|not\s*available|unknown|unsupported)\b/i.test(
      message,
    ) ||
    /\b(not\s*found|does\s*not\s*exist|unavailable|not\s*available|unknown|unsupported)\b[\s\S]{0,120}\bmodel\b/i.test(
      message,
    )
  if (messageHasModelUnavailable) return true

  const typeOrCodeHasUnavailable = [details.code, details.type].some(
    (field) => typeof field === 'string' && /not[_ -]?found|unavailable|unknown|unsupported/i.test(field),
  )
  const hasModelReference = fields.some((field) => /\bmodel\b/i.test(field))
  if (hasModelReference && typeOrCodeHasUnavailable) return true
  return details.param === 'model' && typeOrCodeHasUnavailable
}

function createError(init: {
  code: AgentProviderErrorCode
  message: string
  retryable: boolean
  status?: number
  provider?: AgentProviderConfig
  model?: AgentModelConfig
  apiKey?: string
}): AgentProviderError {
  return new AgentProviderError({
    code: init.code,
    message: sanitizeMessage(init.message, [init.apiKey]),
    retryable: init.retryable,
    status: init.status,
    providerId: init.provider?.id,
    modelId: init.model?.id,
  })
}

function sanitizeMessage(message: string, redactions: Array<string | undefined> = []): string {
  let sanitized = message
  redactions.forEach((redaction) => {
    if (!redaction) return
    const trimmed = redaction.trim()
    if (!trimmed) return
    sanitized = sanitized.split(trimmed).join('[redacted-api-key]')
  })
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted-api-key]')
  sanitized = sanitized.replace(/x-api-key\s*[:=]\s*[A-Za-z0-9._~+/=-]+/gi, 'x-api-key: [redacted-api-key]')
  return sanitized.length > 800 ? `${sanitized.slice(0, 797)}...` : sanitized
}

function safeStringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
