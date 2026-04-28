// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDefaultDocument } from '../../lib/document'
import { parseAgentResponse } from '../../lib/agentResponse'
import { createMockAgentResponse } from '../../lib/agentMockProvider'
import type { MockAgentRequest } from '../../lib/agentMockProvider'
import { createEmptyBlueprintWorkspace } from '../../lib/blueprintWorkspace'
import { hashDocument } from '../../lib/documentHash'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import type { AgentResponseParseResult } from '../../types/agent'
import type { DocumentFile } from '../../types/document'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const providerMock = vi.hoisted(() => ({
  runMockAgentProvider: vi.fn<(request: MockAgentRequest) => Promise<AgentResponseParseResult>>(),
}))

vi.mock('../../lib/agentMockProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/agentMockProvider')>()),
  runMockAgentProvider: providerMock.runMockAgentProvider,
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

async function renderPanel() {
  const { AgentPanel } = await import('./AgentPanel')
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<AgentPanel />)
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
      host.querySelector<HTMLButtonElement>('button[type="button"]')?.click()
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
})
