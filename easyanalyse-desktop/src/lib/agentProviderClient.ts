import { selfCheckBlueprintCandidates } from './agentTools'
import { selectAgentReferenceExamples, formatAgentReferenceExamplesForPrompt } from './agentExampleLibrary'
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
  maxToolIterations?: number
  validateDocument?: import('../types/agentTools').AgentToolContext['validateDocument']
  selfCheck?: {
    enabled: boolean
    repairOnIssues: boolean
    maxRepairAttempts: number
  }
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
  const examples = selectAgentReferenceExamples(input.prompt, input.currentDocument ?? null)
  if (examples.length > 0) {
    parts.push('', formatAgentReferenceExamplesForPrompt(examples))
  }
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
    operation: async ({ signal }) => {
      const selfCheckOptions = input.selfCheck ?? { enabled: true, repairOnIssues: true, maxRepairAttempts: 1 }
      const runOnce = async (nextUserPrompt: string): Promise<ProviderParseResult> => provider.kind === 'anthropic'
        ? runAnthropicProvider({
          provider,
          model,
          apiKey,
          systemPrompt,
          userPrompt: nextUserPrompt,
          currentDocument: input.currentDocument ?? null,
          generation: input.generation,
          fetch: fetchImpl as AnthropicFetch,
          signal,
        })
        : runOpenAiCompatibleProvider({
          provider,
          model,
          apiKey,
          systemPrompt,
          userPrompt: nextUserPrompt,
          currentDocument: input.currentDocument ?? null,
          generation: input.generation,
          fetch: fetchImpl as OpenAiCompatibleFetch,
          signal,
          maxToolIterations: input.maxToolIterations,
          validateDocument: input.validateDocument,
        })

      let checked = await applyPostProviderSelfCheck(await runOnce(userPrompt), selfCheckOptions, input.validateDocument)
      if (!selfCheckOptions.enabled || !selfCheckOptions.repairOnIssues || checked.response.kind !== 'blueprints') return checked

      const repairTrace = [...(checked.repairTrace ?? [])]
      for (let attempt = 1; attempt <= Math.max(0, selfCheckOptions.maxRepairAttempts); attempt += 1) {
        if (!blueprintResponseHasSelfCheckIssues(checked)) break
        const repairPrompt = buildSelfCheckRepairPrompt(input.prompt, checked)
        const repaired = await applyPostProviderSelfCheck(await runOnce(repairPrompt), { ...selfCheckOptions, repairOnIssues: false }, input.validateDocument)
        const repairedOk = repaired.response.kind === 'blueprints' && !blueprintResponseHasSelfCheckIssues(repaired)
        repairTrace.push({
          attempt,
          ok: repairedOk,
          summary: repairedOk ? 'Self-check repair attempt returned candidates without tool issues.' : 'Self-check repair attempt returned candidates that still need attention.',
        })
        checked = { ...repaired, repairTrace: [...(repaired.repairTrace ?? []), ...repairTrace] }
        if (repairedOk) break
      }
      return checked
    },
  })
}

async function applyPostProviderSelfCheck(
  result: ProviderParseResult,
  options: { enabled: boolean; repairOnIssues: boolean; maxRepairAttempts: number },
  validateDocument?: import('../types/agentTools').AgentToolContext['validateDocument'],
): Promise<ProviderParseResult> {
  if (!options.enabled || result.response.kind !== 'blueprints') return result
  const reports = await selfCheckBlueprintCandidates(result.response.blueprints, { validateDocument })
  result.response.blueprints.forEach((candidate, index) => {
    const selfCheck = reports[index]
    if (!selfCheck) return
    candidate.selfCheck = selfCheck
    candidate.toolIssues = selfCheck.candidates.flatMap((item) => [...item.validation.issues, ...item.layout.issues])
    candidate.issues = [...candidate.issues, ...candidate.toolIssues]
  })
  const trace = reports.map((report) => ({
    toolName: 'check_blueprint_candidate',
    ok: report.ok,
    summary: report.summary,
    issueCount: report.candidates.reduce((total, candidate) => total + candidate.issueCount, 0),
  }))
  return { ...result, toolTrace: [...(result.toolTrace ?? []), ...trace] }
}

function blueprintResponseHasSelfCheckIssues(result: ProviderParseResult): boolean {
  if (result.response.kind !== 'blueprints') return false
  return result.response.blueprints.some((candidate) =>
    candidate.selfCheck?.ok === false || (candidate.toolIssues?.length ?? 0) > 0,
  )
}

function buildSelfCheckRepairPrompt(originalPrompt: string, checked: ProviderParseResult): string {
  const reports = checked.response.kind === 'blueprints'
    ? checked.response.blueprints.map((candidate, index) => ({
      index,
      title: candidate.title,
      selfCheck: candidate.selfCheck,
      toolIssues: candidate.toolIssues,
    }))
    : []
  return [
    'The previous EasyAnalyse AgentResponse candidate did not fully pass local self-check.',
    'Return a complete corrected AgentResponse v1 JSON object only. Do not explain outside JSON.',
    'Keep semantic v4 connectivity expressed only by terminal labels. Do not add wires/nodes/junctions/signalId.',
    'Fix validation errors and move devices to remove layout overlap warnings when possible. Warnings do not block application, but you should improve the candidate.',
    '',
    `Original user request:\n${originalPrompt.trim()}`,
    '',
    'Machine-readable self-check reports:',
    JSON.stringify(reports),
  ].join('\n')
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
