import { extractAgentResponseText } from './agentResponseText'
import { getAgentToolSchemas, runAgentTool } from './agentTools'
import { getErrorMessage as errorMessage } from './errors'
import { isRecord } from './guards'
import type { AgentResponseParseResult } from '../types/agent'
import type { AgentToolExecutor, AgentToolRuntimeContext, AgentToolTraceEntry } from '../types/agentTools'
import type { DocumentFile, ValidationIssue } from '../types/document'
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
  rawText?: string
  conversationText?: string
  conversationStatus?: 'complete' | 'partial'
  diagnostics?: string[]
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
    temperature: input.generation?.temperature ?? DEFAULT_TEMPERATURE,
    top_p: input.generation?.topP ?? DEFAULT_TOP_P,
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
  const extracted = getAssistantContent(firstChoice, input)
  const metadata = buildResponseMetadata(root, firstChoice, input)

  const parsed = extractAgentResponseText(extracted.text, { mainDocument: input.mainDocument ?? null })
  return { ...parsed, metadata, diagnostics: [...parsed.diagnostics, ...extracted.diagnostics] }
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
  const replayReasoningContent = shouldReplayReasoningContent(input.provider, input.model)
  const receivedAssistantTexts: string[] = []
  const receivedContentDiagnostics: string[] = []
  let lastResponseMetadata: ProviderResponseMetadata | undefined

  for (let step = 0; step <= maxToolIterations + MAX_FINALIZATION_ATTEMPTS; step += 1) {
    const allowTools = toolIterations < maxToolIterations && finalizationAttempts === 0
    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: false,
    }
    applyOpenAiCompatibleGenerationOptions(body, input, { jsonOnly: !allowTools })
    if (allowTools) {
      body.tools = getAgentToolSchemas()
      body.tool_choice = 'auto'
    } else {
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
    let response: Awaited<ReturnType<typeof performOpenAiRequest>>
    let root: JsonRecord
    let choice: JsonRecord
    try {
      response = await performOpenAiRequest(input, request)
      root = parseOpenAiRoot(response.body, { responseBody: response.body, provider: input.provider, model: input.model, status: response.status })
      choice = getFirstChoice(root, { responseBody: response.body, provider: input.provider, model: input.model, status: response.status })
      lastResponseMetadata = buildResponseMetadata(root, choice, {
        responseBody: response.body,
        provider: input.provider,
        model: input.model,
        status: response.status,
      })
    } catch (error) {
      const fallback = buildReceivedTextFallback(receivedAssistantTexts, error, input, toolTrace, lastResponseMetadata)
      if (fallback) return fallback
      throw error
    }
    const assistantMessage = isRecord(choice.message) ? choice.message : null
    const assistantContent = assistantMessage ? extractAssistantContent(assistantMessage.content) : { text: '', diagnostics: [] }
    const assistantText = assistantContent.text.trim()
    if (assistantText) receivedAssistantTexts.push(assistantText)
    receivedContentDiagnostics.push(...assistantContent.diagnostics)
    const toolCalls = Array.isArray(assistantMessage?.tool_calls) ? assistantMessage.tool_calls : []
    emitProgress(input.progress, describeOpenAiResponseProgress(choice, assistantMessage, toolCalls, response.status))
    if (toolCalls.length > 0 && !allowTools) {
      const error = createError({
        code: 'AGENT_PROVIDER_PROTOCOL_ERROR',
        message: `OpenAI-compatible provider requested tool calls after the configured tool iteration limit (${maxToolIterations}). Increase the limit or ask for a simpler blueprint.`,
        retryable: false,
        status: response.status,
        provider: input.provider,
        model: input.model,
      })
      const fallback = buildReceivedTextFallback(receivedAssistantTexts, error, input, toolTrace, lastResponseMetadata)
      if (fallback) return fallback
      throw error
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
        const toolResult = parsedArgs.ok
          ? await toolExecutor(normalized.name, parsedArgs.value, buildToolRuntimeContext(input))
          : await toolExecutor(normalized.name, {}, buildToolRuntimeContext(input))
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
          message: `Hard format tool reported ${hardFormatIssueCount} issue${hardFormatIssueCount === 1 ? '' : 's'}${issueSummary ? ` (${issueSummary})` : ''}; returning repair context to the model.`,
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
          content: [
            'Your previous response was not a valid single AgentResponse JSON object.',
            'If your previous response only contained reasoning_content, convert the result into the final JSON now.',
            'Do not think through the problem again. Do not call tools. Start output immediately with the JSON object.',
            'Return exactly one JSON object now: schemaVersion="agent-response-v1", semanticVersion="easyanalyse-semantic-v4".',
            'For kind="blueprints", blueprints MUST be an array containing at least one complete candidate.',
            'Do not include markdown, prose, multiple JSON objects, or text before/after JSON.',
          ].join('\n'),
        })
        continue
      }
      if (hasMissingAssistantContent(assistantMessage)) {
        const error = createError({
          code: 'AGENT_PROVIDER_PROTOCOL_ERROR',
          message: `OpenAI-compatible provider did not return final AgentResponse content after ${MAX_FINALIZATION_ATTEMPTS} finalization attempt(s). ${describeAssistantContentState(assistantMessage, choice)}`,
          retryable: false,
          status: response.status,
          provider: input.provider,
          model: input.model,
        })
        const fallback = buildReceivedTextFallback(receivedAssistantTexts, error, input, toolTrace, lastResponseMetadata)
        if (fallback) return fallback
        throw error
      }
      const fallback = buildReceivedTextFallback(receivedAssistantTexts, error, input, toolTrace, lastResponseMetadata)
      if (fallback) return fallback
      throw error
    }
    const finalHardFormatDiagnostics = await collectKnownHardFormatFailureDiagnostics(parsed, {
      lastHardFormatIssueCount,
      status: response.status,
      provider: input.provider,
      model: input.model,
      input,
    })
    emitProgress(input.progress, { phase: 'complete', message: 'Provider response completed.', detail: { kind: parsed.response.kind } })
    return {
      ...parsed,
      rawText: receivedAssistantTexts.length > 1 ? receivedAssistantTexts.join('\n\n') : parsed.rawText,
      conversationText: mergeVisibleAssistantTexts(receivedAssistantTexts, parsed.conversationText ?? ''),
      diagnostics: uniqueDiagnostics([
        ...(parsed.diagnostics ?? []),
        ...receivedContentDiagnostics,
        ...finalHardFormatDiagnostics,
      ]),
      toolTrace,
    }
  }

  const error = createError({
    code: 'AGENT_PROVIDER_PROTOCOL_ERROR',
    message: 'OpenAI-compatible provider did not return final AgentResponse content after tool calling iterations.',
    retryable: false,
    provider: input.provider,
    model: input.model,
  })
  const fallback = buildReceivedTextFallback(receivedAssistantTexts, error, input, toolTrace, lastResponseMetadata)
  if (fallback) return fallback
  throw error
}

