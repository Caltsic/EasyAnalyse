import type { DocumentFile, ValidationIssue, ValidationReport } from './document'
import type { AgentBlueprintCandidate } from './agent'
import type { LayoutOverlapCheckOptions, LayoutOverlapReport } from '../lib/layoutValidation'

export type AgentToolName =
  | 'get_current_document'
  | 'get_easyanalyse_format_rules'
  | 'check_document_format'
  | 'check_blueprint_format'
  | 'create_blueprint_candidate'
  | 'validate_document'
  | 'check_layout_overlaps'
  | 'check_blueprint_candidate'

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
    checkedNetworkLineCount: number
    checkedPairCount: number
    checkedNetworkLineDevicePairCount: number
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

export type AgentToolExecutor = (
  toolName: string,
  args: unknown,
  context?: AgentToolRuntimeContext,
) => Promise<AgentToolResult> | AgentToolResult

export interface AgentToolRuntimeContext {
  currentDocument?: DocumentFile | null
  getCurrentDocument?: () => Promise<DocumentFile | null> | DocumentFile | null
  getEasyAnalyseFormatRules?: () => Promise<string> | string
  validateDocument?: (document: DocumentFile) => Promise<ValidationReport> | ValidationReport
  createBlueprintCandidate?: (
    candidate: AgentBlueprintCandidate,
    context: {
      format: AgentFormatCheckReport
      sourceTool: 'create_blueprint_candidate'
    },
  ) => Promise<unknown> | unknown
}

export type AgentToolContext = AgentToolRuntimeContext

export type AgentToolInput =
  | Record<string, never>
  | { document?: DocumentFile | string; json?: string; options?: LayoutOverlapCheckOptions }
  | { document: DocumentFile; options?: LayoutOverlapCheckOptions }
  | { candidate: AgentBlueprintCandidate | { document: DocumentFile }; options?: LayoutOverlapCheckOptions }

export interface AgentFormatCheckReport {
  ok: boolean
  parsed: boolean
  schemaValid: boolean
  semanticValid?: boolean
  issueCount: number
  issues: ValidationIssue[]
}

export interface GetCurrentDocumentData {
  hasDocument: boolean
  document: DocumentFile | null
}

export interface GetEasyAnalyseFormatRulesData {
  rules: string
}

export interface CheckDocumentFormatData {
  format: AgentFormatCheckReport
  validation?: ValidationReport
  normalizedDocument?: DocumentFile | null
}

export interface CheckBlueprintFormatData {
  format: AgentFormatCheckReport
  document?: CheckDocumentFormatData
}

export interface CreateBlueprintCandidateData {
  created: boolean
  format: AgentFormatCheckReport
  result?: unknown
}

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
