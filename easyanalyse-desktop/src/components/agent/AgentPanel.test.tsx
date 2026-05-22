// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDefaultDocument } from '../../lib/document'
import { parseAgentResponse } from '../../lib/agentResponse'
import { createMockAgentResponse } from '../../lib/agentMockProvider'
import type { MockAgentRequest } from '../../lib/agentMockProvider'
import { createEmptyBlueprintWorkspace } from '../../lib/blueprintWorkspace'
import { createMemorySecretBackend, createSecretStore, type SecretStore } from '../../lib/secretStore'
import { hashDocument } from '../../lib/documentHash'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { AgentResponseParseResult } from '../../types/agent'
import type { DocumentFile } from '../../types/document'
import type { AgentProviderPublicConfig } from '../../types/settings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const providerMock = vi.hoisted(() => ({
  runMockAgentProvider: vi.fn<(request: MockAgentRequest) => Promise<AgentResponseParseResult>>(),
  runConfiguredAgentProvider: vi.fn(),
}))

vi.mock('../../lib/agentMockProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/agentMockProvider')>()),
  runMockAgentProvider: providerMock.runMockAgentProvider,
}))

vi.mock('../../lib/agentProviderClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/agentProviderClient')>()),
  runConfiguredAgentProvider: providerMock.runConfiguredAgentProvider,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function createDocument(id = 'doc-agent'): DocumentFile {
  const document = buildDefaultDocument()
  return {
    ...document,
    document: {
      ...document.document,
      id,
      title: `Agent ${id}`,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function renderPanel(props: { secretStore?: Pick<SecretStore, 'readSecret'> } = {}) {
  const { AgentPanel } = await import('./AgentPanel')
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<AgentPanel {...props} />)
  })
  return container
}

async function enterPromptAndSubmit(host: HTMLElement, prompt: string) {
  const textarea = host.querySelector<HTMLTextAreaElement>('#agent-panel-prompt')
  const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')
  expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
  expect(submit).toBeInstanceOf(HTMLButtonElement)
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    valueSetter?.call(textarea, prompt)
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    submit!.click()
  })
}

function deepseekProvider(overrides: Partial<AgentProviderPublicConfig> = {}): AgentProviderPublicConfig {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat'],
    defaultModel: 'deepseek-chat',
    apiKeyRef: 'secret-ref:deepseek-test',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useBlueprintStore.setState({
    workspace: null,
    sidecarPath: null,
    dirty: false,
    selectedBlueprintId: null,
    loadError: null,
    saveError: null,
    validationError: null,
  })
  useEditorStore.setState({
    document: createDocument(),
    filePath: '/tmp/agent.easyanalyse.json',
    dirty: false,
    locale: 'en-US',
  })
  useSettingsStore.setState({
    settings: { basic: { locale: 'system' }, appearance: { theme: 'system' }, agent: { providers: [] } },
    loaded: true,
    warnings: [],
  })
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  root = null
  container = null
})

