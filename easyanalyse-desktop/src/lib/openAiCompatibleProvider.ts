import { AGENT_RESPONSE_SCHEMA_VERSION, AGENT_RESPONSE_SEMANTIC_VERSION, parseAgentResponse } from './agentResponse'
import { getAgentToolSchemas, runAgentTool } from './agentTools'
import { getErrorMessage as errorMessage } from './errors'
import { isRecord } from './guards'
import { useSettingsStore } from '../store/settingsStore'
import type { AgentBlueprintCandidate, AgentResponseParseResult } from '../types/agent'
import type { AgentToolExecutor, AgentToolResult, AgentToolRuntimeContext, AgentToolTraceEntry } from '../types/agentTools'
import type { DocumentFile, ValidationIssue } from '../types/document'
import type { AgentProviderKind, DeepSeekV4ThinkingMode } from '../types/settings'

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
  deepSeekV4Thinking?: DeepSeekV4ThinkingMode
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
  toolTrace?: AgentToolTraceEntry[]
  repairTrace?: import('../types/agentTools').AgentRepairTraceEntry[]
}

export interface ProviderStreamEvent {
  type: 'content-delta' | 'done' | 'error'
  text?: string
  error?: string
}

export type ProviderProgressPhase =
  | 'preparing'
  | 'request'
  | 'response'
  | 'tool'
  | 'finalization'
  | 'parse'
  | 'self-check'
  | 'repair'
  | 'complete'

export interface ProviderProgressEvent {
  phase: ProviderProgressPhase
  message: string
  detail?: Record<string, unknown>
}

export type ProviderProgressHandler = (event: ProviderProgressEvent) => void

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

export interface OpenAiCompatibleRunInput extends ProviderBuildInput, AgentToolRuntimeContext {
  fetch: OpenAiCompatibleFetch
  currentDocument?: DocumentFile | null
  originalUserPrompt?: string
  signal?: AbortSignal
  maxToolIterations?: number
  enableToolCalling?: boolean
  toolExecutor?: AgentToolExecutor
  progress?: ProviderProgressHandler
}

