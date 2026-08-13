import type { AgentResponse, AgentResponseParseIssue } from '../types/agent'
import type { AgentRepairTraceEntry, AgentToolTraceEntry } from '../types/agentTools'
import type { ProviderResponseMetadata } from './openAiCompatibleProvider'

export type AgentRuntimeKind = 'legacy' | 'pi'
export type AgentConversationStatus = 'complete' | 'partial' | 'error' | 'cancelled'

export interface AgentRuntimeDiagnostic {
  source: 'provider' | 'parse' | 'artifact' | 'tool' | 'runtime'
  severity: 'info' | 'warning' | 'error'
  message: string
  code?: string
}

export type AgentRuntimeEvent =
  | { type: 'assistant-delta'; text: string }
  | { type: 'assistant-final'; text: string; status: AgentConversationStatus }
  | { type: 'tool-started'; toolName: string; toolCallId?: string }
  | { type: 'tool-finished'; toolName: string; toolCallId?: string; ok: boolean; summary: string; issueCount: number }
  | { type: 'artifact-created'; artifactType: 'blueprint'; ids: string[]; summary: string }
  | { type: 'artifact-rejected'; artifactType: 'blueprint'; summary: string }
  | { type: 'diagnostic'; diagnostic: AgentRuntimeDiagnostic }
  | { type: 'run-error'; message: string; partialText: string }
  | { type: 'run-cancelled'; partialText: string }

export type AgentRuntimeEventHandler = (event: AgentRuntimeEvent) => void

export interface AgentRuntimeResult {
  runtime: AgentRuntimeKind
  conversation: {
    text: string
    status: AgentConversationStatus
  }
  providerText?: string
  response?: AgentResponse
  issues: AgentResponseParseIssue[]
  diagnostics: AgentRuntimeDiagnostic[]
  metadata?: ProviderResponseMetadata
  toolTrace: AgentToolTraceEntry[]
  repairTrace: AgentRepairTraceEntry[]
  artifactsStoredByTools: boolean
}

export function diagnosticFromMessage(
  source: AgentRuntimeDiagnostic['source'],
  message: string,
  severity: AgentRuntimeDiagnostic['severity'] = 'warning',
  code?: string,
): AgentRuntimeDiagnostic {
  return { source, severity, message, ...(code ? { code } : {}) }
}
