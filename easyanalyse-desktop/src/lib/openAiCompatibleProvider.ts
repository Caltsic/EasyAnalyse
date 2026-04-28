import { parseAgentResponse } from './agentResponse'
import type { AgentResponseParseResult } from '../types/agent'
import type { DocumentFile } from '../types/document'
import type { AgentProviderKind } from '../types/settings'

export const OPENAI_COMPATIBLE_ADAPTER_ID = 'openai-compatible'
export const OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT = 'openai-chat-completions'

export type ProviderRequestFormat = typeof OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT | 'anthropic-messages'
export type ProviderAdapterId = typeof OPENAI_COMPATIBLE_ADAPTER_ID | 'anthropic'
export type ProviderEndpoint = 'chat/completions' | 'messages'
export type ProviderHttpMethod = 'POST'

export interface AgentProviderConfig {
  id: string
  name?: string
  kind: AgentProviderKind
  baseUrl: string
  models?: readonly string[]
  defaultModel?: string
  apiKeyRef?: string
}

export interface AgentModelConfig {
  id: string
  name?: string
}

export interface ProviderGenerationOptions {
  temperature?: number
  topP?: number
  maxTokens?: number
}

export interface ProviderBuildInput {
  provider: AgentProviderConfig
  model: AgentModelConfig
  apiKey: string
  systemPrompt: string
  userPrompt: string
  generation?: ProviderGenerationOptions
}

export interface ProviderRequestMetadata {
  adapterId: ProviderAdapterId
  requestFormat: ProviderRequestFormat
  providerId: string
  modelId: string
  endpoint: ProviderEndpoint
}

export interface ProviderHttpRequest {
  url: string
  method: ProviderHttpMethod
  headers: Record<string, string>
  body: string
  metadata: ProviderRequestMetadata
}

export interface ProviderUsageMetadata {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface ProviderResponseMetadata {
  adapterId: ProviderAdapterId
  requestFormat: ProviderRequestFormat
  providerId?: string
  modelId?: string
  responseId?: string
  finishReason?: string
  stopReason?: string
  usage?: ProviderUsageMetadata
}

export interface ProviderParseInput {
  responseBody: unknown
  mainDocument?: DocumentFile | null
  provider?: AgentProviderConfig
  model?: AgentModelConfig
  status?: number
}

export interface ProviderParseResult extends AgentResponseParseResult {
  metadata: ProviderResponseMetadata
}

export interface ProviderStreamEvent {
  type: 'content-delta' | 'done' | 'error'
  text?: string
  error?: string
}

export interface AgentProviderAdapter {
  readonly id: string
  readonly requestFormat: ProviderRequestFormat
  buildPayload(input: ProviderBuildInput): ProviderHttpRequest
  parseResponse(input: ProviderParseInput): ProviderParseResult
  parseStreamChunk?(chunk: Uint8Array | string): ProviderStreamEvent[]
  supports(config: AgentProviderConfig, model: AgentModelConfig): boolean
}

export interface OpenAiCompatibleFetchInit {
  method: ProviderHttpMethod
  headers: Record<string, string>
  body: string
  signal?: AbortSignal
}

export type OpenAiCompatibleFetch = (url: string, init: OpenAiCompatibleFetchInit) => Promise<Response>

export interface OpenAiCompatibleRunInput extends ProviderBuildInput {
  fetch: OpenAiCompatibleFetch
  currentDocument?: DocumentFile | null
  signal?: AbortSignal
}

export type AgentProviderErrorCode =
  | 'AGENT_PROVIDER_AUTH_FAILED'
  | 'AGENT_PROVIDER_MODEL_UNAVAILABLE'
  | 'AGENT_RATE_LIMITED'
  | 'AGENT_PROVIDER_NETWORK_ERROR'
  | 'AGENT_PROVIDER_SERVER_ERROR'
  | 'AGENT_PROVIDER_PARSE_ERROR'
  | 'AGENT_PROVIDER_PROTOCOL_ERROR'
  | 'AGENT_PROVIDER_SCHEMA_ERROR'
  | 'AGENT_PROVIDER_BAD_REQUEST'
  | 'AGENT_PROVIDER_CONFIGURATION_ERROR'

export interface AgentProviderErrorInit {
  code: AgentProviderErrorCode
  message: string
  retryable: boolean
  status?: number
  providerId?: string
  modelId?: string
}

export class AgentProviderError extends Error {
  readonly code: AgentProviderErrorCode
  readonly retryable: boolean
  readonly status?: number
  readonly providerId?: string
  readonly modelId?: string

  constructor(init: AgentProviderErrorInit) {
    super(init.message)
    this.name = 'AgentProviderError'
    this.code = init.code
    this.retryable = init.retryable
    this.status = init.status
    this.providerId = init.providerId
    this.modelId = init.modelId
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      status: this.status,
      providerId: this.providerId,
      modelId: this.modelId,
    }
  }
}

