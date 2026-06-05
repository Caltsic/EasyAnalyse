export const EASYANALYSE_PROJECT_EXTENSION = '.easyanalyse'
export const EASYANALYSE_PROJECT_FORMAT_VERSION = '1.0.0'
export const EASYANALYSE_PROJECT_MANIFEST_RELATIVE_PATH = 'project.easyanalyse-project.json'
export const EASYANALYSE_PROJECT_DOCUMENT_RELATIVE_PATH = 'working-copy/document.json'
export const EASYANALYSE_PROJECT_BLUEPRINT_WORKSPACE_RELATIVE_PATH = 'blueprints/workspace.easyanalyse-blueprints.json'
export const LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH = 'working-copy/live-draft.raw.json.partial'

export interface EasyAnalyseProjectManifest {
  projectFormatVersion: typeof EASYANALYSE_PROJECT_FORMAT_VERSION
  createdAt: string
  updatedAt: string
  workingCopy: {
    documentPath: typeof EASYANALYSE_PROJECT_DOCUMENT_RELATIVE_PATH
    updatedAt?: string
  }
  blueprintWorkspace: {
    path: typeof EASYANALYSE_PROJECT_BLUEPRINT_WORKSPACE_RELATIVE_PATH
    updatedAt?: string
  }
  liveDraft?: {
    status: 'active' | 'cleared'
    version: number
    partialPath: typeof LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH
    updatedAt: string
    byteLength?: number
  }
}

export function isEasyAnalyseProjectPath(path: string | null | undefined): boolean {
  if (!path) return false
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalized.endsWith(EASYANALYSE_PROJECT_EXTENSION)
}

export function createEasyAnalyseProjectManifest(options: {
  now?: string
  liveDraftUpdatedAt?: string | null
  liveDraftStatus?: NonNullable<EasyAnalyseProjectManifest['liveDraft']>['status']
  liveDraftVersion?: number
  liveDraftByteLength?: number
} = {}): EasyAnalyseProjectManifest {
  const now = options.now ?? new Date().toISOString()
  const manifest: EasyAnalyseProjectManifest = {
    projectFormatVersion: EASYANALYSE_PROJECT_FORMAT_VERSION,
    createdAt: now,
    updatedAt: now,
    workingCopy: {
      documentPath: EASYANALYSE_PROJECT_DOCUMENT_RELATIVE_PATH,
    },
    blueprintWorkspace: {
      path: EASYANALYSE_PROJECT_BLUEPRINT_WORKSPACE_RELATIVE_PATH,
    },
  }

  if (options.liveDraftUpdatedAt) {
    manifest.liveDraft = {
      status: options.liveDraftStatus ?? 'active',
      version: Math.max(1, Math.trunc(options.liveDraftVersion ?? 1)),
      partialPath: LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH,
      updatedAt: options.liveDraftUpdatedAt,
      ...(options.liveDraftByteLength === undefined
        ? {}
        : { byteLength: Math.max(0, Math.trunc(options.liveDraftByteLength)) }),
    }
  }

  return manifest
}

export function normalizeEasyAnalyseProjectManifest(
  value: unknown,
  options: { now?: string } = {},
): EasyAnalyseProjectManifest {
  const now = options.now ?? new Date().toISOString()
  if (!isPlainRecord(value) || value.projectFormatVersion !== EASYANALYSE_PROJECT_FORMAT_VERSION) {
    return createEasyAnalyseProjectManifest({ now })
  }

  const createdAt = typeof value.createdAt === 'string' && value.createdAt.trim() ? value.createdAt : now
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt.trim() ? value.updatedAt : createdAt
  const workingCopy = normalizeProjectSection(value.workingCopy)
  const blueprintWorkspace = normalizeProjectSection(value.blueprintWorkspace)
  const liveDraft = normalizeLiveDraft(value.liveDraft, now)

  return {
    projectFormatVersion: EASYANALYSE_PROJECT_FORMAT_VERSION,
    createdAt,
    updatedAt,
    workingCopy: {
      documentPath: EASYANALYSE_PROJECT_DOCUMENT_RELATIVE_PATH,
      ...(workingCopy.updatedAt ? { updatedAt: workingCopy.updatedAt } : {}),
    },
    blueprintWorkspace: {
      path: EASYANALYSE_PROJECT_BLUEPRINT_WORKSPACE_RELATIVE_PATH,
      ...(blueprintWorkspace.updatedAt ? { updatedAt: blueprintWorkspace.updatedAt } : {}),
    },
    ...(liveDraft ? { liveDraft } : {}),
  }
}

function normalizeLiveDraft(value: unknown, now: string): EasyAnalyseProjectManifest['liveDraft'] | null {
  if (!isPlainRecord(value)) {
    return null
  }
  const status = value.status === 'cleared' ? 'cleared' : 'active'
  const version = typeof value.version === 'number' && Number.isFinite(value.version)
    ? Math.max(1, Math.trunc(value.version))
    : 1
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt.trim() ? value.updatedAt : now
  const byteLength = typeof value.byteLength === 'number' && Number.isFinite(value.byteLength)
    ? Math.max(0, Math.trunc(value.byteLength))
    : undefined
  return {
    status,
    version,
    partialPath: LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH,
    updatedAt,
    ...(byteLength === undefined ? {} : { byteLength }),
  }
}

function normalizeProjectSection(value: unknown): { updatedAt?: string } {
  if (!isPlainRecord(value) || typeof value.updatedAt !== 'string' || !value.updatedAt.trim()) {
    return {}
  }
  return { updatedAt: value.updatedAt }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
