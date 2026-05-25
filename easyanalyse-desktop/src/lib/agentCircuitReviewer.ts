import { deriveCircuitInsights } from './circuitDescription'
import { isRecord } from './guards'
import type { AgentCircuitCorrectnessReviewReport } from '../types/agentTools'
import type { DocumentFile } from '../types/document'
import type { AgentProviderPublicConfig } from '../types/settings'

export interface CircuitReviewerFetchInit {
  method: 'POST'
  headers: Record<string, string>
  body: string
  signal?: AbortSignal
}

export type CircuitReviewerFetch = (url: string, init: CircuitReviewerFetchInit) => Promise<Response>

export interface RunCircuitCorrectnessReviewerInput {
  provider: AgentProviderPublicConfig
  modelId: string
  apiKey: string
  userRequest: string
  reviewFocus?: string
  candidateTitle?: string
  document: DocumentFile
  fetchImpl: CircuitReviewerFetch
  signal?: AbortSignal
}

type JsonRecord = Record<string, unknown>

const REVIEW_SCHEMA_VERSION = 'agent-circuit-correctness-review-v1' as const
const SEMANTIC_VERSION = 'easyanalyse-semantic-v4' as const
const VALID_VERDICTS = new Set(['pass', 'warning', 'fail', 'unknown'])

export async function runCircuitCorrectnessReviewer(
  input: RunCircuitCorrectnessReviewerInput,
): Promise<AgentCircuitCorrectnessReviewReport> {
  const apiKey = input.apiKey.trim()
  if (!apiKey) throw new Error('Reviewer provider API key is empty.')

  const systemPrompt = buildReviewerSystemPrompt()
  const userPrompt = buildReviewerUserPrompt(input)
  const responseText = input.provider.kind === 'anthropic'
    ? await requestAnthropicReviewer(input, systemPrompt, userPrompt)
    : await requestOpenAiCompatibleReviewer(input, systemPrompt, userPrompt)

  return parseCircuitCorrectnessReviewReport(responseText, {
    providerId: input.provider.id,
    modelId: input.modelId,
    redactions: [apiKey],
  })
}

export function parseCircuitCorrectnessReviewReport(
  text: string,
  options: { providerId?: string; modelId?: string; redactions?: string[] } = {},
): AgentCircuitCorrectnessReviewReport {
  const parsed = parseJsonObject(text)
  if (!isRecord(parsed)) {
    return unknownReport(
      'Reviewer response could not be parsed as a JSON object.',
      ['The reviewer did not return the required report JSON object.'],
      ['Retry the review, or inspect the circuit manually before applying it.'],
      options,
    )
  }

  const verdict = typeof parsed.verdict === 'string' && VALID_VERDICTS.has(parsed.verdict)
    ? parsed.verdict as AgentCircuitCorrectnessReviewReport['verdict']
    : 'unknown'
  const confidence = normalizeConfidence(parsed.confidence)
  const summary = stringOrFallback(parsed.summary, verdict === 'unknown' ? 'Reviewer report is incomplete.' : `Reviewer verdict: ${verdict}.`)
  const reasons = stringArray(parsed.reasons, ['Reviewer did not provide detailed reasons.'])
  const suggestions = stringArray(parsed.suggestions, [])
  const checkedAssumptions = stringArray(parsed.checkedAssumptions, [])

  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    semanticVersion: SEMANTIC_VERSION,
    verdict,
    confidence,
    summary: redact(summary, options.redactions),
    reasons: reasons.map((item) => redact(item, options.redactions)),
    suggestions: suggestions.map((item) => redact(item, options.redactions)),
    checkedAssumptions: checkedAssumptions.map((item) => redact(item, options.redactions)),
    ...(options.providerId && options.modelId ? { reviewer: { providerId: options.providerId, modelId: options.modelId } } : {}),
  }
}

function buildReviewerSystemPrompt(): string {
  return [
    'You are the strict EasyAnalyse circuit correctness reviewer.',
    'Your only task is to judge whether the submitted EasyAnalyse semantic circuit logically satisfies the user request.',
    'Be skeptical. Passing JSON format does not mean the circuit is electrically correct.',
    'Check topology, component roles, terminal-label connectivity, values, supplies, feedback, and whether the stated behavior can plausibly work.',
    'Do not rewrite the circuit. Do not create a blueprint. Return only one JSON object.',
    'Use verdict "pass" only when the circuit is logically consistent with the request.',
    'Use verdict "warning" when the circuit is mostly plausible but has assumptions or meaningful risks.',
    'Use verdict "fail" when the topology, connectivity, values, or required function are materially wrong.',
    'Use verdict "unknown" when the document or request lacks enough information to judge.',
    'Required JSON shape: {"verdict":"pass|warning|fail|unknown","confidence":0.0,"summary":"...","reasons":["..."],"suggestions":["..."],"checkedAssumptions":["..."]}.',
  ].join('\n')
}

