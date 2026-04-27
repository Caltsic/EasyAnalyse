import { create } from 'zustand'
import {
  createAppSettingsStorage,
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  type AppSettingsStorage,
} from '../lib/appSettings'
import type { SecretStore } from '../lib/secretStore'
import type { AgentProviderPublicConfig, AppSettings } from '../types/settings'

export interface SettingsState {
  settings: AppSettings
  loaded: boolean
  warnings: string[]
  load(storage?: AppSettingsStorage | null): void
  replaceSettings(settings: unknown, storage?: AppSettingsStorage | null): void
  reset(storage?: AppSettingsStorage | null): void
  upsertProvider(provider: unknown, storage?: AppSettingsStorage | null): boolean
  deleteProvider(providerId: string, storage?: AppSettingsStorage | null, secretStore?: Pick<SecretStore, 'deleteSecret'>): Promise<void>
  clearProviderApiKey(providerId: string, storage?: AppSettingsStorage | null, secretStore?: Pick<SecretStore, 'deleteSecret'>): Promise<void>
  selectProvider(providerId: string | undefined, storage?: AppSettingsStorage | null): void
  selectModel(modelId: string | undefined, storage?: AppSettingsStorage | null): void
}

function defaultStorage() {
  return createAppSettingsStorage()
}

function persistSettings(settings: unknown, storage: AppSettingsStorage | null | undefined) {
  const normalized = normalizeAppSettings(settings)
  if (storage === null) {
    return normalized
  }
  return (storage ?? defaultStorage()).save(normalized.settings)
}

function replaceProvider(providers: AgentProviderPublicConfig[], provider: AgentProviderPublicConfig) {
  const index = providers.findIndex((item) => item.id === provider.id)
  if (index === -1) {
    return [...providers, provider]
  }
  return providers.map((item, itemIndex) => (itemIndex === index ? provider : item))
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_APP_SETTINGS,
  loaded: false,
  warnings: [],

  load: (storage = defaultStorage()) => {
    const result = storage === null ? { settings: DEFAULT_APP_SETTINGS, warnings: [] } : storage.load()
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
  },

  replaceSettings: (settings, storage = defaultStorage()) => {
    const result = persistSettings(settings, storage)
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
  },

  reset: (storage = defaultStorage()) => {
    const result = persistSettings(DEFAULT_APP_SETTINGS, storage)
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
  },

  upsertProvider: (provider, storage = defaultStorage()) => {
    const current = get().settings
    const providerResult = normalizeAppSettings({
      ...current,
      agent: { providers: [provider] },
    })
    const normalizedProvider = providerResult.settings.agent.providers[0]
    if (normalizedProvider === undefined) {
      set({ warnings: providerResult.warnings })
      return false
    }

    const existingProvider = current.agent.providers.find((item) => item.id === normalizedProvider.id)
    const providerToPersist = normalizedProvider.apiKeyRef === undefined && existingProvider?.apiKeyRef
      ? { ...normalizedProvider, apiKeyRef: existingProvider.apiKeyRef }
      : normalizedProvider
    const existingSelectedProviderId = current.agent.selectedProviderId
    const nextProviders = replaceProvider(current.agent.providers, providerToPersist)
    const selectedProviderId = existingSelectedProviderId === providerToPersist.id || !existingSelectedProviderId
      ? providerToPersist.id
      : existingSelectedProviderId
    const selectedModelId = selectedProviderId === providerToPersist.id
      ? (providerToPersist.defaultModel ?? providerToPersist.models[0])
      : current.agent.selectedModelId
    const result = persistSettings({
      ...current,
      agent: {
        providers: nextProviders,
        selectedProviderId,
        selectedModelId,
      },
    }, storage)
    set({ settings: result.settings, loaded: true, warnings: [...providerResult.warnings, ...result.warnings] })
    return result.settings.agent.providers.some((item) => item.id === normalizedProvider.id)
  },

  deleteProvider: async (providerId, storage = defaultStorage(), secretStore) => {
    const current = get().settings
    const trimmedProviderId = providerId.trim()
    const deletedProvider = current.agent.providers.find((provider) => provider.id === trimmedProviderId)
    const nextProviders = current.agent.providers.filter((provider) => provider.id !== trimmedProviderId)
    const result = persistSettings({
      ...current,
      agent: {
        providers: nextProviders,
        selectedProviderId: current.agent.selectedProviderId,
        selectedModelId: current.agent.selectedModelId,
      },
    }, storage)
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
    if (deletedProvider?.apiKeyRef && secretStore) {
      try {
        await secretStore.deleteSecret(deletedProvider.apiKeyRef)
      } catch (error) {
        const restored = persistSettings(current, storage)
        set({ settings: restored.settings, loaded: true, warnings: restored.warnings })
        throw error
      }
    }
  },

  clearProviderApiKey: async (providerId, storage = defaultStorage(), secretStore) => {
    const current = get().settings
    const trimmedProviderId = providerId.trim()
    const provider = current.agent.providers.find((item) => item.id === trimmedProviderId)
    if (!provider) {
      return
    }
    const providerWithoutApiKey = { ...provider }
    delete providerWithoutApiKey.apiKeyRef
    const result = persistSettings({
      ...current,
      agent: {
        ...current.agent,
        providers: replaceProvider(current.agent.providers, providerWithoutApiKey),
      },
    }, storage)
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
    if (provider.apiKeyRef && secretStore) {
      try {
        await secretStore.deleteSecret(provider.apiKeyRef)
      } catch (error) {
        const restored = persistSettings(current, storage)
        set({ settings: restored.settings, loaded: true, warnings: restored.warnings })
        throw error
      }
    }
  },

  selectProvider: (providerId, storage = defaultStorage()) => {
    const current = get().settings
    const provider = current.agent.providers.find((item) => item.id === providerId?.trim())
    const result = persistSettings({
      ...current,
      agent: {
        ...current.agent,
        selectedProviderId: provider?.id,
        selectedModelId: provider?.defaultModel ?? provider?.models[0],
      },
    }, storage)
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
  },

  selectModel: (modelId, storage = defaultStorage()) => {
    const current = get().settings
    const result = persistSettings({
      ...current,
      agent: {
        ...current.agent,
        selectedModelId: modelId,
      },
    }, storage)
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
  },
}))
