import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type, type AssistantMessage, type Message, type Model, type TSchema } from '@earendil-works/pi-ai'
import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { runAgentTool } from './agentTools'
import type { AgentRuntimeDiagnostic, AgentRuntimeEventHandler, AgentRuntimeResult } from './agentRuntime'
import { diagnosticFromMessage } from './agentRuntime'
import { getErrorMessage } from './errors'
import {
  EASYANALYSE_BLUEPRINT_CANDIDATE_CONTRACT,
  EASYANALYSE_LAYOUT_AUTHORING_RULES,
  EASYANALYSE_SEMANTIC_V4_CONTRACT,
} from './agentSemanticPrompt'
import type { AgentToolRuntimeContext, AgentToolTraceEntry } from '../types/agentTools'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import type { AgentThreadMessage } from '../types/agentThread'
import type { DocumentFile } from '../types/document'
import type { AgentProviderPublicConfig } from '../types/settings'

const PI_VERSION = '0.84.1'
const DEFAULT_CONTEXT_WINDOW = 64_000
const DEFAULT_MAX_TOKENS = 8_000
const DEFAULT_MAX_TURNS = 8

export interface RunPiAgentInput extends AgentToolRuntimeContext {
  provider: AgentProviderPublicConfig
  modelId: string
  apiKey: string
  prompt: string
  currentDocument?: DocumentFile | null
  includeDocumentContext?: boolean
  threadMessages?: AgentThreadMessage[]
  requestId?: string
  signal?: AbortSignal
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
  maxTurns?: number
  onEvent?: AgentRuntimeEventHandler
  streamFn?: StreamFn
}

export interface RunPiAgentWithStreamInput extends RunPiAgentInput {
  streamFn: StreamFn
}