function uniqueDiagnostics(messages: string[]): string[] {
  return [...new Set(messages.filter(Boolean))]
}

function buildReceivedTextFallback(
  receivedAssistantTexts: string[],
  error: unknown,
  input: OpenAiCompatibleRunInput,
  toolTrace: AgentToolTraceEntry[],
  metadata?: ProviderResponseMetadata,
): ProviderParseResult | null {
  const text = receivedAssistantTexts.filter((item) => item.trim()).join('\n\n').trim()
  if (!text) return null
  const message = errorMessage(error)
  emitProgress(input.progress, {
    phase: 'complete',
    message: 'Provider run ended after returning assistant text; preserving the received text as a partial response.',
    detail: { partial: true, error: message },
  })
  return {
    ok: true,
    response: {
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'Partial provider response',
      markdown: text,
    },
    issues: [],
    metadata: metadata ?? {
      adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
      requestFormat: OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT,
      providerId: input.provider.id,
      modelId: input.model.id,
    },
    rawText: text,
    conversationText: text,
    conversationStatus: 'partial',
    diagnostics: [`Provider execution did not finish normally; preserved all received assistant text. ${message}`],
    toolTrace,
  }
}

function applyOpenAiCompatibleGenerationOptions(
  body: Record<string, unknown>,
  input: ProviderBuildInput,
  options: { jsonOnly: boolean },
): void {
  const deepSeekV4 = isDeepSeekV4Model(input.provider, input.model)
  if (!deepSeekV4 || input.generation?.temperature !== undefined) {
    body.temperature = input.generation?.temperature ?? DEFAULT_TEMPERATURE
  }
  if (!deepSeekV4 || input.generation?.topP !== undefined) {
    body.top_p = input.generation?.topP ?? DEFAULT_TOP_P
  }

  body.max_tokens = input.generation?.maxTokens ?? (deepSeekV4 ? DEEPSEEK_V4_DEFAULT_MAX_TOKENS : DEFAULT_MAX_TOKENS)

  if (!deepSeekV4) return
  if (options.jsonOnly) {
    body.thinking = { type: 'disabled' }
  } else {
    body.reasoning_effort = 'high'
  }
}

