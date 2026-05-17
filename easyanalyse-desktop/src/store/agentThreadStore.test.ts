import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyBlueprintWorkspace } from '../lib/blueprintWorkspace'
import { hashDocument } from '../lib/documentHash'
import type { AgentBlueprintCandidate, AgentResponseParseIssue } from '../types/agent'
import type { AgentThreadWorkspace, AppendAgentThreadToolMessageInput } from '../types/agentThread'
import type { DocumentFile } from '../types/document'
import { normalizeAgentThreadWorkspace, useAgentThreadStore } from './agentThreadStore'
import { useBlueprintStore } from './blueprintStore'

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-1',
      title: 'Reference circuit',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T01:00:00.000Z',
      tags: ['demo'],
    },
    devices: [
      {
        id: 'r1',
        name: 'R1',
        kind: 'resistor',
        terminals: [
          { id: 'r1-a', name: 'A', label: 'VIN', direction: 'input' },
          { id: 'r1-b', name: 'B', label: 'VOUT', direction: 'output' },
        ],
      },
    ],
    view: {
      canvas: { units: 'px', grid: { enabled: true, size: 16 } },
      devices: { r1: { position: { x: 10, y: 20 }, shape: 'rectangle' } },
    },
    ...overrides,
  }
}

async function createWorkspaceForDocument(document = createDocument()) {
  return createEmptyBlueprintWorkspace({
    mainDocument: {
      documentId: document.document.id,
      hash: await hashDocument(document),
    },
  })
}

function resetStores() {
  useBlueprintStore.setState({
    workspace: null,
    sidecarPath: null,
    dirty: false,
    selectedBlueprintId: null,
    loadError: null,
    saveError: null,
    validationError: null,
  })
  useAgentThreadStore.setState({
    threads: [],
    selectedThreadId: null,
  })
}

beforeEach(() => {
  resetStores()
})