export async function runPiAgent(input: RunPiAgentInput): Promise<AgentRuntimeResult> {
  if (input.signal?.aborted) {
    input.onEvent?.({ type: 'run-cancelled', partialText: '' })
    input.onEvent?.({ type: 'assistant-final', text: '', status: 'cancelled' })
    return {
      runtime: 'pi',
      conversation: { text: '', status: 'cancelled' },
      issues: [],
      diagnostics: [],
      toolTrace: [],
      repairTrace: [],
      artifactsStoredByTools: false,
    }
  }
  const provider = input.provider
  const model = createPiModel(provider, input.modelId)
  const providerRuntime = createProvider({
    id: provider.id,
    name: provider.name,
    baseUrl: model.baseUrl,
    auth: {
      apiKey: {
        name: `${provider.name} API key`,
        resolve: async () => ({ auth: { apiKey: input.apiKey }, source: 'EasyAnalyse SecretStore' }),
      },
    },
    models: [model],
    api: model.api === 'anthropic-messages' ? anthropicMessagesApi() : openAICompletionsApi(),
  })

  const diagnostics: AgentRuntimeDiagnostic[] = []
  const toolTrace: AgentToolTraceEntry[] = []
  let conversationText = ''
  let turnCount = 0
  let storedBlueprintCount = 0
  const storedBlueprintIds = new Set<string>()
  const externalAbort = () => agent.abort()
  const maxTurns = Math.max(1, input.maxTurns ?? DEFAULT_MAX_TURNS)
  const runtimeContext = buildRuntimeContext(input)
  const tools = createPiTools(runtimeContext, input.onEvent, toolTrace, (count) => {
    storedBlueprintCount += count
  }, (ids) => {
    ids.forEach((id) => storedBlueprintIds.add(id))
  })
  const history = convertThreadMessages(input.threadMessages ?? [])

  const agent = new Agent({
    initialState: {
      systemPrompt: buildPiSystemPrompt(input),
      model,
      tools,
      messages: history,
      thinkingLevel: 'off',
    },
    streamFn: input.streamFn ?? ((activeModel, context, options) => providerRuntime.streamSimple(activeModel as typeof model, context, {
        ...options,
        apiKey: input.apiKey,
        fetch: input.fetchImpl,
        timeoutMs: input.timeoutMs,
        maxRetries: 0,
      })),
    toolExecution: 'sequential',
    sessionId: input.requestId,
    shouldStopAfterTurn: () => {
      turnCount += 1
      const shouldStop = turnCount >= maxTurns
      if (shouldStop) {
        const diagnostic = diagnosticFromMessage(
          'runtime',
          `Pi Agent stopped after ${maxTurns} turn(s) to enforce the EasyAnalyse run limit.`,
          'warning',
          'agent_runtime.turn_limit',
        )
        diagnostics.push(diagnostic)
        input.onEvent?.({ type: 'diagnostic', diagnostic })
      }
      return shouldStop
    },
  })

  agent.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      const delta = event.assistantMessageEvent.delta
      conversationText += delta
      input.onEvent?.({ type: 'assistant-delta', text: delta })
      return
    }
    if (event.type === 'tool_execution_start') {
      input.onEvent?.({ type: 'tool-started', toolName: event.toolName, toolCallId: event.toolCallId })
      return
    }
    if (event.type === 'tool_execution_end' && event.isError) {
      const summary = toolResultText(event.result) || `Pi Agent could not execute ${event.toolName}.`
      toolTrace.push({ toolName: event.toolName, ok: false, summary, issueCount: 1 })
      input.onEvent?.({
        type: 'tool-finished',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        ok: false,
        summary,
        issueCount: 1,
      })
      const diagnostic = diagnosticFromMessage('tool', summary, 'warning', 'agent_runtime.tool_execution_failed')
      diagnostics.push(diagnostic)
      input.onEvent?.({ type: 'diagnostic', diagnostic })
      return
    }
    if (event.type === 'message_end' && event.message.role === 'assistant' && !conversationText.trim()) {
      const text = assistantText(event.message)
      if (text) conversationText = text
    }
  })

  input.signal?.addEventListener('abort', externalAbort, { once: true })
  try {
    await agent.prompt(input.prompt)
  } finally {
    input.signal?.removeEventListener('abort', externalAbort)
  }

  const lastAssistant = [...agent.state.messages].reverse().find((message): message is AssistantMessage => message.role === 'assistant')
  const fallbackText = lastAssistant ? assistantText(lastAssistant) : ''
  if (!conversationText.trim() && fallbackText) conversationText = fallbackText
  const status = input.signal?.aborted || lastAssistant?.stopReason === 'aborted'
    ? 'cancelled'
    : lastAssistant?.stopReason === 'error'
      ? (conversationText.trim() ? 'partial' : 'error')
      : conversationText.trim()
        ? 'complete'
        : 'error'

  if (lastAssistant?.errorMessage) {
    const diagnostic = diagnosticFromMessage(
      'provider',
      lastAssistant.errorMessage,
      'error',
      lastAssistant.stopReason === 'aborted' ? 'agent_runtime.cancelled' : 'agent_runtime.provider_error',
    )
    diagnostics.push(diagnostic)
    input.onEvent?.({ type: 'diagnostic', diagnostic })
  }

  const terminalText = conversationText.trim()
  if (status === 'cancelled') input.onEvent?.({ type: 'run-cancelled', partialText: terminalText })
  else if (status === 'error') input.onEvent?.({ type: 'run-error', message: lastAssistant?.errorMessage ?? 'Pi Agent returned no visible text.', partialText: terminalText })
  input.onEvent?.({ type: 'assistant-final', text: terminalText, status })
  storedBlueprintCount = storedBlueprintIds.size || storedBlueprintCount

  return {
    runtime: 'pi',
    conversation: { text: terminalText, status },
    providerText: terminalText,
    issues: [],
    diagnostics,
    toolTrace,
    repairTrace: [],
    artifactsStoredByTools: storedBlueprintCount > 0,
  }
}

export function runPiAgentWithStream(input: RunPiAgentWithStreamInput): Promise<AgentRuntimeResult> {
  return runPiAgent(input)
}

