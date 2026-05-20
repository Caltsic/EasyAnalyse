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
  type ProviderProgressEvent,
  type ProviderProgressHandler,
  type ProviderGenerationOptions,
  type ProviderParseResult,
} from './openAiCompatibleProvider'
import type { DocumentFile, ValidationIssue } from '../types/document'
import type { AgentToolExecutor, AgentToolRuntimeContext } from '../types/agentTools'
import type { AgentThreadMessage } from '../types/agentThread'
import type { AgentProviderPublicConfig } from '../types/settings'

export type AgentProviderProgressEvent = ProviderProgressEvent
export type AgentProviderProgressHandler = ProviderProgressHandler

export interface RunConfiguredAgentProviderInput {
  provider: AgentProviderPublicConfig
  modelId: string
  apiKey: string
  prompt: string
  currentDocument?: DocumentFile | null
  includeDocumentContext?: boolean
  threadMessages?: AgentThreadMessage[]
  requestId?: string
  signal?: AbortSignal
  timeoutMs?: number
  retry?: ProviderRetryOptions
  generation?: ProviderGenerationOptions
  fetchImpl?: OpenAiCompatibleFetch | AnthropicFetch
  maxToolIterations?: number
  validateDocument?: AgentToolRuntimeContext['validateDocument']
  createBlueprintCandidate?: AgentToolRuntimeContext['createBlueprintCandidate']
  getCurrentDocument?: AgentToolRuntimeContext['getCurrentDocument']
  getBlueprintWorkspace?: AgentToolRuntimeContext['getBlueprintWorkspace']
  getSelectedBlueprintId?: AgentToolRuntimeContext['getSelectedBlueprintId']
  getCurrentSelection?: AgentToolRuntimeContext['getCurrentSelection']
  getEditorFocus?: AgentToolRuntimeContext['getEditorFocus']
  getEasyAnalyseFormatRules?: AgentToolRuntimeContext['getEasyAnalyseFormatRules']
  toolExecutor?: AgentToolExecutor
  progress?: AgentProviderProgressHandler
  selfCheck?: {
    enabled: boolean
    repairOnIssues: boolean
    maxRepairAttempts: number
  }
}

export const DEFAULT_AGENT_PROVIDER_TIMEOUT_MS: number | undefined = undefined
export const DEFAULT_AGENT_MODEL_CONTEXT_WINDOW = 64_000
export const DEFAULT_AGENT_RESERVED_OUTPUT_TOKENS = 8_000

const DEFAULT_RETRY: ProviderRetryOptions = {
  maxAttempts: 1,
}

const EASYANALYSE_SEMANTIC_V4_CONTRACT = [
  'Canonical EasyAnalyse semantic v4 contract:',
  '- The persisted circuit format is semantic-first. It has devices, terminals, terminal labels, and view metadata. It never has wires, nodes, junctions, bend points, free terminal coordinates, terminal-label coordinates, signal objects, signalId, component wrappers, or port wrappers.',
  '- Top-level DocumentFile shape is exactly { schemaVersion:"4.0.0", document:{...}, devices:[...], view:{...}, extensions? }. Required top-level fields are schemaVersion, document, devices, view.',
  '- document metadata needs a stable non-empty id and title. source should be human, ai, mixed, or imported when present. Use language "zh-CN" when responding to Chinese circuit requests unless the user asks otherwise.',
  '- Each device is one hardware block. Device id values are globally unique. Each device needs id, name, kind, terminals[]. reference is recommended. properties may contain value, voltage, outputVoltage, nominalVoltage, frequency, partNumber, package, topology.',
  '- Resistors, capacitors, inductors, ferrite beads, and other value-bearing passives must carry properties.value. Crystals, oscillators, and resonators must carry properties.frequency. Supply/regulator/source devices should carry voltage/outputVoltage/nominalVoltage.',
  '- Prefer canonical kinds: resistor, capacitor, electrolytic-capacitor, inductor, ferrite-bead, led, diode, flyback-diode, rectifier-diode, zener-diode, tvs-diode, nmos, pmos, npn-transistor, pnp-transistor, switch, push-button, crystal, oscillator, resonator, op-amp, controller, regulator, power-source, ground, connector, sensor, driver, transformer, relay, fuse, test-point.',
  '- Terminal id values are globally unique. Every terminal needs id, name, direction, and usually label. Allowed direction values are only input and output. Optional side is left/right/top/bottom/auto; optional order keeps side order deterministic.',
  '- Connectivity is defined only by exact terminal.label equality. If VIN appears on three terminals, those three terminals are connected. view.networkLines never create connectivity.',
  '- For two-terminal passive devices, choose a readable signal flow: upstream terminal input, downstream terminal output, return-to-ground terminal output. Power entry pins and ground pins are usually input; regulated or driven rails are usually output.',
  '- view.canvas.units must be "px". view.devices is keyed by device id. view.devices[deviceId].position is the top-left of the rendered device bounds, not its center. view.networkLines is keyed by visual line id.',
  '- Built-in schematic templates are selected from devices[*].kind. Do not invent persisted shape names to express a package, role, polarity, or symbol variant. Package belongs in properties.package.',
  '- The renderer can enlarge effective device bounds around labels and terminals. Leave clear space between devices and between visual rails and devices.',
].join('\n')

