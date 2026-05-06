import { runAnthropicProvider, type AnthropicFetch } from './anthropicProvider'
import { checkAgentContextBudget, runProviderWithControls, type ProviderRetryOptions } from './agentProviderRuntime'
import {
  AgentProviderError,
  runOpenAiCompatibleProvider,
  type AgentModelConfig,
  type AgentProviderConfig,
  type OpenAiCompatibleFetch,
  type ProviderGenerationOptions,
  type ProviderParseResult,
} from './openAiCompatibleProvider'
import type { DocumentFile } from '../types/document'
import type { AgentProviderPublicConfig } from '../types/settings'

export interface RunConfiguredAgentProviderInput {
  provider: AgentProviderPublicConfig
  modelId: string
  apiKey: string
  prompt: string
  currentDocument?: DocumentFile | null
  includeDocumentContext?: boolean
  requestId?: string
  signal?: AbortSignal
  timeoutMs?: number
  retry?: ProviderRetryOptions
  generation?: ProviderGenerationOptions
  fetchImpl?: OpenAiCompatibleFetch | AnthropicFetch
}

export const DEFAULT_AGENT_PROVIDER_TIMEOUT_MS = 60_000
export const DEFAULT_AGENT_MODEL_CONTEXT_WINDOW = 64_000
export const DEFAULT_AGENT_RESERVED_OUTPUT_TOKENS = 8_000

const DEFAULT_RETRY: ProviderRetryOptions = {
  maxAttempts: 1,
}

export function buildAgentSystemPrompt(): string {
  return [
    'You are the EasyAnalyse desktop circuit blueprint agent.',
    'Return exactly one JSON object and no markdown fences or extra prose.',
    'The JSON object MUST be an AgentResponse with schemaVersion "agent-response-v1" and semanticVersion "easyanalyse-semantic-v4".',
    'Allowed kind values: message, question, error, blueprints, patch.',
    'For circuit generation or modification, prefer kind "blueprints" and return one or more complete semantic v4 DocumentFile candidates.',
    'Never mutate the main document directly. All circuit changes must be represented as blueprint candidates.',
    'Semantic v4 rules: connectivity is expressed only by terminal labels; view.networkLines are visual summaries only; do not create wires, wire, nodes, node, junctions, bend points, signalId, or arbitrary terminal coordinates.',
    'Each blueprint document MUST use schemaVersion "4.0.0" and terminal direction values only "input" or "output".',
    'For kind "blueprints", the top-level "blueprints" property MUST be an array, even when returning exactly one candidate. Never use a singular "blueprint" object.',
    'Each candidate MUST include title, summary, rationale, tradeoffs array, complete document, and issues array. Use view.canvas.units "px".',
    'Blueprints may intentionally contain issues for user/AI reference; include any concerns in candidate.issues or notes instead of refusing.',
    'Minimal valid response skeleton: {"schemaVersion":"agent-response-v1","semanticVersion":"easyanalyse-semantic-v4","kind":"blueprints","summary":"...","blueprints":[{"title":"...","summary":"...","rationale":"...","tradeoffs":[],"document":{"schemaVersion":"4.0.0","document":{"id":"...","title":"...","createdAt":"...","updatedAt":"..."},"devices":[],"view":{"canvas":{"units":"px","grid":{"enabled":true,"size":16}},"devices":{},"networkLines":{}}},"issues":[]}]}.',
  ].join('\n')
}

export function buildAgentUserPrompt(input: {
  prompt: string
  currentDocument?: DocumentFile | null
  includeDocumentContext?: boolean
  requestId?: string
}): string {
  const parts = [
    `User request:\n${input.prompt.trim()}`,
    '',
    `Request id: ${input.requestId ?? 'agent-panel'}`,
  ]
  if (input.includeDocumentContext && input.currentDocument) {
    parts.push('', 'Current EasyAnalyse semantic v4 document JSON:', JSON.stringify(input.currentDocument))
  } else {
    parts.push('', 'Current document JSON was not included. If modification requires existing circuit details, ask a question instead of inventing hidden state.')
  }
  return parts.join('\n')
}

export async function runConfiguredAgentProvider(input: RunConfiguredAgentProviderInput): Promise<ProviderParseResult> {
  const provider = normalizeProviderConfig(input.provider)
  const model = normalizeModelConfig(input.modelId, provider)
  const apiKey = input.apiKey.trim()
  if (!apiKey) {
    throw new AgentProviderError({
      code: 'AGENT_PROVIDER_AUTH_FAILED',
      message: 'Configured provider API key is empty.',
      retryable: false,
      providerId: provider.id,
      modelId: model.id,
    })
  }

  const systemPrompt = buildAgentSystemPrompt()
  const userPrompt = buildAgentUserPrompt({
    prompt: input.prompt,
    currentDocument: input.currentDocument ?? null,
    includeDocumentContext: input.includeDocumentContext,
    requestId: input.requestId,
  })
  const documentText = ''
  checkAgentContextBudget({
    systemPrompt,
    userPrompt,
    documentText,
    modelContextWindow: DEFAULT_AGENT_MODEL_CONTEXT_WINDOW,
    reservedOutputTokens: DEFAULT_AGENT_RESERVED_OUTPUT_TOKENS,
    redactions: [apiKey],
  })

  const fetchImpl = input.fetchImpl ?? getWindowFetch()

  return runProviderWithControls({
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? DEFAULT_AGENT_PROVIDER_TIMEOUT_MS,
    retry: input.retry ?? DEFAULT_RETRY,
    redactions: [apiKey],
    providerId: provider.id,
    modelId: model.id,
    operation: ({ signal }) => {
      if (provider.kind === 'anthropic') {
        return runAnthropicProvider({
          provider,
          model,
          apiKey,
          systemPrompt,
          userPrompt,
          currentDocument: input.currentDocument ?? null,
          generation: input.generation,
          fetch: fetchImpl as AnthropicFetch,
          signal,
        })
      }
      return runOpenAiCompatibleProvider({
        provider,
        model,
        apiKey,
        systemPrompt,
        userPrompt,
        currentDocument: input.currentDocument ?? null,
        generation: input.generation,
        fetch: fetchImpl as OpenAiCompatibleFetch,
        signal,
      })
    },
  })
}

function normalizeProviderConfig(provider: AgentProviderPublicConfig): AgentProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    models: provider.models,
    defaultModel: provider.defaultModel,
    apiKeyRef: provider.apiKeyRef,
  }
}

function normalizeModelConfig(modelId: string, provider: AgentProviderConfig): AgentModelConfig {
  const id = modelId.trim() || provider.defaultModel || provider.models?.[0]
  if (!id?.trim()) {
    throw new AgentProviderError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: `Provider ${provider.id} has no selected model.`,
      retryable: false,
      providerId: provider.id,
    })
  }
  return { id: id.trim() }
}

function getWindowFetch(): OpenAiCompatibleFetch | AnthropicFetch {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    throw new AgentProviderError({
      code: 'AGENT_PROVIDER_CONFIGURATION_ERROR',
      message: 'Provider requests require a browser fetch implementation.',
      retryable: false,
    })
  }
  return window.fetch.bind(window) as OpenAiCompatibleFetch | AnthropicFetch
}
