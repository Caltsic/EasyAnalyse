import type {
  BlueprintHashAlgorithm,
  BlueprintLifecycleStatus,
  BlueprintMainDocumentRef,
  BlueprintRecord,
  BlueprintRuntimeState,
  BlueprintSource,
  BlueprintValidationState,
  BlueprintWorkspaceFile,
  BlueprintWorkspaceVersion,
} from '../types/blueprint'
import type { DocumentFile } from '../types/document'
import { DOCUMENT_HASH_ALGORITHM, hashDocument } from './documentHash'

const BLUEPRINT_WORKSPACE_VERSION = '1.0.0' satisfies BlueprintWorkspaceVersion
const LIFECYCLE_STATUSES = new Set<BlueprintLifecycleStatus>(['active', 'archived', 'deleted'])
const VALIDATION_STATES = new Set<BlueprintValidationState>(['unknown', 'valid', 'invalid'])
const SOURCES = new Set<BlueprintSource>(['manual_snapshot', 'manual_import', 'agent', 'agent_derived'])

export interface CreateEmptyBlueprintWorkspaceArgs {
  workspaceId?: string
  now?: string
  mainDocument?: Omit<BlueprintMainDocumentRef, 'hashAlgorithm'> & { hashAlgorithm?: BlueprintHashAlgorithm }
  appVersion?: string
  extensions?: Record<string, unknown>
}

export interface CreateBlueprintFromDocumentArgs {
  id?: string
  title?: string
  description?: string
  document: DocumentFile
  lifecycleStatus?: BlueprintLifecycleStatus
  validationState?: BlueprintValidationState
  validationReport?: BlueprintRecord['validationReport']
  baseMainDocumentHash?: string
  source?: BlueprintSource
  parentBlueprintId?: string
  appliedInfo?: BlueprintRecord['appliedInfo']
  now?: string
  tags?: string[]
  notes?: string
  extensions?: Record<string, unknown>
}

export function createEmptyBlueprintWorkspace(args: CreateEmptyBlueprintWorkspaceArgs = {}): BlueprintWorkspaceFile {
  const now = args.now ?? new Date().toISOString()
  const workspace: BlueprintWorkspaceFile = {
    blueprintWorkspaceVersion: BLUEPRINT_WORKSPACE_VERSION,
    workspaceId: args.workspaceId ?? createId('bpw'),
    createdAt: now,
    updatedAt: now,
    blueprints: [],
  }

  if (args.mainDocument) {
    workspace.mainDocument = normalizeMainDocumentRef(args.mainDocument)
  }
  if (args.appVersion !== undefined) {
    workspace.appVersion = args.appVersion
  }
  if (args.extensions !== undefined) {
    workspace.extensions = args.extensions
  }

  return workspace
}

export async function createBlueprintFromDocument(args: CreateBlueprintFromDocumentArgs): Promise<BlueprintRecord> {
  if (!isDocumentFile(args.document)) {
    throw new Error('Blueprint document must be a DocumentFile')
  }

  const now = args.now ?? new Date().toISOString()
  const lifecycleStatus = args.lifecycleStatus ?? 'active'
  const validationState = args.validationState ?? 'unknown'
  const source = args.source ?? 'manual_snapshot'

  assertLifecycleStatus(lifecycleStatus, 'lifecycleStatus')
  assertValidationState(validationState, 'validationState')
  assertSource(source, 'source')

  const documentSnapshot = cloneDocumentFile(args.document)

  const record: BlueprintRecord = {
    id: args.id ?? createId('bp'),
    title: args.title ?? documentSnapshot.document.title,
    lifecycleStatus,
    validationState,
    document: documentSnapshot,
    documentHash: await hashDocument(documentSnapshot),
    source,
    createdAt: now,
    updatedAt: now,
  }

  assignOptional(record, 'description', args.description)
  assignOptional(record, 'validationReport', args.validationReport)
  assignOptional(record, 'baseMainDocumentHash', args.baseMainDocumentHash)
  assignOptional(record, 'parentBlueprintId', args.parentBlueprintId)
  assignOptional(record, 'appliedInfo', args.appliedInfo)
  assignOptional(record, 'tags', args.tags)
  assignOptional(record, 'notes', args.notes)
  assignOptional(record, 'extensions', args.extensions)

  return record
}

