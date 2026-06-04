// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDefaultDocument } from '../../lib/document'
import { parseAgentResponse } from '../../lib/agentResponse'
import { createMockAgentResponse } from '../../lib/agentMockProvider'
import type { MockAgentRequest } from '../../lib/agentMockProvider'
import type { AgentProviderProgressEvent } from '../../lib/agentProviderClient'
import type { OpenAiCompatibleFetch } from '../../lib/openAiCompatibleProvider'
import { createEmptyBlueprintWorkspace } from '../../lib/blueprintWorkspace'
import { createMemorySecretBackend, createSecretStore } from '../../lib/secretStore'
import { hashDocument } from '../../lib/documentHash'
import { LIVE_BLUEPRINT_JSON_MARKER } from '../../lib/liveBlueprintDraft'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { AgentResponseParseResult } from '../../types/agent'
import type { DocumentFile } from '../../types/document'
import type { AgentProviderPublicConfig } from '../../types/settings'
import type { AgentPanelProps } from './AgentPanel'

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

vi.mock('../blueprints/BlueprintPreviewCanvas', () => ({
  BlueprintPreviewCanvas: ({ document, className }: { document: DocumentFile; className?: string }) => (
    <div aria-label="Blueprint preview canvas" className={className} data-document-title={document.document.title} />
  ),
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

function createDocumentWithDevice(id = 'doc-agent-device'): DocumentFile {
  const document = createDocument(id)
  return {
    ...document,
    devices: [
      {
        id: 'r1',
        name: 'R1',
        kind: 'resistor',
        terminals: [
          { id: 'r1-a', name: 'A', direction: 'input', label: 'VIN' },
          { id: 'r1-b', name: 'B', direction: 'output', label: 'VOUT' },
        ],
      },
    ],
    view: {
      ...document.view,
      devices: {
        r1: { position: { x: 100, y: 100 }, size: { width: 120, height: 80 } },
      },
      networkLines: {},
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

async function renderPanel(props: AgentPanelProps = {}) {
  const { AgentPanel } = await import('./AgentPanel')
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<AgentPanel {...props} />)
  })
  return container
}

async function renderAgentAndBlueprints(props: AgentPanelProps = {}) {
  const { AgentPanel } = await import('./AgentPanel')
  const { BlueprintsPanel } = await import('../blueprints/BlueprintsPanel')
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <>
        <AgentPanel {...props} />
        <BlueprintsPanel />
      </>,
    )
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

function createControlledSseResponse() {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

  return {
    response,
    enqueue(event: unknown) {
      if (!controller) throw new Error('SSE stream controller is not ready')
      const data = event === '[DONE]' ? '[DONE]' : JSON.stringify(event)
      controller.enqueue(encoder.encode(`data: ${data}\n\n`))
    },
    close() {
      controller?.close()
    },
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
    liveDraft: {
      status: 'idle',
      sessionId: null,
      raw: '',
      markerFound: false,
      hasCompleteJson: false,
      displayDocument: null,
      lastGoodDocument: null,
      updatedAt: null,
    },
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

  it('asks before blueprint generation and saves the current canvas as a new blueprint before continuing', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-begin-gate-save')
    const finalResponse = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'Generation can continue',
      markdown: 'The canvas was saved before generating.',
    }))
    let providerContinuedAfterGate = false
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      const beginResult = await input.beginBlueprintGeneration?.({ intent: 'Generate a replacement circuit', title: 'Saved before generation' })
      expect(beginResult).toMatchObject({ allowed: true, action: 'save_new_blueprint' })
      providerContinuedAfterGate = true
      return finalResponse
    })
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/begin-save.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderAgentAndBlueprints({ secretStore })

    await enterPromptAndSubmit(host, 'generate a replacement blueprint')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })
    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Save as new blueprint'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Generation can continue'))
    })

    expect(providerContinuedAfterGate).toBe(true)
    const blueprints = useBlueprintStore.getState().workspace?.blueprints ?? []
    expect(blueprints).toHaveLength(1)
    expect(blueprints[0]).toMatchObject({
      title: 'Saved before generation',
      source: 'manual_snapshot',
      document: expect.objectContaining({ document: expect.objectContaining({ id: 'doc-begin-gate-save' }) }),
    })
  })

  it('reuses the begin gate decision before storing final blueprints', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-begin-gate-reuse')
    const candidateDocument = createDocument('doc-reuse-after-begin')
    candidateDocument.document.title = 'Final after begin gate'
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      const beginResult = await input.beginBlueprintGeneration?.({ intent: 'Generate replacement', title: 'Final after begin gate' })
      expect(beginResult).toMatchObject({ allowed: true, action: 'continue_without_saving' })
      return parseAgentResponse(JSON.stringify({
        schemaVersion: 'agent-response-v1',
        semanticVersion: 'easyanalyse-semantic-v4',
        kind: 'blueprints',
        summary: 'Final candidate after begin tool',
        blueprints: [{
          title: 'Final after begin gate',
          summary: 'Stored without showing the begin gate a second time.',
          rationale: 'The first begin gate decision is scoped to this run.',
          tradeoffs: [],
          document: candidateDocument,
          issues: [],
        }],
      }))
    })
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/begin-reuse.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderAgentAndBlueprints({ secretStore })

    await enterPromptAndSubmit(host, 'start with begin tool then return final blueprint')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })
    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Continue without saving'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1))
    })

    expect(useBlueprintStore.getState().workspace?.blueprints[0]?.title).toBe('Final after begin gate')
    expect(host.textContent).not.toContain('Save the current canvas before generating?')
  })

  it('cancels the provider run from the begin blueprint generation gate', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-begin-gate-cancel')
    let beginResult: unknown = null
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      beginResult = await input.beginBlueprintGeneration?.({ intent: 'Generate replacement' })
      return parseAgentResponse(JSON.stringify({
        schemaVersion: 'agent-response-v1',
        semanticVersion: 'easyanalyse-semantic-v4',
        kind: 'message',
        markdown: 'This response should be ignored after cancellation.',
      }))
    })
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/begin-cancel.easyanalyse' })
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

    await enterPromptAndSubmit(host, 'start then cancel blueprint generation')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })
    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Cancel generation'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Agent run cancelled'))
    })

    expect(beginResult).toMatchObject({ allowed: false, action: 'cancelled' })
    expect(host.textContent).not.toContain('This response should be ignored after cancellation.')
    expect(useBlueprintStore.getState().workspace?.blueprints ?? []).toEqual([])
  })

  it('enforces the begin gate before storing final blueprints even when the model skipped the begin tool', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-begin-gate-final')
    const candidateDocument = createDocument('doc-final-after-gate')
    candidateDocument.document.title = 'Final after enforced gate'
    providerMock.runConfiguredAgentProvider.mockResolvedValue(parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'blueprints',
      summary: 'Final candidate without begin tool',
      blueprints: [{
        title: 'Final after enforced gate',
        summary: 'Should store only after user chooses.',
        rationale: 'The model skipped the begin tool, so EasyAnalyse enforces it.',
        tradeoffs: [],
        document: candidateDocument,
        issues: [],
      }],
    })))
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/begin-final.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderAgentAndBlueprints({ secretStore })

    await enterPromptAndSubmit(host, 'return final blueprints without begin tool')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })
    expect(useBlueprintStore.getState().workspace?.blueprints ?? []).toEqual([])

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Continue without saving'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1))
    })

    expect(useBlueprintStore.getState().workspace?.blueprints[0]?.title).toBe('Final after enforced gate')
    expect(host.textContent).toContain('1 blueprint candidates stored')
  })

  it('enforces the begin gate before storing tool-created blueprints when the model skipped the begin tool', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-begin-gate-tool')
    const candidateDocument = createDocument('doc-tool-after-gate')
    const candidate = {
      title: 'Tool after enforced gate',
      summary: 'Stored after user gate.',
      rationale: 'The model skipped begin but called create_blueprint_candidate.',
      tradeoffs: [],
      document: candidateDocument,
      issues: [],
    }
    let createResult: unknown = null
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      createResult = await input.createBlueprintCandidate?.(candidate)
      return parseAgentResponse(JSON.stringify({
        schemaVersion: 'agent-response-v1',
        semanticVersion: 'easyanalyse-semantic-v4',
        kind: 'message',
        markdown: 'Tool storage completed.',
      }))
    })
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/begin-tool.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderAgentAndBlueprints({ secretStore })

    await enterPromptAndSubmit(host, 'call create blueprint without begin tool')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })
    expect(createResult).toBeNull()

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Continue without saving'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1))
    })

    expect(createResult).toMatchObject({ blueprintIds: [expect.any(String)] })
    expect(useBlueprintStore.getState().workspace?.blueprints[0]?.title).toBe('Tool after enforced gate')
  })

  it('projects configured provider streamed blueprint JSON into transient live draft state', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const liveDocument = createDocument('doc-live-streamed')
    liveDocument.document.title = 'Live streamed draft'
    const partialAgentResponseWithCompleteDocument = [
      '{',
      '"schemaVersion":"agent-response-v1",',
      '"semanticVersion":"easyanalyse-semantic-v4",',
      '"kind":"blueprints",',
      '"summary":"Streaming wrapper",',
      '"blueprints":[{',
      '"title":"Live candidate",',
      '"summary":"Candidate summary",',
      '"rationale":"Candidate rationale",',
      '"tradeoffs":[],',
      `"document":${JSON.stringify(liveDocument)},`,
      '"issues":[]',
    ].join('')
    const finalResponse = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'Live preview ready',
      markdown: 'The live draft is visible in the blueprint preview.',
    }))
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming blueprint draft partial.',
        detail: {
          streamedContent: `${LIVE_BLUEPRINT_JSON_MARKER}\n{"schemaVersion":"4.0.0"`,
        },
      })
      input.progress?.({
        phase: 'response',
        message: 'Streaming complete blueprint draft.',
        detail: {
          streamedContent: `${LIVE_BLUEPRINT_JSON_MARKER}\n${partialAgentResponseWithCompleteDocument}`,
        },
      })
      return finalResponse
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

    await enterPromptAndSubmit(host, 'stream a live blueprint draft')

    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().liveDraft.status).toBe('ready'))
    })
    const state = useBlueprintStore.getState()
    expect(state.liveDraft.displayDocument?.document.title).toBe('Live streamed draft')
    expect(state.liveDraft.lastGoodDocument?.document.id).toBe('doc-live-streamed')
    expect(state.liveDraft.raw).toContain(LIVE_BLUEPRINT_JSON_MARKER)
    expect(state.workspace?.blueprints ?? []).toEqual([])
    expect(state.dirty).toBe(false)
    expect(host.textContent).toContain('Live preview ready')
    expect(host.textContent).not.toContain('Streaming blueprint draft partial.')
    expect(host.textContent).not.toContain('Streaming complete blueprint draft.')
  })

  it('projects a partial direct DocumentFile once required display fields are complete', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const liveDocument = createDocument('doc-live-direct-partial')
    liveDocument.document.title = 'Direct partial live draft'
    const partialDirectDocument = [
      '{',
      '"schemaVersion":"4.0.0",',
      `"document":${JSON.stringify(liveDocument.document)},`,
      `"devices":${JSON.stringify(liveDocument.devices)},`,
      `"view":${JSON.stringify(liveDocument.view)},`,
      '"extensions":{',
    ].join('')
    const finalResponse = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'Partial direct preview ready',
      markdown: 'The direct DocumentFile was previewed before its root object closed.',
    }))
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming partial direct document.',
        detail: {
          streamedContent: `${LIVE_BLUEPRINT_JSON_MARKER}\n${partialDirectDocument}`,
        },
      })
      return finalResponse
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

    await enterPromptAndSubmit(host, 'stream a partial direct document')

    await act(async () => {
      await vi.waitFor(() => {
        expect(useBlueprintStore.getState().liveDraft.displayDocument?.document.title).toBe('Direct partial live draft')
      })
    })
    expect(useBlueprintStore.getState().liveDraft.status).toBe('partial-json')
    expect(useBlueprintStore.getState().liveDraft.hasCompleteJson).toBe(false)
    expect(useBlueprintStore.getState().liveDraft.displayDocument?.document.title).toBe('Direct partial live draft')
    expect(host.textContent).toContain('Partial direct preview ready')
  })

  it('enforces the begin gate before previewing streamed live drafts when the model skipped the begin tool', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-live-gate-source')
    const liveDocument = createDocument('doc-live-gated')
    liveDocument.document.title = 'Gated live draft'
    const streamedContent = `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(liveDocument)}`
    const finalResponse = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'Live stream finished',
      markdown: 'The streamed draft is gated by EasyAnalyse.',
    }))
    const writeLiveBlueprintDraftPartial = vi.fn(async () => '/tmp/live-gated.easyanalyse/working-copy/live-draft.raw.json.partial')
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming gated draft.',
        detail: { streamedContent },
      })
      return finalResponse
    })
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/live-gated.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel({ secretStore, writeLiveBlueprintDraftPartial })

    await enterPromptAndSubmit(host, 'stream live JSON without begin tool')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })
    expect(useBlueprintStore.getState().liveDraft.status).toBe('idle')
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Live stream finished')

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Continue without saving'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().liveDraft.status).toBe('ready'))
      await new Promise((resolve) => window.setTimeout(resolve, 300))
    })

    expect(useBlueprintStore.getState().liveDraft.displayDocument?.document.title).toBe('Gated live draft')
    expect(writeLiveBlueprintDraftPartial).toHaveBeenCalledWith('/tmp/live-gated.easyanalyse', streamedContent)
    expect(host.textContent).toContain('Live stream finished')
  })

  it('ignores gated streamed live drafts when the editor context changes before approval', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-live-context-source')
    const replacementDocument = createDocumentWithDevice('doc-live-context-replacement')
    const liveDocument = createDocument('doc-live-context-stale')
    liveDocument.document.title = 'Stale live draft'
    const streamedContent = `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(liveDocument)}`
    const finalResponse = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'This result should be ignored',
      markdown: 'The editor changed while the live gate was open.',
    }))
    const writeLiveBlueprintDraftPartial = vi.fn(async () => '/tmp/live-context.easyanalyse/working-copy/live-draft.raw.json.partial')
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming stale gated draft.',
        detail: { streamedContent },
      })
      return finalResponse
    })
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/live-context.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel({ secretStore, writeLiveBlueprintDraftPartial })

    await enterPromptAndSubmit(host, 'stream live JSON then switch document')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })
    useEditorStore.setState({ document: replacementDocument, filePath: '/tmp/live-context-replacement.easyanalyse' })

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Continue without saving'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('ignored because the editor document or workspace changed'))
    })

    expect(useBlueprintStore.getState().liveDraft.status).toBe('idle')
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('This result should be ignored')
  })

  it('cancels a pending streamed live draft gate without previewing or writing partials', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-live-cancel-source')
    const liveDocument = createDocument('doc-live-cancelled')
    liveDocument.document.title = 'Cancelled live draft'
    const streamedContent = `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(liveDocument)}`
    const finalResponse = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'This result should not complete',
      markdown: 'The live gate was cancelled.',
    }))
    const writeLiveBlueprintDraftPartial = vi.fn(async () => '/tmp/live-cancel.easyanalyse/working-copy/live-draft.raw.json.partial')
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming cancellable gated draft.',
        detail: { streamedContent },
      })
      return finalResponse
    })
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/live-cancel.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel({ secretStore, writeLiveBlueprintDraftPartial })

    await enterPromptAndSubmit(host, 'stream live JSON then cancel gate')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Cancel generation'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Agent run cancelled'))
    })

    expect(useBlueprintStore.getState().liveDraft.status).toBe('idle')
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('This result should not complete')
  })

  it('waits for a pending streamed live draft gate before showing a provider error', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-live-error-source')
    const liveDocument = createDocument('doc-live-before-error')
    liveDocument.document.title = 'Live draft before provider error'
    const streamedContent = `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(liveDocument)}`
    const writeLiveBlueprintDraftPartial = vi.fn(async () => '/tmp/live-error.easyanalyse/working-copy/live-draft.raw.json.partial')
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming gated draft before provider error.',
        detail: { streamedContent },
      })
      throw new Error('provider failed after streaming')
    })
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/live-error.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel({ secretStore, writeLiveBlueprintDraftPartial })

    await enterPromptAndSubmit(host, 'stream live JSON then provider fails')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })
    expect(host.textContent).not.toContain('provider failed after streaming')
    expect(useBlueprintStore.getState().liveDraft.status).toBe('idle')
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Continue without saving'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('provider failed after streaming'))
      await new Promise((resolve) => window.setTimeout(resolve, 300))
    })

    expect(useBlueprintStore.getState().liveDraft.displayDocument?.document.title).toBe('Live draft before provider error')
    expect(writeLiveBlueprintDraftPartial).toHaveBeenCalledWith('/tmp/live-error.easyanalyse', streamedContent)
  })

  it('cancels a pending streamed live draft gate before a provider error is shown', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const documentWithDevice = createDocumentWithDevice('doc-live-error-cancel-source')
    const liveDocument = createDocument('doc-live-error-cancelled')
    liveDocument.document.title = 'Cancelled provider error draft'
    const streamedContent = `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(liveDocument)}`
    const writeLiveBlueprintDraftPartial = vi.fn(async () => '/tmp/live-error-cancel.easyanalyse/working-copy/live-draft.raw.json.partial')
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming gated draft before cancellable provider error.',
        detail: { streamedContent },
      })
      throw new Error('provider error should be suppressed after cancel')
    })
    useEditorStore.setState({ document: documentWithDevice, filePath: '/tmp/live-error-cancel.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderPanel({ secretStore, writeLiveBlueprintDraftPartial })

    await enterPromptAndSubmit(host, 'stream live JSON then cancel provider error')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Save the current canvas before generating?'))
    })

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Cancel generation'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Agent run cancelled'))
    })

    expect(useBlueprintStore.getState().liveDraft.status).toBe('idle')
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('provider error should be suppressed after cancel')
  })

  it('does not write a queued live draft partial after accepting the draft', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const liveDocument = createDocument('doc-live-accept-no-rewrite')
    liveDocument.document.title = 'Accept without partial rewrite'
    const streamedContent = `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(liveDocument)}`
    const finalResponse = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'Live draft queued',
      markdown: 'The live draft can be accepted before the partial write timer fires.',
    }))
    const writeLiveBlueprintDraftPartial = vi.fn(async () => '/tmp/project-accept.easyanalyse/working-copy/live-draft.raw.json.partial')
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming live draft for accept.',
        detail: { streamedContent },
      })
      return finalResponse
    })
    useEditorStore.setState({ filePath: '/tmp/project-accept.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderAgentAndBlueprints({ secretStore, writeLiveBlueprintDraftPartial })

    await enterPromptAndSubmit(host, 'stream a live draft then accept it')
    await act(async () => {
      await vi.waitFor(() => {
        expect(useBlueprintStore.getState().liveDraft.displayDocument?.document.title).toBe('Accept without partial rewrite')
      })
    })
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Accept draft'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1))
      await new Promise((resolve) => window.setTimeout(resolve, 300))
    })

    expect(useBlueprintStore.getState().liveDraft.status).toBe('idle')
    expect(useBlueprintStore.getState().workspace?.blueprints[0]?.title).toBe('Accept without partial rewrite')
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()
  })

  it('does not write a queued live draft partial after discarding the draft', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const liveDocument = createDocument('doc-live-discard-no-rewrite')
    liveDocument.document.title = 'Discard without partial rewrite'
    const streamedContent = `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(liveDocument)}`
    const finalResponse = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'Live draft queued',
      markdown: 'The live draft can be discarded before the partial write timer fires.',
    }))
    const writeLiveBlueprintDraftPartial = vi.fn(async () => '/tmp/project-discard.easyanalyse/working-copy/live-draft.raw.json.partial')
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming live draft for discard.',
        detail: { streamedContent },
      })
      return finalResponse
    })
    useEditorStore.setState({ filePath: '/tmp/project-discard.easyanalyse' })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderAgentAndBlueprints({ secretStore, writeLiveBlueprintDraftPartial })

    await enterPromptAndSubmit(host, 'stream a live draft then discard it')
    await act(async () => {
      await vi.waitFor(() => {
        expect(useBlueprintStore.getState().liveDraft.displayDocument?.document.title).toBe('Discard without partial rewrite')
      })
    })
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Discard draft'))
        ?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().liveDraft.status).toBe('idle'))
      await new Promise((resolve) => window.setTimeout(resolve, 300))
    })

    expect(useBlueprintStore.getState().workspace?.blueprints ?? []).toEqual([])
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()
  })

  it('persists streamed live drafts only when the active document is a project directory', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const liveDocument = createDocument('doc-live-partial-project')
    const streamedContent = `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(liveDocument)}`
    const finalResponse = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'message',
      summary: 'Partial persisted',
      markdown: 'The live draft is still only a preview.',
    }))
    const writeLiveBlueprintDraftPartial = vi.fn(async () => '/tmp/project.easyanalyse/working-copy/live-draft.raw.json.partial')
    providerMock.runConfiguredAgentProvider.mockImplementation(async (input) => {
      input.progress?.({
        phase: 'response',
        message: 'Streaming project draft.',
        detail: { streamedContent },
      })
      return finalResponse
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
    useEditorStore.setState({ filePath: '/tmp/project.easyanalyse' })
    const host = await renderPanel({ secretStore, writeLiveBlueprintDraftPartial })

    await enterPromptAndSubmit(host, 'stream into a project draft')

    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().liveDraft.status).toBe('ready'))
      await new Promise((resolve) => window.setTimeout(resolve, 300))
    })
    expect(writeLiveBlueprintDraftPartial).toHaveBeenCalledWith('/tmp/project.easyanalyse', streamedContent)

    writeLiveBlueprintDraftPartial.mockClear()
    useEditorStore.setState({ filePath: '/tmp/legacy.easyanalyse.json' })
    await enterPromptAndSubmit(host, 'stream into a legacy json draft')
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Partial persisted'))
      await new Promise((resolve) => window.setTimeout(resolve, 300))
    })
    expect(writeLiveBlueprintDraftPartial).not.toHaveBeenCalled()
  })

  it('renders live blueprint preview from real provider-runtime SSE before the final response closes', async () => {
    const { runConfiguredAgentProvider } = await vi.importActual<typeof import('../../lib/agentProviderClient')>(
      '../../lib/agentProviderClient',
    )
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const liveDocument = createDocument('doc-provider-runtime-live')
    liveDocument.document.title = 'Provider runtime live draft'
    const candidate = {
      title: 'Provider runtime candidate',
      summary: 'Candidate summary',
      rationale: 'Candidate rationale',
      tradeoffs: [],
      document: liveDocument,
      issues: [],
    }
    const finalContent = JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'blueprints',
      summary: 'Provider runtime streamed blueprint',
      blueprints: [candidate],
    })
    const splitAfterDocument = finalContent.indexOf(',"issues":[]')
    expect(splitAfterDocument).toBeGreaterThan(0)
    const firstDelta = finalContent.slice(0, splitAfterDocument)
    const secondDelta = finalContent.slice(splitAfterDocument)
    const sse = createControlledSseResponse()
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(async () => sse.response)
    const runProvider: AgentPanelProps['runProvider'] = (input) => runConfiguredAgentProvider({
      ...input,
      fetchImpl: fetchMock,
      maxToolIterations: 0,
      selfCheck: { enabled: false, repairOnIssues: false, maxRepairAttempts: 0 },
    })
    useEditorStore.setState({ filePath: null })
    useSettingsStore.setState({
      settings: {
        basic: { locale: 'system' },
        appearance: { theme: 'system' },
        agent: { providers: [provider], selectedProviderId: provider.id, selectedModelId: 'deepseek-chat' },
      },
      loaded: true,
      warnings: [],
    })
    const host = await renderAgentAndBlueprints({ secretStore, runProvider })

    await enterPromptAndSubmit(host, 'stream through provider runtime')
    await act(async () => {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ stream: true, response_format: { type: 'json_object' } })

    await act(async () => {
      sse.enqueue({
        id: 'chatcmpl-agent-panel-stream',
        choices: [{ index: 0, delta: { content: firstDelta } }],
      })
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().liveDraft.displayDocument?.document.title).toBe('Provider runtime live draft'))
    })
    const previewCanvas = host.querySelector('[aria-label="Blueprint preview canvas"]') as HTMLElement | null
    expect(host.textContent).toContain('Live blueprint preview')
    expect(previewCanvas?.dataset.documentTitle).toBe('Provider runtime live draft')
    expect(host.textContent).toContain('Running')

    await act(async () => {
      sse.enqueue({
        id: 'chatcmpl-agent-panel-stream',
        choices: [{ index: 0, delta: { content: secondDelta }, finish_reason: 'stop' }],
      })
      sse.enqueue('[DONE]')
      sse.close()
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('1 blueprint candidates stored'))
    })
  })

  it('keeps an accepted live draft from being revived or duplicated by the same provider run', async () => {
    const provider = deepseekProvider()
    const secretStore = createSecretStore({ backend: createMemorySecretBackend(), idFactory: () => 'deepseek-test' })
    await secretStore.saveSecret({ providerId: provider.id, value: 'test-deepseek-key' })
    const acceptedLiveDocument = createDocument('doc-live-accepted-during-run')
    acceptedLiveDocument.document.title = 'Accepted during run'
    const laterLiveDocument = createDocument('doc-live-later-ignored')
    laterLiveDocument.document.title = 'Ignored later stream'
    const finalDocument = createDocument('doc-live-final-ignored')
    finalDocument.document.title = 'Ignored final candidate'
    const pending = deferred<AgentResponseParseResult>()
    let progress: ((event: AgentProviderProgressEvent) => void) | undefined
    providerMock.runConfiguredAgentProvider.mockImplementation((input) => {
      progress = input.progress
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
    const host = await renderAgentAndBlueprints({ secretStore })

    await enterPromptAndSubmit(host, 'stream and accept a live draft')
    await act(async () => {
      await vi.waitFor(() => expect(progress).toBeTypeOf('function'))
      progress?.({
        phase: 'response',
        message: 'Streaming first live draft.',
        detail: {
          streamedContent: `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(acceptedLiveDocument)}`,
        },
      })
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().liveDraft.displayDocument?.document.title).toBe('Accepted during run'))
    })

    await act(async () => {
      const acceptButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Accept draft'))
      expect(acceptButton).toBeInstanceOf(window.HTMLButtonElement)
      acceptButton?.click()
    })
    await act(async () => {
      await vi.waitFor(() => expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1))
    })

    progress?.({
      phase: 'response',
      message: 'Streaming a later live draft that should be ignored.',
      detail: {
        streamedContent: `${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(laterLiveDocument)}`,
      },
    })
    expect(useBlueprintStore.getState().liveDraft.status).toBe('idle')
    expect(useBlueprintStore.getState().workspace?.blueprints[0]?.title).toBe('Accepted during run')

    const finalResult = parseAgentResponse(JSON.stringify({
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'blueprints',
      summary: 'Final candidate arrived after accept.',
      blueprints: [{
        title: 'Ignored final candidate',
        summary: 'Should not be stored after accept.',
        rationale: 'The live draft session was already handled by the user.',
        tradeoffs: [],
        document: finalDocument,
        issues: [],
      }],
    }))
    await act(async () => {
      pending.resolve(finalResult)
      await pending.promise
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Final blueprint skipped'))
    })

    expect(useBlueprintStore.getState().workspace?.blueprints).toHaveLength(1)
    expect(useBlueprintStore.getState().workspace?.blueprints[0]?.title).toBe('Accepted during run')
    expect(host.textContent).toContain('were not stored again')
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