describe('agentThreadStore', () => {
  it('creates threads and persists messages in workspace.extensions.agentThreads for an unsaved workspace', async () => {
    useBlueprintStore.setState({
      workspace: await createWorkspaceForDocument(),
      sidecarPath: null,
      dirty: false,
    })

    const thread = useAgentThreadStore.getState().ensureThread({ title: 'Investigate power rail' })
    const userMessage = useAgentThreadStore.getState().appendUserMessage('Check the VIN rail.')
    const assistantMessage = useAgentThreadStore.getState().appendAssistantMessage('VIN looks connected.')
    const toolMessage = useAgentThreadStore.getState().appendToolMessage({
      toolName: 'blueprint-validator',
      status: 'success',
      summary: 'Validated generated blueprint.',
      blueprintIds: ['bp-1'],
      issueCount: 1,
    })

    const extension = useBlueprintStore.getState().workspace?.extensions?.agentThreads
    expect(extension?.selectedThreadId).toBe(thread.id)
    expect(extension?.threads).toHaveLength(1)
    expect(extension?.threads[0]).toMatchObject({
      id: thread.id,
      title: 'Investigate power rail',
      status: 'active',
    })
    expect(extension?.threads[0]?.messages).toMatchObject([
      { id: userMessage?.id, role: 'user', content: 'Check the VIN rail.' },
      { id: assistantMessage?.id, role: 'assistant', content: 'VIN looks connected.' },
      {
        id: toolMessage?.id,
        role: 'tool',
        toolName: 'blueprint-validator',
        status: 'success',
        summary: 'Validated generated blueprint.',
        blueprintIds: ['bp-1'],
        issueCount: 1,
      },
    ])
    expect(useBlueprintStore.getState().dirty).toBe(true)
  })

  it('hydrates from loaded workspace extensions and persists select, rename, archive, and delete operations', async () => {
    const existingAgentThreads: AgentThreadWorkspace = {
      schemaVersion: 'agent-threads-v1',
      selectedThreadId: 'thread-1',
      threads: [
        {
          id: 'thread-1',
          title: 'Loaded thread',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
          status: 'active',
          messages: [],
        },
        {
          id: 'thread-2',
          title: 'Second thread',
          createdAt: '2026-05-01T01:00:00.000Z',
          updatedAt: '2026-05-01T01:00:00.000Z',
          status: 'active',
          messages: [],
        },
      ],
    }
    useBlueprintStore.setState({
      workspace: {
        ...(await createWorkspaceForDocument()),
        extensions: {
          agentThreads: existingAgentThreads,
        },
      },
      dirty: false,
    })

    expect(useAgentThreadStore.getState().selectedThreadId).toBe('thread-1')
    expect(useAgentThreadStore.getState().threads.map((thread) => thread.id)).toEqual(['thread-1', 'thread-2'])

    useAgentThreadStore.getState().selectThread('thread-2')
    useAgentThreadStore.getState().renameThread('thread-2', 'Renamed thread')
    useAgentThreadStore.getState().archiveThread('thread-2')

    let extension = useBlueprintStore.getState().workspace?.extensions?.agentThreads
    expect(extension?.selectedThreadId).toBe('thread-1')
    expect(extension?.threads.find((thread) => thread.id === 'thread-2')).toMatchObject({
      title: 'Renamed thread',
      status: 'archived',
    })

    useAgentThreadStore.getState().deleteThread('thread-2')

    extension = useBlueprintStore.getState().workspace?.extensions?.agentThreads
    expect(extension?.threads.map((thread) => thread.id)).toEqual(['thread-1'])
    expect(useBlueprintStore.getState().dirty).toBe(true)
  })

  it('stores agent blueprint candidates through blueprintStore and records a tool message with returned ids', async () => {
    const mainDocument = createDocument()
    await useBlueprintStore.getState().loadForMainDocument(null, mainDocument)
    useAgentThreadStore.getState().appendUserMessage('Generate alternatives.')

    const candidate: AgentBlueprintCandidate = {
      title: 'Agent alternative',
      summary: 'Adds a decoupling capacitor.',
      rationale: 'Improve rail stability.',
      tradeoffs: ['More BOM cost'],
      document: createDocument({
        document: { id: 'candidate-doc', title: 'Candidate circuit' },
      }),
      issues: [{ severity: 'warning', code: 'W_AGENT', message: 'Review capacitor value' }],
      toolIssues: [{ severity: 'warning', code: 'W_TOOL', message: 'Tool note' }],
    }
    const parseIssue: AgentResponseParseIssue = {
      severity: 'warning',
      code: 'W_PARSE',
      message: 'Minor formatting repair',
      candidateIndex: 0,
    }

    const blueprintIds = await useAgentThreadStore.getState().addAgentBlueprintCandidatesToCurrentThread(
      [candidate],
      {
        mainDocument,
        filePath: null,
        issues: [parseIssue],
      },
      {
        toolName: 'agent-blueprint-import',
      },
    )

    const blueprintRecords = useBlueprintStore.getState().workspace?.blueprints ?? []
    const toolMessages = useBlueprintStore.getState().workspace?.extensions?.agentThreads?.threads[0]?.messages.filter(
      (message) => message.role === 'tool',
    )
    expect(blueprintIds).toEqual(blueprintRecords.map((record) => record.id))
    expect(blueprintRecords).toHaveLength(1)
    expect(toolMessages).toMatchObject([
      {
        role: 'tool',
        toolName: 'agent-blueprint-import',
        status: 'success',
        blueprintIds,
        issueCount: 3,
      },
    ])
  })

  it('does not append messages to an explicitly targeted archived thread', async () => {
    useBlueprintStore.setState({
      workspace: await createWorkspaceForDocument(),
      dirty: false,
    })
    const thread = useAgentThreadStore.getState().createThread({ title: 'Archive target' })
    useAgentThreadStore.getState().archiveThread(thread.id)
    useBlueprintStore.setState({ dirty: false })

    const message = useAgentThreadStore.getState().appendAssistantMessage('This should not be stored.', {
      threadId: thread.id,
    })

    expect(message).toBeNull()
    expect(useBlueprintStore.getState().workspace?.extensions?.agentThreads?.threads[0]?.messages).toEqual([])
    expect(useBlueprintStore.getState().dirty).toBe(false)
  })

  it('normalizes stored thread metadata without preserving secret-shaped extra fields', () => {
    const normalized = normalizeAgentThreadWorkspace({
      schemaVersion: 'agent-threads-v1',
      selectedThreadId: 'thread-1',
      threads: [
        {
          id: 'thread-1',
          title: 'Loaded thread',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
          status: 'active',
          messages: [
            {
              id: 'message-1',
              role: 'tool',
              createdAt: '2026-05-01T00:01:00.000Z',
              toolName: 'provider-call',
              status: 'success',
              summary: 'Call complete.',
              blueprintIds: ['bp-1', 42],
              issueCount: 1,
              apiKey: 'sk-test-secret',
            },
          ],
          apiKey: 'sk-thread-secret',
        },
      ],
    })
    const message = normalized.threads[0]?.messages[0]

    expect(message).toEqual({
      id: 'message-1',
      role: 'tool',
      createdAt: '2026-05-01T00:01:00.000Z',
      toolName: 'provider-call',
      status: 'success',
      summary: 'Call complete.',
      blueprintIds: ['bp-1'],
      issueCount: 1,
    })
    expect(JSON.stringify(normalized)).not.toContain('sk-test-secret')
    expect(JSON.stringify(normalized)).not.toContain('sk-thread-secret')
  })

  it('drops extra properties when appending tool messages so API keys are not persisted', async () => {
    useBlueprintStore.setState({
      workspace: await createWorkspaceForDocument(),
      dirty: false,
    })
    useAgentThreadStore.getState().appendToolMessage({
      toolName: 'provider-call',
      status: 'success',
      summary: 'Done.',
      blueprintIds: [],
      issueCount: 0,
      apiKey: 'sk-runtime-secret',
    } as AppendAgentThreadToolMessageInput & { apiKey: string })

    const serialized = JSON.stringify(useBlueprintStore.getState().workspace?.extensions?.agentThreads)
    expect(serialized).not.toContain('sk-runtime-secret')
    expect(serialized).not.toContain('apiKey')
  })
})
