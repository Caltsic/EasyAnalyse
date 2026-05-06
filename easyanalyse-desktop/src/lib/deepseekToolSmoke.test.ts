import { describe, expect, it } from 'vitest'
import { runConfiguredAgentProvider } from './agentProviderClient'
import { DEEPSEEK_PROVIDER_PRESET } from './providerPresets'
import type { OpenAiCompatibleFetch } from './openAiCompatibleProvider'

declare const process: { env: Record<string, string | undefined> }

const runSmoke = process.env.EASYANALYSE_RUN_DEEPSEEK_TOOL_SMOKE === '1'
const maybeIt = runSmoke ? it : it.skip

describe('DeepSeek tool calling smoke', () => {
  maybeIt('calls check_blueprint_candidate then returns AgentResponse v1 blueprints through product client', async () => {
    const apiKey = process.env.EASYANALYSE_DEEPSEEK_API_KEY
    expect(apiKey).toBeTruthy()
    const fetchImpl: OpenAiCompatibleFetch = async (url, init) => {
      const response = await fetch(url, init)
      if (!response.ok) return response
      const body = await response.clone().json().catch(() => null)
      const content = body?.choices?.[0]?.message?.content
      if (typeof content === 'string' && process.env.EASYANALYSE_DEBUG_DEEPSEEK_TOOL_SMOKE === '1') {
        console.info('DeepSeek content:', content.slice(0, 4000))
      }
      return response
    }
    const result = await runConfiguredAgentProvider({
      provider: { ...DEEPSEEK_PROVIDER_PRESET, models: [...DEEPSEEK_PROVIDER_PRESET.models] },
      modelId: DEEPSEEK_PROVIDER_PRESET.defaultModel ?? 'deepseek-chat',
      apiKey: apiKey!,
      prompt: [
        'Create exactly one EasyAnalyse semantic v4 LED current limiting circuit blueprint candidate.',
        'You MUST call check_blueprint_candidate before your final answer.',
        'Your tool argument candidate MUST be an AgentBlueprintCandidate with title, summary, rationale, tradeoffs, document, and issues.',
        'The final answer MUST be one AgentResponse v1 JSON object with kind blueprints and blueprints as an array.',
      ].join(' '),
      fetchImpl,
      validateDocument: () => ({ detectedFormat: 'semantic-v4', schemaValid: true, semanticValid: true, issueCount: 0, issues: [] }),
      maxToolIterations: 5,
      selfCheck: { enabled: true, repairOnIssues: true, maxRepairAttempts: 2 },
      generation: { maxTokens: 4096, temperature: 0 },
    })
    expect(result.response.kind).toBe('blueprints')
    if (result.response.kind !== 'blueprints') return
    expect(result.response.blueprints.length).toBeGreaterThan(0)
    expect(result.toolTrace?.some((entry) => entry.toolName === 'check_blueprint_candidate')).toBe(true)
  }, 90_000)
})
