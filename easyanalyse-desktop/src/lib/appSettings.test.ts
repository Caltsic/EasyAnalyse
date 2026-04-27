import { describe, expect, it } from 'vitest'
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  createAppSettingsStorage,
  normalizeAppSettings,
  serializeAppSettings,
} from './appSettings'

class MemoryStorage implements Storage {
  private items = new Map<string, string>()

  get length() {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.items.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
}

describe('app settings normalization', () => {
  it('provides safe default settings with appearance and agent provider boundaries', () => {
    expect(DEFAULT_APP_SETTINGS).toEqual({
      basic: { locale: 'system' },
      appearance: { theme: 'system' },
      agent: { providers: [] },
    })
    expect(normalizeAppSettings(undefined).settings).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('migrates partial and legacy-shaped unknown data without preserving unknown fields', () => {
    const { settings, warnings } = normalizeAppSettings({
      theme: 'dark',
      appearance: { accentColor: 'pink' },
      basic: { locale: 'en-US', unknownBasicField: 'ignored' },
      agent: {
        providers: [
          {
            id: 'deepseek-main',
            name: 'DeepSeek',
            kind: 'deepseek',
            baseUrl: 'https://api.deepseek.com',
            models: ['deepseek-chat'],
            defaultModel: 'deepseek-chat',
            apiKeyRef: 'keychain://easyanalyse/provider/deepseek-main',
            apiKey: 'SHOULD_NOT_BE_SERIALIZED',
            debugToken: 'SHOULD_NOT_BE_SERIALIZED_EITHER',
          },
          { id: '', name: 'Broken', kind: 'openai-compatible', baseUrl: 'https://example.invalid', models: ['x'] },
        ],
        selectedProviderId: 'deepseek-main',
        selectedModelId: 'deepseek-chat',
      },
      unknownTopLevel: true,
    })

    expect(settings).toEqual({
      basic: { locale: 'en-US' },
      appearance: { theme: 'dark' },
      agent: {
        providers: [
          {
            id: 'deepseek-main',
            name: 'DeepSeek',
            kind: 'deepseek',
            baseUrl: 'https://api.deepseek.com',
            models: ['deepseek-chat'],
            defaultModel: 'deepseek-chat',
            apiKeyRef: 'keychain://easyanalyse/provider/deepseek-main',
          },
        ],
        selectedProviderId: 'deepseek-main',
        selectedModelId: 'deepseek-chat',
      },
    })
    expect(warnings.some((warning) => warning.includes('provider'))).toBe(true)
    expect(JSON.stringify(settings)).not.toContain('SHOULD_NOT_BE_SERIALIZED')
  })

  it('serializes only ordinary settings and apiKeyRef, never plaintext API key shaped fields', () => {
    const serialized = serializeAppSettings({
      basic: { locale: 'zh-CN' },
      appearance: { theme: 'light' },
      agent: {
        providers: [
          {
            id: 'openai-like',
            name: 'OpenAI Compatible',
            kind: 'openai-compatible',
            baseUrl: 'https://example.invalid/v1',
            models: ['gpt-test'],
            defaultModel: 'gpt-test',
            apiKeyRef: 'secret-ref:openai-like',
            apiKey: 'SHOULD_NOT_BE_SERIALIZED',
            password: 'SHOULD_NOT_BE_SERIALIZED_PASSWORD',
          },
        ],
        selectedProviderId: 'openai-like',
        selectedModelId: 'gpt-test',
      },
    })

    expect(serialized).toContain('secret-ref:openai-like')
    expect(serialized).not.toContain('SHOULD_NOT_BE_SERIALIZED')
    expect(serialized).not.toContain('SHOULD_NOT_BE_SERIALIZED_PASSWORD')
    expect(JSON.parse(serialized)).toEqual({
      basic: { locale: 'zh-CN' },
      appearance: { theme: 'light' },
      agent: {
        providers: [
          {
            id: 'openai-like',
            name: 'OpenAI Compatible',
            kind: 'openai-compatible',
            baseUrl: 'https://example.invalid/v1',
            models: ['gpt-test'],
            defaultModel: 'gpt-test',
            apiKeyRef: 'secret-ref:openai-like',
          },
        ],
        selectedProviderId: 'openai-like',
        selectedModelId: 'gpt-test',
      },
    })
  })

  it('migrates missing or invalid basic settings to safe defaults', () => {
    expect(normalizeAppSettings({ appearance: { theme: 'dark' } }).settings.basic).toEqual({ locale: 'system' })

    const { settings, warnings } = normalizeAppSettings({
      basic: { locale: 'fr-FR' },
    })

    expect(settings.basic).toEqual({ locale: 'system' })
    expect(warnings.some((warning) => warning.includes('basic.locale'))).toBe(true)
  })

  it('normalizes provider and model selection to existing public config', () => {
    const { settings, warnings } = normalizeAppSettings({
      appearance: { theme: 'dark' },
      agent: {
        providers: [
          {
            id: 'p1',
            name: 'Provider 1',
            kind: 'anthropic',
            baseUrl: 'https://example.invalid/anthropic',
            models: ['claude-a', 'claude-b'],
            defaultModel: 'claude-b',
          },
          {
            id: 'p2',
            name: 'Provider 2',
            kind: 'openai-compatible',
            baseUrl: 'https://example.invalid/openai',
            models: ['model-x'],
            defaultModel: 'not-listed',
          },
        ],
        selectedProviderId: 'missing-provider',
        selectedModelId: 'missing-model',
      },
    })

    expect(settings.agent.selectedProviderId).toBe('p1')
    expect(settings.agent.selectedModelId).toBe('claude-b')
    expect(settings.agent.providers[1].defaultModel).toBeUndefined()
    expect(warnings.some((warning) => warning.includes('selectedProviderId'))).toBe(true)
  })
})

describe('app settings storage wrapper', () => {
  it('falls back to defaults with a readable warning when reading storage throws', () => {
    const storage = new MemoryStorage()
    storage.getItem = () => {
      throw new Error('SecurityError: storage blocked')
    }
    const appSettingsStorage = createAppSettingsStorage(storage)

    const result = appSettingsStorage.load()

    expect(result.settings).toEqual(DEFAULT_APP_SETTINGS)
    expect(result.warnings.join('\n')).toContain('Unable to read app settings storage')
    expect(result.warnings.join('\n')).toContain('SecurityError: storage blocked')
  })

  it('returns sanitized settings with a readable warning when writing storage throws', () => {
    const storage = new MemoryStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError: full')
    }
    const appSettingsStorage = createAppSettingsStorage(storage)

    const result = appSettingsStorage.save({ appearance: { theme: 'dark' } })

    expect(result.settings.appearance.theme).toBe('dark')
    expect(result.warnings.join('\n')).toContain('Unable to save app settings storage')
    expect(result.warnings.join('\n')).toContain('QuotaExceededError: full')
  })

  it('returns a readable warning when clearing storage throws', () => {
    const storage = new MemoryStorage()
    storage.removeItem = () => {
      throw new Error('SecurityError: remove blocked')
    }
    const appSettingsStorage = createAppSettingsStorage(storage)

    const result = appSettingsStorage.clear()

    expect(result.settings).toEqual(DEFAULT_APP_SETTINGS)
    expect(result.warnings.join('\n')).toContain('Unable to clear app settings storage')
    expect(result.warnings.join('\n')).toContain('SecurityError: remove blocked')
  })

  it('handles unavailable default localStorage access without throwing', () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: Object.defineProperty({}, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('SecurityError: localStorage unavailable')
        },
      }),
    })

