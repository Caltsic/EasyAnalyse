import { runAgentTool, selfCheckBlueprintCandidates } from './agentTools'
import { selectAgentReferenceExamples, formatAgentReferenceExamplesForPrompt } from './agentExampleLibrary'
import { runAnthropicProvider, type AnthropicFetch } from './anthropicProvider'
import { checkAgentContextBudget, runProviderWithControls, type ProviderRetryOptions } from './agentProviderRuntime'
import { AGENT_RESPONSE_SCHEMA_VERSION, AGENT_RESPONSE_SEMANTIC_VERSION } from './agentResponse'
import { getErrorMessage } from './errors'
import { isRecord } from './guards'
import {
  OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT,
  OPENAI_COMPATIBLE_ADAPTER_ID,
  AgentProviderError,
  inferGenerateFilterBlueprintArgsFromPrompt,
  runOpenAiCompatibleProvider,
  type AgentModelConfig,
  type AgentProviderConfig,
  type OpenAiCompatibleFetch,
  type ProviderProgressEvent,
  type ProviderProgressHandler,
  type ProviderGenerationOptions,
  type ProviderParseResult,
} from './openAiCompatibleProvider'
import type { AgentBlueprintCandidate } from '../types/agent'
import type { DocumentFile, ValidationIssue } from '../types/document'
import type { AgentToolExecutor, AgentToolRuntimeContext, AgentToolTraceEntry } from '../types/agentTools'
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
  beginBlueprintGeneration?: AgentToolRuntimeContext['beginBlueprintGeneration']
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
    'For filter requests, prefer generate_filter_blueprint before hand-authoring JSON. It returns a complete AgentBlueprintCandidate with deterministic filter topology, component values, network labels, and a default layout; review it, then store it with create_blueprint_candidate or return it as a blueprint response.',
    'For filter requests, call generate_filter_blueprint before begin_blueprint_generation. begin_blueprint_generation is for hand-authored streamed blueprint JSON; do not let it replace deterministic generation tools.',
    'When you decide to hand-author a new circuit blueprint without a deterministic generator, call begin_blueprint_generation once before emitting blueprint JSON so the app can handle the current canvas.',
    'After begin_blueprint_generation returns continue/saved/discarded, start your streamed answer with BEGIN_EASYANALYSE_BLUEPRINT_JSON on its own line, then output the final AgentResponse JSON. The app extracts the first blueprint document from that JSON for live preview while you are still streaming.',
    'Use tools when they help. For blueprint candidates, check_blueprint_format reports display/openability diagnostics; ok=false results are recoverable and should be repaired or explained instead of ending the conversation.',
    'check_blueprint_candidate, validate_document, and check_layout_overlaps are advisory quality checks. Their semantic/layout issues are hints, not a requirement to reach 0 issues before final JSON.',
    'When calling blueprint candidate tools, the arguments MUST be exactly shaped as {"candidate":{"title":"...","summary":"...","rationale":"...","tradeoffs":[],"document":{...},"issues":[]}}. Do not pass only a document, and do not put candidate fields at the tool argument top level.',
    EASYANALYSE_SEMANTIC_V4_CONTRACT,
    EASYANALYSE_LAYOUT_AUTHORING_RULES,
    'For kind "blueprints", the top-level "blueprints" property MUST be an array, even when returning exactly one candidate. Never use a singular "blueprint" object.',
    'Each candidate MUST include title, summary, rationale, tradeoffs array, complete document, and issues array. Use view.canvas.units "px".',
    'candidate.issues is for human-visible caveats, recoverable format diagnostics, and advisory validation/layout findings; it is not a substitute for making the blueprint displayable when you can repair it.',
    'A candidate may include optional simulation when you can build a lightweight preview model: {"schemaVersion":"easyanalyse-simulation-v1","manifest":{"schemaVersion":"easyanalyse-simulation-v1","name":"..."},"workerScript":"function run(input, context) { return { points: [...] }; }","defaultInput":{"parameters":{}}}. The workerScript must be plain JavaScript, must not use DOM, fetch, network, files, API keys, Tauri, or imports, and should return {points, summary?, logs?, metadata?}.',
    'If the user explicitly asks for simulation, parameter preview, sliders, graph preview, frequency response, or a worker script, put the structured artifact at blueprints[n].simulation. Do not merely mention simulation in summary, rationale, notes, issues, or document metadata.',
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
    '- If format checks report errors, continue by repairing the candidate or clearly explaining what remains blocked; do not stop with a provider-level error.',
    '- Place devices on a wide top-left coordinate grid and keep view.networkLines outside device bounds or omit them.',
    '- If a lightweight mathematical model is clear, include candidate.simulation with an easyanalyse-simulation-v1 manifest and sandboxed JavaScript workerScript; otherwise omit simulation instead of inventing unreliable math.',
    '- When the user explicitly requests simulation or a worker script, candidate.simulation belongs at blueprints[n].simulation and should not be replaced by summary text.',
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
          originalUserPrompt: input.prompt,
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
          beginBlueprintGeneration: input.beginBlueprintGeneration,
          createBlueprintCandidate: input.createBlueprintCandidate,
          toolExecutor: input.toolExecutor,
          progress: input.progress,
        })
      }

      let initialResult: ProviderParseResult
      try {
        initialResult = await runOnce(userPrompt)
      } catch (error) {
        const fallback = await buildConfiguredFilterFallback(input, provider, model, error)
        if (!fallback) throw error
        initialResult = fallback
      }

      let checked = await applyPostProviderSelfCheck(initialResult, selfCheckOptions, input.validateDocument, input.progress)
      if (!selfCheckOptions.enabled || !selfCheckOptions.repairOnIssues || checked.response.kind !== 'blueprints') {
        checked = await ensureConfiguredFilterSimulationArtifacts(checked, input)
        emitProgress(input.progress, { phase: 'complete', message: 'Agent provider run completed.', detail: { kind: checked.response.kind } })
        return checked
      }

      const repairTrace = [...(checked.repairTrace ?? [])]
      for (let attempt = 1; attempt <= Math.max(0, selfCheckOptions.maxRepairAttempts); attempt += 1) {
        if (!blueprintResponseHasSelfCheckIssues(checked)) break
        emitProgress(input.progress, { phase: 'repair', message: `Requesting self-check repair attempt ${attempt}.`, detail: { attempt } })
        const repairPrompt = buildSelfCheckRepairPrompt(input.prompt, checked)
        let repaired: ProviderParseResult
        try {
          repaired = await applyPostProviderSelfCheck(
            preserveBlueprintSimulationArtifacts(checked, await runOnce(repairPrompt)),
            { ...selfCheckOptions, repairOnIssues: false },
            input.validateDocument,
            input.progress,
          )
        } catch (error) {
          const message = `Self-check repair attempt ${attempt} failed; keeping the last usable provider result. ${getErrorMessage(error)}`
          emitProgress(input.progress, { phase: 'repair', message, detail: { attempt } })
          repairTrace.push({ attempt, ok: false, summary: message })
          checked = { ...checked, repairTrace: [...(checked.repairTrace ?? []), ...repairTrace] }
          break
        }
        const repairedOk = repaired.response.kind === 'blueprints' && !blueprintResponseHasSelfCheckIssues(repaired)
        repairTrace.push({
          attempt,
          ok: repairedOk,
          summary: repairedOk ? 'Self-check repair attempt returned candidates without hard format issues.' : 'Self-check repair attempt returned candidates that still have hard format issues.',
        })
        checked = { ...repaired, repairTrace: [...(repaired.repairTrace ?? []), ...repairTrace] }
        if (repairedOk) break
      }
      checked = await ensureConfiguredFilterSimulationArtifacts(checked, input)
      emitProgress(input.progress, { phase: 'complete', message: 'Agent provider run completed.', detail: { kind: checked.response.kind } })
      return checked
    },
  })
}

