import type { AgentProviderKind, AgentProviderPublicConfig, AppLocalePreference, AppSettings, AppThemeMode } from '../types/settings'

export const APP_SETTINGS_STORAGE_KEY = 'easyanalyse.appSettings.v1'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  basic: { locale: 'system' },
  appearance: { theme: 'system' },
  agent: { providers: [] },
}

export interface AppSettingsNormalizationResult {
  settings: AppSettings
  warnings: string[]
}

export interface AppSettingsStorage {
  load(): AppSettingsNormalizationResult
  save(settings: unknown): AppSettingsNormalizationResult
  clear(): AppSettingsNormalizationResult
}

const VALID_THEMES = new Set<AppThemeMode>(['system', 'light', 'dark'])
const VALID_LOCALES = new Set<AppLocalePreference>(['system', 'zh-CN', 'en-US'])
const VALID_PROVIDER_KINDS = new Set<AgentProviderKind>(['openai-compatible', 'anthropic', 'deepseek'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeTheme(input: unknown, warnings: string[]): AppThemeMode {
  if (!isRecord(input)) {
    return DEFAULT_APP_SETTINGS.appearance.theme
  }

  const appearance = isRecord(input.appearance) ? input.appearance : undefined
  const candidate = appearance?.theme ?? input.theme
  if (typeof candidate === 'string' && VALID_THEMES.has(candidate as AppThemeMode)) {
    return candidate as AppThemeMode
  }

  if (candidate !== undefined) {
    warnings.push('Ignored invalid appearance.theme; using system theme.')
  }
  return DEFAULT_APP_SETTINGS.appearance.theme
}

function normalizeLocale(input: unknown, warnings: string[]): AppLocalePreference {
  if (!isRecord(input)) {
    return DEFAULT_APP_SETTINGS.basic.locale
  }

  const basic = isRecord(input.basic) ? input.basic : undefined
  const candidate = basic?.locale
  if (typeof candidate === 'string' && VALID_LOCALES.has(candidate as AppLocalePreference)) {
    return candidate as AppLocalePreference
  }

  if (candidate !== undefined) {
    warnings.push('Ignored invalid basic.locale; using system locale.')
  }
  return DEFAULT_APP_SETTINGS.basic.locale
}

function normalizeModels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const models: string[] = []
  for (const item of value) {
    const model = nonEmptyString(item)
    if (model === undefined || seen.has(model)) {
      continue
    }
    seen.add(model)
    models.push(model)
  }
  return models
}

function normalizeProvider(value: unknown, warnings: string[]): AgentProviderPublicConfig | null {
  if (!isRecord(value)) {
    warnings.push('Ignored invalid agent provider entry.')
    return null
  }

  const id = nonEmptyString(value.id)
  const name = nonEmptyString(value.name)
  const kind = typeof value.kind === 'string' && VALID_PROVIDER_KINDS.has(value.kind as AgentProviderKind) ? value.kind : undefined
  const baseUrl = nonEmptyString(value.baseUrl)
  const models = normalizeModels(value.models)

  if (id === undefined || name === undefined || kind === undefined || baseUrl === undefined || models.length === 0) {
    warnings.push('Ignored invalid agent provider entry.')
    return null
  }

  const provider: AgentProviderPublicConfig = {
    id,
    name,
    kind: kind as AgentProviderKind,
    baseUrl,
    models,
  }

  const defaultModel = nonEmptyString(value.defaultModel)
  if (defaultModel !== undefined) {
    if (models.includes(defaultModel)) {
      provider.defaultModel = defaultModel
    } else {
      warnings.push(`Ignored defaultModel for provider ${id} because it is not listed in models.`)
    }
  }

  const apiKeyRef = nonEmptyString(value.apiKeyRef)
  if (apiKeyRef !== undefined) {
    provider.apiKeyRef = apiKeyRef
  }

  return provider
}

function normalizeProviders(input: unknown, warnings: string[]): AgentProviderPublicConfig[] {
  const providersInput = isRecord(input) && isRecord(input.agent) && Array.isArray(input.agent.providers) ? input.agent.providers : []
  const providers: AgentProviderPublicConfig[] = []
  const seen = new Set<string>()

  for (const item of providersInput) {
    const provider = normalizeProvider(item, warnings)
    if (provider === null) {
      continue
    }
    if (seen.has(provider.id)) {
      warnings.push(`Ignored duplicate agent provider id ${provider.id}.`)
      continue
    }
    seen.add(provider.id)
    providers.push(provider)
  }

  return providers
}

function normalizeSelection(input: unknown, providers: AgentProviderPublicConfig[], warnings: string[]): Pick<AppSettings['agent'], 'selectedProviderId' | 'selectedModelId'> {
  if (providers.length === 0) {
    return {}
  }

  const agentInput = isRecord(input) && isRecord(input.agent) ? input.agent : {}
  const requestedProviderId = nonEmptyString(agentInput.selectedProviderId)
  let selectedProvider = requestedProviderId === undefined ? undefined : providers.find((provider) => provider.id === requestedProviderId)

  if (selectedProvider === undefined) {
    selectedProvider = providers[0]
    if (requestedProviderId !== undefined) {
      warnings.push('Ignored selectedProviderId because it does not match a configured provider.')
    }
  }

  const requestedModelId = nonEmptyString(agentInput.selectedModelId)
  let selectedModelId: string | undefined
  if (requestedModelId !== undefined && selectedProvider.models.includes(requestedModelId)) {
    selectedModelId = requestedModelId
  } else {
    if (requestedModelId !== undefined) {
      warnings.push('Ignored selectedModelId because it is not available on the selected provider.')
    }
    selectedModelId = selectedProvider.defaultModel ?? selectedProvider.models[0]
  }

  return {
    selectedProviderId: selectedProvider.id,
    selectedModelId,
  }
}

export function normalizeAppSettings(input: unknown): AppSettingsNormalizationResult {
  const warnings: string[] = []
  const locale = normalizeLocale(input, warnings)
  const theme = normalizeTheme(input, warnings)
  const providers = normalizeProviders(input, warnings)
  const selection = normalizeSelection(input, providers, warnings)

  return {
    settings: {
      basic: { locale },
      appearance: { theme },
      agent: {
        providers,
        ...selection,
      },
    },
    warnings,
  }
}

export function serializeAppSettings(settings: unknown): string {
  return JSON.stringify(normalizeAppSettings(settings).settings, null, 2)
}

export function parseSerializedAppSettings(raw: string | null): AppSettingsNormalizationResult {
  if (raw === null) {
    return { settings: DEFAULT_APP_SETTINGS, warnings: [] }
  }

  try {
    return normalizeAppSettings(JSON.parse(raw))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      settings: DEFAULT_APP_SETTINGS,
      warnings: [`Unable to parse app settings; using defaults. ${message}`],
    }
  }
}

function storageErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getDefaultStorage(): { storage: Storage | null; warnings: string[] } {
  if (typeof window === 'undefined') {
    return { storage: null, warnings: [] }
  }

  try {
    return { storage: window.localStorage, warnings: [] }
  } catch (error) {
    return {
      storage: null,
      warnings: [`App settings storage is unavailable. ${storageErrorMessage(error)}`],
    }
  }
}

export function createAppSettingsStorage(storage?: Storage | null): AppSettingsStorage {
  const resolved = storage === undefined ? getDefaultStorage() : { storage, warnings: [] }

  return {
    load() {
      if (resolved.storage === null) {
        return { settings: DEFAULT_APP_SETTINGS, warnings: ['App settings storage is unavailable; using defaults.', ...resolved.warnings] }
      }
      try {
        return parseSerializedAppSettings(resolved.storage.getItem(APP_SETTINGS_STORAGE_KEY))
      } catch (error) {
        return {
          settings: DEFAULT_APP_SETTINGS,
          warnings: [`Unable to read app settings storage; using defaults. ${storageErrorMessage(error)}`],
        }
      }
    },
    save(settings: unknown) {
      const result = normalizeAppSettings(settings)
      if (resolved.storage === null) {
        return { ...result, warnings: [...result.warnings, 'App settings storage is unavailable; settings were not persisted.', ...resolved.warnings] }
      }
      try {
        resolved.storage.setItem(APP_SETTINGS_STORAGE_KEY, serializeAppSettings(result.settings))
      } catch (error) {
        return { ...result, warnings: [...result.warnings, `Unable to save app settings storage; settings were not persisted. ${storageErrorMessage(error)}`] }
      }
      return result
    },
    clear() {
      if (resolved.storage === null) {
        return { settings: DEFAULT_APP_SETTINGS, warnings: ['App settings storage is unavailable; settings were not cleared.', ...resolved.warnings] }
      }
      try {
        resolved.storage.removeItem(APP_SETTINGS_STORAGE_KEY)
        return { settings: DEFAULT_APP_SETTINGS, warnings: [] }
      } catch (error) {
        return {
          settings: DEFAULT_APP_SETTINGS,
          warnings: [`Unable to clear app settings storage; settings were not cleared. ${storageErrorMessage(error)}`],
        }
      }
    },
  }
}