describe('AgentPanel', () => {
  it('stores valid and invalid mock blueprint candidates without mutating the main document', async () => {
    const mainDocument = useEditorStore.getState().document
    const beforeJson = JSON.stringify(mainDocument)
    providerMock.runMockAgentProvider.mockImplementation(async (request) =>
      parseAgentResponse(createMockAgentResponse({ ...request, scenario: 'blueprints' }), {
        mainDocument: request.currentDocument,
      }),
    )
    const host = await renderPanel()

    await enterPromptAndSubmit(host, 'make blueprint candidates')

    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(2))
    })
    expect(JSON.stringify(useEditorStore.getState().document)).toBe(beforeJson)
    expect(useEditorStore.getState().dirty).toBe(false)
    expect(useBlueprintStore.getState().workspace?.blueprints.map((record) => record.source)).toEqual(['agent', 'agent'])
    expect(useBlueprintStore.getState().workspace?.blueprints.map((record) => record.validationState)).toEqual([
      'unknown',
      'invalid',
    ])
    expect(host.textContent).toContain('2 blueprint candidates stored')
    expect(host.textContent).toContain('Invalid retained candidate')
  })

  it('cancels an in-flight provider response without inserting candidates', async () => {
    const pending = deferred<AgentResponseParseResult>()
    providerMock.runMockAgentProvider.mockReturnValue(pending.promise)
    const host = await renderPanel()

    await enterPromptAndSubmit(host, 'blueprint slow')
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Cancel run"]')?.click()
    })
    pending.resolve(parseAgentResponse(createMockAgentResponse({ prompt: 'blueprint slow', scenario: 'blueprints' })))
    await act(async () => {
      await pending.promise
    })

    expect(useBlueprintStore.getState().workspace?.blueprints ?? []).toEqual([])
    expect(host.textContent).toContain('Agent run cancelled')
  })

  it('ignores provider results when the editor document switches before insertion', async () => {
    const pending = deferred<AgentResponseParseResult>()
    providerMock.runMockAgentProvider.mockReturnValue(pending.promise)
    const host = await renderPanel()

    await enterPromptAndSubmit(host, 'blueprint after switch')
    await act(async () => {
      useEditorStore.setState({ document: createDocument('doc-switched'), filePath: '/tmp/switched.easyanalyse.json' })
      pending.resolve(parseAgentResponse(createMockAgentResponse({ prompt: 'blueprint after switch', scenario: 'blueprints' })))
      await pending.promise
    })

    expect(useBlueprintStore.getState().workspace?.blueprints ?? []).toEqual([])
    expect(host.textContent).toContain('ignored because the editor document or workspace changed')
  })

  it('store insertion is stale-safe when the blueprint workspace switches while candidates are being created', async () => {
    const originalDocument = createDocument('doc-original')
    const switchedDocument = createDocument('doc-workspace-switch')
    const mainHash = await hashDocument(originalDocument)
    useBlueprintStore.setState({
      workspace: createEmptyBlueprintWorkspace({
        mainDocument: { documentId: originalDocument.document.id, path: '/tmp/original.easyanalyse.json', hash: mainHash },
      }),
    })
    const parsed = parseAgentResponse(
      createMockAgentResponse({ prompt: 'blueprint', currentDocument: originalDocument, scenario: 'blueprints' }),
      { mainDocument: originalDocument },
    )
    expect(parsed.response.kind).toBe('blueprints')

    const insertionPromise =
      parsed.response.kind === 'blueprints'
        ? useBlueprintStore.getState().addAgentBlueprintCandidates(parsed.response.blueprints, {
            mainDocument: originalDocument,
            filePath: '/tmp/original.easyanalyse.json',
            issues: parsed.issues,
          })
        : Promise.resolve([])
    await useBlueprintStore.getState().loadForMainDocument('/tmp/switched.easyanalyse.json', switchedDocument)
    const inserted = await insertionPromise

    expect(inserted).toEqual([])
    expect(useBlueprintStore.getState().workspace?.mainDocument?.documentId).toBe('doc-workspace-switch')
    expect(useBlueprintStore.getState().workspace?.blueprints).toEqual([])
  })

  it('uses the configured DeepSeek provider and saved secret when settings select a real provider', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const parsed = parseAgentResponse(createMockAgentResponse({ prompt: 'deepseek blueprint', scenario: 'blueprints' }))
    const pending = deferred<AgentResponseParseResult>()
    providerMock.runConfiguredAgentProvider.mockReturnValue(pending.promise)
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel({ secretStore })

    await act(async () => {
      host.querySelector<HTMLInputElement>('#agent-panel-include-document')!.click()
    })
    await enterPromptAndSubmit(host, 'deepseek blueprint')

    await act(async () => {
      await vi.waitFor(() => expect(providerMock.runConfiguredAgentProvider).toHaveBeenCalledTimes(1))
    })
    expect(providerMock.runMockAgentProvider).not.toHaveBeenCalled()
    expect(providerMock.runConfiguredAgentProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider,
      modelId: 'deepseek-chat',
      apiKey: expect.any(String),
      prompt: 'deepseek blueprint',
      includeDocumentContext: true,
      currentDocument: useEditorStore.getState().document,
      signal: expect.any(AbortSignal),
    }))
    await act(async () => {
      pending.resolve(parsed)
      await pending.promise
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(2))
    })
    expect(host.textContent).toContain('2 blueprint candidates stored')
  })

  it('shows configured provider activity while a response is still pending', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const parsed = parseAgentResponse(createMockAgentResponse({ prompt: 'deepseek slow blueprint', scenario: 'blueprints' }))
    const parsedWithToolTrace = {
      ...parsed,
      toolTrace: [
        {
          toolName: 'check_blueprint_format',
          ok: true,
          summary: 'Blueprint candidate hard format check passed.',
          issueCount: 0,
        },
      ],
    }
    const pending = deferred<AgentResponseParseResult>()
    providerMock.runConfiguredAgentProvider.mockImplementation((input) => {
      input.progress?.({ phase: 'request', message: 'Sending provider request 1 with tool access.' })
      input.progress?.({ phase: 'response', message: 'Provider returned reasoning metadata (14228 characters) without final content yet.' })
      return pending.promise
    })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel({ secretStore })

    await enterPromptAndSubmit(host, 'deepseek slow blueprint')

    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Provider returned reasoning metadata'))
    })
    expect(host.textContent).toContain('Running')
    expect(host.textContent).toContain('Sending provider request 1 with tool access')
    const toolDetails = Array.from(host.querySelectorAll<HTMLDetailsElement>('details.agent-message__tool-details'))
    expect(toolDetails.length).toBeGreaterThan(0)
    expect(toolDetails.every((details) => !details.open)).toBe(true)

    await act(async () => {
      pending.resolve(parsedWithToolTrace)
      await pending.promise
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(2))
    })
    const messageArticles = Array.from(host.querySelectorAll<HTMLElement>('article.agent-message'))
    const messageTexts = messageArticles.map((article) => article.textContent ?? '')
    const toolChecksIndex = messageTexts.findIndex((text) => text.includes('Tool checks'))
    const assistantIndex = messageTexts.findIndex((text) => text.includes('2 blueprint candidates stored'))
    expect(toolChecksIndex).toBeGreaterThan(-1)
    expect(assistantIndex).toBeGreaterThan(toolChecksIndex)
    expect(messageArticles.at(-1)?.className).toContain('agent-message--assistant')
  })

  it('does not call a configured provider when its API key is missing', async () => {
    const provider = deepseekProvider({ apiKeyRef: undefined })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel()

    await enterPromptAndSubmit(host, 'should fail before request')

    expect(providerMock.runConfiguredAgentProvider).not.toHaveBeenCalled()
    expect(host.textContent).toContain('has no saved API key')
  })

  it('asks users to re-save unsupported legacy keychain API key references', async () => {
    const provider = deepseekProvider({ apiKeyRef: 'keychain://deepseek/legacy' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel()

    await enterPromptAndSubmit(host, 'should fail before request')

    expect(providerMock.runConfiguredAgentProvider).not.toHaveBeenCalled()
    expect(host.textContent).toContain('unsupported legacy API key reference')
  })

  it('aborts a configured provider run when cancelled', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    let capturedSignal: AbortSignal | undefined
    const pending = deferred<AgentResponseParseResult>()
    providerMock.runConfiguredAgentProvider.mockImplementation((input) => {
      capturedSignal = input.signal
      return pending.promise
    })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel({ secretStore })
    await enterPromptAndSubmit(host, 'slow real provider')
    await vi.waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal))
    const signal = capturedSignal as AbortSignal
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Cancel run"]')?.click()
    })
    expect(signal.aborted).toBe(true)
    pending.resolve(parseAgentResponse(createMockAgentResponse({ prompt: 'slow real provider', scenario: 'blueprints' })))
    await act(async () => {
      await pending.promise
    })

    expect(useBlueprintStore.getState().workspace?.blueprints ?? []).toEqual([])
    expect(host.textContent).toContain('Agent run cancelled')
  })
})
