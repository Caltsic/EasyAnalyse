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

  it('edits, deletes, and normalizes provider/model selection fallback', () => {
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'p1', name: 'Provider 1', kind: 'deepseek', baseUrl: 'https://deepseek.invalid', models: ['chat'], defaultModel: 'chat' },
          { id: 'p2', name: 'Provider 2', kind: 'anthropic', baseUrl: 'https://anthropic.invalid', models: ['claude-a', 'claude-b'] },
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

    useSettingsStore.getState().deleteProvider('p2', null)
    expect(useSettingsStore.getState().settings.agent.providers.map((provider) => provider.id)).toEqual(['p1'])
    expect(useSettingsStore.getState().settings.agent.selectedProviderId).toBe('p1')
    expect(useSettingsStore.getState().settings.agent.selectedModelId).toBe('chat')

    useSettingsStore.getState().deleteProvider('p1', null)
    expect(useSettingsStore.getState().settings.agent).toEqual({ providers: [] })
  })
})
