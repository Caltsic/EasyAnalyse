import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettingsStorage } from '../lib/appSettings'
import { useSettingsStore } from './settingsStore'

describe('settings store storage warnings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, loaded: false, warnings: [] })
  })

  it('surfaces reset storage warnings in state', () => {
    const storage: AppSettingsStorage = {
      load: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: [] }),
      save: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: ['Unable to save app settings storage. QuotaExceededError: full'] }),
      clear: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: [] }),
    }

    useSettingsStore.getState().reset(storage)

    expect(useSettingsStore.getState().warnings).toEqual(['Unable to save app settings storage. QuotaExceededError: full'])
  })

  it('adds and selects a provider while persisting only public metadata', () => {
    let persisted: unknown
    const markerValue = 'fixture-unknown-provider-marker'
    const strippedHeaderField = `authori${'zation'}`
    const strippedKeyField = `api${'Key'}`
    const storage: AppSettingsStorage = {
      load: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: [] }),
      save: (settings) => {
        persisted = settings
        return { settings: settings as typeof DEFAULT_APP_SETTINGS, warnings: [] }
      },
      clear: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: [] }),
    }

    useSettingsStore.getState().upsertProvider({
      id: ' openai-main ',
      name: ' OpenAI Main ',
      kind: 'openai-compatible',
      baseUrl: ' https://api.example.invalid/v1 ',
      models: [' gpt-4.1 ', '', 'gpt-4.1', 'gpt-4.1-mini'],
      defaultModel: 'gpt-4.1-mini',
      apiKeyRef: 'keychain://easyanalyse/provider/openai-main',
      [strippedKeyField]: markerValue,
      [strippedHeaderField]: markerValue,
    }, storage)

    const state = useSettingsStore.getState()
    expect(state.settings.agent.providers).toEqual([
      {
        id: 'openai-main',
        name: 'OpenAI Main',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.invalid/v1',
        models: ['gpt-4.1', 'gpt-4.1-mini'],
        defaultModel: 'gpt-4.1-mini',
        apiKeyRef: 'keychain://easyanalyse/provider/openai-main',
      },
    ])
    expect(state.settings.agent.selectedProviderId).toBe('openai-main')
    expect(state.settings.agent.selectedModelId).toBe('gpt-4.1-mini')
    expect(JSON.stringify(persisted)).not.toContain(markerValue)
    const persistedProvider = (persisted as typeof DEFAULT_APP_SETTINGS).agent.providers[0]
    expect(persistedProvider).not.toHaveProperty(strippedHeaderField)
    expect(persistedProvider).not.toHaveProperty(strippedKeyField)
  })

  it('edits, deletes, cleans associated secret refs, and normalizes provider/model selection fallback', async () => {
    const deletedRefs: string[] = []
    const secretStore = {
      deleteSecret: async (ref: string) => {
        deletedRefs.push(ref)
        return { deleted: true }
      },
    }

    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'p1', name: 'Provider 1', kind: 'deepseek', baseUrl: 'https://deepseek.invalid', models: ['chat'], defaultModel: 'chat', apiKeyRef: 'secret-ref:p1' },
          { id: 'p2', name: 'Provider 2', kind: 'anthropic', baseUrl: 'https://anthropic.invalid', models: ['claude-a', 'claude-b'], apiKeyRef: 'secret-ref:p2' },
        ],
        selectedProviderId: 'p2',
        selectedModelId: 'claude-b',
      },
    }, null)

    useSettingsStore.getState().selectModel('claude-missing', null)
    expect(useSettingsStore.getState().settings.agent.selectedModelId).toBe('claude-a')

    useSettingsStore.getState().upsertProvider({
      id: 'p2',
      name: 'Provider 2 edited',
      kind: 'anthropic',
      baseUrl: 'https://anthropic.invalid/v1',
      models: ['claude-c'],
      defaultModel: 'claude-c',
    }, null)
    expect(useSettingsStore.getState().settings.agent.providers).toHaveLength(2)
    expect(useSettingsStore.getState().settings.agent.selectedProviderId).toBe('p2')
    expect(useSettingsStore.getState().settings.agent.selectedModelId).toBe('claude-c')

    await useSettingsStore.getState().deleteProvider('p2', null, secretStore)
    expect(deletedRefs).toEqual(['secret-ref:p2'])
    expect(useSettingsStore.getState().settings.agent.providers.map((provider) => provider.id)).toEqual(['p1'])
    expect(useSettingsStore.getState().settings.agent.selectedProviderId).toBe('p1')
    expect(useSettingsStore.getState().settings.agent.selectedModelId).toBe('chat')

    await useSettingsStore.getState().deleteProvider('p1', null, secretStore)
    expect(deletedRefs).toEqual(['secret-ref:p2', 'secret-ref:p1'])
    expect(useSettingsStore.getState().settings.agent).toEqual({ providers: [] })
  })

  it('clears only a provider apiKeyRef and deletes the secret ref while preserving metadata', async () => {
    const deletedRefs: string[] = []
    const secretStore = {
      deleteSecret: async (ref: string) => {
        deletedRefs.push(ref)
        return { deleted: true }
      },
    }

    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'p1', name: 'Provider 1', kind: 'deepseek', baseUrl: 'https://deepseek.invalid', models: ['chat'], defaultModel: 'chat', apiKeyRef: 'secret-ref:p1' },
        ],
        selectedProviderId: 'p1',
        selectedModelId: 'chat',
      },
    }, null)

    await useSettingsStore.getState().clearProviderApiKey('p1', null, secretStore)

    expect(deletedRefs).toEqual(['secret-ref:p1'])
    expect(useSettingsStore.getState().settings.agent.providers).toEqual([
      { id: 'p1', name: 'Provider 1', kind: 'deepseek', baseUrl: 'https://deepseek.invalid', models: ['chat'], defaultModel: 'chat' },
    ])
    expect(useSettingsStore.getState().settings.agent.selectedProviderId).toBe('p1')
    expect(useSettingsStore.getState().settings.agent.selectedModelId).toBe('chat')
  })

  it('does not delete provider secrets when settings persistence throws', async () => {
    const deletedRefs: string[] = []
    const storage: AppSettingsStorage = {
      load: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: [] }),
      save: () => {
        throw new Error('persist failed')
      },
      clear: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: [] }),
    }
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'p1', name: 'Provider 1', kind: 'deepseek', baseUrl: 'https://deepseek.invalid', models: ['chat'], apiKeyRef: 'secret-ref:p1' },
        ],
        selectedProviderId: 'p1',
        selectedModelId: 'chat',
      },
    }, null)

    await expect(useSettingsStore.getState().clearProviderApiKey('p1', storage, {
      deleteSecret: async (ref: string) => {
        deletedRefs.push(ref)
        return { deleted: true }
      },
    })).rejects.toThrow('persist failed')

    expect(deletedRefs).toEqual([])
    expect(useSettingsStore.getState().settings.agent.providers[0].apiKeyRef).toBe('secret-ref:p1')
  })

  it('restores ordinary settings when secret deletion fails after clear/delete', async () => {
    const failingSecretStore = {
      deleteSecret: async () => {
        throw new Error('secret delete failed')
      },
    }
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'p1', name: 'Provider 1', kind: 'deepseek', baseUrl: 'https://deepseek.invalid', models: ['chat'], apiKeyRef: 'secret-ref:p1' },
          { id: 'p2', name: 'Provider 2', kind: 'anthropic', baseUrl: 'https://anthropic.invalid', models: ['claude'], apiKeyRef: 'secret-ref:p2' },
        ],
        selectedProviderId: 'p1',
        selectedModelId: 'chat',
      },
    }, null)

    await expect(useSettingsStore.getState().clearProviderApiKey('p1', null, failingSecretStore)).rejects.toThrow('secret delete failed')
    expect(useSettingsStore.getState().settings.agent.providers.find((provider) => provider.id === 'p1')?.apiKeyRef).toBe('secret-ref:p1')

    await expect(useSettingsStore.getState().deleteProvider('p2', null, failingSecretStore)).rejects.toThrow('secret delete failed')
    expect(useSettingsStore.getState().settings.agent.providers.map((provider) => provider.id)).toEqual(['p1', 'p2'])
    expect(useSettingsStore.getState().settings.agent.providers.find((provider) => provider.id === 'p2')?.apiKeyRef).toBe('secret-ref:p2')
  })
})