const EASYANALYSE_LAYOUT_AUTHORING_RULES = [
  'Canonical layout rules:',
  '- Use a wide grid for generated blueprints. A safe default is x=80,380,680,980,1280,1580 and y=96,320,544,768,992. Keep default rectangular devices at least 280 px apart horizontally and 180 px apart vertically.',
  '- For op-amp stages, put input source and bias/filter parts to the left, the op-amp near the middle, feedback parts above or below the op-amp, output/load parts to the right, and supply/ground rails outside the active device row.',
  '- For filters and cascaded amplifiers, use left-to-right stage order. Do not stack many devices at the same x/y. Split dense feedback networks onto separate rows.',
  '- view.networkLines are optional visual rails for labels already used by terminals. Good rail positions are above the top device row, below the bottom device row, or to the outside of the device columns. Do not run a networkLine through a device rectangle. If a clean rail cannot be drawn, omit the networkLine.',
  '- If a tool reports layout.device.overlap, prefer changing only view.devices positions. If it reports layout.network-line.device-overlap, prefer changing only that view.networkLines entry, or remove it if it is not essential. If it reports layout.text.device-overlap, increase spacing around the related terminal/network label or move the nearby device/rail.',
].join('\n')

export function buildAgentSystemPrompt(): string {
  return [
    'You are the EasyAnalyse desktop circuit blueprint agent.',
    'Return exactly one JSON object and no markdown fences or extra prose.',
    'The JSON object MUST be an AgentResponse with schemaVersion "agent-response-v1" and semanticVersion "easyanalyse-semantic-v4".',
    'Allowed kind values: message, question, error, blueprints, patch.',
    'For circuit generation or modification, prefer kind "blueprints" and return one or more complete semantic v4 DocumentFile candidates.',
    'Never mutate the main document directly. All circuit changes must be represented as blueprint candidates.',
    'Use tools when they help. For blueprint candidates, check_blueprint_format is the hard format gate; fix ok=false format results before returning or creating the candidate.',
    'check_blueprint_candidate, validate_document, and check_layout_overlaps are advisory quality checks. Their semantic/layout issues are hints, not a requirement to reach 0 issues before final JSON.',
    'When calling blueprint candidate tools, the arguments MUST be exactly shaped as {"candidate":{"title":"...","summary":"...","rationale":"...","tradeoffs":[],"document":{...},"issues":[]}}. Do not pass only a document, and do not put candidate fields at the tool argument top level.',
    EASYANALYSE_SEMANTIC_V4_CONTRACT,
    EASYANALYSE_LAYOUT_AUTHORING_RULES,
    'For kind "blueprints", the top-level "blueprints" property MUST be an array, even when returning exactly one candidate. Never use a singular "blueprint" object.',
    'Each candidate MUST include title, summary, rationale, tradeoffs array, complete document, and issues array. Use view.canvas.units "px".',
    'candidate.issues is for human-visible caveats and advisory validation/layout findings; it is not a substitute for fixing hard format errors from check_blueprint_format.',
    'On repair turns, keep the already-valid semantic circuit intact. Make the smallest possible changes needed by hard format errors. Prefer editing view.devices positions and view.networkLines coordinates only when you choose to address advisory layout hints.',
    'If a hard format tool reports missing required device/terminal fields or invalid terminal.direction, repair those fields. If advisory layout tools report layout.device.overlap, layout.network-line.device-overlap, or layout.text.device-overlap, treat that as a readability hint and improve it when feasible.',
    'If the user asks for a generated circuit from scratch, produce a complete standalone document. If the user asks to modify the current document and context is provided, return a complete modified document candidate, not a patch.',
    'Valid tiny semantic v4 pattern: a resistor from VIN to VOUT and capacitor from VOUT to GND is represented by R1.A label VIN, R1.B label VOUT, C1.A label VOUT, C1.B label GND. No wire or node array is needed.',
    'Minimal valid response skeleton: {"schemaVersion":"agent-response-v1","semanticVersion":"easyanalyse-semantic-v4","kind":"blueprints","summary":"...","blueprints":[{"title":"...","summary":"...","rationale":"...","tradeoffs":[],"document":{"schemaVersion":"4.0.0","document":{"id":"...","title":"...","createdAt":"...","updatedAt":"..."},"devices":[],"view":{"canvas":{"units":"px","grid":{"enabled":true,"size":16}},"devices":{},"networkLines":{}}},"issues":[]}]}.',
  ].join('\n')
}