export type AgentProviderErrorCode =
  | 'AGENT_PROVIDER_AUTH_FAILED'
  | 'AGENT_PROVIDER_MODEL_UNAVAILABLE'
  | 'AGENT_RATE_LIMITED'
  | 'AGENT_PROVIDER_NETWORK_ERROR'
  | 'AGENT_PROVIDER_TIMEOUT'
  | 'AGENT_PROVIDER_CANCELLED'
  | 'AGENT_PROVIDER_CONTEXT_TOO_LARGE'
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
const DEFAULT_MAX_TOKENS = 4096
const DEEPSEEK_V4_DEFAULT_MAX_TOKENS = 32_768
const DEFAULT_MAX_TOOL_ITERATIONS = 5
const MAX_FINALIZATION_ATTEMPTS = 2
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
  const body: Record<string, unknown> = {
    model: modelId,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.userPrompt },
    ],
    stream: false,
    response_format: JSON_OBJECT_RESPONSE_FORMAT,
  }
  applyOpenAiCompatibleGenerationOptions(body, input, { jsonOnly: true })

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
    const fenced = parseFencedAgentResponse(content, input)
    if (fenced) return { ...fenced, metadata }
    const embedded = parseTrailingAgentResponse(content, input)
    if (embedded) return { ...embedded, metadata }
    const lenientAgentResponse = parseLenientAgentResponse(content, input)
    if (lenientAgentResponse) return { ...lenientAgentResponse, metadata }
    const lenientMessage = parseLenientAgentMessage(content)
    if (lenientMessage) return { ...lenientMessage, metadata }
    const plainText = parsePlainTextAgentMessage(content)
    if (plainText) return { ...plainText, metadata }
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

  if (input.enableToolCalling === false) {
    emitProgress(input.progress, { phase: 'request', message: 'Sending provider request.' })
    const body = await performOpenAiRequest(input, buildOpenAiCompatiblePayload(input))
    emitProgress(input.progress, { phase: 'response', message: 'Provider response received.', detail: { status: body.status } })
    const parsed = parseOpenAiCompatibleResponse({
      responseBody: body.body,
      mainDocument: input.currentDocument ?? null,
      provider: input.provider,
      model: input.model,
      status: body.status,
    })
    emitProgress(input.progress, { phase: 'complete', message: 'Provider returned a valid AgentResponse.', detail: { kind: parsed.response.kind } })
    return parsed
  }

  const providerId = requireNonEmptyString(input.provider.id, 'provider.id')
  const modelId = requireNonEmptyString(input.model.id, 'model.id')
  const apiKey = requireNonEmptyString(input.apiKey, 'apiKey')
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userPrompt },
  ]
  const toolExecutor = input.toolExecutor ?? runAgentTool
  const toolTrace: AgentToolTraceEntry[] = []
  const maxToolIterations = input.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS
  let toolIterations = 0
  let finalizationAttempts = 0
  let lastHardFormatIssueCount: number | null = null
  let blueprintGenerationStarted = false
  let postBeginToolRoundOffered = false
  const generatedToolCandidates: AgentBlueprintCandidate[] = []
  const replayReasoningContent = shouldReplayReasoningContent(input.provider, input.model)
  const filterInferencePrompt = getFilterInferencePrompt(input)
  const postBeginToolRoundNeeded = shouldOfferPostBeginToolRound(filterInferencePrompt)

  for (let step = 0; step <= maxToolIterations + MAX_FINALIZATION_ATTEMPTS; step += 1) {
    const allowPostBeginToolRound =
      blueprintGenerationStarted &&
      postBeginToolRoundNeeded &&
      !postBeginToolRoundOffered &&
      generatedToolCandidates.length === 0
    const allowTools =
      (!blueprintGenerationStarted || allowPostBeginToolRound) &&
      toolIterations < maxToolIterations &&
      finalizationAttempts === 0
    if (allowPostBeginToolRound) postBeginToolRoundOffered = true
    const allowLiveBlueprintMarker = blueprintGenerationStarted && !allowTools && finalizationAttempts === 0
    const streamResponse = !allowTools && finalizationAttempts === 0
    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: streamResponse,
    }
    applyOpenAiCompatibleGenerationOptions(body, input, { jsonOnly: !allowTools && !allowLiveBlueprintMarker })
    if (allowTools) {
      body.tools = getAgentToolSchemas()
      body.tool_choice = shouldForceGenerateFilterTool(filterInferencePrompt) && generatedToolCandidates.length === 0
        ? { type: 'function', function: { name: 'generate_filter_blueprint' } }
        : 'auto'
    } else if (!allowLiveBlueprintMarker) {
      body.response_format = JSON_OBJECT_RESPONSE_FORMAT
    }
    const request: ProviderHttpRequest = {
      url: buildChatCompletionsUrl(input.provider.baseUrl, input.provider, input.model),
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      metadata: { adapterId: OPENAI_COMPATIBLE_ADAPTER_ID, requestFormat: OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT, providerId, modelId, endpoint: 'chat/completions' },
    }
    emitProgress(input.progress, {
      phase: 'request',
      message: allowTools
        ? `Sending provider request ${step + 1} with tool access.`
        : `Sending final JSON request ${step + 1}.`,
      detail: { step: step + 1, toolsEnabled: allowTools, toolIterations, finalizationAttempts },
    })
    const response = await performOpenAiRequest(input, request)
    let root: JsonRecord
    let choice: JsonRecord
    let assistantMessage: JsonRecord | null
    let toolCalls: unknown[]
    try {
      root = parseOpenAiRoot(response.body, { responseBody: response.body, provider: input.provider, model: input.model, status: response.status })
      choice = getFirstChoice(root, { responseBody: response.body, provider: input.provider, model: input.model, status: response.status })
      assistantMessage = isRecord(choice.message) ? choice.message : null
      toolCalls = Array.isArray(assistantMessage?.tool_calls) ? assistantMessage.tool_calls : []
    } catch (error) {
      if (!allowTools && finalizationAttempts < MAX_FINALIZATION_ATTEMPTS) {
        finalizationAttempts += 1
        emitProgress(input.progress, {
          phase: 'finalization',
          message: 'Provider response was not parseable; requesting final JSON output.',
          detail: { attempt: finalizationAttempts, error: errorMessage(error) },
        })
        messages.push({
          role: 'user',
          content: buildFinalJsonRetryPrompt('The previous provider response could not be parsed as choices[0].message.content.'),
        })
        continue
      }
      const fallback = buildGeneratedToolFallbackResult(generatedToolCandidates, input, response.status, toolTrace)
      if (fallback) return fallback
      const inferredFallback = await buildInferredGeneratedFilterFallback(input, toolExecutor, toolTrace, response.status)
      if (inferredFallback) return inferredFallback
      throw error
    }
    emitProgress(input.progress, describeOpenAiResponseProgress(choice, assistantMessage, toolCalls, response.status))
    if (toolCalls.length > 0 && !allowTools) {
      throw createError({
        code: 'AGENT_PROVIDER_PROTOCOL_ERROR',
        message: `OpenAI-compatible provider requested tool calls after the configured tool iteration limit (${maxToolIterations}). Increase the limit or ask for a simpler blueprint.`,
        retryable: false,
        status: response.status,
        provider: input.provider,
        model: input.model,
      })
    }
    if (toolCalls.length > 0) {
      messages.push(buildAssistantReplayMessage(assistantMessage, {
        toolCalls,
        fallbackContent: null,
        includeReasoningContent: replayReasoningContent,
      }))
      let ranHardFormatTool = false
      let hardFormatIssueCount = 0
      const hardFormatIssues: ValidationIssue[] = []
      for (const call of toolCalls) {
        const normalized = normalizeToolCall(call)
        emitProgress(input.progress, {
          phase: 'tool',
          message: `Running tool ${normalized.name}.`,
          detail: { toolName: normalized.name, toolCallId: normalized.id },
        })
        const parsedArgs = parseToolArguments(normalized.arguments)
        const toolArgs = parsedArgs.ok
          ? mergeGeneratedSimulationIntoToolArgs(normalized.name, parsedArgs.value, generatedToolCandidates)
          : {}
        const toolResult = parsedArgs.ok
          ? await toolExecutor(normalized.name, toolArgs, buildToolRuntimeContext(input))
          : await toolExecutor(normalized.name, {}, buildToolRuntimeContext(input))
        if (normalized.name === 'begin_blueprint_generation' && toolResult.ok) {
          blueprintGenerationStarted = true
        }
        const generatedToolCandidate = normalized.name === 'generate_filter_blueprint'
          ? extractGeneratedToolCandidate(toolResult)
          : null
        if (generatedToolCandidate) {
          generatedToolCandidates.push(generatedToolCandidate)
        }
        toolTrace.push({ toolName: normalized.name, ok: toolResult.ok, summary: toolResult.summary, issueCount: toolResult.issueCount })
        const blockingFormatIssues = getHardFormatIssuesForToolResult(normalized.name, toolResult.ok, toolResult.issues)
        if (blockingFormatIssues.length > 0) {
          ranHardFormatTool = true
          hardFormatIssueCount += blockingFormatIssues.length
          hardFormatIssues.push(...blockingFormatIssues)
        } else if ((normalized.name === 'check_document_format' || normalized.name === 'check_blueprint_format') && toolResult.ok) {
          ranHardFormatTool = true
        }
        emitProgress(input.progress, {
          phase: 'tool',
          message: `Tool ${normalized.name} completed with ${toolResult.issueCount} issue${toolResult.issueCount === 1 ? '' : 's'}.`,
          detail: { toolName: normalized.name, ok: toolResult.ok, issueCount: toolResult.issueCount },
        })
        messages.push({ role: 'tool', tool_call_id: normalized.id, name: normalized.name, content: JSON.stringify(toolResult) })
      }
      toolIterations += 1
      if (ranHardFormatTool) lastHardFormatIssueCount = hardFormatIssueCount
      if (hardFormatIssueCount > 0 && toolIterations < maxToolIterations) {
        const issueSummary = summarizeIssueCodes(hardFormatIssues)
        emitProgress(input.progress, {
          phase: 'tool',
          message: `Format tool reported ${hardFormatIssueCount} recoverable issue${hardFormatIssueCount === 1 ? '' : 's'}${issueSummary ? ` (${issueSummary})` : ''}; returning repair context to the model.`,
          detail: { toolIterations, maxToolIterations, issueCount: hardFormatIssueCount },
        })
        messages.push({
          role: 'user',
          content: buildToolIssueRepairPrompt(hardFormatIssues, {
            issueCount: hardFormatIssueCount,
            toolIterations,
            maxToolIterations,
          }),
        })
      }
      continue
    }
    let parsed: ProviderParseResult
    try {
      parsed = parseOpenAiCompatibleResponse({ responseBody: response.body, mainDocument: input.currentDocument ?? null, provider: input.provider, model: input.model, status: response.status })
      parsed = attachGeneratedSimulationArtifacts(parsed, generatedToolCandidates)
      parsed = await attachInferredFilterSimulationArtifacts(parsed, input, toolExecutor, toolTrace, response.status)
    } catch (error) {
      if (finalizationAttempts < MAX_FINALIZATION_ATTEMPTS) {
        finalizationAttempts += 1
        emitProgress(input.progress, {
          phase: 'finalization',
          message: 'Provider response was not final AgentResponse JSON; requesting final JSON output.',
          detail: { attempt: finalizationAttempts, error: errorMessage(error) },
        })
        const replayMessage = buildAssistantReplayMessage(assistantMessage, {
          fallbackContent: '',
          includeReasoningContent: replayReasoningContent,
        })
        if (shouldAppendAssistantReplayMessage(replayMessage)) messages.push(replayMessage)
        messages.push({
          role: 'user',
          content: buildFinalJsonRetryPrompt('Your previous response was not a valid single AgentResponse JSON object.'),
        })
        continue
      }
      if (hasMissingAssistantContent(assistantMessage)) {
        const fallback = buildGeneratedToolFallbackResult(generatedToolCandidates, input, response.status, toolTrace)
        if (fallback) return fallback
        const inferredFallback = await buildInferredGeneratedFilterFallback(input, toolExecutor, toolTrace, response.status)
        if (inferredFallback) return inferredFallback
        throw createError({
          code: 'AGENT_PROVIDER_PROTOCOL_ERROR',
          message: `OpenAI-compatible provider did not return final AgentResponse content after ${MAX_FINALIZATION_ATTEMPTS} finalization attempt(s). ${describeAssistantContentState(assistantMessage, choice)}`,
          retryable: false,
          status: response.status,
          provider: input.provider,
          model: input.model,
        })
      }
      const fallback = buildGeneratedToolFallbackResult(generatedToolCandidates, input, response.status, toolTrace)
      if (fallback) return fallback
      const inferredFallback = await buildInferredGeneratedFilterFallback(input, toolExecutor, toolTrace, response.status)
      if (inferredFallback) return inferredFallback
      throw error
    }
    parsed = await annotateKnownHardFormatFailure(parsed, {
      lastHardFormatIssueCount,
      status: response.status,
      provider: input.provider,
      model: input.model,
      input,
    })
    emitProgress(input.progress, { phase: 'complete', message: 'Provider returned a valid AgentResponse.', detail: { kind: parsed.response.kind } })
    return { ...parsed, toolTrace }
  }

  throw createError({
    code: 'AGENT_PROVIDER_PROTOCOL_ERROR',
    message: 'OpenAI-compatible provider did not return final AgentResponse content after tool calling iterations.',
    retryable: false,
    provider: input.provider,
    model: input.model,
  })
}

function buildFinalJsonRetryPrompt(firstLine: string): string {
  return [
    firstLine,
    'If your previous response only contained reasoning_content, convert the result into the final JSON now.',
    'Do not think through the problem again. Do not call tools. Start output immediately with the JSON object.',
    'Return exactly one JSON object now: schemaVersion="agent-response-v1", semanticVersion="easyanalyse-semantic-v4".',
    'For kind="blueprints", blueprints MUST be an array containing at least one complete candidate.',
    'If the user requested simulation, graph preview, parameter preview, frequency response, or a worker script, preserve or create the structured artifact at blueprints[n].simulation with schemaVersion "easyanalyse-simulation-v1"; do not only describe it in summary text.',
    'Do not include markdown, prose, multiple JSON objects, or text before/after JSON.',
  ].join('\n')
}

