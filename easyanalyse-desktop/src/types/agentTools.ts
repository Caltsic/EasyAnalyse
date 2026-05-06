import type { DocumentFile, ValidationIssue, ValidationReport } from './document'
import type { AgentBlueprintCandidate } from './agent'
import type { LayoutOverlapCheckOptions, LayoutOverlapReport } from '../lib/layoutValidation'

export type AgentToolName = 'validate_document' | 'check_layout_overlaps' | 'check_blueprint_candidate'

export interface AgentToolResult<TData = unknown> {
  schemaVersion: 'agent-tool-result-v1'
  semanticVersion: 'easyanalyse-semantic-v4'
  ok: boolean
  toolName: AgentToolName
  summary: string
  issueCount: number
  issues: ValidationIssue[]
  data?: TData
}

export interface AgentSelfCheckReport {
  schemaVersion: 'agent-self-check-v1'
  semanticVersion: 'easyanalyse-semantic-v4'
  ok: boolean
  summary: string
  candidates: AgentSelfCheckCandidateReport[]
}

export interface AgentSelfCheckCandidateReport {
  index: number
  title?: string
  ok: boolean
  issueCount: number
  validation: {
    ok: boolean
    schemaValid: boolean
    semanticValid: boolean
    issueCount: number
    issues: ValidationIssue[]
  }
  layout: {
    ok: boolean
    issueCount: number
    checkedDeviceCount: number
    checkedPairCount: number
    issues: ValidationIssue[]
  }
}

export interface AgentToolTraceEntry {
  toolName: AgentToolName | string
  ok: boolean
  summary: string
  issueCount: number
}

export interface AgentRepairTraceEntry {
  attempt: number
  ok: boolean
  summary: string
}

export interface AgentToolContext {
  validateDocument?: (document: DocumentFile) => Promise<ValidationReport> | ValidationReport
}

export type AgentToolInput =
  | { document: DocumentFile; options?: LayoutOverlapCheckOptions }
  | { candidate: AgentBlueprintCandidate | { document: DocumentFile }; options?: LayoutOverlapCheckOptions }

export interface CheckBlueprintCandidateData {
  selfCheck: AgentSelfCheckReport
}

export interface ValidateDocumentData {
  validation: ValidationReport
  normalizedDocument?: DocumentFile | null
}

export interface CheckLayoutOverlapsData {
  layout: LayoutOverlapReport
}
