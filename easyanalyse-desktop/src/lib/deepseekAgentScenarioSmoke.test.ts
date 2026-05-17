import { describe, expect, it } from 'vitest'
import { runConfiguredAgentProvider } from './agentProviderClient'
import { parseAgentResponse } from './agentResponse'
import { DEEPSEEK_PROVIDER_PRESET } from './providerPresets'
import type { OpenAiCompatibleFetch } from './openAiCompatibleProvider'
import type { AgentBlueprintCandidate } from '../types/agent'
import type { DocumentFile, ValidationIssue, ValidationReport } from '../types/document'

declare const process: { env: Record<string, string | undefined> }

interface Scenario {
  id: string
  title: string
  prompt: string
  minDevices: number
  requiredLabels: string[]
  requiredKindHints: string[]
  requireTransistorCount?: number
}

const runSmoke = process.env.EASYANALYSE_RUN_DEEPSEEK_SCENARIO_SMOKE === '1'
const maybeDescribe = runSmoke ? describe : describe.skip
const smokeBaseUrl = process.env.EASYANALYSE_DEEPSEEK_SMOKE_BASE_URL ?? DEEPSEEK_PROVIDER_PRESET.baseUrl
const smokeModel = process.env.EASYANALYSE_DEEPSEEK_SMOKE_MODEL ?? 'deepseek-v4-pro'
const smokeTimeoutMs = normalizePositiveInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_TIMEOUT_MS, 600_000)
const smokeMaxTokens = normalizeOptionalPositiveInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_MAX_TOKENS)
const smokeMaxToolIterations = normalizePositiveInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_MAX_TOOL_ITERATIONS, 6)
const smokeMaxRepairAttempts = normalizeNonNegativeInteger(process.env.EASYANALYSE_DEEPSEEK_SMOKE_MAX_REPAIR_ATTEMPTS, 1)

const scenarios: Scenario[] = [
  {
    id: 'sallen-key-high-q-lowpass',
    title: 'High-Q 2 kHz low-pass filter',
    minDevices: 8,
    requiredLabels: ['VIN', 'VOUT', 'GND'],
    requiredKindHints: ['resistor', 'capacitor'],
    prompt: [
      'Generate one complete EasyAnalyse semantic v4 blueprint candidate for a high-Q low-pass filter circuit.',
      'Circuit intent: 2nd-order active Sallen-Key low-pass, cutoff frequency fc=2 kHz, Q about 5, input is a 500 Hz square-wave source.',
      'Include a signal source labelled VIN, two resistors, two capacitors, an op-amp/buffer device, positive/negative supply pins or supply rail devices, and output labelled VOUT.',
      'Use exact net labels VIN, VOUT, GND, VCC, VEE, and meaningful intermediate labels such as N1 and N2.',
      'Add component values in device.parameters when useful: example R about 7.96k and C about 10nF, with a note that gain/feedback sets high Q.',
      'Return exactly one AgentResponse JSON object with kind blueprints and exactly one candidate. Do not use wires, nodes, ports, components wrappers, junctions, or signalId.',
    ].join(' '),
  },
  {
    id: 'two-stage-bjt-amplifier',
    title: 'Two-stage transistor amplifier',
    minDevices: 10,
    requiredLabels: ['VIN', 'VOUT', 'GND', 'VCC'],
    requiredKindHints: ['resistor', 'capacitor'],
    requireTransistorCount: 2,
    prompt: [
      'Generate one complete EasyAnalyse semantic v4 blueprint candidate for a discrete two-stage audio voltage amplifier.',
      'Circuit intent: first stage is an NPN common-emitter voltage gain stage, second stage is an NPN emitter follower/buffer, with AC coupling between stages.',
      'Include input coupling capacitor, bias resistor divider, collector/emitter resistors, interstage coupling capacitor, output coupling capacitor, load resistor, VCC supply, and GND return.',
      'Use exact net labels VIN, BIAS1, Q1_COL, STAGE1_OUT, Q2_BASE, VOUT, VCC, and GND.',
      'Use two transistor-like devices named Q1 and Q2 and give all terminals id, name, direction, and label.',
      'Return exactly one AgentResponse JSON object with kind blueprints and exactly one candidate. Connectivity must be terminal.label equality only.',
    ].join(' '),
  },
  {
    id: 'mcu-core-system-board',
    title: 'MCU core system board',
    minDevices: 12,
    requiredLabels: ['3V3', 'GND', 'NRST', 'SWDIO', 'SWCLK'],
    requiredKindHints: ['resistor', 'capacitor', 'crystal', 'connector'],
    prompt: [
      'Generate one complete EasyAnalyse semantic v4 blueprint candidate for an MCU core system board.',
      'Circuit intent: STM32-like microcontroller minimum system with 3.3 V regulator, decoupling capacitors, crystal oscillator, reset circuit, BOOT0 pulldown, SWD programming header, status LED, and power input connector.',
      'Use exact net labels VIN, 3V3, GND, NRST, BOOT0, OSC_IN, OSC_OUT, SWDIO, SWCLK, SWO, LED_STATUS.',
      'Include a microcontroller device, LDO/regulator device, at least three capacitors, crystal, reset pushbutton, BOOT0 resistor, SWD connector, power connector, resistor, and LED.',
      'Layout requirement: view.devices positions are top-left coordinates. Use a wide grid such as x=80,380,680,980,1280 and y=96,320,544,768; do not place two default-size devices less than 280 px apart horizontally or 180 px apart vertically.',
      'Every device and terminal must have stable non-empty id/name fields. Terminal directions are only input or output.',
      'Return exactly one AgentResponse JSON object with kind blueprints and exactly one candidate. Do not invent wires or node arrays.',
    ].join(' '),
  },
]