function applyOpenAiCompatibleGenerationOptions(
  body: Record<string, unknown>,
  input: ProviderBuildInput,
  options: { jsonOnly: boolean },
): void {
  const deepSeekV4 = isDeepSeekV4Model(input.provider, input.model)
  const deepSeekThinking = deepSeekV4 ? getDeepSeekV4ThinkingMode(input, options) : null
  const thinkingEnabled = deepSeekThinking !== null && isDeepSeekV4ThinkingEnabled(deepSeekThinking, options)
  if (!deepSeekV4 || (!thinkingEnabled && input.generation?.temperature !== undefined)) {
    body.temperature = input.generation?.temperature ?? DEFAULT_TEMPERATURE
  }
  if (!deepSeekV4 || (!thinkingEnabled && input.generation?.topP !== undefined)) {
    body.top_p = input.generation?.topP ?? DEFAULT_TOP_P
  }

  body.max_tokens = input.generation?.maxTokens ?? (deepSeekV4 ? DEEPSEEK_V4_DEFAULT_MAX_TOKENS : DEFAULT_MAX_TOKENS)

  if (deepSeekThinking === null) return
  if (deepSeekThinking === 'disabled' || (deepSeekThinking === 'auto' && options.jsonOnly)) {
    body.thinking = { type: 'disabled' }
    return
  }

  if (deepSeekThinking === 'auto') {
    body.reasoning_effort = 'high'
    return
  }

  body.thinking = { type: 'enabled' }
  body.reasoning_effort = deepSeekThinking
}

function getDeepSeekV4ThinkingMode(input: ProviderBuildInput, options: { jsonOnly: boolean }): DeepSeekV4ThinkingMode {
  const configured = input.generation?.deepSeekV4Thinking ?? useSettingsStore.getState().settings.agent.deepSeekV4Thinking ?? 'auto'
  if (configured === 'auto' && !options.jsonOnly) return 'auto'
  return configured
}

function isDeepSeekV4ThinkingEnabled(mode: DeepSeekV4ThinkingMode, options: { jsonOnly: boolean }): boolean {
  return mode === 'high' || mode === 'max' || (mode === 'auto' && !options.jsonOnly)
}

function isDeepSeekV4Model(provider: AgentProviderConfig, model: AgentModelConfig): boolean {
  return provider.kind === 'deepseek' && /^deepseek-v4-/i.test(model.id.trim())
}

function shouldReplayReasoningContent(provider: AgentProviderConfig, model: AgentModelConfig): boolean {
  return isDeepSeekV4Model(provider, model)
}

function shouldOfferPostBeginToolRound(userPrompt: string): boolean {
  return /generate_filter_blueprint|filter|low[-\s]?pass|high[-\s]?pass|sallen|截止|滤波|低通|高通/i.test(userPrompt)
}

function shouldForceGenerateFilterTool(userPrompt: string): boolean {
  return /generate_filter_blueprint/i.test(userPrompt)
}

function getFilterInferencePrompt(input: OpenAiCompatibleRunInput): string {
  const original = input.originalUserPrompt?.trim()
  return original ? original : input.userPrompt
}

function buildToolRuntimeContext(input: OpenAiCompatibleRunInput): AgentToolRuntimeContext {
  return {
    currentDocument: input.currentDocument ?? null,
    ...(input.getCurrentDocument ? { getCurrentDocument: input.getCurrentDocument } : {}),
    ...(input.blueprintWorkspace ? { blueprintWorkspace: input.blueprintWorkspace } : {}),
    ...(input.getBlueprintWorkspace ? { getBlueprintWorkspace: input.getBlueprintWorkspace } : {}),
    ...(input.selectedBlueprintId !== undefined ? { selectedBlueprintId: input.selectedBlueprintId } : {}),
    ...(input.getSelectedBlueprintId ? { getSelectedBlueprintId: input.getSelectedBlueprintId } : {}),
    ...(input.currentSelection ? { currentSelection: input.currentSelection } : {}),
    ...(input.getCurrentSelection ? { getCurrentSelection: input.getCurrentSelection } : {}),
    ...(input.getEditorFocus ? { getEditorFocus: input.getEditorFocus } : {}),
    ...(input.getEasyAnalyseFormatRules ? { getEasyAnalyseFormatRules: input.getEasyAnalyseFormatRules } : {}),
    ...(input.validateDocument ? { validateDocument: input.validateDocument } : {}),
    ...(input.beginBlueprintGeneration ? { beginBlueprintGeneration: input.beginBlueprintGeneration } : {}),
    ...(input.createBlueprintCandidate ? { createBlueprintCandidate: input.createBlueprintCandidate } : {}),
  }
}

function extractGeneratedToolCandidate(toolResult: AgentToolResult): AgentBlueprintCandidate | null {
  if (!isRecord(toolResult.data)) return null
  const candidate = toolResult.data.candidate
  if (!isRecord(candidate) || !isRecord(candidate.document)) return null
  return cloneGeneratedCandidate(candidate as unknown as AgentBlueprintCandidate)
}

function mergeGeneratedSimulationIntoToolArgs(
  toolName: string,
  args: unknown,
  generatedCandidates: readonly AgentBlueprintCandidate[],
): unknown {
  if (toolName !== 'create_blueprint_candidate' || generatedCandidates.length === 0) return args
  if (!isRecord(args) || !isRecord(args.candidate) || isRecord(args.candidate.simulation)) return args
  const generated = findGeneratedCandidateMatch(args.candidate, generatedCandidates)
    ?? (generatedCandidates.length === 1 ? generatedCandidates[0] : null)
  if (!generated?.simulation) return args
  return {
    ...args,
    candidate: {
      ...args.candidate,
      simulation: cloneJson(generated.simulation),
    },
  }
}

function attachGeneratedSimulationArtifacts(
  parsed: ProviderParseResult,
  generatedCandidates: readonly AgentBlueprintCandidate[],
): ProviderParseResult {
  if (generatedCandidates.length === 0 || parsed.response.kind !== 'blueprints') return parsed
  let changed = false
  const blueprints = parsed.response.blueprints.map((candidate) => {
    if (candidate.simulation !== undefined) return candidate
    const generated = findGeneratedCandidateMatch(candidate as unknown as JsonRecord, generatedCandidates)
      ?? (parsed.response.kind === 'blueprints' && parsed.response.blueprints.length === 1 && generatedCandidates.length === 1 ? generatedCandidates[0] : null)
    if (!generated?.simulation) return candidate
    changed = true
    return {
      ...candidate,
      simulation: cloneJson(generated.simulation),
    }
  })
  if (!changed) return parsed
  return {
    ...parsed,
    response: {
      ...parsed.response,
      blueprints,
    },
  }
}

function buildGeneratedToolFallbackResult(
  generatedCandidates: readonly AgentBlueprintCandidate[],
  input: OpenAiCompatibleRunInput,
  status: number | undefined,
  toolTrace: AgentToolTraceEntry[],
): ProviderParseResult | null {
  if (generatedCandidates.length === 0) return null
  const blueprints = generatedCandidates.map(cloneGeneratedCandidate)
  return {
    ok: true,
    issues: [],
    response: {
      schemaVersion: AGENT_RESPONSE_SCHEMA_VERSION,
      semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
      kind: 'blueprints',
      summary: `Returned ${blueprints.length} deterministic blueprint candidate${blueprints.length === 1 ? '' : 's'} from successful tool output because provider final JSON could not be parsed.`,
      warnings: ['Provider final JSON formatting failed; EasyAnalyse used successful deterministic tool output instead.'],
      blueprints,
    },
    metadata: {
      adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
      requestFormat: OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT,
      providerId: input.provider.id,
      modelId: input.model.id,
      responseId: 'easyanalyse-generated-tool-fallback',
      finishReason: status === undefined ? 'tool-fallback' : `tool-fallback-http-${status}`,
    },
    toolTrace: [...toolTrace],
  }
}

async function buildInferredGeneratedFilterFallback(
  input: OpenAiCompatibleRunInput,
  toolExecutor: AgentToolExecutor,
  toolTrace: AgentToolTraceEntry[],
  status: number | undefined,
): Promise<ProviderParseResult | null> {
  const args = inferGenerateFilterBlueprintArgsFromPrompt(getFilterInferencePrompt(input))
  if (!args) return null
  emitProgress(input.progress, {
    phase: 'tool',
    message: 'Running tool generate_filter_blueprint from inferred filter parameters.',
    detail: { toolName: 'generate_filter_blueprint', inferred: true },
  })
  const toolResult = await toolExecutor('generate_filter_blueprint', args, buildToolRuntimeContext(input))
  toolTrace.push({
    toolName: 'generate_filter_blueprint',
    ok: toolResult.ok,
    summary: toolResult.summary,
    issueCount: toolResult.issueCount,
  })
  const candidate = extractGeneratedToolCandidate(toolResult)
  if (!candidate) return null
  return buildGeneratedToolFallbackResult([candidate], input, status, toolTrace)
}