async function buildConfiguredFilterFallback(
  input: RunConfiguredAgentProviderInput,
  provider: AgentProviderConfig,
  model: AgentModelConfig,
  error: unknown,
): Promise<ProviderParseResult | null> {
  const providerErrorCode = recoverableProviderContentErrorCode(error)
  if (!providerErrorCode) return null
  const args = inferGenerateFilterBlueprintArgsFromPrompt(input.prompt)
  if (!args) return null

  emitProgress(input.progress, {
    phase: 'tool',
    message: 'Provider response was not usable; running tool generate_filter_blueprint from inferred filter parameters.',
    detail: { toolName: 'generate_filter_blueprint', inferred: true, providerErrorCode },
  })
  const toolExecutor = input.toolExecutor ?? runAgentTool
  const toolResult = await toolExecutor('generate_filter_blueprint', args, buildConfiguredToolRuntimeContext(input))
  const toolTrace: AgentToolTraceEntry[] = [{
    toolName: 'generate_filter_blueprint',
    ok: toolResult.ok,
    summary: toolResult.summary,
    issueCount: toolResult.issueCount,
  }]
  const candidate = extractToolCandidate(toolResult.data)
  if (!candidate) return null

  return {
    ok: true,
    issues: [],
    response: {
      schemaVersion: AGENT_RESPONSE_SCHEMA_VERSION,
      semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
      kind: 'blueprints',
      summary: 'Returned a deterministic filter blueprint candidate after the provider response could not be used directly.',
      warnings: [
        `Provider output was not usable (${providerErrorCode}); EasyAnalyse used generate_filter_blueprint for this explicit filter request.`,
      ],
      blueprints: [candidate],
    },
    metadata: {
      adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
      requestFormat: OPENAI_CHAT_COMPLETIONS_REQUEST_FORMAT,
      providerId: provider.id,
      modelId: model.id,
      responseId: 'easyanalyse-configured-filter-fallback',
      finishReason: `configured-filter-fallback-${providerErrorCode}`,
    },
    toolTrace,
  }
}

