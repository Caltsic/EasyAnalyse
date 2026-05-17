import { describe, expect, it } from 'vitest'
import { runConfiguredAgentProvider } from './agentProviderClient'
import { DEEPSEEK_PROVIDER_PRESET } from './providerPresets'
import type { OpenAiCompatibleFetch } from './openAiCompatibleProvider'

declare const process: { env: Record<string, string | undefined> }

const runSmoke = process.env.EASYANALYSE_RUN_DEEPSEEK_TOOL_SMOKE === '1'
const maybeIt = runSmoke ? it : it.skip
const smokeBaseUrl = process.env.EASYANALYSE_DEEPSEEK_SMOKE_BASE_URL ?? DEEPSEEK_PROVIDER_PRESET.baseUrl
const smokeModel = process.env.EASYANALYSE_DEEPSEEK_SMOKE_MODEL ?? DEEPSEEK_PROVIDER_PRESET.defaultModel ?? 'deepseek-chat'
const smokeTimeoutMs = normalizePositiveInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_TIMEOUT_MS, 120_000)
const smokeMaxTokens = normalizeOptionalPositiveInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_MAX_TOKENS)
const smokeMaxToolIterations = normalizePositiveInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_MAX_TOOL_ITERATIONS, 5)
const smokeMaxRepairAttempts = normalizeNonNegativeInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_MAX_REPAIR_ATTEMPTS, 2)

describe('DeepSeek tool calling smoke', () => {
  maybeIt('calls check_blueprint_candidate then returns AgentResponse v1 blueprints through product client', async () => {
    const apiKey = process.env.EASYANALYSE_DEEPSEEK_API_KEY
    expect(apiKey).toBeTruthy()
    let callCount = 0
    const fetchImpl: OpenAiCompatibleFetch = async (url, init) => {
      const callIndex = ++callCount
      const startedAt = Date.now()
      const response = await fetch(url, init)
      const elapsedMs = Date.now() - startedAt
      if (process.env.EASYANALYSE_DEBUG_DEEPSEEK_TOOL_SMOKE === '1') {
        console.info(`DeepSeek tool smoke call ${callIndex}: HTTP ${response.status} in ${elapsedMs} ms`)
      }
      if (!response.ok) return response
      const body = await response.clone().json().catch(() => null)
      const content = body?.choices?.[0]?.message?.content
      const toolCalls = body?.choices?.[0]?.message?.tool_calls
      if (process.env.EASYANALYSE_DEBUG_DEEPSEEK_TOOL_SMOKE === '1' && Array.isArray(toolCalls)) {
        console.info(`DeepSeek tool smoke call ${callIndex}: ${toolCalls.length} tool call(s)`)
      }
      if (typeof content === 'string' && process.env.EASYANALYSE_DEBUG_DEEPSEEK_TOOL_SMOKE === '1') {
        console.info('DeepSeek content:', content.slice(0, 4000))
      }
      return response
    }
    const result = await runConfiguredAgentProvider({
      provider: {
        ...DEEPSEEK_PROVIDER_PRESET,
        baseUrl: smokeBaseUrl,
        models: Array.from(new Set([...DEEPSEEK_PROVIDER_PRESET.models, smokeModel])),
        defaultModel: smokeModel,
      },
      modelId: smokeModel,
      apiKey: apiKey!,
      prompt: [
        'Create exactly one EasyAnalyse semantic v4 LED current limiting circuit blueprint candidate.',
        'You MUST call check_blueprint_candidate before your final answer.',
        'Your tool argument candidate MUST be an AgentBlueprintCandidate with title, summary, rationale, tradeoffs, document, and issues.',
        'The final answer MUST be one AgentResponse v1 JSON object with kind blueprints and blueprints as an array.',
      ].join(' '),
      fetchImpl,
      validateDocument: () => ({ detectedFormat: 'semantic-v4', schemaValid: true, semanticValid: true, issueCount: 0, issues: [] }),
      maxToolIterations: smokeMaxToolIterations,
      selfCheck: { enabled: true, repairOnIssues: true, maxRepairAttempts: smokeMaxRepairAttempts },
      timeoutMs: smokeTimeoutMs,
      generation: smokeMaxTokens === undefined ? { temperature: 0 } : { maxTokens: smokeMaxTokens, temperature: 0 },
    })
    expect(result.response.kind).toBe('blueprints')
    if (result.response.kind !== 'blueprints') return
    expect(result.response.blueprints.length).toBeGreaterThan(0)
    expect(result.toolTrace?.some((entry) => entry.toolName === 'check_blueprint_candidate')).toBe(true)
  }, 180_000)
})

function normalizePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function normalizeOptionalPositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function normalizeNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}