export function createPiModel(provider: AgentProviderPublicConfig, modelId: string): Model<'openai-completions' | 'anthropic-messages'> {
  const api = provider.kind === 'anthropic' ? 'anthropic-messages' : 'openai-completions'
  return {
    id: modelId,
    name: modelId,
    api,
    provider: provider.id,
    baseUrl: normalizePiBaseUrl(provider.baseUrl, api),
    reasoning: provider.kind === 'deepseek' || /reason|think/i.test(modelId),
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    ...(api === 'openai-completions'
      ? {
          compat: {
            supportsStrictMode: false,
            requiresReasoningContentOnAssistantMessages: provider.kind === 'deepseek',
            thinkingFormat: provider.kind === 'deepseek' ? 'deepseek' as const : 'openai' as const,
          },
        }
      : {}),
  }
}

export function createPiTools(
  context: AgentToolRuntimeContext,
  onEvent?: AgentRuntimeEventHandler,
  toolTrace: AgentToolTraceEntry[] = [],
  onBlueprintStored?: (count: number) => void,
  onBlueprintIds?: (ids: string[]) => void,
): AgentTool[] {
  return [
    createTool('get_current_document', 'Read the current EasyAnalyse semantic-v4 document.', Type.Object({}, { additionalProperties: false }), context, onEvent, toolTrace),
    createTool('summarize_topology', 'Summarize circuit topology from the current document.', Type.Object({}, { additionalProperties: false }), context, onEvent, toolTrace),
    createTool(
      'create_blueprint_candidate',
      'Validate and store exactly one complete EasyAnalyse blueprint candidate. This is the only way to submit a circuit artifact.',
      Type.Object({
        candidate: Type.Object({
          title: Type.String(),
          summary: Type.String(),
          rationale: Type.String(),
          tradeoffs: Type.Array(Type.String()),
          document: createPiDocumentSchema(),
          highlightedLabels: Type.Optional(Type.Array(Type.String())),
          notes: Type.Optional(Type.Array(Type.String())),
          issues: Type.Array(createPiValidationIssueSchema()),
        }, { additionalProperties: true }),
      }, { additionalProperties: false }),
      context,
      onEvent,
      toolTrace,
      (result) => {
        const ids = extractBlueprintIds(result.data)
        if (result.ok && ids.length > 0) {
          onBlueprintStored?.(ids.length)
          onBlueprintIds?.(ids)
          onEvent?.({ type: 'artifact-created', artifactType: 'blueprint', ids, summary: result.summary })
        } else if (!result.ok) {
          onEvent?.({ type: 'artifact-rejected', artifactType: 'blueprint', summary: result.summary })
        }
      },
    ),
  ]
}

