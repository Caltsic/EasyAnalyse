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

export type AgentCorrectnessReviewerMode = 'inherit-main' | 'custom-provider'

export interface AgentCorrectnessReviewerConfig {
  mode: AgentCorrectnessReviewerMode
  providerId?: string
  modelId?: string
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
    correctnessReviewer: AgentCorrectnessReviewerConfig
  }
}
