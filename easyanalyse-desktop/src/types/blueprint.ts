import type { DocumentFile, ValidationReport } from './document'

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
  extensions?: Record<string, unknown>
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
  extensions?: Record<string, unknown>
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