function buildReviewerUserPrompt(input: RunCircuitCorrectnessReviewerInput): string {
  return [
    `User request:\n${input.userRequest.trim() || '(no explicit request was provided)'}`,
    input.reviewFocus ? `\nReview focus:\n${input.reviewFocus.trim()}` : '',
    input.candidateTitle ? `\nCandidate title:\n${input.candidateTitle}` : '',
    '\nCompact topology summary:',
    JSON.stringify(buildTopologySummary(input.document)),
    '\nComplete EasyAnalyse semantic v4 JSON:',
    JSON.stringify(input.document),
  ].filter(Boolean).join('\n')
}

function buildTopologySummary(document: DocumentFile): JsonRecord {
  const insights = deriveCircuitInsights(document)
  return {
    title: document.document.title,
    devices: document.devices.map((device) => ({
      id: device.id,
      name: device.name,
      kind: device.kind,
      reference: device.reference,
      properties: device.properties,
      terminals: device.terminals.map((terminal) => ({
        id: terminal.id,
        name: terminal.name,
        label: terminal.label,
        direction: terminal.direction,
      })),
    })),
    connectionGroups: insights.connectionGroups.map((group) => ({
      label: group.label,
      deviceIds: group.deviceIds,
      terminalIds: group.terminalIds,
    })),
  }
}

async function requestOpenAiCompatibleReviewer(
  input: RunCircuitCorrectnessReviewerInput,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const body = {
    model: input.modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
    stream: false,
    response_format: { type: 'json_object' },
  }
  const response = await sendReviewerRequest(input, buildChatCompletionsUrl(input.provider.baseUrl), {
    Authorization: `Bearer ${input.apiKey}`,
    'Content-Type': 'application/json',
  }, body)
  const choice = Array.isArray(response.choices) && isRecord(response.choices[0]) ? response.choices[0] : null
  const message = isRecord(choice?.message) ? choice.message : null
  const content = message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    return ''
  }
  return content
}

async function requestAnthropicReviewer(
  input: RunCircuitCorrectnessReviewerInput,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const body = {
    model: input.modelId,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0,
    max_tokens: 2048,
    stream: false,
  }
  const response = await sendReviewerRequest(input, buildAnthropicMessagesUrl(input.provider.baseUrl), {
    'x-api-key': input.apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  }, body)
  const content = Array.isArray(response.content) ? response.content : []
  return content
    .map((item) => isRecord(item) && typeof item.text === 'string' ? item.text : '')
    .filter(Boolean)
    .join('\n')
}

async function sendReviewerRequest(
  input: RunCircuitCorrectnessReviewerInput,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<JsonRecord> {
  let response: Response
  try {
    response = await input.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  } catch (error) {
    throw new Error(redact(`Reviewer provider network error: ${error instanceof Error ? error.message : String(error)}`, [input.apiKey]))
  }
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!response.ok) {
    throw new Error(redact(`Reviewer provider HTTP ${response.status}: ${extractProviderErrorMessage(parsed)}`, [input.apiKey]))
  }
  if (!isRecord(parsed)) {
    throw new Error('Reviewer provider returned a non-object response.')
  }
  return parsed
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '')
  if (/\/chat\/completions$/iu.test(trimmed)) return trimmed
  if (/\/v1$/iu.test(trimmed)) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

function buildAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '')
  if (/\/v1\/messages$/iu.test(trimmed)) return trimmed
  if (/\/v1$/iu.test(trimmed)) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown
      } catch {
        return null
      }
    }
    return null
  }
}

function unknownReport(
  summary: string,
  reasons: string[],
  suggestions: string[],
  options: { providerId?: string; modelId?: string; redactions?: string[] },
): AgentCircuitCorrectnessReviewReport {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    semanticVersion: SEMANTIC_VERSION,
    verdict: 'unknown',
    confidence: 0,
    summary: redact(summary, options.redactions),
    reasons: reasons.map((item) => redact(item, options.redactions)),
    suggestions: suggestions.map((item) => redact(item, options.redactions)),
    checkedAssumptions: [],
    ...(options.providerId && options.modelId ? { reviewer: { providerId: options.providerId, modelId: options.modelId } } : {}),
  }
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const values = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return values.length > 0 ? values.map((item) => item.trim()) : fallback
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function extractProviderErrorMessage(value: unknown): string {
  if (!isRecord(value)) return String(value)
  const error = isRecord(value.error) ? value.error : value
  return stringOrFallback(error.message, JSON.stringify(value))
}

function redact(value: string, redactions: readonly string[] = []): string {
  return redactions.reduce((text, secret) => secret ? text.split(secret).join('[redacted-api-key]') : text, value)
    .replace(/sk-[A-Za-z0-9._-]+/g, '[redacted-api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted-api-key]')
    .replace(/Authorization/giu, 'auth header')
    .replace(/apiKey/giu, 'api key')
}