maybeDescribe('DeepSeek real Agent circuit scenario smoke', () => {
  for (const scenario of scenarios) {
    it(`generates a clean blueprint for ${scenario.title}`, async () => {
      const apiKey = process.env.EASYANALYSE_DEEPSEEK_API_KEY
      expect(apiKey).toBeTruthy()
      const startedAt = Date.now()
      const fetchImpl = buildLoggingFetch(scenario.id)

      const result = await runConfiguredAgentProvider({
        provider: {
          ...DEEPSEEK_PROVIDER_PRESET,
          baseUrl: smokeBaseUrl,
          models: Array.from(new Set([...DEEPSEEK_PROVIDER_PRESET.models, smokeModel])),
          defaultModel: smokeModel,
        },
        modelId: smokeModel,
        apiKey: apiKey!,
        prompt: scenario.prompt,
        includeDocumentContext: false,
        requestId: `deepseek-scenario-${scenario.id}`,
        timeoutMs: smokeTimeoutMs,
        fetchImpl,
        maxToolIterations: smokeMaxToolIterations,
        selfCheck: { enabled: true, repairOnIssues: true, maxRepairAttempts: smokeMaxRepairAttempts },
        validateDocument: localValidateDocument,
        progress: (event) => {
          console.info(`[${scenario.id}] ${event.phase}: ${event.message}`)
        },
        generation: smokeMaxTokens === undefined
          ? { temperature: 0 }
          : { temperature: 0, maxTokens: smokeMaxTokens },
      })

      expect(result.response.kind).toBe('blueprints')
      if (result.response.kind !== 'blueprints') return
      expect(result.response.blueprints.length).toBe(1)
      expect(result.toolTrace?.some((entry) => entry.toolName === 'check_blueprint_candidate')).toBe(true)

      const candidate = result.response.blueprints[0]!
      const requirementFailures = checkScenarioRequirements(candidate, scenario)
      const issueFailures = [
        ...result.issues,
        ...(candidate.toolIssues ?? []),
        ...candidate.issues,
      ].filter((issue) => issue.severity === 'error')

      console.info(`[${scenario.id}] completed in ${Math.round((Date.now() - startedAt) / 1000)}s`)
      console.info(`[${scenario.id}] devices=${candidate.document.devices.length}; labels=${collectLabels(candidate.document).join(',')}`)
      console.info(`[${scenario.id}] toolTrace=${JSON.stringify(result.toolTrace ?? [])}`)
      console.info(`[${scenario.id}] repairTrace=${JSON.stringify(result.repairTrace ?? [])}`)

      expect(issueFailures).toEqual([])
      expect(requirementFailures).toEqual([])
    }, smokeTimeoutMs + 180_000)
  }
})

