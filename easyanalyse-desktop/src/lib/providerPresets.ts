import type { AgentProviderPublicConfig } from '../types/settings'

export type ProviderPreset = Readonly<Omit<AgentProviderPublicConfig, 'apiKeyRef' | 'models'>> & {
  readonly apiKeyRef?: never
  readonly models: readonly string[]
}

type ProviderPresetInput = Omit<AgentProviderPublicConfig, 'apiKeyRef'>

function freezeProviderPreset(preset: ProviderPresetInput): ProviderPreset {
  return Object.freeze({
    id: preset.id,
    name: preset.name,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    models: Object.freeze([...preset.models]),
    ...(preset.defaultModel === undefined ? {} : { defaultModel: preset.defaultModel }),
  })
}

export function cloneProviderPreset(preset: ProviderPreset): AgentProviderPublicConfig {
  const provider: AgentProviderPublicConfig = {
    id: preset.id,
    name: preset.name,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    models: [...preset.models],
  }

  if (preset.defaultModel !== undefined) {
    provider.defaultModel = preset.defaultModel
  }

  return provider
}

export const DEEPSEEK_PROVIDER_PRESET: ProviderPreset = freezeProviderPreset({
  id: 'deepseek',
  name: 'DeepSeek',
  kind: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  models: ['deepseek-chat', 'deepseek-reasoner'],
  defaultModel: 'deepseek-chat',
})

export const PROVIDER_PRESETS: readonly ProviderPreset[] = Object.freeze([
  DEEPSEEK_PROVIDER_PRESET,
])