export function normalizeBlueprintWorkspace(value: unknown): BlueprintWorkspaceFile {
  if (!isPlainRecord(value)) {
    throw new Error('Blueprint workspace must be an object')
  }

  if (value.blueprintWorkspaceVersion !== BLUEPRINT_WORKSPACE_VERSION) {
    throw new Error('Blueprint workspace version is required and must be 1.0.0')
  }

  if (!Array.isArray(value.blueprints)) {
    throw new Error('Blueprint workspace blueprints must be an array')
  }

  const blueprints = value.blueprints.map((blueprint, index) => normalizeBlueprintRecord(blueprint, index))
  const firstCreatedAt = blueprints[0]?.createdAt
  const latestUpdatedAt = latestIsoString(blueprints.map((blueprint) => blueprint.updatedAt))

  const workspace: BlueprintWorkspaceFile = {
    blueprintWorkspaceVersion: BLUEPRINT_WORKSPACE_VERSION,
    workspaceId: typeof value.workspaceId === 'string' && value.workspaceId.length > 0 ? value.workspaceId : createId('bpw'),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : (firstCreatedAt ?? new Date().toISOString()),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : (latestUpdatedAt ?? firstCreatedAt ?? new Date().toISOString()),
    blueprints,
  }

  if (value.mainDocument !== undefined) {
    if (!isPlainRecord(value.mainDocument)) {
      throw new Error('Blueprint workspace mainDocument must be an object')
    }
    workspace.mainDocument = normalizeMainDocumentRef(value.mainDocument)
  }
  if (value.appVersion !== undefined) {
    if (typeof value.appVersion !== 'string') {
      throw new Error('Blueprint workspace appVersion must be a string')
    }
    workspace.appVersion = value.appVersion
  }
  if (value.extensions !== undefined) {
    if (!isPlainRecord(value.extensions)) {
      throw new Error('Blueprint workspace extensions must be an object')
    }
    workspace.extensions = value.extensions
  }

  return workspace
}

export function isBlueprintWorkspaceFile(value: unknown): value is BlueprintWorkspaceFile {
  try {
    normalizeBlueprintWorkspace(value)
    return true
  } catch {
    return false
  }
}

export function serializeBlueprintWorkspace(workspace: BlueprintWorkspaceFile): string {
  const normalized = normalizeBlueprintWorkspace(workspace)
  return `${JSON.stringify(normalized, null, 2)}\n`
}

export function deserializeBlueprintWorkspace(json: string): BlueprintWorkspaceFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Blueprint workspace JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  return normalizeBlueprintWorkspace(parsed)
}

export function getBlueprintSidecarPath(documentPath: string): string {
  const slashIndex = documentPath.lastIndexOf('/')
  const directory = slashIndex >= 0 ? documentPath.slice(0, slashIndex + 1) : ''
  const fileName = slashIndex >= 0 ? documentPath.slice(slashIndex + 1) : documentPath
  const stem = fileName.endsWith('.json') ? fileName.slice(0, -'.json'.length) : fileName
  return `${directory}${stem}.easyanalyse-blueprints.json`
}

export function getBlueprintRuntimeState(record: BlueprintRecord, currentMainHash: string): BlueprintRuntimeState {
  return {
    isCurrentMainDocument: record.documentHash === currentMainHash,
    hasBaseHashMismatch: record.baseMainDocumentHash !== undefined && record.baseMainDocumentHash !== currentMainHash,
  }
}

function cloneDocumentFile(document: DocumentFile): DocumentFile {
  return JSON.parse(JSON.stringify(document)) as DocumentFile
}

function normalizeBlueprintRecord(value: unknown, index: number): BlueprintRecord {
  if (!isPlainRecord(value)) {
    throw new Error(`Blueprint record at index ${index} must be an object`)
  }

  const id = requireString(value.id, `Blueprint record at index ${index} id`)
  const title = requireString(value.title, `Blueprint record ${id} title`)
  const lifecycleStatus = requireString(value.lifecycleStatus, `Blueprint record ${id} lifecycleStatus`)
  assertLifecycleStatus(lifecycleStatus, `Blueprint record ${id} lifecycleStatus`)
  const validationState = requireString(value.validationState, `Blueprint record ${id} validationState`)
  assertValidationState(validationState, `Blueprint record ${id} validationState`)
  if (!isDocumentFile(value.document)) {
    throw new Error(`Blueprint record ${id} document must be a DocumentFile`)
  }
  const documentHash = requireString(value.documentHash, `Blueprint record ${id} documentHash`)
  const source = requireString(value.source, `Blueprint record ${id} source`)
  assertSource(source, `Blueprint record ${id} source`)
  const createdAt = requireString(value.createdAt, `Blueprint record ${id} createdAt`)
  const updatedAt = requireString(value.updatedAt, `Blueprint record ${id} updatedAt`)

  const record: BlueprintRecord = {
    id,
    title,
    lifecycleStatus,
    validationState,
    document: value.document,
    documentHash,
    source,
    createdAt,
    updatedAt,
  }

  assignOptionalString(record, 'description', value.description, id)
  if (value.validationReport !== undefined) {
    record.validationReport = value.validationReport as BlueprintRecord['validationReport']
  }
  assignOptionalString(record, 'baseMainDocumentHash', value.baseMainDocumentHash, id)
  assignOptionalString(record, 'parentBlueprintId', value.parentBlueprintId, id)
  assignOptional(record, 'appliedInfo', normalizeAppliedInfo(value.appliedInfo, id))
  assignOptionalStringArray(record, 'tags', value.tags, id)
  assignOptionalString(record, 'notes', value.notes, id)
  if (value.extensions !== undefined) {
    if (!isPlainRecord(value.extensions)) {
      throw new Error(`Blueprint record ${id} extensions must be an object`)
    }
    record.extensions = value.extensions
  }

  return record
}

