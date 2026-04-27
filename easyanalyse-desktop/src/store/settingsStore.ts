import { create } from 'zustand'
import {
  createAppSettingsStorage,
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  type AppSettingsStorage,
} from '../lib/appSettings'
import type { AgentProviderPublicConfig, AppSettings } from '../types/settings'

export interface SettingsState {
  settings: AppSettings
  loaded: boolean
  warnings: string[]
  load(storage?: AppSettingsStorage | null): void
  replaceSettings(settings: unknown, storage?: AppSettingsStorage | null): void
  reset(storage?: AppSettingsStorage | null): void
  upsertProvider(provider: unknown, storage?: AppSettingsStorage | null): boolean
  deleteProvider(providerId: string, storage?: AppSettingsStorage | null): void
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

    const existingSelectedProviderId = current.agent.selectedProviderId
    const nextProviders = replaceProvider(current.agent.providers, normalizedProvider)
    const selectedProviderId = existingSelectedProviderId === normalizedProvider.id || !existingSelectedProviderId
      ? normalizedProvider.id
      : existingSelectedProviderId
    const selectedModelId = selectedProviderId === normalizedProvider.id
      ? (normalizedProvider.defaultModel ?? normalizedProvider.models[0])
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

  deleteProvider: (providerId, storage = defaultStorage()) => {
    const current = get().settings
    const nextProviders = current.agent.providers.filter((provider) => provider.id !== providerId.trim())
    const result = persistSettings({
      ...current,
      agent: {
        providers: nextProviders,
        selectedProviderId: current.agent.selectedProviderId,
        selectedModelId: current.agent.selectedModelId,
      },
    }, storage)
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
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