interface OpenAiErrorDetails {
  message?: string
  code?: string
  type?: string
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
const DEFAULT_MAX_TOKENS = 2048
const JSON_OBJECT_RESPONSE_FORMAT = { type: 'json_object' } as const

export function createOpenAiCompatibleProviderAdapter(): AgentProviderAdapter {
  return {
    id: OPENAI_COMPATIBLE_ADAPTER_ID,
    requestFormat: OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT,
    buildPayload: buildOpenAiCompatiblePayload,
    parseResponse: parseOpenAiCompatibleResponse,
    supports: supportsOpenAiCompatibleProvider,
  }
}

export const openAiCompatibleProviderAdapter = createOpenAiCompatibleProviderAdapter()

export function buildOpenAiCompatiblePayload(input: ProviderBuildInput): ProviderHttpRequest {
  const providerId = requireNonEmptyString(input.provider.id, 'provider.id')
  const modelId = requireNonEmptyString(input.model.id, 'model.id')
  const apiKey = requireNonEmptyString(input.apiKey, 'apiKey')
  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.userPrompt },
    ],
    temperature: input.generation?.temperature ?? DEFAULT_TEMPERATURE,
    top_p: input.generation?.topP ?? DEFAULT_TOP_P,
    max_tokens: input.generation?.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: false,
    response_format: JSON_OBJECT_RESPONSE_FORMAT,
  }

  return {
    url: buildChatCompletionsUrl(input.provider.baseUrl, input.provider, input.model),
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    metadata: {
      adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
      requestFormat: OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT,
      providerId,
      modelId,
      endpoint: 'chat/completions',
    },
  }
}

export function parseOpenAiCompatibleResponse(input: ProviderParseInput): ProviderParseResult {
  const root = parseOpenAiRoot(input.responseBody, input)
  const firstChoice = getFirstChoice(root, input)
  const content = getAssistantContent(firstChoice, input)
  const metadata = buildResponseMetadata(root, firstChoice, input)

  try {
    const parsed = parseAgentResponse(content, { mainDocument: input.mainDocument ?? null })
    return { ...parsed, metadata }
  } catch (error) {
    const message = errorMessage(error)
    const code: AgentProviderErrorCode = /json/i.test(message)
      ? 'AGENT_PROVIDER_PARSE_ERROR'
      : 'AGENT_PROVIDER_SCHEMA_ERROR'
    throw createError({
      code,
      message: `OpenAI-compatible provider returned an invalid AgentResponse: ${message}`,
      retryable: false,
      status: input.status,
      provider: input.provider,
      model: input.model,
    })
  }
}

export async function runOpenAiCompatibleProvider(input: OpenAiCompatibleRunInput): Promise<ProviderParseResult> {
  if (typeof input.fetch !== 'function') {
    throw createError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: 'OpenAI-compatible provider requires an injected fetch implementation; global network access is never used by default.',
      retryable: false,
      provider: input.provider,
      model: input.model,
    })
  }

  const request = buildOpenAiCompatiblePayload(input)
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

  return parseOpenAiCompatibleResponse({
    responseBody: body,
    mainDocument: input.currentDocument ?? null,
    provider: input.provider,
    model: input.model,
    status: response.status,
  })
}

export function supportsOpenAiCompatibleProvider(config: AgentProviderConfig, model: AgentModelConfig): boolean {
  if (config.kind !== 'openai-compatible' && config.kind !== 'deepseek') return false
  const baseUrl = config.baseUrl.trim()
  const modelId = model.id.trim()
  if (!baseUrl || !modelId) return false
  const configuredModels = config.models ?? []
  if (configuredModels.length === 0) return true
  return configuredModels.includes(modelId)
}

function buildChatCompletionsUrl(baseUrl: string, provider: AgentProviderConfig, model: AgentModelConfig): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) {
    throw createError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: 'OpenAI-compatible provider baseUrl is required.',
      retryable: false,
      provider,
      model,
    })
  }
  return `${trimmed.replace(/\/+$/, '')}/chat/completions`
}

function requireNonEmptyString(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw createError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: `OpenAI-compatible provider ${field} is required.`,
      retryable: false,
    })
  }
  return trimmed
}

function parseOpenAiRoot(value: unknown, input: ProviderParseInput): JsonRecord {
  if (!isRecord(value)) {
    throw protocolError('OpenAI-compatible provider response must be a JSON object with choices[0].message.content.', input)
  }
  return value
}

function getFirstChoice(root: JsonRecord, input: ProviderParseInput): JsonRecord {
  if (!Array.isArray(root.choices) || root.choices.length === 0) {
    throw protocolError('OpenAI-compatible provider response did not include choices[0].message.content.', input)
  }
  const firstChoice = root.choices[0]
  if (!isRecord(firstChoice)) {
    throw protocolError('OpenAI-compatible provider response choices[0] must be an object with message.content.', input)
  }
  return firstChoice
}