function recoverableProviderContentErrorCode(error: unknown): string | null {
  const code = error instanceof AgentProviderError
    ? error.code
    : isRecord(error) && typeof error.code === 'string'
      ? error.code
      : null
  if (
    code === 'AGENT_PROVIDER_PROTOCOL_ERROR'
    || code === 'AGENT_PROVIDER_PARSE_ERROR'
    || code === 'AGENT_PROVIDER_SCHEMA_ERROR'
  ) {
    return code
  }

  const message = getErrorMessage(error)
  if (/choices\[0\]\.message\.content|invalid AgentResponse|final AgentResponse JSON|invalid JSON/i.test(message)) {
    return code ?? 'AGENT_PROVIDER_CONTENT_UNUSABLE'
  }
  return null
}

function buildConfiguredToolRuntimeContext(input: RunConfiguredAgentProviderInput): AgentToolRuntimeContext {
  return {
    currentDocument: input.currentDocument ?? null,
    ...(input.getCurrentDocument ? { getCurrentDocument: input.getCurrentDocument } : {}),
    ...(input.getBlueprintWorkspace ? { getBlueprintWorkspace: input.getBlueprintWorkspace } : {}),
    ...(input.getSelectedBlueprintId ? { getSelectedBlueprintId: input.getSelectedBlueprintId } : {}),
    ...(input.getCurrentSelection ? { getCurrentSelection: input.getCurrentSelection } : {}),
    ...(input.getEditorFocus ? { getEditorFocus: input.getEditorFocus } : {}),
    ...(input.getEasyAnalyseFormatRules ? { getEasyAnalyseFormatRules: input.getEasyAnalyseFormatRules } : {}),
    ...(input.validateDocument ? { validateDocument: input.validateDocument } : {}),
    ...(input.beginBlueprintGeneration ? { beginBlueprintGeneration: input.beginBlueprintGeneration } : {}),
    ...(input.createBlueprintCandidate ? { createBlueprintCandidate: input.createBlueprintCandidate } : {}),
  }
}

function extractToolCandidate(data: unknown): AgentBlueprintCandidate | null {
  if (!isRecord(data) || !isRecord(data.candidate) || !isRecord(data.candidate.document)) return null
  return cloneJson(data.candidate as unknown as AgentBlueprintCandidate)
}