function createTool(
  name: 'get_current_document' | 'summarize_topology' | 'create_blueprint_candidate',
  description: string,
  parameters: TSchema,
  context: AgentToolRuntimeContext,
  onEvent: AgentRuntimeEventHandler | undefined,
  toolTrace: AgentToolTraceEntry[],
  afterResult?: (result: Awaited<ReturnType<typeof runAgentTool>>) => void,
): AgentTool {
  return {
    name,
    label: name,
    description,
    parameters,
    executionMode: 'sequential',
    execute: async (toolCallId, params) => {
      const result = await runAgentTool(name, params, context)
      toolTrace.push({ toolName: name, ok: result.ok, summary: result.summary, issueCount: result.issueCount })
      afterResult?.(result)
      onEvent?.({
        type: 'tool-finished',
        toolName: name,
        toolCallId,
        ok: result.ok,
        summary: result.summary,
        issueCount: result.issueCount,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      }
    },
  }
}

function buildRuntimeContext(input: RunPiAgentInput): AgentToolRuntimeContext {
  return {
    currentDocument: input.currentDocument ?? null,
    getCurrentDocument: input.getCurrentDocument,
    blueprintWorkspace: input.blueprintWorkspace,
    getBlueprintWorkspace: input.getBlueprintWorkspace,
    selectedBlueprintId: input.selectedBlueprintId,
    getSelectedBlueprintId: input.getSelectedBlueprintId,
    currentSelection: input.currentSelection,
    getCurrentSelection: input.getCurrentSelection,
    getEditorFocus: input.getEditorFocus,
    getEasyAnalyseFormatRules: input.getEasyAnalyseFormatRules,
    validateDocument: input.validateDocument,
    userRequest: input.prompt,
    reviewCircuitCorrectness: input.reviewCircuitCorrectness,
    createBlueprintCandidate: input.createBlueprintCandidate,
  }
}

export function buildPiSystemPrompt(input: RunPiAgentInput): string {
  return [
    `You are the EasyAnalyse circuit agent running on Pi ${PI_VERSION}.`,
    'Reply to the user in normal readable text. Do not wrap the whole answer in AgentResponse JSON.',
    'Never mutate the main document directly.',
    'When the request requires a circuit artifact, create one complete semantic-v4 candidate and submit it through create_blueprint_candidate.',
    'Do not print a Blueprint or DocumentFile as a substitute for calling create_blueprint_candidate.',
    EASYANALYSE_SEMANTIC_V4_CONTRACT,
    EASYANALYSE_LAYOUT_AUTHORING_RULES,
    EASYANALYSE_BLUEPRINT_CANDIDATE_CONTRACT,
    'If create_blueprint_candidate rejects a candidate, use its hard-format diagnostics to correct the candidate and call the tool again. Do not hide the failure by printing raw JSON in the conversation.',
    'Use get_current_document when exact current state matters and summarize_topology when topology context is sufficient.',
    input.includeDocumentContext && input.currentDocument
      ? `Current semantic-v4 document JSON:\n${JSON.stringify(input.currentDocument)}`
      : 'The full current document was not included. Ask before inventing hidden state if the tools are insufficient.',
  ].join('\n')
}

function createPiDocumentSchema(): TSchema {
  const extensions = () => Type.Record(Type.String(), Type.Any())
  const point = () => Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false })
  return Type.Object({
    schemaVersion: Type.Literal('4.0.0'),
    document: Type.Object({
      id: Type.String(),
      title: Type.String(),
      description: Type.Optional(Type.String()),
      createdAt: Type.Optional(Type.String()),
      updatedAt: Type.Optional(Type.String()),
      source: Type.Optional(Type.Union([
        Type.Literal('human'),
        Type.Literal('ai'),
        Type.Literal('mixed'),
        Type.Literal('imported'),
      ])),
      language: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      extensions: Type.Optional(extensions()),
    }, { additionalProperties: false }),
    devices: Type.Array(Type.Object({
      id: Type.String(),
      name: Type.String(),
      kind: Type.String(),
      category: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      reference: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      properties: Type.Optional(Type.Object({
        value: Type.Optional(Type.String()),
        voltage: Type.Optional(Type.String()),
        outputVoltage: Type.Optional(Type.String()),
        nominalVoltage: Type.Optional(Type.String()),
        frequency: Type.Optional(Type.String()),
        partNumber: Type.Optional(Type.String()),
        package: Type.Optional(Type.String()),
        topology: Type.Optional(Type.String()),
      }, { additionalProperties: true })),
      terminals: Type.Array(Type.Object({
        id: Type.String(),
        name: Type.String(),
        label: Type.Optional(Type.String()),
        direction: Type.Union([Type.Literal('input'), Type.Literal('output')]),
        role: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        pin: Type.Optional(Type.Object({
          number: Type.Optional(Type.String()),
          name: Type.Optional(Type.String()),
          bank: Type.Optional(Type.String()),
          extensions: Type.Optional(extensions()),
        }, { additionalProperties: false })),
        required: Type.Optional(Type.Boolean()),
        side: Type.Optional(Type.Union([
          Type.Literal('left'),
          Type.Literal('right'),
          Type.Literal('top'),
          Type.Literal('bottom'),
          Type.Literal('auto'),
        ])),
        order: Type.Optional(Type.Number()),
        extensions: Type.Optional(extensions()),
      }, { additionalProperties: false })),
      extensions: Type.Optional(extensions()),
    }, { additionalProperties: false })),
    view: Type.Object({
      canvas: Type.Object({
        units: Type.Literal('px'),
        grid: Type.Optional(Type.Object({
          enabled: Type.Boolean(),
          size: Type.Number(),
          majorEvery: Type.Optional(Type.Number()),
        }, { additionalProperties: false })),
        background: Type.Optional(Type.Literal('grid')),
        extensions: Type.Optional(extensions()),
      }, { additionalProperties: false }),
      devices: Type.Optional(Type.Record(Type.String(), Type.Object({
        position: Type.Optional(point()),
        size: Type.Optional(Type.Object({ width: Type.Number(), height: Type.Number() }, { additionalProperties: false })),
        rotationDeg: Type.Optional(Type.Number()),
        shape: Type.Optional(Type.Union([Type.Literal('rectangle'), Type.Literal('circle'), Type.Literal('triangle')])),
        locked: Type.Optional(Type.Boolean()),
        collapsed: Type.Optional(Type.Boolean()),
        groupId: Type.Optional(Type.String()),
        extensions: Type.Optional(extensions()),
      }, { additionalProperties: false }))),
      networkLines: Type.Optional(Type.Record(Type.String(), Type.Object({
        label: Type.String(),
        position: point(),
        length: Type.Optional(Type.Number()),
        orientation: Type.Optional(Type.Union([Type.Literal('horizontal'), Type.Literal('vertical')])),
        extensions: Type.Optional(extensions()),
      }, { additionalProperties: false }))),
      focus: Type.Optional(Type.Object({
        defaultDeviceId: Type.Optional(Type.String()),
        preferredDirection: Type.Optional(Type.Union([
          Type.Literal('left-to-right'),
          Type.Literal('top-to-bottom'),
          Type.Literal('auto'),
        ])),
        extensions: Type.Optional(extensions()),
      }, { additionalProperties: false })),
      extensions: Type.Optional(extensions()),
    }, { additionalProperties: false }),
    extensions: Type.Optional(extensions()),
  }, { additionalProperties: false })
}