function getAssistantContent(choice: JsonRecord, input: ProviderParseInput): string {
  if (!isRecord(choice.message)) {
    throw protocolError('OpenAI-compatible provider response did not include choices[0].message.content.', input)
  }
  const content = choice.message.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw protocolError('OpenAI-compatible provider response did not include a non-empty choices[0].message.content string.', input)
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

function buildResponseMetadata(
  root: JsonRecord,
  firstChoice: JsonRecord,
  input: ProviderParseInput,
): ProviderResponseMetadata {
  const metadata: ProviderResponseMetadata = {
    adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
    requestFormat: OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT,
  }
  if (input.provider?.id) metadata.providerId = input.provider.id
  if (input.model?.id) metadata.modelId = input.model.id
  if (typeof root.id === 'string') metadata.responseId = root.id
  if (typeof firstChoice.finish_reason === 'string') metadata.finishReason = firstChoice.finish_reason
  const usage = normalizeUsage(root.usage)
  if (usage) metadata.usage = usage
  return metadata
}

function normalizeUsage(value: unknown): ProviderUsageMetadata | undefined {
  if (!isRecord(value)) return undefined
  const usage: ProviderUsageMetadata = {}
  if (typeof value.prompt_tokens === 'number') usage.promptTokens = value.prompt_tokens
  if (typeof value.completion_tokens === 'number') usage.completionTokens = value.completion_tokens
  if (typeof value.total_tokens === 'number') usage.totalTokens = value.total_tokens
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

  try {
    return JSON.parse(text)
  } catch (error) {
    if (!response.ok) return text
    throw createError({
      code: 'AGENT_PROVIDER_PARSE_ERROR',
      message: `OpenAI-compatible provider returned invalid JSON (HTTP ${response.status}). ${errorMessage(error)}`,
      retryable: false,
      status: response.status,
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
    })
  }
}

function mapHttpError(status: number, body: unknown, context: ErrorContext): AgentProviderError {
  const details = extractOpenAiErrorDetails(body)
  const providerSuffix = providerDetailSuffix(details, body, context.apiKey)

  if (status === 401 || status === 403) {
    return createError({
      code: 'AGENT_PROVIDER_AUTH_FAILED',
      message: `OpenAI-compatible provider authentication failed (HTTP ${status}). Check the API key for this provider.${providerSuffix}`,
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
      message: `OpenAI-compatible provider rate limited the request (HTTP 429). Try again later.${providerSuffix}`,
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
      message: `OpenAI-compatible provider returned a server error (HTTP ${status}). Retry later.${providerSuffix}`,
      retryable: true,
      status,
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
    })
  }

  if (status === 404 || looksLikeModelUnavailable(details)) {
    const modelId = context.model?.id ? ` "${context.model.id}"` : ''
    return createError({
      code: 'AGENT_PROVIDER_MODEL_UNAVAILABLE',
      message: `OpenAI-compatible provider model${modelId} is unavailable (HTTP ${status}). Choose a supported model or provider endpoint.${providerSuffix}`,
      retryable: false,
      status,
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
    })
  }

  return createError({
    code: 'AGENT_PROVIDER_BAD_REQUEST',
    message: `OpenAI-compatible provider rejected the request (HTTP ${status}).${providerSuffix}`,
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
    message: `OpenAI-compatible provider network request failed.${suffix}`,
    retryable: true,
    provider: context.provider,
    model: context.model,
    apiKey: context.apiKey,
  })
}

function extractOpenAiErrorDetails(body: unknown): OpenAiErrorDetails {
  if (isRecord(body)) {
    if (isRecord(body.error)) {
      return {
        message: optionalString(body.error.message),
        code: optionalString(body.error.code),
        type: optionalString(body.error.type),
        param: optionalString(body.error.param),
      }
    }
    return {
      message: optionalString(body.message),
      code: optionalString(body.code),
      type: optionalString(body.type),
      param: optionalString(body.param),
    }
  }
  if (typeof body === 'string') return { message: body }
  return {}
}

function providerDetailSuffix(details: OpenAiErrorDetails, body: unknown, apiKey?: string): string {
  const detail = details.message ?? safeStringify(body)
  if (!detail) return ''
  return ` Provider message: ${sanitizeMessage(detail, [apiKey])}`
}

function looksLikeModelUnavailable(details: OpenAiErrorDetails): boolean {
  const fields = [details.code, details.type, details.param, details.message].filter((value): value is string =>
    Boolean(value),
  )
  const hasModelReference = fields.some((field) => /model/i.test(field))
  const hasUnavailableSignal = fields.some((field) => /not[_ -]?found|not exist|unavailable|unknown/i.test(field))
  return hasModelReference && hasUnavailableSignal
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