async function ensureConfiguredFilterSimulationArtifacts(
  result: ProviderParseResult,
  input: RunConfiguredAgentProviderInput,
): Promise<ProviderParseResult> {
  if (result.response.kind !== 'blueprints') return result
  if (result.response.blueprints.every((candidate) => candidate.simulation !== undefined)) return result
  if (!shouldAttachConfiguredFilterSimulation(input.prompt, result.toolTrace ?? [])) return result

  const args = inferGenerateFilterBlueprintArgsFromPrompt(input.prompt)
  if (!args) return result
  emitProgress(input.progress, {
    phase: 'tool',
    message: 'Running tool generate_filter_blueprint to preserve missing filter simulation artifact.',
    detail: { toolName: 'generate_filter_blueprint', inferred: true },
  })
  const toolExecutor = input.toolExecutor ?? runAgentTool
  const toolResult = await toolExecutor('generate_filter_blueprint', args, buildConfiguredToolRuntimeContext(input))
  const trace: AgentToolTraceEntry = {
    toolName: 'generate_filter_blueprint',
    ok: toolResult.ok,
    summary: toolResult.summary,
    issueCount: toolResult.issueCount,
  }
  const generated = extractToolCandidate(toolResult.data)
  if (!generated?.simulation) {
    return {
      ...result,
      toolTrace: [...(result.toolTrace ?? []), trace],
    }
  }

  let changed = false
  const blueprints = result.response.blueprints.map((candidate) => {
    if (candidate.simulation !== undefined) return candidate
    const shouldAttach = result.response.kind === 'blueprints' && result.response.blueprints.length === 1
      ? true
      : blueprintCandidatesShareIdentity(candidate, generated)
    if (!shouldAttach) return candidate
    changed = true
    return {
      ...candidate,
      simulation: cloneJson(generated.simulation),
    }
  })

  return {
    ...result,
    response: changed
      ? {
          ...result.response,
          blueprints,
        }
      : result.response,
    toolTrace: [...(result.toolTrace ?? []), trace],
  }
}

function shouldAttachConfiguredFilterSimulation(prompt: string, toolTrace: readonly AgentToolTraceEntry[]): boolean {
  if (toolTrace.some((entry) => entry.toolName === 'generate_filter_blueprint' && entry.ok)) return true
  return /generate_filter_blueprint|仿真|simulation|worker|frequency\s*response|频率响应|图表|预览/i.test(prompt)
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

function preserveBlueprintSimulationArtifacts(source: ProviderParseResult, target: ProviderParseResult): ProviderParseResult {
  if (source.response.kind !== 'blueprints' || target.response.kind !== 'blueprints') return target
  const sourceCandidates = source.response.blueprints.filter((candidate) => candidate.simulation !== undefined)
  if (sourceCandidates.length === 0) return target

  let changed = false
  const blueprints = target.response.blueprints.map((candidate) => {
    const matched = sourceCandidates.find((sourceCandidate) => blueprintCandidatesShareIdentity(candidate, sourceCandidate))
      ?? (sourceCandidates.length === 1 && target.response.kind === 'blueprints' && target.response.blueprints.length === 1 ? sourceCandidates[0] : undefined)
    if (matched?.simulation === undefined) return candidate
    changed = true
    return {
      ...candidate,
      simulation: cloneJson(matched.simulation),
    }
  })

  if (!changed) return target
  return {
    ...target,
    response: {
      ...target.response,
      blueprints,
    },
  }
}

type ParsedBlueprintCandidate = Extract<ProviderParseResult['response'], { kind: 'blueprints' }>['blueprints'][number]

function blueprintCandidatesShareIdentity(left: ParsedBlueprintCandidate, right: ParsedBlueprintCandidate): boolean {
  const leftDocumentId = left.document.document.id
  const rightDocumentId = right.document.document.id
  if (leftDocumentId && rightDocumentId && leftDocumentId === rightDocumentId) return true
  if (left.title.trim() !== right.title.trim()) return false
  const leftDeviceIds = left.document.devices.map((device) => device.id).sort().join('|')
  const rightDeviceIds = right.document.devices.map((device) => device.id).sort().join('|')
  return leftDeviceIds.length > 0 && leftDeviceIds === rightDeviceIds
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
      ...(candidate.simulation === undefined ? {} : { simulation: candidate.simulation }),
    }))
    : []
  return [
    'The previous EasyAnalyse AgentResponse candidate still has hard format issues from local self-check.',
    'Return a complete corrected AgentResponse v1 JSON object only. Do not explain outside JSON.',
    'Keep semantic v4 connectivity expressed only by terminal labels. Do not add wires/nodes/junctions/signalId.',
    'Repair the existing candidate with the smallest possible edit. If the circuit semantics are already correct, do not redesign the circuit.',
    'Fix schema/format errors that can prevent the document from opening. Semantic and layout findings in the report are advisory and are not blockers by themselves.',
    'Only change devices, terminals, labels, or topology when a hard format issue directly requires it.',
    'If a previous candidate includes simulation and the original user request asked for simulation or parameter preview, preserve candidate.simulation unless the simulation itself is invalid or impossible to repair.',
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