function buildLoggingFetch(scenarioId: string): OpenAiCompatibleFetch {
  let callCount = 0
  return async (url, init) => {
    const callIndex = ++callCount
    const startedAt = Date.now()
    const requestBody = safeParseJson(init.body)
    const toolsEnabled = Array.isArray(requestBody?.tools)
    const jsonOnly = Boolean(requestBody?.response_format)
    console.info(`[${scenarioId}] HTTP request ${callIndex}: tools=${toolsEnabled} jsonOnly=${jsonOnly}`)
    const response = await fetch(url, init)
    const responseBody = await response.clone().json().catch(() => null)
    const elapsedMs = Date.now() - startedAt
    const choice = responseBody?.choices?.[0]
    const message = choice?.message
    const contentLength = typeof message?.content === 'string' ? message.content.length : 0
    const reasoningLength = typeof message?.reasoning_content === 'string' ? message.reasoning_content.length : 0
    const toolCallCount = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0
    console.info(
      `[${scenarioId}] HTTP response ${callIndex}: status=${response.status} elapsedMs=${elapsedMs} finish=${choice?.finish_reason ?? 'n/a'} content=${contentLength} reasoning=${reasoningLength} toolCalls=${toolCallCount}`,
    )
    return response
  }
}

function localValidateDocument(document: DocumentFile): ValidationReport {
  try {
    const parsed = parseAgentResponse({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'blueprints',
      summary: 'local validation wrapper',
      blueprints: [
        {
          title: 'local validation candidate',
          summary: 'local validation candidate',
          rationale: 'local validation candidate',
          tradeoffs: [],
          document,
          issues: [],
        },
      ],
    })
    const issues = parsed.issues.map(stripBlueprintIssuePrefix)
    const hasErrors = issues.some((issue) => issue.severity === 'error')
    return {
      detectedFormat: 'semantic-v4',
      schemaValid: !hasErrors,
      semanticValid: !hasErrors,
      issueCount: issues.length,
      issues,
      normalizedDocument: hasErrors ? null : document,
    }
  } catch (error) {
    return {
      detectedFormat: 'unknown',
      schemaValid: false,
      semanticValid: false,
      issueCount: 1,
      issues: [{
        severity: 'error',
        code: 'local-validation.exception',
        message: error instanceof Error ? error.message : String(error),
        path: null,
        entityId: null,
      }],
      normalizedDocument: null,
    }
  }
}

function stripBlueprintIssuePrefix(issue: ValidationIssue): ValidationIssue {
  return {
    ...issue,
    path: issue.path?.replace(/^blueprints\[0\]\.document\.?/, '') ?? issue.path ?? null,
  }
}

function checkScenarioRequirements(candidate: AgentBlueprintCandidate, scenario: Scenario): string[] {
  const failures: string[] = []
  const document = candidate.document
  const labels = new Set(collectLabels(document))
  const kindText = document.devices.map((device) => `${device.kind} ${device.name}`).join(' ').toLowerCase()
  if (document.devices.length < scenario.minDevices) {
    failures.push(`expected at least ${scenario.minDevices} devices, got ${document.devices.length}`)
  }
  scenario.requiredLabels.forEach((label) => {
    if (!labels.has(label)) failures.push(`missing required label ${label}`)
  })
  scenario.requiredKindHints.forEach((hint) => {
    if (!kindText.includes(hint.toLowerCase())) failures.push(`missing kind/name hint ${hint}`)
  })
  if (scenario.requireTransistorCount !== undefined) {
    const transistorCount = document.devices.filter((device) =>
      /transistor|bjt|npn|pnp/i.test(`${device.kind} ${device.name}`),
    ).length
    if (transistorCount < scenario.requireTransistorCount) {
      failures.push(`expected at least ${scenario.requireTransistorCount} transistor-like devices, got ${transistorCount}`)
    }
  }
  return failures
}

function collectLabels(document: DocumentFile): string[] {
  return [...new Set(
    document.devices.flatMap((device) =>
      device.terminals
        .map((terminal) => terminal.label?.trim())
        .filter((label): label is string => Boolean(label)),
    ),
  )].sort((left, right) => left.localeCompare(right))
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

function normalizeNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}
