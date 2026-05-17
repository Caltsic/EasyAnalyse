import type { DocumentFile, ValidationIssue, ValidationReport } from './document'
import type { AgentSelfCheckReport } from './agentTools'
import type { AgentThreadWorkspace } from './agentThread'

export type BlueprintWorkspaceVersion = '1.0.0'
export type BlueprintLifecycleStatus = 'active' | 'archived' | 'deleted'
export type BlueprintValidationState = 'unknown' | 'valid' | 'invalid'
export type BlueprintSource = 'manual_snapshot' | 'manual_import' | 'agent' | 'agent_derived'
export type BlueprintHashAlgorithm = 'easyanalyse-document-canonical-sha256-v1'

export interface BlueprintWorkspaceFile {
  blueprintWorkspaceVersion: BlueprintWorkspaceVersion
  workspaceId: string
  mainDocument?: BlueprintMainDocumentRef
  createdAt: string
  updatedAt: string
  appVersion?: string
  blueprints: BlueprintRecord[]
  extensions?: BlueprintWorkspaceExtensions
}

export interface BlueprintWorkspaceExtensions extends Record<string, unknown> {
  agentThreads?: AgentThreadWorkspace
}

export interface BlueprintMainDocumentRef {
  documentId?: string
  path?: string
  hash?: string
  hashAlgorithm: BlueprintHashAlgorithm
  updatedAt?: string
}

export interface BlueprintRecord {
  id: string
  title: string
  description?: string
  lifecycleStatus: BlueprintLifecycleStatus
  validationState: BlueprintValidationState
  validationReport?: ValidationReport
  document: DocumentFile
  documentHash: string
  baseMainDocumentHash?: string
  source: BlueprintSource
  parentBlueprintId?: string
  appliedInfo?: BlueprintAppliedInfo
  createdAt: string
  updatedAt: string
  tags?: string[]
  notes?: string
  extensions?: BlueprintRecordExtensions
}

export interface BlueprintRecordExtensions extends Record<string, unknown> {
  agentCandidate?: {
    highlightedLabels?: string[]
    issues?: ValidationIssue[]
    parseIssues?: ValidationIssue[]
    selfCheck?: AgentSelfCheckReport
    toolIssues?: ValidationIssue[]
  }
}

export interface BlueprintAppliedInfo {
  appliedAt: string
  appliedToMainDocumentHash: string
  sourceBlueprintDocumentHash: string
  appVersion?: string
}

export interface BlueprintRuntimeState {
  isCurrentMainDocument: boolean
  hasBaseHashMismatch: boolean
}
