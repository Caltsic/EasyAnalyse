export type AppThemeMode = 'system' | 'light' | 'dark'

export type AppLocalePreference = 'system' | 'zh-CN' | 'en-US'

export type AgentProviderKind = 'openai-compatible' | 'anthropic' | 'deepseek'

export interface AgentProviderPublicConfig {
  id: string
  name: string
  kind: AgentProviderKind
  baseUrl: string
  models: string[]
  defaultModel?: string
  apiKeyRef?: string
}

export interface AppSettings {
  basic: {
    locale: AppLocalePreference
  }
  appearance: {
    theme: AppThemeMode
  }
  agent: {
    providers: AgentProviderPublicConfig[]
    selectedProviderId?: string
    selectedModelId?: string
  }
}