function normalizeMainDocumentRef(value: Record<string, unknown>): BlueprintMainDocumentRef {
  const ref: BlueprintMainDocumentRef = {
    hashAlgorithm:
      value.hashAlgorithm === undefined ? DOCUMENT_HASH_ALGORITHM : requireHashAlgorithm(value.hashAlgorithm, 'mainDocument hashAlgorithm'),
  }
  assignOptionalString(ref, 'documentId', value.documentId, 'mainDocument')
  assignOptionalString(ref, 'path', value.path, 'mainDocument')
  assignOptionalString(ref, 'hash', value.hash, 'mainDocument')
  assignOptionalString(ref, 'updatedAt', value.updatedAt, 'mainDocument')
  return ref
}

function normalizeAppliedInfo(value: unknown, id: string): BlueprintRecord['appliedInfo'] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isPlainRecord(value)) {
    throw new Error(`Blueprint record ${id} appliedInfo must be an object`)
  }
  const appliedInfo = {
    appliedAt: requireString(value.appliedAt, `Blueprint record ${id} appliedInfo appliedAt`),
    appliedToMainDocumentHash: requireString(
      value.appliedToMainDocumentHash,
      `Blueprint record ${id} appliedInfo appliedToMainDocumentHash`,
    ),
    sourceBlueprintDocumentHash: requireString(
      value.sourceBlueprintDocumentHash,
      `Blueprint record ${id} appliedInfo sourceBlueprintDocumentHash`,
    ),
  }
  if (value.appVersion !== undefined) {
    return {
      ...appliedInfo,
      appVersion: requireString(value.appVersion, `Blueprint record ${id} appliedInfo appVersion`),
    }
  }
  return appliedInfo
}

function isDocumentFile(value: unknown): value is DocumentFile {
  return (
    isPlainRecord(value) &&
    value.schemaVersion === '4.0.0' &&
    isPlainRecord(value.document) &&
    typeof value.document.id === 'string' &&
    typeof value.document.title === 'string' &&
    Array.isArray(value.devices) &&
    isPlainRecord(value.view) &&
    isPlainRecord(value.view.canvas) &&
    value.view.canvas.units === 'px'
  )
}

function assertLifecycleStatus(value: string, label: string): asserts value is BlueprintLifecycleStatus {
  if (!LIFECYCLE_STATUSES.has(value as BlueprintLifecycleStatus)) {
    throw new Error(`${label} must be active, archived, or deleted`)
  }
}

function assertValidationState(value: string, label: string): asserts value is BlueprintValidationState {
  if (!VALIDATION_STATES.has(value as BlueprintValidationState)) {
    throw new Error(`${label} must be unknown, valid, or invalid`)
  }
}

function assertSource(value: string, label: string): asserts value is BlueprintSource {
  if (!SOURCES.has(value as BlueprintSource)) {
    throw new Error(`${label} must be manual_snapshot, manual_import, agent, or agent_derived`)
  }
}

function requireHashAlgorithm(value: unknown, label: string): BlueprintHashAlgorithm {
  if (value !== DOCUMENT_HASH_ALGORITHM) {
    throw new Error(`${label} must be ${DOCUMENT_HASH_ALGORITHM}`)
  }
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`)
  }
  return value
}

function assignOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function assignOptionalString<T extends object, K extends keyof T>(target: T, key: K, value: unknown, id: string): void {
  if (value !== undefined) {
    if (typeof value !== 'string') {
      throw new Error(`Blueprint record ${id} ${String(key)} must be a string`)
    }
    target[key] = value as T[K]
  }
}

function assignOptionalStringArray<T extends object, K extends keyof T>(target: T, key: K, value: unknown, id: string): void {
  if (value !== undefined) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new Error(`Blueprint record ${id} ${String(key)} must be an array of strings`)
    }
    target[key] = value as T[K]
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function latestIsoString(values: string[]): string | undefined {
  return values.reduce<string | undefined>((latest, value) => (latest === undefined || value > latest ? value : latest), undefined)
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}