    try {
      const result = createAppSettingsStorage().load()
      expect(result.settings).toEqual(DEFAULT_APP_SETTINGS)
      expect(result.warnings.join('\n')).toContain('App settings storage is unavailable')
      expect(result.warnings.join('\n')).toContain('SecurityError: localStorage unavailable')
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      })
    }
  })

  it('falls back to defaults with a readable warning when stored JSON is corrupt', () => {
    const storage = new MemoryStorage()
    storage.setItem(APP_SETTINGS_STORAGE_KEY, '{not valid json')
    const appSettingsStorage = createAppSettingsStorage(storage)

    const result = appSettingsStorage.load()

    expect(result.settings).toEqual(DEFAULT_APP_SETTINGS)
    expect(result.warnings.join('\n')).toContain('Unable to parse app settings')
  })

  it('saves sanitized settings under a replaceable localStorage key', () => {
    const storage = new MemoryStorage()
    const appSettingsStorage = createAppSettingsStorage(storage)

    appSettingsStorage.save({
      appearance: { theme: 'dark' },
      agent: {
        providers: [
          {
            id: 'provider',
            name: 'Provider',
            kind: 'deepseek',
            baseUrl: 'https://example.invalid',
            models: ['chat'],
            apiKeyRef: 'secret-ref:provider',
            apiKey: 'SHOULD_NOT_BE_SERIALIZED',
          },
        ],
        selectedProviderId: 'provider',
        selectedModelId: 'chat',
      },
    })

    const raw = storage.getItem(APP_SETTINGS_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('SHOULD_NOT_BE_SERIALIZED')
    expect(appSettingsStorage.load().settings.agent.providers[0].apiKeyRef).toBe('secret-ref:provider')
  })
})
