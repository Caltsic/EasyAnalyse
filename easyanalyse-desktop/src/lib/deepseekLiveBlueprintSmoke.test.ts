import { describe, expect, it } from 'vitest'
import { runConfiguredAgentProvider, type AgentProviderProgressEvent } from './agentProviderClient'
import { parseLiveBlueprintDraft, type LiveBlueprintDraftResult } from './liveBlueprintDraft'
import { DEEPSEEK_PROVIDER_PRESET } from './providerPresets'
import type { OpenAiCompatibleFetch } from './openAiCompatibleProvider'
import type { DocumentFile } from '../types/document'

declare const process: { env: Record<string, string | undefined> }

const runSmoke = process.env.EASYANALYSE_RUN_DEEPSEEK_LIVE_SMOKE === '1'
const maybeDescribe = runSmoke ? describe : describe.skip
const smokeBaseUrl = process.env.EASYANALYSE_DEEPSEEK_SMOKE_BASE_URL ?? DEEPSEEK_PROVIDER_PRESET.baseUrl
const smokeModel = process.env.EASYANALYSE_DEEPSEEK_SMOKE_MODEL ?? 'deepseek-v4-flash'
const smokeTimeoutMs = normalizePositiveInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_TIMEOUT_MS, 240_000)
const smokeMaxTokens = normalizeOptionalPositiveInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_MAX_TOKENS)

maybeDescribe('DeepSeek live blueprint streaming smoke', () => {
  it('streams candidate content that can be projected by the live blueprint parser', async () => {
    const apiKey = process.env.EASYANALYSE_DEEPSEEK_API_KEY
    expect(apiKey).toBeTruthy()

    const progressEvents: AgentProviderProgressEvent[] = []
    const parsedDrafts: LiveBlueprintDraftResult[] = []
    let lastGood: DocumentFile | null = null
    let streamedEventCount = 0
    const fetchImpl = buildLoggingFetch()

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
        'Return exactly one EasyAnalyse AgentResponse v1 JSON object with kind blueprints.',
        'Generate one simple semantic v4 RC low-pass filter blueprint.',
        'The document must use schemaVersion "4.0.0", have VIN, VOUT, and GND terminal labels, and include at least one resistor and one capacitor.',
        'Do not use tools, markdown, explanation text, wires, nodes, ports, or component wrappers.',
        'Emit the JSON object directly.',
      ].join(' '),
      includeDocumentContext: false,
      requestId: 'deepseek-live-blueprint-smoke',
      timeoutMs: smokeTimeoutMs,
      fetchImpl,
      maxToolIterations: 0,
      selfCheck: { enabled: false, repairOnIssues: false, maxRepairAttempts: 0 },
      progress: (event) => {
        progressEvents.push(event)
        const streamedContent = event.detail?.streamedContent
        if (typeof streamedContent !== 'string') return
        streamedEventCount += 1
        const parsed = parseLiveBlueprintDraft(streamedContent, { lastGood })
        parsedDrafts.push(parsed)
        lastGood = parsed.lastGood
      },
      generation: smokeMaxTokens === undefined
        ? { temperature: 0 }
        : { temperature: 0, maxTokens: smokeMaxTokens },
    })

    expect(result.response.kind).toBe('blueprints')
    if (result.response.kind !== 'blueprints') return
    expect(result.response.blueprints.length).toBe(1)
    expect(result.response.blueprints[0]!.document.devices.length).toBeGreaterThanOrEqual(2)
    expect(streamedEventCount).toBeGreaterThan(0)
    expect(parsedDrafts.some((draft) => draft.markerFound)).toBe(true)
    const displayDocuments = parsedDrafts
      .map((draft) => draft.displayDocument)
      .filter((document): document is DocumentFile => document !== null)
    expect(displayDocuments.length).toBeGreaterThan(0)
    expect(displayDocuments.at(-1)?.document.title).toBeTruthy()

    const statusCounts = parsedDrafts.reduce<Record<string, number>>((counts, draft) => {
      counts[draft.status] = (counts[draft.status] ?? 0) + 1
      return counts
    }, {})
    console.info(`DeepSeek live smoke streamedEvents=${streamedEventCount}; statuses=${JSON.stringify(statusCounts)}`)
    console.info(`DeepSeek live smoke progressPhases=${[...new Set(progressEvents.map((event) => event.phase))].join(',')}`)
  }, smokeTimeoutMs + 60_000)
})

function buildLoggingFetch(): OpenAiCompatibleFetch {
  let callCount = 0
  return async (url, init) => {
    const callIndex = ++callCount
    const requestBody = safeParseJson(init.body)
    const startedAt = Date.now()
    console.info(`DeepSeek live smoke request ${callIndex}: stream=${requestBody?.stream === true}; tools=${Array.isArray(requestBody?.tools)}`)
    const response = await fetch(url, init)
    console.info(`DeepSeek live smoke response ${callIndex}: status=${response.status}; elapsedMs=${Date.now() - startedAt}`)
    return response
  }
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

function normalizePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function normalizeOptionalPositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}