async function attachInferredFilterSimulationArtifacts(
  parsed: ProviderParseResult,
  input: OpenAiCompatibleRunInput,
  toolExecutor: AgentToolExecutor,
  toolTrace: AgentToolTraceEntry[],
  status: number | undefined,
): Promise<ProviderParseResult> {
  if (parsed.response.kind !== 'blueprints') return parsed
  if (parsed.response.blueprints.every((candidate) => candidate.simulation !== undefined)) return parsed
  const args = inferGenerateFilterBlueprintArgsFromPrompt(getFilterInferencePrompt(input))
  if (!args) return parsed

  emitProgress(input.progress, {
    phase: 'tool',
    message: 'Running tool generate_filter_blueprint to preserve missing filter simulation artifact.',
    detail: { toolName: 'generate_filter_blueprint', inferred: true, providerStatus: status },
  })
  const toolResult = await toolExecutor('generate_filter_blueprint', args, buildToolRuntimeContext(input))
  toolTrace.push({
    toolName: 'generate_filter_blueprint',
    ok: toolResult.ok,
    summary: toolResult.summary,
    issueCount: toolResult.issueCount,
  })
  const candidate = extractGeneratedToolCandidate(toolResult)
  if (!candidate?.simulation) return parsed
  return attachGeneratedSimulationArtifacts(parsed, [candidate])
}

export function inferGenerateFilterBlueprintArgsFromPrompt(userPrompt: string): Record<string, unknown> | null {
  if (!shouldForceGenerateFilterTool(userPrompt) && !/(低通|高通|low[-\s]?pass|high[-\s]?pass|滤波器|filter)/i.test(userPrompt)) {
    return null
  }
  const cutoffFrequencyHz = inferCutoffFrequencyHz(userPrompt)
  if (cutoffFrequencyHz === null) return null

  const filterType = /(高通|high[-\s]?pass)/i.test(userPrompt) ? 'highpass' : 'lowpass'
  const topology = /(sallen|key|二阶|second[-\s]?order)/i.test(userPrompt)
    ? 'sallen-key'
    : /(一阶|first[-\s]?order|rc|passive|无源)/i.test(userPrompt)
      ? 'passive-rc'
      : 'auto'
  const q = inferNumericValue(userPrompt, /(?:\bq\b|品质因数|quality\s*factor)\s*(?:=|≈|约|:|：)?\s*([0-9]+(?:\.[0-9]+)?)/i)
  const gain = inferNumericValue(userPrompt, /(?:gain|增益)\s*(?:=|≈|约|:|：)?\s*([0-9]+(?:\.[0-9]+)?)/i)

  return {
    filterType,
    topology,
    cutoffFrequencyHz,
    ...(q !== null ? { q } : {}),
    ...(gain !== null ? { gain } : {}),
  }
}

