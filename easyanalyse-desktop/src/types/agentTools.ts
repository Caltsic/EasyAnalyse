import type { BlueprintRecord, BlueprintWorkspaceFile } from './blueprint'
import type { DocumentFile, EditorSelection, ValidationIssue, ValidationReport } from './document'
import type { AgentBlueprintCandidate } from './agent'
import type { LayoutOverlapCheckOptions, LayoutOverlapReport } from '../lib/layoutValidation'

export type AgentToolName =
  | 'get_current_document'
  | 'get_blueprint_workspace'
  | 'get_blueprint_candidate'
  | 'compare_blueprint_candidate'
  | 'get_current_selection'
  | 'summarize_topology'
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
    checkedTextBoxCount: number
    checkedPairCount: number
    checkedNetworkLineDevicePairCount: number
    checkedTextDevicePairCount: number
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
  blueprintWorkspace?: BlueprintWorkspaceFile | null
  getBlueprintWorkspace?: () => Promise<BlueprintWorkspaceFile | null> | BlueprintWorkspaceFile | null
  selectedBlueprintId?: string | null
  getSelectedBlueprintId?: () => Promise<string | null> | string | null
  currentSelection?: EditorSelection | null
  getCurrentSelection?: () => Promise<EditorSelection | null> | EditorSelection | null
  getEditorFocus?: () => Promise<AgentEditorFocus | null> | AgentEditorFocus | null
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
  | {
      blueprintId?: string
      includeDocument?: boolean
      includeDocuments?: boolean
      includeArchived?: boolean
      source?: 'current_document' | 'selected_blueprint'
    }

export interface AgentEditorFocus {
  focusedDeviceId: string | null
  focusedLabelKey: string | null
  focusedNetworkLineId: string | null
}

export interface AgentDocumentSummary {
  id?: string
  title?: string
  deviceCount: number
  networkLineCount: number
  updatedAt?: string
}

export interface AgentBlueprintRecordSummary {
  id: string
  title: string
  description?: string
  lifecycleStatus: BlueprintRecord['lifecycleStatus']
  validationState: BlueprintRecord['validationState']
  source: BlueprintRecord['source']
  createdAt: string
  updatedAt: string
  baseMainDocumentHash?: string
  documentHash: string
  validationIssueCount: number
  agentIssueCount: number
  documentSummary: AgentDocumentSummary
  document?: DocumentFile
}

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

export interface GetBlueprintWorkspaceData {
  hasWorkspace: boolean
  selectedBlueprintId: string | null
  workspace: {
    workspaceId: string
    blueprintWorkspaceVersion: BlueprintWorkspaceFile['blueprintWorkspaceVersion']
    createdAt: string
    updatedAt: string
    mainDocument?: BlueprintWorkspaceFile['mainDocument']
    blueprintCount: number
    blueprints: AgentBlueprintRecordSummary[]
  } | null
}

export interface GetBlueprintCandidateData {
  hasWorkspace: boolean
  selectedBlueprintId: string | null
  requestedBlueprintId: string | null
  found: boolean
  blueprint: AgentBlueprintRecordSummary | null
}

export interface CompareBlueprintCandidateData {
  selectedBlueprintId: string | null
  requestedBlueprintId: string | null
  found: boolean
  hasCurrentDocument: boolean
  diff?: unknown
}

export interface GetCurrentSelectionData {
  selection: EditorSelection | null
  focus: AgentEditorFocus | null
  selectedBlueprintId: string | null
}

export interface SummarizeTopologyData {
  source: 'current_document' | 'selected_blueprint' | 'provided_document'
  blueprintId?: string
  documentSummary: AgentDocumentSummary
  devices: Array<{
    id: string
    title: string
    reference: string
    kind: string
    bounds: { x: number; y: number; width: number; height: number }
    connectionLabels: string[]
    terminals: Array<{
      id: string
      name: string
      direction: string
      label: string | null
      point: { x: number; y: number }
    }>
  }>
  connectionGroups: Array<{
    key: string
    label: string
    terminalIds: string[]
    deviceIds: string[]
    point: { x: number; y: number }
  }>
  deviceRelations: Array<{
    deviceId: string
    title: string
    upstreamDeviceIds: string[]
    downstreamDeviceIds: string[]
    relatedTerminalIds: string[]
    connectionLabels: string[]
  }>
  networkLines: Array<{
    id: string
    label: string
    position: { x: number; y: number }
    length: number
    orientation: string
    start: { x: number; y: number }
    end: { x: number; y: number }
  }>
  labelSuggestions: string[]
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
