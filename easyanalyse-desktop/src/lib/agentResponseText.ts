import {
  AGENT_RESPONSE_SCHEMA_VERSION,
  AGENT_RESPONSE_SEMANTIC_VERSION,
  parseAgentResponse,
} from './agentResponse'
import { isRecord } from './guards'
import type { AgentResponse, AgentResponseParseResult } from '../types/agent'
import type { DocumentFile } from '../types/document'

export type AgentResponseTextExtraction =
  | 'strict'
  | 'fenced'
  | 'trailing-json'
  | 'lenient-message'
  | 'plain-text'

export interface AgentResponseTextResult extends AgentResponseParseResult {
  rawText: string
  conversationText: string
  extraction: AgentResponseTextExtraction
  diagnostics: string[]
}

type JsonRecord = Record<string, unknown>

export function extractAgentResponseText(
  text: string,
  options: { mainDocument?: DocumentFile | null } = {},
): AgentResponseTextResult {
  const rawText = text
  const parseText = text.trim()
  if (!parseText) {
    throw new Error('Provider response did not include non-empty assistant text.')
  }

  let strictError: unknown
  try {
    return finalize(parseAgentResponse(parseText, options), rawText, 'strict')
  } catch (error) {
    strictError = error
  }

  const fenced = parseFenced(parseText, options)
  if (fenced) return finalize(fenced, rawText, 'fenced', [diagnostic(strictError)])

  const trailing = parseTrailing(parseText, options)
  if (trailing) {
    const prefix = parseText.slice(0, trailing.start).trim()
    return finalize(
      trailing.parsed,
      rawText,
      'trailing-json',
      [diagnostic(strictError)],
      prefix || undefined,
    )
  }

  const lenient = parseLenientMessage(parseText)
  if (lenient) return finalize(lenient, rawText, 'lenient-message', [diagnostic(strictError)])

  return finalize(
    plainTextResponse(parseText, 'Provider message'),
    rawText,
    'plain-text',
    [`Structured AgentResponse extraction failed; preserved the provider text. ${diagnostic(strictError)}`],
    rawText,
  )
}

export function conversationTextFromAgentResponse(response: AgentResponse): string {
  if (response.kind === 'message') {
    return response.summary?.trim()
      ? `${response.summary.trim()}\n\n${response.markdown.trim()}`.trim()
      : response.markdown.trim()
  }
  if (response.kind === 'question') {
    const options = response.options?.filter((item) => item.trim()).join(', ')
    return options ? `${response.question.trim()}\n\nOptions: ${options}` : response.question.trim()
  }
  if (response.kind === 'error') return response.message.trim()
  if (response.kind === 'patch') return response.message.trim()
  return response.summary.trim()
}

function finalize(
  parsed: AgentResponseParseResult,
  rawText: string,
  extraction: AgentResponseTextExtraction,
  diagnostics: string[] = [],
  preferredConversationText?: string,
): AgentResponseTextResult {
  const visible = preferredConversationText?.trim() || conversationTextFromAgentResponse(parsed.response)
  if (visible) {
    return { ...parsed, rawText, conversationText: visible, extraction, diagnostics: diagnostics.filter(Boolean) }
  }

  return {
    ...plainTextResponse(rawText),
    rawText,
    conversationText: rawText,
    extraction: 'plain-text',
    diagnostics: [
      ...diagnostics,
      'The structured response contained no visible conversation text; preserved the raw provider response.',
    ].filter(Boolean),
  }
}

function parseFenced(
  text: string,
  options: { mainDocument?: DocumentFile | null },
): AgentResponseParseResult | null {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (!match) return null
  try {
    return parseAgentResponse(match[1]!.trim(), options)
  } catch {
    return null
  }
}

function parseTrailing(
  text: string,
  options: { mainDocument?: DocumentFile | null },
): { parsed: AgentResponseParseResult; start: number } | null {
  const trimmedEnd = text.trimEnd().length
  for (let start = text.lastIndexOf('{'); start >= 0;) {
    const candidate = extractJsonObjectStringAt(text, start)
    if (candidate && start + candidate.length === trimmedEnd) {
      try {
        return { parsed: parseAgentResponse(candidate, options), start }
      } catch {
        // The last opening brace may belong to a nested object inside the
        // trailing AgentResponse. Keep scanning toward the full root object.
      }
    }
    if (start === 0) break
    start = text.lastIndexOf('{', start - 1)
  }
  return null
}

function parseLenientMessage(text: string): AgentResponseParseResult | null {
  const root = parseLooseJsonObject(text)
  if (!root) return null
  const kind = typeof root.kind === 'string' ? root.kind : undefined
  if (kind === 'blueprints' || Array.isArray(root.blueprints)) return null
  if (kind !== undefined && kind !== 'message' && kind !== 'question' && kind !== 'error') return null
  if (typeof root.schemaVersion === 'string' && root.schemaVersion !== AGENT_RESPONSE_SCHEMA_VERSION) return null
  if (typeof root.semanticVersion === 'string' && root.semanticVersion !== AGENT_RESPONSE_SEMANTIC_VERSION) return null

  const markdown = extractMessageText(root)
  if (!markdown) return null
  return plainTextResponse(markdown, typeof root.summary === 'string' ? root.summary.trim() : undefined)
}

function plainTextResponse(markdown: string, summary?: string): AgentResponseParseResult {
  return {
    ok: true,
    response: {
      schemaVersion: AGENT_RESPONSE_SCHEMA_VERSION,
      semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
      kind: 'message',
      ...(summary ? { summary } : {}),
      markdown,
    },
    issues: [],
  }
}

function parseLooseJsonObject(text: string): JsonRecord | null {
  if (!text.startsWith('{')) return null
  try {
    const parsed = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractMessageText(root: JsonRecord): string | null {
  const direct = [
    root.markdown,
    root.message,
    root.content,
    root.text,
    root.answer,
    root.response,
    root.summary,
  ].map(stringFromMessageValue).find((value): value is string => value !== null)
  if (direct) return direct
  if (root.kind === 'question') return stringFromMessageValue(root.question)
  if (root.kind === 'error') return stringFromMessageValue(root.message)
  return null
}

function stringFromMessageValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    const parts = value.map(stringFromMessageValue).filter((part): part is string => part !== null)
    return parts.length > 0 ? parts.join('\n') : null
  }
  if (isRecord(value)) {
    const nested = [
      value.markdown,
      value.message,
      value.content,
      value.text,
      value.answer,
      value.response,
      value.summary,
    ].map(stringFromMessageValue).find((part): part is string => part !== null)
    if (nested) return nested
    try {
      const serialized = JSON.stringify(value)
      return serialized !== '{}' ? serialized : null
    } catch {
      return null
    }
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function extractJsonObjectStringAt(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
      if (depth < 0) return null
    }
  }
  return null
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
