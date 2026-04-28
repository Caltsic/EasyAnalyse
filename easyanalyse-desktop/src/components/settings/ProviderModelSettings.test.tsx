// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../lib/appSettings'
import { DEEPSEEK_PROVIDER_PRESET } from '../../lib/providerPresets'
import { useSettingsStore } from '../../store/settingsStore'
import { ProviderModelSettings } from './ProviderModelSettings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function field(container: HTMLElement, name: string) {
  const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)
  expect(element).not.toBeNull()
  return element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
}

async function changeField(container: HTMLElement, name: string, value: string) {
  await act(async () => {
    const element = field(container, name)
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    valueSetter?.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

async function clickButton(container: HTMLElement, label: string) {
  await act(async () => {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === label)
    expect(button).toBeDefined()
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('ProviderModelSettings', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, loaded: true, warnings: [] })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders provider/model settings with masked secret status and no editable plaintext ref field', async () => {
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          {
            id: 'deepseek-main',
            name: 'DeepSeek Main',
            kind: 'deepseek',
            baseUrl: 'https://api.deepseek.com',
            models: ['deepseek-chat', 'deepseek-reasoner'],
            defaultModel: 'deepseek-chat',
            apiKeyRef: 'keychain://easyanalyse/provider/deepseek-main',
          },
        ],
        selectedProviderId: 'deepseek-main',
        selectedModelId: 'deepseek-reasoner',
      },
    }, null)

    await act(async () => {
      root.render(<ProviderModelSettings />)
    })

    expect(container.textContent).toContain('Provider / Model')
    expect(container.textContent).toContain('DeepSeek Main')
    expect(container.textContent).toContain('deepseek-reasoner')
    expect(container.textContent).toContain('Secret reference')
    expect(container.textContent).toContain('keychain://easy…main')
    const apiKeyInput = container.querySelector<HTMLInputElement>('input[name="apiKey"]')
    expect(apiKeyInput).not.toBeNull()
    expect(apiKeyInput?.type).toBe('password')
    expect(apiKeyInput?.autocomplete).toBe('off')
    expect(container.querySelector('input[name="password"]')).toBeNull()
    expect(container.querySelector('input[name="token"]')).toBeNull()
    expect(container.querySelector('input[name="apiKeyRef"]')).toBeNull()
  })

  it('keeps an invalid draft in the form and shows warnings instead of clearing rejected providers', async () => {
    await act(async () => {
      root.render(<ProviderModelSettings />)
    })

    await changeField(container, 'id', 'bad-url-provider')
    await changeField(container, 'name', 'Bad URL Provider')
    await changeField(container, 'baseUrl', '/relative/path')
    await changeField(container, 'models', 'model-a')
    await clickButton(container, 'Save provider metadata')

    expect(useSettingsStore.getState().settings.agent.providers).toHaveLength(0)
    expect(field(container, 'id').value).toBe('bad-url-provider')
    expect(field(container, 'baseUrl').value).toBe('/relative/path')
    expect(container.textContent).toContain('baseUrl')
  })

  it('saves API key input through SecretStore, persists only apiKeyRef, and shows fallback warning', async () => {
    const markerValue = `fixture-ui-secret-${crypto.randomUUID()}`
    const savedValues: string[] = []
    const secretStore = {
      saveSecret: async ({ value }: { providerId: string; value: string }) => {
        savedValues.push(value)
        return { ref: 'secret-ref:ui-provider-ref', security: { kind: 'local-secret-file' as const, warning: 'Weak security: stored in local app data secret file fallback.' } }
      },
      deleteSecret: async () => ({ deleted: true }),
      securityStatus: async () => ({ kind: 'local-secret-file' as const, warning: 'Weak security: stored in local app data secret file fallback.' }),
    }

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })

    await changeField(container, 'id', 'ui-provider')
    await changeField(container, 'name', 'UI Provider')
    await changeField(container, 'baseUrl', 'https://example.invalid/ui')
    await changeField(container, 'models', 'ui-model')
    await changeField(container, 'apiKey', markerValue)
    await clickButton(container, 'Save provider metadata')
    await act(async () => { await Promise.resolve() })

    expect(savedValues).toEqual([markerValue])
    const provider = useSettingsStore.getState().settings.agent.providers[0]
    expect(provider.apiKeyRef).toBe('secret-ref:ui-provider-ref')
    expect(JSON.stringify(useSettingsStore.getState().settings)).not.toContain(markerValue)
    expect(container.textContent).toContain('Weak security')
    expect(field(container, 'apiKey').value).toBe('')
  })

  it('fills and saves the DeepSeek preset as public metadata without saving a blank API key', async () => {
    const secretStore = {
      saveSecret: vi.fn(async () => {
        throw new Error('SecretStore saveSecret must not be called for a blank preset API key')
      }),
      deleteSecret: vi.fn(async () => ({ deleted: true })),
      securityStatus: vi.fn(async () => ({ kind: 'native-keychain' as const })),
    }

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })

    await clickButton(container, 'Use DeepSeek preset')

    expect(field(container, 'id').value).toBe('deepseek')
    expect(field(container, 'name').value).toBe('DeepSeek')
    expect(field(container, 'kind').value).toBe('deepseek')
    expect(field(container, 'baseUrl').value).toBe('https://api.deepseek.com/v1')
    expect(field(container, 'models').value).toBe('deepseek-chat\ndeepseek-reasoner')
    expect(field(container, 'defaultModel').value).toBe('deepseek-chat')
    expect(field(container, 'apiKey').value).toBe('')

    await clickButton(container, 'Save provider metadata')
    await act(async () => { await Promise.resolve() })

    expect(secretStore.saveSecret).not.toHaveBeenCalled()
    const settings = useSettingsStore.getState().settings
    expect(settings.agent.providers).toEqual([DEEPSEEK_PROVIDER_PRESET])
    expect(settings.agent.selectedProviderId).toBe('deepseek')
    expect(settings.agent.selectedModelId).toBe('deepseek-chat')
    expect(settings.agent.providers[0]).not.toHaveProperty('apiKeyRef')
    expect(JSON.stringify(settings)).not.toMatch(/(?:apiKey|apiKeyRef|secret-ref:|keychain:\/\/|Bearer\s+)/i)
  })

  it('preserves an existing DeepSeek apiKeyRef when saving preset metadata without a new API key', async () => {
    const secretStore = {
      saveSecret: vi.fn(async () => ({ ref: 'secret-ref:unexpected-new-key', security: { kind: 'native-keychain' as const } })),
      deleteSecret: vi.fn(async () => ({ deleted: true })),
      securityStatus: vi.fn(async () => ({ kind: 'native-keychain' as const })),
    }
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          {
            id: 'deepseek',
            name: 'Legacy DeepSeek',
            kind: 'deepseek',
            baseUrl: 'https://legacy.deepseek.invalid/v1',
            models: ['legacy-deepseek-model'],
            defaultModel: 'legacy-deepseek-model',
            apiKeyRef: 'secret-ref:existing-deepseek',
          },
        ],
        selectedProviderId: 'deepseek',
        selectedModelId: 'legacy-deepseek-model',
      },
    }, null)

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })

    await clickButton(container, 'Use DeepSeek preset')
    expect(field(container, 'apiKey').value).toBe('')
    await clickButton(container, 'Save provider metadata')
    await act(async () => { await Promise.resolve() })

    expect(secretStore.saveSecret).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().settings.agent.providers).toEqual([
      { ...DEEPSEEK_PROVIDER_PRESET, apiKeyRef: 'secret-ref:existing-deepseek' },
    ])
    expect(useSettingsStore.getState().settings.agent.selectedModelId).toBe('deepseek-chat')
  })

  it('deletes an existing DeepSeek secret ref when the preset flow saves a replacement API key', async () => {
    const replacementValue = `fixture-deepseek-replacement-${crypto.randomUUID()}`
    const savedValues: string[] = []
    const secretStore = {
      saveSecret: vi.fn(async ({ providerId, value }: { providerId: string; value: string }) => {
        expect(providerId).toBe('deepseek')
        savedValues.push(value)
        return { ref: 'secret-ref:new-deepseek', security: { kind: 'native-keychain' as const } }
      }),
      deleteSecret: vi.fn(async () => ({ deleted: true })),
      securityStatus: vi.fn(async () => ({ kind: 'native-keychain' as const })),
    }
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          {
            id: 'deepseek',
            name: 'Legacy DeepSeek',
            kind: 'deepseek',
            baseUrl: 'https://legacy.deepseek.invalid/v1',
            models: ['legacy-deepseek-model'],
            defaultModel: 'legacy-deepseek-model',
            apiKeyRef: 'secret-ref:old-deepseek',
          },
        ],
        selectedProviderId: 'deepseek',
        selectedModelId: 'legacy-deepseek-model',
      },
    }, null)

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })

    await clickButton(container, 'Use DeepSeek preset')
    await changeField(container, 'apiKey', replacementValue)
    await clickButton(container, 'Save provider metadata')
    await act(async () => { await Promise.resolve() })

    expect(savedValues).toEqual([replacementValue])
    expect(secretStore.saveSecret).toHaveBeenCalledTimes(1)
    const settings = useSettingsStore.getState().settings
    expect(settings.agent.providers).toEqual([
      { ...DEEPSEEK_PROVIDER_PRESET, apiKeyRef: 'secret-ref:new-deepseek' },
    ])
    expect(JSON.stringify(settings)).not.toContain(replacementValue)
    expect(secretStore.deleteSecret).toHaveBeenCalledTimes(1)
    expect(secretStore.deleteSecret).toHaveBeenCalledWith('secret-ref:old-deepseek')
  })

  it('rolls back a newly saved API key when provider metadata is rejected', async () => {
    const deletedRefs: string[] = []
    const secretStore = {
      saveSecret: async () => ({ ref: 'secret-ref:orphan-candidate', security: { kind: 'native-keychain' as const } }),
      deleteSecret: async (ref: string) => {
        deletedRefs.push(ref)
        return { deleted: true }
      },
      securityStatus: async () => ({ kind: 'native-keychain' as const }),
    }

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })

    await changeField(container, 'id', 'bad-provider')
    await changeField(container, 'name', 'Bad Provider')
    await changeField(container, 'baseUrl', '/relative/path')
    await changeField(container, 'models', 'model-a')
    await changeField(container, 'apiKey', `fixture-ui-secret-${crypto.randomUUID()}`)
    await clickButton(container, 'Save provider metadata')
    await act(async () => { await Promise.resolve() })

    expect(useSettingsStore.getState().settings.agent.providers).toHaveLength(0)
    expect(deletedRefs).toEqual(['secret-ref:orphan-candidate'])
    expect(container.textContent).toContain('Provider metadata was rejected')
    expect(field(container, 'apiKey').value).toBe('')
  })

  it('deletes the old secret ref after a replacement API key is persisted', async () => {
    const deletedRefs: string[] = []
    const secretStore = {
      saveSecret: async () => ({ ref: 'secret-ref:new-key', security: { kind: 'native-keychain' as const } }),
      deleteSecret: async (ref: string) => {
        deletedRefs.push(ref)
        return { deleted: true }
      },
      securityStatus: async () => ({ kind: 'native-keychain' as const }),
    }
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'replace-provider', name: 'Replace Provider', kind: 'anthropic', baseUrl: 'https://example.invalid/replace', models: ['replace-model'], apiKeyRef: 'secret-ref:old-key' },
        ],
        selectedProviderId: 'replace-provider',
        selectedModelId: 'replace-model',
      },
    }, null)

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })
    await clickButton(container, 'Edit')
    await changeField(container, 'apiKey', `fixture-replacement-secret-${crypto.randomUUID()}`)
    await clickButton(container, 'Save provider metadata')
    await act(async () => { await Promise.resolve() })

    expect(useSettingsStore.getState().settings.agent.providers[0].apiKeyRef).toBe('secret-ref:new-key')
    expect(deletedRefs).toEqual(['secret-ref:old-key'])
  })


  it('keeps provider id read-only while editing an existing provider', async () => {
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'readonly-provider', name: 'Readonly Provider', kind: 'deepseek', baseUrl: 'https://example.invalid/readonly', models: ['readonly-model'] },
        ],
        selectedProviderId: 'readonly-provider',
        selectedModelId: 'readonly-model',
      },
    }, null)

    await act(async () => {
      root.render(<ProviderModelSettings />)
    })
    await clickButton(container, 'Edit')

    const idInput = field(container, 'id') as HTMLInputElement
    expect(idInput.readOnly).toBe(true)
    await changeField(container, 'id', 'renamed-provider')
    expect(field(container, 'id').value).toBe('readonly-provider')
  })

  it('keeps a new replacement API key when old secret cleanup fails and clears plaintext input', async () => {
    const deletedRefs: string[] = []
    const secretStore = {
      saveSecret: async () => ({ ref: 'secret-ref:new-key', security: { kind: 'native-keychain' as const } }),
      deleteSecret: async (ref: string) => {
        deletedRefs.push(ref)
        if (ref === 'secret-ref:old-key') throw new Error('old secret cleanup failed')
        return { deleted: true }
      },
      securityStatus: async () => ({ kind: 'native-keychain' as const }),
    }
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'cleanup-provider', name: 'Cleanup Provider', kind: 'anthropic', baseUrl: 'https://example.invalid/cleanup', models: ['cleanup-model'], apiKeyRef: 'secret-ref:old-key' },
        ],
        selectedProviderId: 'cleanup-provider',
        selectedModelId: 'cleanup-model',
      },
    }, null)

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })
    await clickButton(container, 'Edit')
    await changeField(container, 'apiKey', `fixture-replacement-secret-${crypto.randomUUID()}`)
    await clickButton(container, 'Save provider metadata')
    await act(async () => { await Promise.resolve() })

    expect(useSettingsStore.getState().settings.agent.providers[0].apiKeyRef).toBe('secret-ref:new-key')
    expect(deletedRefs).toEqual(['secret-ref:old-key'])
    expect(deletedRefs).not.toContain('secret-ref:new-key')
    expect(container.textContent).toContain('Provider saved, but unable to delete old API key')
    expect(field(container, 'apiKey').value).toBe('')
  })

  it('clears plaintext API key input when SecretStore save fails', async () => {
    const secretStore = {
      saveSecret: async () => { throw new Error('save failed') },
      deleteSecret: async () => ({ deleted: true }),
      securityStatus: async () => ({ kind: 'native-keychain' as const }),
    }

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })
    await changeField(container, 'id', 'save-fails')
    await changeField(container, 'name', 'Save Fails')
    await changeField(container, 'baseUrl', 'https://example.invalid/save-fails')
    await changeField(container, 'models', 'save-fails-model')
    await changeField(container, 'apiKey', `fixture-secret-${crypto.randomUUID()}`)
    await clickButton(container, 'Save provider metadata')
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain('save failed')
    expect(field(container, 'apiKey').value).toBe('')
    expect(useSettingsStore.getState().settings.agent.providers).toHaveLength(0)
  })

  it('shows a readable error when clearing a saved API key fails', async () => {
    const secretStore = {
      saveSecret: async ({ value }: { providerId: string; value: string }) => ({ ref: `secret-ref:${value}`, security: { kind: 'native-keychain' as const } }),
      deleteSecret: async () => {
        throw new Error('secret backend unavailable')
      },
      securityStatus: async () => ({ kind: 'native-keychain' as const }),
    }
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'error-provider', name: 'Error Provider', kind: 'anthropic', baseUrl: 'https://example.invalid/error', models: ['error-model'], apiKeyRef: 'secret-ref:error-key' },
        ],
        selectedProviderId: 'error-provider',
        selectedModelId: 'error-model',
      },
    }, null)

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })
    await clickButton(container, 'Clear API key')
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain('Unable to clear API key')
    expect(container.textContent).toContain('secret backend unavailable')
  })

  it('clears a saved API key through SecretStore without deleting provider metadata', async () => {
    const deletedRefs: string[] = []
    const secretStore = {
      saveSecret: async ({ value }: { providerId: string; value: string }) => ({ ref: `secret-ref:${value}`, security: { kind: 'native-keychain' as const } }),
      deleteSecret: async (ref: string) => {
        deletedRefs.push(ref)
        return { deleted: true }
      },
      securityStatus: async () => ({ kind: 'native-keychain' as const }),
    }
    useSettingsStore.getState().replaceSettings({
      agent: {
        providers: [
          { id: 'keep-provider', name: 'Keep Provider', kind: 'anthropic', baseUrl: 'https://example.invalid/keep', models: ['keep-model'], apiKeyRef: 'secret-ref:clear-me' },
        ],
        selectedProviderId: 'keep-provider',
        selectedModelId: 'keep-model',
      },
    }, null)

    await act(async () => {
      root.render(<ProviderModelSettings secretStore={secretStore} />)
    })

    expect(container.textContent).toContain('Secret reference')
    await clickButton(container, 'Clear API key')
    await act(async () => { await Promise.resolve() })

    expect(deletedRefs).toEqual(['secret-ref:clear-me'])
    const provider = useSettingsStore.getState().settings.agent.providers[0]
    expect(provider).toMatchObject({
      id: 'keep-provider',
      name: 'Keep Provider',
      kind: 'anthropic',
      baseUrl: 'https://example.invalid/keep',
      models: ['keep-model'],
    })
    expect(provider).not.toHaveProperty('apiKeyRef')
    expect(useSettingsStore.getState().settings.agent.selectedProviderId).toBe('keep-provider')
    expect(container.textContent).toContain('Keep Provider')
    expect(container.textContent).not.toContain('Secret reference')
  })

  it('adds, edits, selects, and deletes provider metadata through the UI', async () => {
    await act(async () => {
      root.render(<ProviderModelSettings />)
    })

    await changeField(container, 'id', 'provider-a')
    await changeField(container, 'name', 'Provider A')
    await changeField(container, 'kind', 'anthropic')
    await changeField(container, 'baseUrl', 'https://example.invalid/a')
    await changeField(container, 'models', 'claude-a\nclaude-b')
    await changeField(container, 'defaultModel', 'claude-b')
    await changeField(container, 'apiKey', `fixture-ui-secret-${crypto.randomUUID()}`)
    await clickButton(container, 'Save provider metadata')

    await changeField(container, 'id', 'provider-b')
    await changeField(container, 'name', 'Provider B')
    await changeField(container, 'kind', 'openai-compatible')
    await changeField(container, 'baseUrl', 'https://example.invalid/b')
    await changeField(container, 'models', 'model-b1,model-b2')
    await changeField(container, 'defaultModel', 'model-b1')
    await clickButton(container, 'Save provider metadata')

    expect(container.textContent).toContain('Provider A')
    expect(container.textContent).toContain('Provider B')
    expect(useSettingsStore.getState().settings.agent.providers).toHaveLength(2)

    await changeField(container, 'selectedProviderId', 'provider-a')
    await changeField(container, 'selectedModelId', 'claude-a')
    expect(useSettingsStore.getState().settings.agent.selectedProviderId).toBe('provider-a')
    expect(useSettingsStore.getState().settings.agent.selectedModelId).toBe('claude-a')

    const providerBCards = Array.from(container.querySelectorAll('article')).filter((article) => article.textContent?.includes('Provider B'))
    expect(providerBCards).toHaveLength(1)
    await act(async () => {
      providerBCards[0].querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(field(container, 'id').value).toBe('provider-b')
    await changeField(container, 'name', 'Provider B Edited')
    await changeField(container, 'models', 'model-b2')
    await changeField(container, 'defaultModel', 'model-b2')
    await clickButton(container, 'Save provider metadata')

    expect(container.textContent).toContain('Provider B Edited')
    expect(useSettingsStore.getState().settings.agent.providers.find((provider) => provider.id === 'provider-b')?.models).toEqual(['model-b2'])

    const providerACards = Array.from(container.querySelectorAll('article')).filter((article) => article.textContent?.includes('Provider A'))
    expect(providerACards).toHaveLength(1)
    await act(async () => {
      const deleteButton = Array.from(providerACards[0].querySelectorAll('button')).find((button) => button.textContent === 'Delete')
      expect(deleteButton).toBeDefined()
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).not.toContain('Provider A')
    expect(useSettingsStore.getState().settings.agent.providers.map((provider) => provider.id)).toEqual(['provider-b'])
    expect(useSettingsStore.getState().settings.agent.selectedProviderId).toBe('provider-b')
  })
})
