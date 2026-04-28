import type { DocumentFile, ValidationIssue } from './document'

export type AgentResponseSchemaVersion = 'agent-response-v1'
export type AgentResponseKind = 'message' | 'blueprints' | 'patch' | 'question' | 'error'
export type AgentCapabilityState = boolean | 'deferred' | 'unsupported'
export type AgentCapabilities = Partial<Record<AgentResponseKind, AgentCapabilityState>>

export interface AgentResponseBase {
  schemaVersion: AgentResponseSchemaVersion
  semanticVersion?: string
  capabilities?: AgentCapabilities
  kind: AgentResponseKind
  requestId?: string
  summary?: string
  warnings?: string[]
}

export interface AgentMessageResponse extends AgentResponseBase {
  kind: 'message'
  markdown: string
}

export interface AgentBlueprintCandidate {
  title: string
  summary: string
  rationale: string
  tradeoffs: string[]
  document: DocumentFile
  highlightedLabels?: string[]
  notes?: string[]
  issues: ValidationIssue[]
}

export interface AgentBlueprintsResponse extends AgentResponseBase {
  kind: 'blueprints'
  summary: string
  blueprints: AgentBlueprintCandidate[]
}

export interface AgentPatchResponse extends AgentResponseBase {
  kind: 'patch'
  unsupported: true
  message: string
}

export interface AgentQuestionResponse extends AgentResponseBase {
  kind: 'question'
  question: string
  options?: string[]
}

export interface AgentErrorResponse extends AgentResponseBase {
  kind: 'error'
  message: string
  recoverable: boolean
}

export type AgentResponse =
  | AgentMessageResponse
  | AgentBlueprintsResponse
  | AgentPatchResponse
  | AgentQuestionResponse
  | AgentErrorResponse

export interface AgentResponseParseIssue extends ValidationIssue {
  candidateIndex?: number
}

export interface AgentResponseParseResult {
  ok: true
  response: AgentResponse
  issues: AgentResponseParseIssue[]
}

export interface AgentResponseParseOptions {
  /** Optional reference used by callers/tests to prove parsing never mutates the main document. */
  mainDocument?: DocumentFile | null
}