export function buildAgentUserPrompt(input: {
  prompt: string
  currentDocument?: DocumentFile | null
  includeDocumentContext?: boolean
  threadMessages?: AgentThreadMessage[]
  requestId?: string
}): string {
  const parts = [
    `Request id: ${input.requestId ?? 'agent-panel'}`,
  ]
  const historySummary = buildAgentThreadHistorySummary(input.threadMessages ?? [])
  if (historySummary) {
    parts.push(
      '',
      'Recent conversation summary for this Agent thread. This is context only; the current user request below is authoritative:',
      historySummary,
    )
  }
  parts.push('', `Current user request:\n${input.prompt.trim()}`)
  const examples = selectAgentReferenceExamples(input.prompt, input.currentDocument ?? null)
  if (examples.length > 0) {
    parts.push('', formatAgentReferenceExamplesForPrompt(examples))
  }
  parts.push(
    '',
    'Authoring checklist before returning or creating blueprint candidates:',
    '- Use only terminal.label equality for connectivity; do not create wires/nodes/junctions/signalId/ports/components.',
    '- Ensure every device and terminal has id/name, every terminal direction is input or output, and value/frequency/voltage properties exist where the part type requires them.',
    '- Use check_blueprint_format to verify hard persisted JSON format when uncertain.',
    '- Place devices on a wide top-left coordinate grid and keep view.networkLines outside device bounds or omit them.',
    '- For any repair after a hard format tool result, change only the fields needed by the reported issues whenever possible.',
  )
  if (input.includeDocumentContext && input.currentDocument) {
    parts.push('', 'Current EasyAnalyse semantic v4 document JSON:', JSON.stringify(input.currentDocument))
  } else {
    parts.push('', 'Current document JSON was not included. If modification requires existing circuit details, ask a question instead of inventing hidden state.')
  }
  return parts.join('\n')
}

