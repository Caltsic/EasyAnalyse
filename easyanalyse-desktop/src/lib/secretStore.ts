import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './tauri'

export const SECRET_REF_PREFIX = 'secret-ref:'
export const SECRET_STORE_WEAK_SECURITY_WARNING = 'Weak security: stored in local app data secret file fallback instead of an OS keychain or credential manager.'

type SecretSecurityKind = 'native-keychain' | 'local-secret-file' | 'memory-test'

export interface SecretStoreSecurityStatus {
  kind: SecretSecurityKind
  warning?: string
}

export interface SecretSaveInput {
  providerId: string
  value: string
}

export interface SecretSaveResult {
  ref: string
  security: SecretStoreSecurityStatus
}

export interface SecretDeleteResult {
  deleted: boolean
}

export interface SecretBackend {
  save(input: SecretSaveInput & { ref: string }): Promise<SecretSaveResult>
  read(ref: string): Promise<string | undefined>
  delete(ref: string): Promise<SecretDeleteResult>
  status(): Promise<SecretStoreSecurityStatus>
}

export interface SecretStore {
  saveSecret(input: SecretSaveInput): Promise<SecretSaveResult>
  readSecret(ref: string): Promise<string | undefined>
  deleteSecret(ref: string): Promise<SecretDeleteResult>
  securityStatus(): Promise<SecretStoreSecurityStatus>
}

export interface CreateSecretStoreOptions {
  backend?: SecretBackend
  idFactory?: () => string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && /^secret-ref:[A-Za-z0-9._/-]+$/.test(value)
}

export function isManagedSecretRef(value: unknown): value is string {
  return isSecretRef(value)
}

export function isLegacyExternalSecretRef(value: unknown): value is string {
  return typeof value === 'string' && /^keychain:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(value)
}

function assertSecretRef(ref: string) {
  if (!isSecretRef(ref)) {
    throw new Error('Invalid secret reference. Expected secret-ref:<id>.')
  }
}

function normalizeProviderId(providerId: string) {
  const normalized = providerId.trim().replace(/[^A-Za-z0-9._-]+/g, '-')
  return normalized.length > 0 ? normalized : 'provider'
}

function defaultIdFactory() {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return randomId.replace(/[^A-Za-z0-9._-]+/g, '-')
}

function secureStatus(kind: SecretSecurityKind): SecretStoreSecurityStatus {
  if (kind === 'local-secret-file') {
    return { kind, warning: SECRET_STORE_WEAK_SECURITY_WARNING }
  }
  return { kind }
}

export function maskSecretRef(ref: string | undefined) {
  if (!ref) {
    return 'Not saved'
  }
  const normalized = ref.trim()
  if (normalized.length <= 15) {
    return `${normalized.slice(0, 8)}…`
  }
  return `${normalized.slice(0, 15)}…${normalized.slice(-4)}`
}

export function createMemorySecretBackend(options: { kind?: SecretSecurityKind } = {}): SecretBackend {
  const kind = options.kind ?? 'memory-test'
  const values = new Map<string, string>()

  return {
    async save(input) {
      assertSecretRef(input.ref)
      values.set(input.ref, input.value)
      return { ref: input.ref, security: secureStatus(kind) }
    },
    async read(ref) {
      assertSecretRef(ref)
      return values.get(ref)
    },
    async delete(ref) {
      assertSecretRef(ref)
      return { deleted: values.delete(ref) }
    },
    async status() {
      return secureStatus(kind)
    },
  }
}

const LOCAL_SECRET_STORAGE_KEY = 'easyanalyse.secretStore.v1'

function readLocalSecretMap(storage: Storage): Record<string, string> {
  const raw = storage.getItem(LOCAL_SECRET_STORAGE_KEY)
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return {}
    }
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => isSecretRef(entry[0]) && typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

function createLocalSecretFileFallbackBackend(storage: Storage | null): SecretBackend {
  const memoryFallback = new Map<string, string>()

  return {
    async save(input) {
      assertSecretRef(input.ref)
      if (storage === null) {
        memoryFallback.set(input.ref, input.value)
      } else {
        const secrets = readLocalSecretMap(storage)
        secrets[input.ref] = input.value
        storage.setItem(LOCAL_SECRET_STORAGE_KEY, JSON.stringify(secrets))
      }
      return { ref: input.ref, security: secureStatus('local-secret-file') }
    },
    async read(ref) {
      assertSecretRef(ref)
      if (storage === null) {
        return memoryFallback.get(ref)
      }
      return readLocalSecretMap(storage)[ref]
    },
    async delete(ref) {
      assertSecretRef(ref)
      if (storage === null) {
        return { deleted: memoryFallback.delete(ref) }
      }
      const secrets = readLocalSecretMap(storage)
      const deleted = Object.prototype.hasOwnProperty.call(secrets, ref)
      delete secrets[ref]
      storage.setItem(LOCAL_SECRET_STORAGE_KEY, JSON.stringify(secrets))
      return { deleted }
    },
    async status() {
      return secureStatus('local-secret-file')
    },
  }
}

function createTauriSecretBackend(): SecretBackend {
  return {
    async save(input) {
      return invoke<SecretSaveResult>('secret_store_save', { providerId: input.providerId, value: input.value, ref: input.ref })
    },
    async read(ref) {
      return invoke<string | undefined>('secret_store_read', { ref })
    },
    async delete(ref) {
      return invoke<SecretDeleteResult>('secret_store_delete', { ref })
    },
    async status() {
      return invoke<SecretStoreSecurityStatus>('secret_store_status')
    },
  }
}

function defaultBackend(): SecretBackend {
  if (isTauriRuntime()) {
    return createTauriSecretBackend()
  }

  let storage: Storage | null = null
  try {
    storage = typeof window === 'undefined' ? null : window.localStorage
  } catch {
    storage = null
  }
  return createLocalSecretFileFallbackBackend(storage)
}

export function createSecretStore(options: CreateSecretStoreOptions = {}): SecretStore {
  const backend = options.backend ?? defaultBackend()
  const idFactory = options.idFactory ?? defaultIdFactory

  return {
    async saveSecret(input) {
      const providerId = normalizeProviderId(input.providerId)
      const value = input.value.trim()
      if (value.length === 0) {
        throw new Error('Cannot save an empty API key secret.')
      }
      const ref = `${SECRET_REF_PREFIX}${idFactory()}`
      return backend.save({ providerId, value, ref })
    },
    async readSecret(ref) {
      assertSecretRef(ref)
      return backend.read(ref)
    },
    async deleteSecret(ref) {
      if (isLegacyExternalSecretRef(ref)) {
        return { deleted: false }
      }
      assertSecretRef(ref)
      return backend.delete(ref)
    },
    async securityStatus() {
      return backend.status()
    },
  }
}

export const defaultSecretStore = createSecretStore()
