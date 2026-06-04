import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { translate } from '../../lib/i18n'
import { cloneProviderPreset, DEEPSEEK_PROVIDER_PRESET, type ProviderPreset } from '../../lib/providerPresets'
import { defaultSecretStore, maskSecretRef, type SecretStore, type SecretStoreSecurityStatus } from '../../lib/secretStore'
import { useEditorStore } from '../../store/editorStore'
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
  editingProviderId?: string
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
    editingProviderId: provider.id,
  }
}

function draftFromPreset(preset: ProviderPreset, existingProvider?: AgentProviderPublicConfig): ProviderDraft {
  const provider = cloneProviderPreset(preset)
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    modelsText: provider.models.join('\n'),
    defaultModel: provider.defaultModel ?? '',
    apiKeyRef: existingProvider?.apiKeyRef ?? '',
    apiKey: '',
    editingProviderId: existingProvider?.id,
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
  const locale = useEditorStore((state) => state.locale)
  const settings = useSettingsStore((state) => state.settings)
  const warnings = useSettingsStore((state) => state.warnings)
  const upsertProvider = useSettingsStore((state) => state.upsertProvider)
  const deleteProvider = useSettingsStore((state) => state.deleteProvider)
  const clearProviderApiKey = useSettingsStore((state) => state.clearProviderApiKey)
  const selectProvider = useSettingsStore((state) => state.selectProvider)
  const selectModel = useSettingsStore((state) => state.selectModel)
  const setCorrectnessReviewer = useSettingsStore((state) => state.setCorrectnessReviewer)
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT)
  const [secretStatus, setSecretStatus] = useState<SecretStoreSecurityStatus | null>(null)
  const [secretWarning, setSecretWarning] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params)

  const selectedProvider = useMemo(
    () => settings.agent.providers.find((provider) => provider.id === settings.agent.selectedProviderId),
    [settings.agent.providers, settings.agent.selectedProviderId],
  )
  const reviewerProvider = useMemo(
    () => settings.agent.providers.find((provider) => provider.id === settings.agent.correctnessReviewer.providerId),
    [settings.agent.providers, settings.agent.correctnessReviewer.providerId],
  )
  const reviewerModelId = settings.agent.correctnessReviewer.mode === 'custom-provider'
    ? settings.agent.correctnessReviewer.modelId ?? reviewerProvider?.defaultModel ?? reviewerProvider?.models[0] ?? ''
    : ''

  useEffect(() => {
    let cancelled = false
    void secretStore.securityStatus().then((status) => {
      if (!cancelled) {
        setSecretStatus(status)
        setSecretWarning(status.warning ?? null)
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setSecretWarning(getErrorMessage(error))
      }
    })
    return () => {
      cancelled = true
    }
  }, [secretStore])

  const updateDraft = <Key extends keyof ProviderDraft>(key: Key, value: ProviderDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const applyDeepSeekPreset = () => {
    const existingProvider = settings.agent.providers.find((provider) => provider.id === DEEPSEEK_PROVIDER_PRESET.id)
    setOperationError(null)
    setDraft(draftFromPreset(DEEPSEEK_PROVIDER_PRESET, existingProvider))
  }

  const updateReviewerMode = (mode: 'inherit-main' | 'custom-provider') => {
    if (mode === 'inherit-main') {
      setCorrectnessReviewer({ mode: 'inherit-main' })
      return
    }
    const provider = reviewerProvider ?? selectedProvider ?? settings.agent.providers[0]
    if (!provider) {
      setCorrectnessReviewer({ mode: 'inherit-main' })
      return
    }
    setCorrectnessReviewer({
      mode: 'custom-provider',
      providerId: provider.id,
      modelId: provider.defaultModel ?? provider.models[0],
    })
  }

  const updateReviewerProvider = (providerId: string) => {
    const provider = settings.agent.providers.find((item) => item.id === providerId)
    if (!provider) {
      setCorrectnessReviewer({ mode: 'inherit-main' })
      return
    }
    setCorrectnessReviewer({
      mode: 'custom-provider',
      providerId: provider.id,
      modelId: provider.defaultModel ?? provider.models[0],
    })
  }

  const updateReviewerModel = (modelId: string) => {
    if (!reviewerProvider) return
    setCorrectnessReviewer({
      mode: 'custom-provider',
      providerId: reviewerProvider.id,
      modelId,
    })
  }

  const saveDraft = async () => {
    setOperationError(null)
    setBusyAction('save')
    let newApiKeyRef: string | undefined
    let metadataPersisted = false
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
          await secretStore.deleteSecret(newApiKeyRef).catch(() => undefined)
        }
        setDraft((current) => ({ ...current, apiKey: '' }))
        setOperationError(t('providerMetadataRejected'))
        setBusyAction(null)
        return
      }
      metadataPersisted = true
      setDraft(EMPTY_DRAFT)
    } catch (error) {
      if (!metadataPersisted && newApiKeyRef) {
        await secretStore.deleteSecret(newApiKeyRef).catch(() => undefined)
      }
      setDraft((current) => ({ ...current, apiKey: '' }))
      setOperationError(t('unableToSaveProvider', { message: getErrorMessage(error) }))
      setBusyAction(null)
      return
    }

    if (newApiKeyRef && oldApiKeyRef && oldApiKeyRef !== newApiKeyRef) {
      try {
        await secretStore.deleteSecret(oldApiKeyRef)
      } catch (error) {
        setOperationError(t('providerSavedUnableToDeleteOldKey', { message: getErrorMessage(error) }))
      }
    }
    setBusyAction(null)
  }

  const clearApiKey = async (provider: AgentProviderPublicConfig) => {
    setOperationError(null)
    setBusyAction(`clear:${provider.id}`)
    try {
      await clearProviderApiKey(provider.id, undefined, secretStore)
      setDraft((current) => current.id === provider.id ? { ...current, apiKeyRef: '', apiKey: '' } : current)
    } catch (error) {
      setOperationError(t('unableToClearApiKey', { message: getErrorMessage(error) }))
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
      setOperationError(t('unableToDeleteProvider', { message: getErrorMessage(error) }))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section className="settings-panel" aria-label={t('providerModelSettingsLabel')}>
      <div className="settings-panel__header">
        <div>
          <p className="eyebrow">{t('settings')}</p>
          <h2>{t('providerModelSettings')}</h2>
        </div>
        <p className="settings-panel__note">
          {t('settingsNote')}
          {secretStatus?.kind && ` ${t('secretBackend', { kind: secretStatus.kind })}`}
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
          {t('activeProvider')}
          <select
            name="selectedProviderId"
            value={settings.agent.selectedProviderId ?? ''}
            onChange={(event) => selectProvider(event.target.value || undefined)}
          >
            {settings.agent.providers.length === 0 && <option value="">{t('noProvidersConfigured')}</option>}
            {settings.agent.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
        </label>

        <label>
          {t('activeModel')}
          <select
            name="selectedModelId"
            value={settings.agent.selectedModelId ?? ''}
            onChange={(event) => selectModel(event.target.value || undefined)}
            disabled={!selectedProvider}
          >
            {!selectedProvider && <option value="">{t('noModelsConfigured')}</option>}
            {selectedProvider?.models.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-panel__section" aria-label={t('correctnessReviewer')}>
        <div>
          <p className="eyebrow">{t('correctnessReviewer')}</p>
          <p className="settings-panel__note">{t('correctnessReviewerNote')}</p>
        </div>
        <label>
          {t('reviewerMode')}
          <select
            name="correctnessReviewerMode"
            value={settings.agent.correctnessReviewer.mode}
            onChange={(event) => updateReviewerMode(event.target.value === 'custom-provider' ? 'custom-provider' : 'inherit-main')}
          >
            <option value="inherit-main">{t('reviewerInheritMain')}</option>
            <option value="custom-provider">{t('reviewerCustomProvider')}</option>
          </select>
        </label>
        {settings.agent.correctnessReviewer.mode === 'custom-provider' && (
          <>
            <label>
              {t('reviewerProvider')}
              <select
                name="correctnessReviewerProviderId"
                value={reviewerProvider?.id ?? ''}
                onChange={(event) => updateReviewerProvider(event.target.value)}
              >
                {settings.agent.providers.length === 0 && <option value="">{t('noProvidersConfigured')}</option>}
                {settings.agent.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
            </label>
            <label>
              {t('reviewerModel')}
              <select
                name="correctnessReviewerModelId"
                value={reviewerModelId}
                onChange={(event) => updateReviewerModel(event.target.value)}
                disabled={!reviewerProvider}
              >
                {!reviewerProvider && <option value="">{t('noModelsConfigured')}</option>}
                {reviewerProvider?.models.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <div className="settings-panel__provider-list" aria-label={t('configuredProviders')}>
        {settings.agent.providers.map((provider) => (
          <article className="settings-panel__provider-card" key={provider.id}>
            <div>
              <h3>{provider.name}</h3>
              <p>{provider.kind} / {provider.baseUrl}</p>
              <p>{provider.models.join(', ')}</p>
              {provider.apiKeyRef && <p>{t('secretReference', { ref: maskSecretRef(provider.apiKeyRef) })}</p>}
            </div>
            <div className="settings-panel__actions">
              <button className="ghost-button" type="button" onClick={() => setDraft(draftFromProvider(provider))}>{t('edit')}</button>
              {provider.apiKeyRef && (
                <button className="ghost-button" type="button" disabled={busyAction !== null} onClick={() => void clearApiKey(provider)}>
                  {busyAction === `clear:${provider.id}` ? t('clearingApiKey') : t('clearApiKey')}
                </button>
              )}
              <button className="ghost-button" type="button" disabled={busyAction !== null} onClick={() => void deleteProviderWithSecrets(provider)}>
                {busyAction === `delete:${provider.id}` ? t('deleting') : t('delete')}
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="settings-panel__section" aria-label={t('providerPresets')}>
        <div>
          <p className="eyebrow">{t('providerPresets')}</p>
          <p className="settings-panel__note">{t('providerPresetsNote')}</p>
        </div>
        <button className="ghost-button" type="button" disabled={busyAction !== null} onClick={applyDeepSeekPreset}>{t('useDeepSeekPreset')}</button>
      </div>

      <div className="settings-panel__form" aria-label={t('providerMetadataForm')}>
        <label>
          {t('providerId')}
          <input
            name="id"
            value={draft.id}
            readOnly={Boolean(draft.editingProviderId)}
            aria-readonly={Boolean(draft.editingProviderId)}
            onChange={(event) => {
              if (!draft.editingProviderId) updateDraft('id', event.target.value)
            }}
            placeholder="deepseek-main"
          />
        </label>
        <label>
          {t('displayName')}
          <input name="name" value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="DeepSeek Main" />
        </label>
        <label>
          {t('kind')}
          <select name="kind" value={draft.kind} onChange={(event) => updateDraft('kind', event.target.value as AgentProviderKind)}>
            {PROVIDER_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </label>
        <label>
          {t('baseUrl')}
          <input name="baseUrl" value={draft.baseUrl} onChange={(event) => updateDraft('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" />
        </label>
        <label>
          {t('models')}
          <textarea name="models" value={draft.modelsText} onChange={(event) => updateDraft('modelsText', event.target.value)} placeholder="model-a&#10;model-b" />
        </label>
        <label>
          {t('defaultModel')}
          <input name="defaultModel" value={draft.defaultModel} onChange={(event) => updateDraft('defaultModel', event.target.value)} placeholder="optional" />
        </label>
        <label>
          {t('apiKey')}
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            value={draft.apiKey}
            onChange={(event) => updateDraft('apiKey', event.target.value)}
            placeholder={draft.apiKeyRef ? t('savedKeyPlaceholder') : t('enterKeyPlaceholder')}
          />
        </label>
        <div className="settings-panel__actions">
          <button type="button" disabled={busyAction !== null} onClick={() => void saveDraft()}>
            {busyAction === 'save' ? t('saving') : t('saveProviderMetadata')}
          </button>
          <button className="ghost-button" type="button" disabled={busyAction !== null} onClick={() => setDraft(EMPTY_DRAFT)}>{t('clear')}</button>
        </div>
      </div>
    </section>
  )
}
