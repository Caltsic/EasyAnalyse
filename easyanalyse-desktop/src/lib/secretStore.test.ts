import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemorySecretBackend,
  createSecretStore,
  maskSecretRef,
  SECRET_REF_PREFIX,
  type SecretBackend,
} from './secretStore'

describe('secretStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('stores secret material behind an opaque secret-ref and reports secure native backend status', async () => {
    const markerValue = `fixture-secret-marker-${crypto.randomUUID()}`
    const backend = createMemorySecretBackend({ kind: 'native-keychain' })
    const store = createSecretStore({ backend, idFactory: () => 'provider-a-test-ref' })

    const result = await store.saveSecret({ providerId: 'provider-a', value: markerValue })

    expect(result.ref).toBe(`${SECRET_REF_PREFIX}provider-a-test-ref`)
    expect(result.security.kind).toBe('native-keychain')
    expect(result.security.warning).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain(markerValue)
    await expect(store.readSecret(result.ref)).resolves.toBe(markerValue)
  })

  it('surfaces a weak-security warning when using local app-data fallback storage', async () => {
    const markerValue = `fixture-fallback-secret-${crypto.randomUUID()}`
    const store = createSecretStore({
      backend: createMemorySecretBackend({ kind: 'local-secret-file' }),
      idFactory: () => 'provider-b-test-ref',
    })

    const result = await store.saveSecret({ providerId: 'provider-b', value: markerValue })

    expect(result.ref).toBe(`${SECRET_REF_PREFIX}provider-b-test-ref`)
    expect(result.security.kind).toBe('local-secret-file')
    expect(result.security.warning).toContain('Weak security')
    expect(JSON.stringify(result)).not.toContain(markerValue)
  })

  it('validates secret-ref boundaries, masks references, and deletes stored values without exposing plaintext', async () => {
    const markerValue = `fixture-delete-secret-${crypto.randomUUID()}`
    const store = createSecretStore({
      backend: createMemorySecretBackend({ kind: 'native-keychain' }),
      idFactory: () => 'delete-test-ref',
    })

    const { ref } = await store.saveSecret({ providerId: 'provider-c', value: markerValue })

    expect(maskSecretRef(ref)).toBe('secret-ref:dele…-ref')
    await expect(store.deleteSecret(ref)).resolves.toEqual({ deleted: true })
    await expect(store.readSecret(ref)).resolves.toBeUndefined()
    await expect(store.readSecret(markerValue)).rejects.toThrow('Invalid secret reference')
    await expect(store.deleteSecret('keychain://legacy-provider-ref?slot=primary%20key')).resolves.toEqual({ deleted: false })
    await expect(store.saveSecret({ providerId: 'provider-c', value: '   ' })).rejects.toThrow('empty')
  })

  it('uses injected command backend without logging or returning secret material in command results', async () => {
    const markerValue = `fixture-command-secret-${crypto.randomUUID()}`
    const calls: Array<{ command: string; args: unknown }> = []
    const backend: SecretBackend = {
      async save(input) {
        calls.push({ command: 'secret_store_save', args: input })
        return { ref: `${SECRET_REF_PREFIX}command-test-ref`, security: { kind: 'native-keychain' } }
      },
      async read(ref) {
        calls.push({ command: 'secret_store_read', args: { ref } })
        return markerValue
      },
      async delete(ref) {
        calls.push({ command: 'secret_store_delete', args: { ref } })
        return { deleted: true }
      },
      async status() {
        return { kind: 'native-keychain' }
      },
    }
    const store = createSecretStore({ backend })

    const result = await store.saveSecret({ providerId: 'provider-d', value: markerValue })

    expect(result.ref).toBe(`${SECRET_REF_PREFIX}command-test-ref`)
    expect(JSON.stringify(result)).not.toContain(markerValue)
    expect(calls[0].args).toMatchObject({ providerId: 'provider-d', value: markerValue })
  })
})