function inferCutoffFrequencyHz(userPrompt: string): number | null {
  const focused = /(?:截止|cutoff|fc|f_c)[^0-9]{0,24}([0-9]+(?:\.[0-9]+)?)\s*(k\s*hz|khz|k|hz|赫兹|千赫)?/i.exec(userPrompt)
  const generic = focused ?? /([0-9]+(?:\.[0-9]+)?)\s*(k\s*hz|khz|k|hz|赫兹|千赫)/i.exec(userPrompt)
  if (!generic) return null
  const value = Number(generic[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = (generic[2] ?? 'hz').toLowerCase().replace(/\s+/g, '')
  if (unit.includes('k') || unit.includes('千')) return value * 1000
  return value
}

function inferNumericValue(userPrompt: string, pattern: RegExp): number | null {
  const match = pattern.exec(userPrompt)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

function findGeneratedCandidateMatch(
  candidate: JsonRecord,
  generatedCandidates: readonly AgentBlueprintCandidate[],
): AgentBlueprintCandidate | null {
  return generatedCandidates.find((generated) => candidatesShareDocumentIdentity(candidate, generated)) ?? null
}

function candidatesShareDocumentIdentity(candidate: JsonRecord, generated: AgentBlueprintCandidate): boolean {
  const candidateDocument = isRecord(candidate.document) ? candidate.document : null
  if (!candidateDocument) return false
  const candidateDocumentId = readDocumentId(candidateDocument)
  const generatedDocumentId = readDocumentId(generated.document as unknown as JsonRecord)
  if (candidateDocumentId && generatedDocumentId && candidateDocumentId === generatedDocumentId) return true

  const candidateTitle = optionalString(candidate.title)?.trim()
  const generatedTitle = generated.title.trim()
  const titleMatches = Boolean(candidateTitle && candidateTitle === generatedTitle)
  const candidateDeviceIds = readDeviceIds(candidateDocument)
  const generatedDeviceIds = readDeviceIds(generated.document as unknown as JsonRecord)
  return titleMatches && candidateDeviceIds.length > 0 && candidateDeviceIds.join('|') === generatedDeviceIds.join('|')
}

function readDocumentId(document: JsonRecord): string | undefined {
  return isRecord(document.document) ? optionalString(document.document.id) : undefined
}

function readDeviceIds(document: JsonRecord): string[] {
  if (!Array.isArray(document.devices)) return []
  return document.devices
    .map((device) => (isRecord(device) ? optionalString(device.id) : undefined))
    .filter((id): id is string => Boolean(id))
}

function cloneGeneratedCandidate(candidate: AgentBlueprintCandidate): AgentBlueprintCandidate {
  return cloneJson(candidate)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getHardFormatIssuesForToolResult(toolName: string, ok: boolean, issues: ValidationIssue[]): ValidationIssue[] {
  if (ok) return []
  if (toolName === 'check_document_format' || toolName === 'check_blueprint_format') return issues
  if (toolName === 'create_blueprint_candidate') return issues.filter(isHardFormatIssue)
  return []
}

function isHardFormatIssue(issue: ValidationIssue): boolean {
  return issue.severity === 'error' && (issue.code.startsWith('schema.') || issue.code.startsWith('format.'))
}

function buildAssistantReplayMessage(
  assistantMessage: JsonRecord | null,
  options: { toolCalls?: unknown[]; fallbackContent: string | null; includeReasoningContent?: boolean },
): Record<string, unknown> {
  const content = assistantMessage?.content
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: typeof content === 'string' || content === null ? content : options.fallbackContent,
  }
  if (options.toolCalls) message.tool_calls = options.toolCalls
  const includeReasoningContent = options.includeReasoningContent ?? false
  if (includeReasoningContent && typeof assistantMessage?.reasoning_content === 'string') {
    message.reasoning_content = assistantMessage.reasoning_content
  }
  return message
}

function shouldAppendAssistantReplayMessage(message: Record<string, unknown>): boolean {
  const content = message.content
  const hasContent = typeof content === 'string' ? content.trim().length > 0 : content !== null
  return hasContent || Array.isArray(message.tool_calls)
}

function hasMissingAssistantContent(assistantMessage: JsonRecord | null): boolean {
  return typeof assistantMessage?.content !== 'string' || assistantMessage.content.trim().length === 0
}

const MAX_REPAIR_PROMPT_ISSUES = 200

function buildToolIssueRepairPrompt(
  issues: ValidationIssue[],
  state: { issueCount: number; toolIterations: number; maxToolIterations: number },
): string {
  const issueSummary = summarizeIssueCodes(issues)
  const repairHints = buildRepairHints(issues)
  const issueLines = issues.slice(0, MAX_REPAIR_PROMPT_ISSUES).map(formatIssueLine)
  const omitted = issues.length > issueLines.length
    ? [`... ${issues.length - issueLines.length} additional issue(s) omitted from this compact repair prompt; the full raw tool result is in the previous tool message.`]
    : []

  return [
    `An EasyAnalyse display/openability format tool reported ${state.issueCount} recoverable issue${state.issueCount === 1 ? '' : 's'} on tool round ${state.toolIterations}/${state.maxToolIterations}.`,
    'Repair format errors when possible, then continue generating. These diagnostics should not terminate the provider run by themselves.',
    'If the errors are repairable, repair and continue. If the request is impossible or lacks required design information, return a valid AgentResponse kind "question" or "error" instead of forcing a broken blueprint.',
    'Call check_blueprint_format again when you need to verify the corrected candidate.',
    'Make the smallest possible edit to the previous candidate. Do not redesign the circuit when the latest issues are only schema or required-field repairs.',
    'Semantic quality and layout readability issues are advisory; do not treat advisory-only check_blueprint_candidate issues as blockers.',
    '',
    'EasyAnalyse semantic v4 repair rules:',
    '- Connectivity is only terminal.label equality. Do not add wires, nodes, junctions, bend points, signalId, ports, or components fields.',
    '- Every device needs id, name, kind, and terminals[]. Every terminal needs id, name, direction ("input" or "output"), and usually label.',
    '- view.devices keys must match device ids. view.devices[deviceId].position is the top-left of the rendered device bounds, not the center. Use view.canvas.units = "px".',
    '- To fix layout.device.overlap, move devices to a wide grid such as x=80,380,680,980,1280 and y=96,320,544,768. Keep default rectangular devices at least 280 px apart horizontally and 180 px apart vertically.',
    '- view.networkLines is only a visual label summary. It never creates connectivity. Each network line label must also appear on at least one terminal, otherwise remove it.',
    '- To fix layout.network-line.device-overlap, move the view.networkLines entry outside device bounds, shorten it, change orientation, or remove it. Prefer rails above/below/left/right of the device grid; do not draw visual rails through components.',
    '- To fix layout.text.device-overlap, use the reported textBounds and deviceBounds. Move the nearby device, its terminal side/order, or the optional networkLine label so text does not cover a module.',
    '',
    `Issue groups: ${issueSummary || 'none'}`,
    ...(repairHints.length > 0 ? ['', 'Repair hints:', ...repairHints.map((hint) => `- ${hint}`)] : []),
    '',
    'Exact issues from the latest tool check:',
    ...(issueLines.length > 0 ? issueLines : ['- No issue details were returned; inspect the raw tool result and produce a complete valid candidate.']),
    ...omitted,
  ].join('\n')
}

function summarizeIssueCodes(issues: readonly ValidationIssue[], maxGroups = 8): string {
  if (issues.length === 0) return ''
  const counts = new Map<string, number>()
  issues.forEach((issue) => {
    const key = `${issue.severity}:${issue.code}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  const groups = [...counts.entries()]
    .sort((left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0]))
    .slice(0, maxGroups)
    .map(([key, count]) => `${key} x${count}`)
  const remaining = counts.size - groups.length
  return remaining > 0 ? `${groups.join(', ')}, +${remaining} more group(s)` : groups.join(', ')
}

function formatIssueLine(issue: ValidationIssue, index: number): string {
  const location = [
    issue.path ? `path=${issue.path}` : null,
    issue.entityId ? `entity=${issue.entityId}` : null,
  ].filter(Boolean).join(' ')
  const details = formatIssueDetails(issue)
  return `${index + 1}. [${issue.severity}] ${issue.code}${location ? ` (${location})` : ''}: ${oneLine(issue.message)}${details ? ` | ${details}` : ''}`
}

function formatIssueDetails(issue: ValidationIssue): string {
  const details = issue.details
  if (!isRecord(details)) return ''
  if (issue.code === 'layout.device.overlap') {
    const leftDeviceId = optionalString(details.leftDeviceId) ?? 'left-device'
    const rightDeviceId = optionalString(details.rightDeviceId) ?? 'right-device'
    const leftBounds = readBounds(details.leftBounds)
    const rightBounds = readBounds(details.rightBounds)
    const overlapWidth = optionalNumber(details.overlapWidth)
    const overlapHeight = optionalNumber(details.overlapHeight)
    const padding = optionalNumber(details.padding) ?? 0
    const moveRightX = leftBounds && rightBounds ? Math.ceil(leftBounds.x + leftBounds.width + Math.max(80, padding + 64)) : null
    const moveBelowY = leftBounds && rightBounds ? Math.ceil(leftBounds.y + leftBounds.height + Math.max(80, padding + 64)) : null
    const parts = [
      `details: ${leftDeviceId} bounds=${formatBounds(leftBounds)}, ${rightDeviceId} bounds=${formatBounds(rightBounds)}`,
      overlapWidth === undefined ? null : `overlapWidth=${round(overlapWidth)}`,
      overlapHeight === undefined ? null : `overlapHeight=${round(overlapHeight)}`,
      moveRightX === null || !rightBounds ? null : `minimal fix: move ${rightDeviceId} to x>=${moveRightX} at y=${round(rightBounds.y)}, or y>=${moveBelowY}`,
    ].filter(Boolean)
    return parts.join('; ')
  }
  if (issue.code === 'layout.network-line.device-overlap') {
    const networkLineId = optionalString(details.networkLineId) ?? optionalString(issue.entityId) ?? 'network-line'
    const label = optionalString(details.networkLineLabel)
    const deviceId = optionalString(details.deviceId) ?? 'device'
    const lineStart = readPoint(details.lineStart)
    const lineEnd = readPoint(details.lineEnd)
    const deviceBounds = readBounds(details.deviceBounds)
    const overlapLength = optionalNumber(details.overlapLength)
    const orientation = lineStart && lineEnd && Math.abs(lineStart.y - lineEnd.y) < 1e-6
      ? 'horizontal'
      : lineStart && lineEnd && Math.abs(lineStart.x - lineEnd.x) < 1e-6
        ? 'vertical'
        : 'diagonal'
    const topY = deviceBounds ? Math.floor(deviceBounds.y - 72) : null
    const bottomY = deviceBounds ? Math.ceil(deviceBounds.y + deviceBounds.height + 72) : null
    const leftX = deviceBounds ? Math.floor(deviceBounds.x - 72) : null
    const rightX = deviceBounds ? Math.ceil(deviceBounds.x + deviceBounds.width + 72) : null
    const fix = orientation === 'horizontal'
      ? `minimal fix: change view.networkLines.${networkLineId}.position.y to <=${topY} or >=${bottomY}, shorten length, or remove this optional rail`
      : orientation === 'vertical'
        ? `minimal fix: change view.networkLines.${networkLineId}.position.x to <=${leftX} or >=${rightX}, shorten length, or remove this optional rail`
        : `minimal fix: make view.networkLines.${networkLineId} horizontal/vertical outside device bounds, or remove this optional rail`
    const parts = [
      `details: line=${networkLineId}${label ? ` label=${label}` : ''} start=${formatPoint(lineStart)} end=${formatPoint(lineEnd)} orientation=${orientation}`,
      `crosses device=${deviceId} bounds=${formatBounds(deviceBounds)}`,
      overlapLength === undefined ? null : `overlapLength=${round(overlapLength)}`,
      fix,
    ].filter(Boolean)
    return parts.join('; ')
  }
  if (issue.code === 'layout.text.device-overlap') {
    const textId = optionalString(details.textId) ?? optionalString(issue.entityId) ?? 'text'
    const textKind = optionalString(details.textKind) ?? 'text'
    const text = optionalString(details.text)
    const ownerDeviceId = optionalString(details.ownerDeviceId)
    const deviceId = optionalString(details.deviceId) ?? 'device'
    const textBounds = readBounds(details.textBounds)
    const deviceBounds = readBounds(details.deviceBounds)
    const overlapWidth = optionalNumber(details.overlapWidth)
    const overlapHeight = optionalNumber(details.overlapHeight)
    const moveRightX = textBounds && deviceBounds ? Math.ceil(textBounds.x + textBounds.width + 64) : null
    const moveBelowY = textBounds && deviceBounds ? Math.ceil(textBounds.y + textBounds.height + 64) : null
    const parts = [
      `details: ${textKind} ${textId}${text ? ` text=${text}` : ''}${ownerDeviceId ? ` owner=${ownerDeviceId}` : ''}`,
      `textBounds=${formatBounds(textBounds)} overlaps device=${deviceId} bounds=${formatBounds(deviceBounds)}`,
      overlapWidth === undefined ? null : `overlapWidth=${round(overlapWidth)}`,
      overlapHeight === undefined ? null : `overlapHeight=${round(overlapHeight)}`,
      moveRightX === null || !deviceBounds ? null : `minimal fix: move ${deviceId} to x>=${moveRightX} or y>=${moveBelowY}, or move the label/rail away from the device`,
    ].filter(Boolean)
    return parts.join('; ')
  }
  const serialized = safeStringify(details)
  return serialized ? `details=${truncate(oneLine(serialized), 700)}` : ''
}

function readPoint(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null
  const x = optionalNumber(value.x)
  const y = optionalNumber(value.y)
  return x === undefined || y === undefined ? null : { x, y }
}

function readBounds(value: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!isRecord(value)) return null
  const x = optionalNumber(value.x)
  const y = optionalNumber(value.y)
  const width = optionalNumber(value.width)
  const height = optionalNumber(value.height)
  return x === undefined || y === undefined || width === undefined || height === undefined ? null : { x, y, width, height }
}

function formatPoint(point: { x: number; y: number } | null): string {
  return point ? `(${round(point.x)},${round(point.y)})` : 'unknown'
}

function formatBounds(bounds: { x: number; y: number; width: number; height: number } | null): string {
  return bounds ? `{x:${round(bounds.x)},y:${round(bounds.y)},w:${round(bounds.width)},h:${round(bounds.height)}}` : 'unknown'
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function buildRepairHints(issues: readonly ValidationIssue[]): string[] {
  const hints = new Set<string>()
  issues.forEach((issue) => {
    const code = issue.code
    if (/missing-device-(id|name)/.test(code)) hints.add('Fill every device with stable id and non-empty name; do not leave generated devices anonymous.')
    if (/missing-terminal-(id|name)/.test(code)) hints.add('Fill every terminal with stable id and non-empty name such as A, B, IN, OUT, VCC, or GND.')
    if (code === 'missing-terminals-array') hints.add('Each device must include terminals: [] at minimum; connectable parts need labeled terminals.')
    if (code === 'invalid-terminal-direction') hints.add('Use only terminal.direction "input" or "output"; never use bidirectional, inout, passive, power, or ground.')
    if (code === 'forbidden-old-topology-field') hints.add('Remove old topology fields such as wires, nodes, junctions, components, ports, and signalId; use matching terminal.label values instead.')
    if (code === 'unused-network-line-label') hints.add('For every view.networkLines entry, either add the same label to a terminal or remove that visual network line.')
    if (code === 'invalid-view-canvas-units') hints.add('Set document.view.canvas.units exactly to "px".')
    if (/missing-view/.test(code)) hints.add('Include view.canvas, view.devices, and view.networkLines in every candidate document.')
    if (code === 'layout.device.overlap') hints.add('Move overlapping devices farther apart in view.devices. Positions are top-left coordinates, not centers; use at least 280 px horizontal and 180 px vertical top-left gaps, or a wide grid such as x=80,380,680,980,1280 and y=96,320,544,768.')
    if (code === 'layout.network-line.device-overlap') hints.add('Move or remove visual network lines that cross devices. view.networkLines are optional rails, not wires; place them outside the device grid or shorten/change orientation so they do not intersect device bounds.')
    if (code === 'layout.text.device-overlap') hints.add('Move the reported device, terminal side/order, or optional networkLine label so textBounds no longer intersects deviceBounds. Prefer adding spacing before changing circuit semantics.')
    if (code === 'agent_tool.invalid_args') hints.add('Call check_blueprint_format or create_blueprint_candidate with { candidate: { title, summary, rationale, tradeoffs, document, issues } }, not with only a document or partial object.')
  })
  return [...hints]
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

async function annotateKnownHardFormatFailure(
  parsed: ProviderParseResult,
  state: {
    lastHardFormatIssueCount: number | null
    status: number
    provider: AgentProviderConfig
    model: AgentModelConfig
    input: OpenAiCompatibleRunInput
  },
): Promise<ProviderParseResult> {
  if (parsed.response.kind !== 'blueprints' || state.lastHardFormatIssueCount === null || state.lastHardFormatIssueCount === 0) return parsed
  const finalHardFormatIssues = await collectFinalBlueprintHardFormatIssues(parsed, state.input)
  if (finalHardFormatIssues.length === 0) return parsed

  const issueSummary = summarizeIssueCodes(finalHardFormatIssues)
  const issueLines = finalHardFormatIssues.slice(0, 8).map(formatIssueLine)
  const diagnosticMessage = [
    `OpenAI-compatible provider returned blueprints after a format tool reported ${state.lastHardFormatIssueCount} issue(s); the final local format check still found ${finalHardFormatIssues.length} recoverable issue(s).`,
    issueSummary ? `Issue groups: ${issueSummary}.` : '',
    issueLines.length > 0 ? `First issues: ${issueLines.join(' | ')}` : '',
  ].filter(Boolean).join(' ')

  emitProgress(state.input.progress, {
    phase: 'self-check',
    message: diagnosticMessage,
    detail: { issueCount: finalHardFormatIssues.length, previousIssueCount: state.lastHardFormatIssueCount },
  })

  const recoverableIssues = finalHardFormatIssues.map((issue) => {
    const originalDetails = isRecord(issue.details) ? issue.details : {}
    return {
      ...issue,
      severity: 'warning' as const,
      code: issue.code.startsWith('format.') || issue.code.startsWith('schema.')
        ? `recoverable.${issue.code}`
        : issue.code,
      message: `Recoverable display/openability diagnostic: ${issue.message}`,
      details: {
        ...originalDetails,
        candidateIndex: typeof originalDetails.candidateIndex === 'number' ? originalDetails.candidateIndex : undefined,
        originalSeverity: issue.severity,
        originalCode: issue.code,
        originalDetails: issue.details,
        providerStatus: state.status,
        providerId: state.provider.id,
        modelId: state.model.id,
      },
    }
  })

  for (const issue of recoverableIssues) {
    const index = isRecord(issue.details) && typeof issue.details.candidateIndex === 'number' ? issue.details.candidateIndex : -1
    const candidate = index >= 0 ? parsed.response.blueprints[index] : null
    if (!candidate) continue
    candidate.issues = [...candidate.issues, issue]
    candidate.toolIssues = [...(candidate.toolIssues ?? []), issue]
  }

  return {
    ...parsed,
    issues: [...parsed.issues, ...recoverableIssues],
  }
}

async function collectFinalBlueprintHardFormatIssues(
  parsed: ProviderParseResult,
  input: OpenAiCompatibleRunInput,
): Promise<ValidationIssue[]> {
  if (parsed.response.kind !== 'blueprints') return []
  const context = buildToolRuntimeContext(input)
  const issues: ValidationIssue[] = []
  for (const [index, candidate] of parsed.response.blueprints.entries()) {
    const result = await runAgentTool('check_blueprint_format', { candidate }, context)
    const hardIssues = getHardFormatIssuesForToolResult('check_blueprint_format', result.ok, result.issues)
    issues.push(...hardIssues.map((issue) => annotateFinalBlueprintIssue(issue, index, candidate.title)))
  }
  return issues
}

function annotateFinalBlueprintIssue(issue: ValidationIssue, candidateIndex: number, title: string): ValidationIssue {
  return {
    ...issue,
    path: formatFinalBlueprintIssuePath(issue.path, candidateIndex),
    details: isRecord(issue.details)
      ? { ...issue.details, candidateIndex, candidateTitle: title }
      : { originalDetails: issue.details, candidateIndex, candidateTitle: title },
  }
}

function formatFinalBlueprintIssuePath(path: string | null | undefined, candidateIndex: number): string {
  const candidatePath = `blueprints[${candidateIndex}]`
  if (!path) return candidatePath
  if (path === 'candidate') return candidatePath
  if (path.startsWith('candidate.')) return `${candidatePath}.${path.slice('candidate.'.length)}`
  if (path === 'document' || path.startsWith('document.')) return `${candidatePath}.${path}`
  return `${candidatePath}.document.${path}`
}

function describeAssistantContentState(assistantMessage: JsonRecord | null, choice: JsonRecord): string {
  if (!assistantMessage) return 'The provider response did not include an assistant message object.'
  const content = assistantMessage.content
  const contentState = typeof content === 'string'
    ? `content length was ${content.trim().length}`
    : `content was ${content === null ? 'null' : typeof content}`
  const reasoningState = typeof assistantMessage.reasoning_content === 'string'
    ? `reasoning_content length was ${assistantMessage.reasoning_content.trim().length}`
    : 'reasoning_content was not present'
  const finishReason = typeof choice.finish_reason === 'string' ? `finish_reason was "${choice.finish_reason}"` : 'finish_reason was not provided'
  return `${contentState}; ${reasoningState}; ${finishReason}.`
}

function describeOpenAiResponseProgress(
  choice: JsonRecord,
  assistantMessage: JsonRecord | null,
  toolCalls: unknown[],
  status: number,
): ProviderProgressEvent {
  const contentLength = textLength(assistantMessage?.content)
  const reasoningContentLength = textLength(assistantMessage?.reasoning_content)
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined
  const detail = { status, finishReason, contentLength, reasoningContentLength, toolCallCount: toolCalls.length }

  if (toolCalls.length > 0) {
    return {
      phase: 'response',
      message: `Model requested ${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}.`,
      detail,
    }
  }
  if (contentLength > 0) {
    return {
      phase: 'response',
      message: `Provider returned ${contentLength} characters of candidate content.`,
      detail,
    }
  }
  if (reasoningContentLength > 0) {
    return {
      phase: 'response',
      message: `Provider returned reasoning metadata (${reasoningContentLength} characters) without final content yet.`,
      detail,
    }
  }
  return {
    phase: 'response',
    message: 'Provider response received without final content.',
    detail,
  }
}

function textLength(value: unknown): number {
  return typeof value === 'string' ? value.trim().length : 0
}

function emitProgress(progress: ProviderProgressHandler | undefined, event: ProviderProgressEvent): void {
  try {
    progress?.(event)
  } catch {
    // Progress reporting must never affect provider execution.
  }
}

async function performOpenAiRequest(
  input: OpenAiCompatibleRunInput,
  request: ProviderHttpRequest,
): Promise<{ body: unknown; status: number }> {
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
  if (!response.ok) throw mapHttpError(response.status, body, input)
  return { body, status: response.status }
}

function normalizeToolCall(call: unknown): { id: string; name: string; arguments: string } {
  if (!isRecord(call)) return { id: 'tool-call', name: 'unknown_tool', arguments: '{}' }
  const fn = isRecord(call.function) ? call.function : {}
  return {
    id: typeof call.id === 'string' ? call.id : 'tool-call',
    name: typeof fn.name === 'string' ? fn.name : 'unknown_tool',
    arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}',
  }
}

function parseToolArguments(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch {
    return { ok: false }
  }
}

function parseFencedAgentResponse(text: string, input: ProviderParseInput): AgentResponseParseResult | null {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (!match) return null
  try {
    return parseAgentResponse(match[1]!.trim(), { mainDocument: input.mainDocument ?? null })
  } catch {
    return null
  }
}

function parseTrailingAgentResponse(text: string, input: ProviderParseInput): AgentResponseParseResult | null {
  const trimmedEnd = text.trimEnd().length
  for (let start = text.lastIndexOf('{'); start >= 0;) {
    const candidate = extractJsonObjectStringAt(text, start)
    if (candidate) {
      const end = start + candidate.length
      if (end === trimmedEnd) {
        try {
          return parseAgentResponse(candidate, { mainDocument: input.mainDocument ?? null })
        } catch {
          return null
        }
      }
    }
    if (start === 0) break
    start = text.lastIndexOf('{', start - 1)
  }
  return null
}

function parseLenientAgentResponse(text: string, input: ProviderParseInput): AgentResponseParseResult | null {
  const root = parseLooseJsonObject(text)
  if (!root) return null

  const normalized = normalizeLenientAgentResponse(root)
  if (!normalized) return null

  try {
    return parseAgentResponse(normalized, { mainDocument: input.mainDocument ?? null })
  } catch {
    return null
  }
}

function normalizeLenientAgentResponse(root: JsonRecord): JsonRecord | null {
  const kind = typeof root.kind === 'string'
    ? root.kind
    : Array.isArray(root.blueprints)
      ? 'blueprints'
      : undefined
  if (kind !== 'message' && kind !== 'blueprints' && kind !== 'question' && kind !== 'error' && kind !== 'patch') {
    return null
  }
  if (typeof root.schemaVersion === 'string' && root.schemaVersion !== AGENT_RESPONSE_SCHEMA_VERSION) return null
  if (typeof root.semanticVersion === 'string' && root.semanticVersion !== AGENT_RESPONSE_SEMANTIC_VERSION) return null

  const normalized: JsonRecord = {
    ...root,
    schemaVersion: AGENT_RESPONSE_SCHEMA_VERSION,
    semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
    kind,
  }

  const summary = stringFromMessageValue(root.summary)
  normalized.summary = summary ?? defaultAgentResponseSummary(kind, root)

  const warnings = stringArrayFromMessageValue(root.warnings)
  if (warnings === null) {
    delete normalized.warnings
  } else {
    normalized.warnings = warnings
  }

  if (root.capabilities !== undefined && !Array.isArray(root.capabilities) && !isRecord(root.capabilities)) {
    delete normalized.capabilities
  }

  if (kind === 'message') {
    const markdown = stringFromMessageValue(root.markdown)
      ?? stringFromMessageValue(root.message)
      ?? stringFromMessageValue(root.content)
      ?? stringFromMessageValue(root.answer)
      ?? summary
    if (!markdown) return null
    normalized.markdown = markdown
    return normalized
  }

  if (kind === 'question') {
    const question = stringFromMessageValue(root.question)
      ?? stringFromMessageValue(root.message)
      ?? stringFromMessageValue(root.content)
      ?? summary
    if (!question) return null
    normalized.question = question
    const options = stringArrayFromMessageValue(root.options)
    if (options === null) delete normalized.options
    else normalized.options = options
    return normalized
  }

  if (kind === 'error') {
    const message = stringFromMessageValue(root.message)
      ?? stringFromMessageValue(root.error)
      ?? stringFromMessageValue(root.content)
      ?? summary
    if (!message) return null
    normalized.message = message
    normalized.recoverable = typeof root.recoverable === 'boolean' ? root.recoverable : true
    return normalized
  }

  if (kind === 'patch') {
    normalized.message = stringFromMessageValue(root.message) ?? summary ?? 'Patch response'
    return normalized
  }

  if (!Array.isArray(root.blueprints)) return null
  const blueprints = root.blueprints.map(normalizeLenientBlueprintCandidate)
  if (blueprints.some((candidate) => candidate === null)) return null
  normalized.blueprints = blueprints
  return normalized
}

function normalizeLenientBlueprintCandidate(value: unknown, index: number): JsonRecord | null {
  if (!isRecord(value)) return null
  if (!isRecord(value.document)) return null

  const documentTitle = isRecord(value.document.document) ? stringFromMessageValue(value.document.document.title) : null
  const title = stringFromMessageValue(value.title) ?? documentTitle ?? `Blueprint ${index + 1}`
  const summary = stringFromMessageValue(value.summary)
    ?? stringFromMessageValue(value.description)
    ?? stringFromMessageValue(value.rationale)
    ?? title
  const rationale = stringFromMessageValue(value.rationale) ?? summary

  const normalized: JsonRecord = {
    ...value,
    title,
    summary,
    rationale,
    tradeoffs: stringArrayFromMessageValue(value.tradeoffs) ?? [],
  }

  const highlightedLabels = stringArrayFromMessageValue(value.highlightedLabels)
  if (highlightedLabels === null) delete normalized.highlightedLabels
  else normalized.highlightedLabels = highlightedLabels

  const notes = stringArrayFromMessageValue(value.notes)
  if (notes === null) delete normalized.notes
  else normalized.notes = notes

  return normalized
}

function defaultAgentResponseSummary(kind: string, root: JsonRecord): string {
  if (kind === 'blueprints') {
    const count = Array.isArray(root.blueprints) ? root.blueprints.length : 0
    return count === 1 ? 'Generated 1 blueprint candidate' : `Generated ${count} blueprint candidates`
  }
  if (kind === 'question') return 'Provider question'
  if (kind === 'error') return 'Provider error'
  if (kind === 'patch') return 'Provider patch'
  return 'Provider message'
}

function stringArrayFromMessageValue(value: unknown): string[] | null {
  if (value === undefined) return null
  if (Array.isArray(value)) {
    return value.map(stringFromMessageValue).filter((item): item is string => item !== null)
  }
  const single = stringFromMessageValue(value)
  return single ? [single] : null
}

function parseLenientAgentMessage(text: string): AgentResponseParseResult | null {
  const root = parseLooseJsonObject(text)
  if (!root) return null

  const kind = typeof root.kind === 'string' ? root.kind : undefined
  if (kind === 'blueprints' || Array.isArray(root.blueprints)) return null
  if (kind !== undefined && kind !== 'message' && kind !== 'question' && kind !== 'error') return null
  if (typeof root.schemaVersion === 'string' && root.schemaVersion !== AGENT_RESPONSE_SCHEMA_VERSION) return null
  if (typeof root.semanticVersion === 'string' && root.semanticVersion !== AGENT_RESPONSE_SEMANTIC_VERSION) return null

  const markdown = extractMessageText(root)
  if (!markdown) return null

  return {
    ok: true,
    response: {
      schemaVersion: AGENT_RESPONSE_SCHEMA_VERSION,
      semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
      kind: 'message',
      ...(typeof root.summary === 'string' && root.summary.trim() ? { summary: root.summary.trim() } : { summary: 'Provider message' }),
      markdown,
    },
    issues: [],
  }
}

function parseLooseJsonObject(text: string): JsonRecord | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null

  try {
    const parsed = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractMessageText(root: JsonRecord): string | null {
  const direct = [
    root.markdown,
    root.message,
    root.content,
    root.text,
    root.answer,
    root.response,
    root.summary,
  ].map(stringFromMessageValue).find((value): value is string => value !== null)
  if (direct) return direct

  if (root.kind === 'question') return stringFromMessageValue(root.question)
  if (root.kind === 'error') return stringFromMessageValue(root.message)
  return null
}

function stringFromMessageValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (Array.isArray(value)) {
    const parts = value.map(stringFromMessageValue).filter((part): part is string => part !== null)
    return parts.length > 0 ? parts.join('\n') : null
  }

  if (isRecord(value)) {
    const nested = [
      value.markdown,
      value.message,
      value.content,
      value.text,
      value.answer,
      value.response,
      value.summary,
    ].map(stringFromMessageValue).find((part): part is string => part !== null)
    if (nested) return nested

    const serialized = safeStringify(value)
    return serialized && serialized !== '{}' ? serialized : null
  }

  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function parsePlainTextAgentMessage(text: string): AgentResponseParseResult | null {
  const markdown = text.trim()
  if (!markdown || looksLikeAgentResponseAttempt(markdown)) return null

  return {
    ok: true,
    response: {
      schemaVersion: AGENT_RESPONSE_SCHEMA_VERSION,
      semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
      kind: 'message',
      summary: 'Provider message',
      markdown,
    },
    issues: [],
  }
}

function looksLikeAgentResponseAttempt(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('{')
    || trimmed.startsWith('[')
    || trimmed.startsWith('```')
    || text.includes(AGENT_RESPONSE_SCHEMA_VERSION)
    || text.includes('"schemaVersion"')
    || text.includes("'schemaVersion'")
}

function extractJsonObjectStringAt(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
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
  const contentType = response.headers.get('Content-Type') ?? response.headers.get('content-type') ?? ''
  if (contentType.toLowerCase().includes('text/event-stream')) {
    return readOpenAiStreamResponseBody(response, context)
  }

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

async function readOpenAiStreamResponseBody(response: Response, context: ErrorContext & { progress?: ProviderProgressHandler }): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text().catch((error: unknown) => {
      throw mapNetworkError(error, context)
    })
    return parseOpenAiStreamText(text, context)
  }

  const decoder = new TextDecoder()
  const state = createOpenAiStreamAccumulator(context)
  let pending = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const parsed = consumeSseBlocks(pending)
      pending = parsed.pending
      for (const block of parsed.blocks) {
        consumeOpenAiStreamBlock(block, state)
      }
    }
    pending += decoder.decode()
    if (pending.trim().length > 0) {
      consumeOpenAiStreamBlock(pending, state)
    }
  } catch (error) {
    throw mapNetworkError(error, context)
  }

  return finalizeOpenAiStreamAccumulator(state, context)
}

interface OpenAiStreamAccumulator {
  id?: string
  model?: string
  finishReason?: string
  content: string
  reasoningContent: string
  contentSnapshots: Record<string, string>
  reasoningSnapshots: Record<string, string>
  usage?: unknown
  context: ErrorContext & { progress?: ProviderProgressHandler }
}

function createOpenAiStreamAccumulator(context: ErrorContext & { progress?: ProviderProgressHandler }): OpenAiStreamAccumulator {
  return {
    content: '',
    reasoningContent: '',
    contentSnapshots: {},
    reasoningSnapshots: {},
    context,
  }
}

function parseOpenAiStreamText(text: string, context: ErrorContext & { progress?: ProviderProgressHandler }): unknown {
  const state = createOpenAiStreamAccumulator(context)
  const consumed = consumeSseBlocks(text)
  for (const block of consumed.blocks) {
    consumeOpenAiStreamBlock(block, state)
  }
  if (consumed.pending.trim().length > 0) {
    consumeOpenAiStreamBlock(consumed.pending, state)
  }
  return finalizeOpenAiStreamAccumulator(state, context)
}

function consumeSseBlocks(text: string): { blocks: string[]; pending: string } {
  const normalized = text.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const pending = parts.pop() ?? ''
  return { blocks: parts, pending }
}

function consumeOpenAiStreamBlock(block: string, state: OpenAiStreamAccumulator): void {
  for (const data of extractSseDataLines(block)) {
    if (data === '[DONE]') continue
    let root: unknown
    try {
      root = JSON.parse(data)
    } catch {
      continue
    }
    if (!isRecord(root)) continue
    if (typeof root.id === 'string') state.id = root.id
    if (typeof root.model === 'string') state.model = root.model
    if (root.usage !== undefined) state.usage = root.usage
    const choice = Array.isArray(root.choices) && isRecord(root.choices[0]) ? root.choices[0] : null
    if (!choice) {
      appendSnapshotContent(state, 'root.content', stringValue(root.content))
      appendSnapshotContent(state, 'root.output_text', stringValue(root.output_text))
      appendSnapshotReasoning(state, 'root.reasoning_content', stringValue(root.reasoning_content))
      continue
    }
    if (typeof choice.finish_reason === 'string') state.finishReason = choice.finish_reason
    const delta = isRecord(choice.delta) ? choice.delta : {}
    appendStreamContent(state, stringValue(delta.content))
    appendStreamContent(state, stringValue(delta.text))
    appendStreamReasoning(state, stringValue(delta.reasoning_content))

    const message = isRecord(choice.message) ? choice.message : null
    if (message) {
      appendSnapshotContent(state, 'choice.message.content', stringValue(message.content))
      appendSnapshotReasoning(state, 'choice.message.reasoning_content', stringValue(message.reasoning_content))
    }
    appendSnapshotContent(state, 'choice.text', stringValue(choice.text))
    appendSnapshotContent(state, 'root.content', stringValue(root.content))
    appendSnapshotContent(state, 'root.output_text', stringValue(root.output_text))
    appendSnapshotReasoning(state, 'root.reasoning_content', stringValue(root.reasoning_content))
  }
}

function extractSseDataLines(block: string): string[] {
  const values: string[] = []
  for (const line of block.split('\n')) {
    const trimmedStart = line.trimStart()
    if (trimmedStart.startsWith('data:')) {
      const value = trimmedStart.slice('data:'.length).trim()
      if (value) values.push(value)
      continue
    }
    const trimmed = trimmedStart.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      values.push(trimmed)
    }
  }
  return values
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function appendSnapshotContent(state: OpenAiStreamAccumulator, key: string, value: string): void {
  const delta = snapshotDelta(state.contentSnapshots, key, value, state.content)
  appendStreamContent(state, delta)
}

function appendSnapshotReasoning(state: OpenAiStreamAccumulator, key: string, value: string): void {
  const delta = snapshotDelta(state.reasoningSnapshots, key, value, state.reasoningContent)
  appendStreamReasoning(state, delta)
}

function snapshotDelta(snapshots: Record<string, string>, key: string, value: string, current: string): string {
  if (value.length === 0) return ''
  const previous = snapshots[key] ?? ''
  snapshots[key] = value
  if (previous.length > 0 && value.startsWith(previous)) {
    return value.slice(previous.length)
  }
  if (previous === value || current.endsWith(value)) {
    return ''
  }
  return value
}

function appendStreamContent(state: OpenAiStreamAccumulator, delta: string): void {
  if (delta.length === 0) return
  state.content += delta
  emitProgress(state.context.progress, {
    phase: 'response',
    message: `Provider streamed ${state.content.length} content character(s).`,
    detail: {
      streamedContent: state.content,
      delta,
    },
  })
}

function appendStreamReasoning(state: OpenAiStreamAccumulator, delta: string): void {
  if (delta.length === 0) return
  state.reasoningContent += delta
  emitProgress(state.context.progress, {
    phase: 'response',
    message: `Provider streamed ${state.reasoningContent.length} reasoning character(s).`,
    detail: {
      reasoningContentLength: state.reasoningContent.length,
    },
  })
}

function finalizeOpenAiStreamAccumulator(state: OpenAiStreamAccumulator, context: ErrorContext): unknown {
  if (state.content.trim().length === 0 && state.reasoningContent.trim().length === 0) {
    return null
  }
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: state.content,
  }
  if (state.reasoningContent.trim().length > 0) {
    message.reasoning_content = state.reasoningContent
  }
  const root: Record<string, unknown> = {
    id: state.id ?? 'chatcmpl-stream',
    object: 'chat.completion',
    model: state.model ?? context.model?.id ?? 'unknown',
    choices: [{
      index: 0,
      finish_reason: state.finishReason ?? 'stop',
      message,
    }],
  }
  if (state.usage !== undefined) {
    root.usage = state.usage
  }
  return root
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
  if (isAbortError(error)) {
    return createError({
      code: 'AGENT_PROVIDER_CANCELLED',
      message: 'OpenAI-compatible provider request was cancelled before completion.',
      retryable: false,
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
    })
  }

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

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (!isRecord(error)) return false
  return error.name === 'AbortError'
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