export function buildAgentThreadHistorySummary(
  messages: readonly AgentThreadMessage[],
  options: { maxMessages?: number; maxChars?: number; maxContentChars?: number } = {},
): string {
  const maxMessages = Math.max(0, options.maxMessages ?? 12)
  const maxChars = Math.max(0, options.maxChars ?? 8_000)
  const maxContentChars = Math.max(80, options.maxContentChars ?? 900)
  if (maxMessages === 0 || maxChars === 0 || messages.length === 0) return ''
  const recent = messages.slice(-maxMessages)
  const lines: string[] = []
  for (const message of recent) {
    const timestamp = message.createdAt ? ` ${message.createdAt}` : ''
    if (message.role === 'user') {
      lines.push(`- User${timestamp}: ${truncateForPrompt(redactPromptText(message.content), maxContentChars)}`)
    } else if (message.role === 'assistant') {
      lines.push(`- Assistant${timestamp}: ${truncateForPrompt(redactPromptText(message.content), maxContentChars)}`)
    } else {
      const blueprintPart = message.blueprintIds.length > 0 ? `; blueprints=${message.blueprintIds.length}` : ''
      lines.push(`- Tool ${message.toolName} [${message.status}]${timestamp}: ${truncateForPrompt(redactPromptText(message.summary), Math.min(maxContentChars, 500))}; issues=${message.issueCount}${blueprintPart}`)
    }
  }
  let summary = lines.join('\n')
  if (summary.length <= maxChars) return summary
  const truncatedLines: string[] = []
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = [lines[index], ...truncatedLines].join('\n')
    if (candidate.length > maxChars) break
    truncatedLines.unshift(lines[index]!)
  }
  summary = truncatedLines.join('\n')
  return summary ? `[Older thread messages omitted to fit context]\n${summary}` : ''
}

function redactPromptText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9._-]{8,}/g, '[redacted-api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key\s*[:=]\s*["']?[^"'\s,}]+/gi, 'apiKey=[redacted]')
}

