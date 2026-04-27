import { useEffect, useMemo, useState } from 'react'
import { defaultSecretStore, maskSecretRef, type SecretStore, type SecretStoreSecurityStatus } from '../../lib/secretStore'
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
  apiKey: string
}

const EMPTY_DRAFT: ProviderDraft = {
  id: '',
  name: '',
  kind: 'openai-compatible',
  baseUrl: '',
  modelsText: '',
  defaultModel: '',
  apiKeyRef: '',
  apiKey: '',
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
    apiKey: '',
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

export interface ProviderModelSettingsProps {
  secretStore?: Pick<SecretStore, 'saveSecret' | 'deleteSecret' | 'securityStatus'>
}

export function ProviderModelSettings({ secretStore = defaultSecretStore }: ProviderModelSettingsProps = {}) {
  const settings = useSettingsStore((state) => state.settings)
  const warnings = useSettingsStore((state) => state.warnings)
  const upsertProvider = useSettingsStore((state) => state.upsertProvider)
  const deleteProvider = useSettingsStore((state) => state.deleteProvider)
  const clearProviderApiKey = useSettingsStore((state) => state.clearProviderApiKey)
  const selectProvider = useSettingsStore((state) => state.selectProvider)
  const selectModel = useSettingsStore((state) => state.selectModel)
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT)
  const [secretStatus, setSecretStatus] = useState<SecretStoreSecurityStatus | null>(null)
  const [secretWarning, setSecretWarning] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const selectedProvider = useMemo(
    () => settings.agent.providers.find((provider) => provider.id === settings.agent.selectedProviderId),
    [settings.agent.providers, settings.agent.selectedProviderId],
  )

  useEffect(() => {
    let cancelled = false
    void secretStore.securityStatus().then((status) => {
      if (!cancelled) {
        setSecretStatus(status)
        setSecretWarning(status.warning ?? null)
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setSecretWarning(error instanceof Error ? error.message : String(error))
      }
    })
    return () => {
      cancelled = true
    }
  }, [secretStore])

  const updateDraft = <Key extends keyof ProviderDraft>(key: Key, value: ProviderDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const readableError = (error: unknown) => error instanceof Error ? error.message : String(error)

  const saveDraft = async () => {
    setOperationError(null)
    setBusyAction('save')
    let newApiKeyRef: string | undefined
    const oldApiKeyRef = draft.apiKeyRef || undefined
    try {
      let apiKeyRef = draft.apiKeyRef
      const secretValue = draft.apiKey.trim()
      if (secretValue.length > 0) {
        const result = await secretStore.saveSecret({ providerId: draft.id, value: secretValue })
        apiKeyRef = result.ref
        newApiKeyRef = result.ref
        setSecretStatus(result.security)
        setSecretWarning(result.security.warning ?? null)
      }
      const accepted = upsertProvider(providerFromDraft({ ...draft, apiKeyRef, apiKey: '' }))
      if (!accepted) {
        if (newApiKeyRef) {
          await secretStore.deleteSecret(newApiKeyRef)
        }
        setOperationError('Provider metadata was rejected; the newly saved API key was removed.')
        return
      }
      if (newApiKeyRef && oldApiKeyRef && oldApiKeyRef !== newApiKeyRef) {
        await secretStore.deleteSecret(oldApiKeyRef)
      }
      setDraft(EMPTY_DRAFT)
    } catch (error) {
      if (newApiKeyRef) {
        await secretStore.deleteSecret(newApiKeyRef).catch(() => undefined)
      }
      setOperationError(`Unable to save provider metadata or API key. ${readableError(error)}`)
    } finally {
      setBusyAction(null)
    }
  }

  const clearApiKey = async (provider: AgentProviderPublicConfig) => {
    setOperationError(null)
    setBusyAction(`clear:${provider.id}`)
    try {
      await clearProviderApiKey(provider.id, undefined, secretStore)
      setDraft((current) => current.id === provider.id ? { ...current, apiKeyRef: '', apiKey: '' } : current)
    } catch (error) {
      setOperationError(`Unable to clear API key. ${readableError(error)}`)
    } finally {
      setBusyAction(null)
    }
  }

  const deleteProviderWithSecrets = async (provider: AgentProviderPublicConfig) => {
    setOperationError(null)
    setBusyAction(`delete:${provider.id}`)
    try {
      await deleteProvider(provider.id, undefined, secretStore)
    } catch (error) {
      setOperationError(`Unable to delete provider. ${readableError(error)}`)
    } finally {
      setBusyAction(null)
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
          Public provider metadata only. API keys are saved to the SecretStore and ordinary settings persist only opaque apiKeyRef values.
          {secretStatus?.kind && ` Secret backend: ${secretStatus.kind}.`}
        </p>
      </div>

      {(warnings.length > 0 || secretWarning) && (
        <div className="settings-panel__warnings" role="status">
          {warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}
          {secretWarning && <p>{secretWarning}</p>}
        </div>
      )}

      {operationError && <div className="settings-panel__warnings" role="alert"><p>{operationError}</p></div>}

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
              {provider.apiKeyRef && <p>Secret reference: {maskSecretRef(provider.apiKeyRef)}</p>}
            </div>
            <div className="settings-panel__actions">
              <button className="ghost-button" type="button" onClick={() => setDraft(draftFromProvider(provider))}>Edit</button>
              {provider.apiKeyRef && <button className="ghost-button" type="button" disabled={busyAction !== null} onClick={() => void clearApiKey(provider)}>{busyAction === `clear:${provider.id}` ? 'Clearing API key…' : 'Clear API key'}</button>}
              <button className="ghost-button" type="button" disabled={busyAction !== null} onClick={() => void deleteProviderWithSecrets(provider)}>{busyAction === `delete:${provider.id}` ? 'Deleting…' : 'Delete'}</button>
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
          API key
          <input name="apiKey" type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => updateDraft('apiKey', event.target.value)} placeholder={draft.apiKeyRef ? 'Saved; enter a new key to replace' : 'Enter key to save in SecretStore'} />
        </label>
        <div className="settings-panel__actions">
          <button type="button" disabled={busyAction !== null} onClick={() => void saveDraft()}>{busyAction === 'save' ? 'Saving…' : 'Save provider metadata'}</button>
          <button className="ghost-button" type="button" disabled={busyAction !== null} onClick={() => setDraft(EMPTY_DRAFT)}>Clear</button>
        </div>
      </div>
    </section>
  )
}
