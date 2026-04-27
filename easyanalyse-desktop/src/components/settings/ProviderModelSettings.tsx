import { useMemo, useState } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import type { AgentProviderKind, AgentProviderPublicConfig } from '../../types/settings'

const PROVIDER_KINDS: AgentProviderKind[] = ['openai-compatible', 'anthropic', 'deepseek']

interface ProviderDraft {
  id: string
  name: string
  kind: AgentProviderKind
  baseUrl: string
  modelsText: string
  defaultModel: string
  apiKeyRef: string
}

const EMPTY_DRAFT: ProviderDraft = {
  id: '',
  name: '',
  kind: 'openai-compatible',
  baseUrl: '',
  modelsText: '',
  defaultModel: '',
  apiKeyRef: '',
}

function draftFromProvider(provider: AgentProviderPublicConfig): ProviderDraft {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    modelsText: provider.models.join('\n'),
    defaultModel: provider.defaultModel ?? '',
    apiKeyRef: provider.apiKeyRef ?? '',
  }
}

function providerFromDraft(draft: ProviderDraft) {
  return {
    id: draft.id,
    name: draft.name,
    kind: draft.kind,
    baseUrl: draft.baseUrl,
    models: draft.modelsText.split(/[\n,]/u),
    defaultModel: draft.defaultModel,
    apiKeyRef: draft.apiKeyRef,
  }
}

export function ProviderModelSettings() {
  const settings = useSettingsStore((state) => state.settings)
  const warnings = useSettingsStore((state) => state.warnings)
  const upsertProvider = useSettingsStore((state) => state.upsertProvider)
  const deleteProvider = useSettingsStore((state) => state.deleteProvider)
  const selectProvider = useSettingsStore((state) => state.selectProvider)
  const selectModel = useSettingsStore((state) => state.selectModel)
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT)

  const selectedProvider = useMemo(
    () => settings.agent.providers.find((provider) => provider.id === settings.agent.selectedProviderId),
    [settings.agent.providers, settings.agent.selectedProviderId],
  )

  const updateDraft = <Key extends keyof ProviderDraft>(key: Key, value: ProviderDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const saveDraft = () => {
    const accepted = upsertProvider(providerFromDraft(draft))
    if (accepted) {
      setDraft(EMPTY_DRAFT)
    }
  }

  return (
    <section className="settings-panel" aria-label="Provider and model settings">
      <div className="settings-panel__header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Provider / Model</h2>
        </div>
        <p className="settings-panel__note">
          Public provider metadata only. API keys are handled by the secret store in a later milestone; this form only accepts an optional reference id.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="settings-panel__warnings" role="status">
          {warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}
        </div>
      )}

      <div className="settings-panel__section">
        <label>
          Active provider
          <select
            name="selectedProviderId"
            value={settings.agent.selectedProviderId ?? ''}
            onChange={(event) => selectProvider(event.target.value || undefined)}
          >
            {settings.agent.providers.length === 0 && <option value="">No providers configured</option>}
            {settings.agent.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
        </label>

        <label>
          Active model
          <select
            name="selectedModelId"
            value={settings.agent.selectedModelId ?? ''}
            onChange={(event) => selectModel(event.target.value || undefined)}
            disabled={!selectedProvider}
          >
            {!selectedProvider && <option value="">No models configured</option>}
            {selectedProvider?.models.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-panel__provider-list" aria-label="Configured providers">
        {settings.agent.providers.map((provider) => (
          <article className="settings-panel__provider-card" key={provider.id}>
            <div>
              <h3>{provider.name}</h3>
              <p>{provider.kind} · {provider.baseUrl}</p>
              <p>{provider.models.join(', ')}</p>
              {provider.apiKeyRef && <p>Secret reference: {provider.apiKeyRef}</p>}
            </div>
            <div className="settings-panel__actions">
              <button className="ghost-button" type="button" onClick={() => setDraft(draftFromProvider(provider))}>Edit</button>
              <button className="ghost-button" type="button" onClick={() => deleteProvider(provider.id)}>Delete</button>
            </div>
          </article>
        ))}
      </div>

      <div className="settings-panel__form" aria-label="Provider metadata form">
        <label>
          Provider id
          <input name="id" value={draft.id} onChange={(event) => updateDraft('id', event.target.value)} placeholder="deepseek-main" />
        </label>
        <label>
          Display name
          <input name="name" value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="DeepSeek Main" />
        </label>
        <label>
          Kind
          <select name="kind" value={draft.kind} onChange={(event) => updateDraft('kind', event.target.value as AgentProviderKind)}>
            {PROVIDER_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </label>
        <label>
          Base URL
          <input name="baseUrl" value={draft.baseUrl} onChange={(event) => updateDraft('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" />
        </label>
        <label>
          Models (comma or one per line)
          <textarea name="models" value={draft.modelsText} onChange={(event) => updateDraft('modelsText', event.target.value)} placeholder="model-a&#10;model-b" />
        </label>
        <label>
          Default model
          <input name="defaultModel" value={draft.defaultModel} onChange={(event) => updateDraft('defaultModel', event.target.value)} placeholder="optional" />
        </label>
        <label>
          API key reference
          <input name="apiKeyRef" value={draft.apiKeyRef} onChange={(event) => updateDraft('apiKeyRef', event.target.value)} placeholder="secret-ref:provider-id" />
        </label>
        <div className="settings-panel__actions">
          <button type="button" onClick={saveDraft}>Save provider metadata</button>
          <button className="ghost-button" type="button" onClick={() => setDraft(EMPTY_DRAFT)}>Clear</button>
        </div>
      </div>
    </section>
  )
}