function truncateForPrompt(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
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
    threadMessages: input.threadMessages,
    requestId: input.requestId,
  })
  emitProgress(input.progress, { phase: 'preparing', message: 'Built provider prompt.' })
  const documentText = ''
  checkAgentContextBudget({
    systemPrompt,
    userPrompt,
    documentText,
    modelContextWindow: DEFAULT_AGENT_MODEL_CONTEXT_WINDOW,
    reservedOutputTokens: DEFAULT_AGENT_RESERVED_OUTPUT_TOKENS,
    redactions: [apiKey],
  })
  emitProgress(input.progress, { phase: 'preparing', message: 'Provider context budget check passed.' })

  const fetchImpl = input.fetchImpl ?? getWindowFetch()

  return runProviderWithControls({
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? DEFAULT_AGENT_PROVIDER_TIMEOUT_MS,
    retry: input.retry ?? DEFAULT_RETRY,
    redactions: [apiKey],
    providerId: provider.id,
    modelId: model.id,
    operation: async ({ signal, attempt }) => {
      emitProgress(input.progress, { phase: 'request', message: `Starting provider attempt ${attempt}.`, detail: { attempt } })
      const selfCheckOptions = input.selfCheck ?? { enabled: true, repairOnIssues: true, maxRepairAttempts: 1 }
      const runOnce = async (nextUserPrompt: string): Promise<ProviderParseResult> => {
        if (provider.kind === 'anthropic') {
          emitProgress(input.progress, { phase: 'request', message: 'Sending Anthropic provider request.' })
          const result = await runAnthropicProvider({
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
          emitProgress(input.progress, { phase: 'response', message: 'Anthropic provider response received.' })
          return result
        }
        return runOpenAiCompatibleProvider({
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
          getCurrentDocument: input.getCurrentDocument,
          getBlueprintWorkspace: input.getBlueprintWorkspace,
          getSelectedBlueprintId: input.getSelectedBlueprintId,
          getCurrentSelection: input.getCurrentSelection,
          getEditorFocus: input.getEditorFocus,
          getEasyAnalyseFormatRules: input.getEasyAnalyseFormatRules,
          validateDocument: input.validateDocument,
          createBlueprintCandidate: input.createBlueprintCandidate,
          toolExecutor: input.toolExecutor,
          progress: input.progress,
        })
      }

      let checked = await applyPostProviderSelfCheck(await runOnce(userPrompt), selfCheckOptions, input.validateDocument, input.progress)
      if (!selfCheckOptions.enabled || !selfCheckOptions.repairOnIssues || checked.response.kind !== 'blueprints') {
        emitProgress(input.progress, { phase: 'complete', message: 'Agent provider run completed.', detail: { kind: checked.response.kind } })
        return checked
      }

      const repairTrace = [...(checked.repairTrace ?? [])]
      for (let attempt = 1; attempt <= Math.max(0, selfCheckOptions.maxRepairAttempts); attempt += 1) {
        if (!blueprintResponseHasSelfCheckIssues(checked)) break
        emitProgress(input.progress, { phase: 'repair', message: `Requesting self-check repair attempt ${attempt}.`, detail: { attempt } })
        const repairPrompt = buildSelfCheckRepairPrompt(input.prompt, checked)
        const repaired = await applyPostProviderSelfCheck(await runOnce(repairPrompt), { ...selfCheckOptions, repairOnIssues: false }, input.validateDocument, input.progress)
        const repairedOk = repaired.response.kind === 'blueprints' && !blueprintResponseHasSelfCheckIssues(repaired)
        repairTrace.push({
          attempt,
          ok: repairedOk,
          summary: repairedOk ? 'Self-check repair attempt returned candidates without hard format issues.' : 'Self-check repair attempt returned candidates that still have hard format issues.',
        })
        checked = { ...repaired, repairTrace: [...(repaired.repairTrace ?? []), ...repairTrace] }
        if (repairedOk) break
      }
      emitProgress(input.progress, { phase: 'complete', message: 'Agent provider run completed.', detail: { kind: checked.response.kind } })
      return checked
    },
  })
}

async function applyPostProviderSelfCheck(
  result: ProviderParseResult,
  options: { enabled: boolean; repairOnIssues: boolean; maxRepairAttempts: number },
  validateDocument?: AgentToolRuntimeContext['validateDocument'],
  progress?: AgentProviderProgressHandler,
): Promise<ProviderParseResult> {
  if (!options.enabled || result.response.kind !== 'blueprints') return result
  emitProgress(progress, { phase: 'self-check', message: 'Running local blueprint self-check.' })
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
  const totalIssues = trace.reduce((total, item) => total + item.issueCount, 0)
  const okCount = reports.filter((report) => report.ok).length
  emitProgress(progress, {
    phase: 'self-check',
    message: `Local self-check completed for ${reports.length} candidate${reports.length === 1 ? '' : 's'} with ${totalIssues} issue${totalIssues === 1 ? '' : 's'}.`,
    detail: { candidates: reports.length, okCount, issueCount: totalIssues },
  })
  return { ...result, toolTrace: [...(result.toolTrace ?? []), ...trace] }
}

function blueprintResponseHasSelfCheckIssues(result: ProviderParseResult): boolean {
  if (result.response.kind !== 'blueprints') return false
  return result.response.blueprints.some((candidate) => (candidate.toolIssues ?? []).some(isHardFormatIssue))
}

function isHardFormatIssue(issue: ValidationIssue): boolean {
  return issue.severity === 'error' && (issue.code.startsWith('schema.') || issue.code.startsWith('format.'))
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
  const previousCandidates = checked.response.kind === 'blueprints'
    ? checked.response.blueprints.map((candidate) => ({
      title: candidate.title,
      summary: candidate.summary,
      rationale: candidate.rationale,
      tradeoffs: candidate.tradeoffs,
      document: candidate.document,
      issues: candidate.issues,
    }))
    : []
  return [
    'The previous EasyAnalyse AgentResponse candidate still has hard format issues from local self-check.',
    'Return a complete corrected AgentResponse v1 JSON object only. Do not explain outside JSON.',
    'Keep semantic v4 connectivity expressed only by terminal labels. Do not add wires/nodes/junctions/signalId.',
    'Repair the existing candidate with the smallest possible edit. If the circuit semantics are already correct, do not redesign the circuit.',
    'Fix schema/format errors that can prevent the document from opening. Semantic and layout findings in the report are advisory and are not blockers by themselves.',
    'Only change devices, terminals, labels, or topology when a hard format issue directly requires it.',
    '',
    `Original user request:\n${originalPrompt.trim()}`,
    '',
    'Previous blueprint candidates to repair:',
    JSON.stringify(previousCandidates),
    '',
    'Machine-readable self-check reports:',
    JSON.stringify(reports),
  ].join('\n')
}

function emitProgress(progress: AgentProviderProgressHandler | undefined, event: AgentProviderProgressEvent): void {
  try {
    progress?.(event)
  } catch {
    // Progress reporting must never affect provider execution.
  }
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