function isDeepSeekV4Model(provider: AgentProviderConfig, model: AgentModelConfig): boolean {
  return provider.kind === 'deepseek' && /^deepseek-v4-/i.test(model.id.trim())
}

function shouldReplayReasoningContent(provider: AgentProviderConfig, model: AgentModelConfig): boolean {
  return isDeepSeekV4Model(provider, model)
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
    ...(input.userRequest !== undefined ? { userRequest: input.userRequest } : {}),
    ...(input.reviewCircuitCorrectness ? { reviewCircuitCorrectness: input.reviewCircuitCorrectness } : {}),
    ...(input.validateDocument ? { validateDocument: input.validateDocument } : {}),
    ...(input.createBlueprintCandidate ? { createBlueprintCandidate: input.createBlueprintCandidate } : {}),
  }
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
    `A hard EasyAnalyse format tool reported ${state.issueCount} issue${state.issueCount === 1 ? '' : 's'} on tool round ${state.toolIterations}/${state.maxToolIterations}.`,
    'Repair hard format errors before returning or creating a blueprint candidate.',
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

async function collectKnownHardFormatFailureDiagnostics(
  parsed: ProviderParseResult,
  state: {
    lastHardFormatIssueCount: number | null
    status: number
    provider: AgentProviderConfig
    model: AgentModelConfig
    input: OpenAiCompatibleRunInput
  },
): Promise<string[]> {
  if (parsed.response.kind !== 'blueprints' || state.lastHardFormatIssueCount === null || state.lastHardFormatIssueCount === 0) return []
  const finalHardFormatIssues = await collectFinalBlueprintHardFormatIssues(parsed, state.input)
  if (finalHardFormatIssues.length === 0) return []

  const issueSummary = summarizeIssueCodes(finalHardFormatIssues)
  const issueLines = finalHardFormatIssues.slice(0, 8).map(formatIssueLine)
  return [[
      `OpenAI-compatible provider returned blueprints after a hard format tool reported ${state.lastHardFormatIssueCount} unresolved issue(s), and the final blueprint hard format check still found ${finalHardFormatIssues.length} issue(s).`,
      issueSummary ? `Issue groups: ${issueSummary}.` : '',
      issueLines.length > 0 ? `First issues: ${issueLines.join(' | ')}` : '',
    ].filter(Boolean).join(' ')]
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

function getAssistantContent(choice: JsonRecord, input: ProviderParseInput): { text: string; diagnostics: string[] } {
  if (!isRecord(choice.message)) {
    throw protocolError('OpenAI-compatible provider response did not include choices[0].message.content.', input)
  }
  const extracted = extractAssistantContent(choice.message.content)
  if (!extracted.text.trim()) {
    throw protocolError('OpenAI-compatible provider response did not include a non-empty choices[0].message.content string.', input)
  }
  return extracted
}

function extractAssistantContent(content: unknown): { text: string; diagnostics: string[] } {
  if (typeof content === 'string') return { text: content, diagnostics: [] }
  if (!Array.isArray(content)) return { text: '', diagnostics: [] }
  const chunks: string[] = []
  let ignoredCount = 0
  for (const part of content) {
    if (typeof part === 'string') {
      chunks.push(part)
      continue
    }
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      chunks.push(part.text)
      continue
    }
    ignoredCount += 1
  }
  return {
    text: chunks.join(''),
    diagnostics: ignoredCount > 0
      ? [`Ignored ${ignoredCount} unsupported OpenAI-compatible assistant content block(s) while preserving text blocks.`]
      : [],
  }
}

function mergeVisibleAssistantTexts(received: string[], finalText: string): string {
  const texts = received.map((item) => item.trim()).filter(Boolean)
  if (texts.length <= 1) return finalText
  const prior = texts.slice(0, -1)
  return [...prior, finalText].filter(Boolean).join('\n\n')
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