function createPiValidationIssueSchema(): TSchema {
  return Type.Object({
    severity: Type.Union([Type.Literal('error'), Type.Literal('warning')]),
    code: Type.String(),
    message: Type.String(),
    entityId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    path: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    details: Type.Optional(Type.Any()),
  }, { additionalProperties: false })
}

function convertThreadMessages(messages: AgentThreadMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    if (message.role === 'user') return [{ role: 'user', content: message.content, timestamp: timestamp(message.createdAt) }]
    if (message.role === 'assistant') return [{
      role: 'assistant',
      content: [{ type: 'text', text: message.content }],
      api: 'pi-messages',
      provider: 'easyanalyse-history',
      model: 'thread-v1',
      usage: emptyUsage(),
      stopReason: 'stop',
      timestamp: timestamp(message.createdAt),
    }]
    return []
  })
}

function assistantText(message: AssistantMessage): string {
  return message.content.filter((item) => item.type === 'text').map((item) => item.text).join('').trim()
}

function toolResultText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .filter((item): item is { type: 'text'; text: string } => (
      Boolean(item) && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
        && typeof (item as { text?: unknown }).text === 'string'
    ))
    .map((item) => item.text)
    .join('\n')
    .trim()
}

function normalizePiBaseUrl(baseUrl: string, api: 'openai-completions' | 'anthropic-messages'): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (api === 'anthropic-messages') return trimmed.replace(/\/v1\/messages$/i, '').replace(/\/v1$/i, '')
  return trimmed.replace(/\/chat\/completions$/i, '')
}

function extractBlueprintIds(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []
  const direct = (data as { blueprintIds?: unknown }).blueprintIds
  if (Array.isArray(direct)) return direct.filter((item): item is string => typeof item === 'string')
  const nestedResult = (data as { result?: unknown }).result
  if (!nestedResult || typeof nestedResult !== 'object') return []
  const blueprintIds = (nestedResult as { blueprintIds?: unknown }).blueprintIds
  return Array.isArray(blueprintIds) ? blueprintIds.filter((item): item is string => typeof item === 'string') : []
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

export function piRuntimeErrorResult(error: unknown, partialText = ''): AgentRuntimeResult {
  const message = getErrorMessage(error)
  return {
    runtime: 'pi',
    conversation: { text: partialText, status: partialText ? 'partial' : 'error' },
    providerText: partialText,
    issues: [],
    diagnostics: [diagnosticFromMessage('runtime', message, 'error', 'agent_runtime.exception')],
    toolTrace: [],
    repairTrace: [],
    artifactsStoredByTools: false,
  }
}
