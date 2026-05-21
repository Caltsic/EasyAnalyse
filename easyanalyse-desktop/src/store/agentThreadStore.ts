import { create } from 'zustand'
import { getErrorMessage } from '../lib/errors'
import { isRecord } from '../lib/guards'
import { makeId } from '../lib/ids'
import type { AgentBlueprintCandidate, AgentResponseParseIssue } from '../types/agent'
import type {
  AgentThread,
  AgentThreadAssistantMessage,
  AgentThreadMessage,
  AgentThreadStatus,
  AgentThreadToolMessage,
  AgentThreadToolMessageStatus,
  AgentThreadUserMessage,
  AgentThreadWorkspace,
  AppendAgentThreadToolMessageInput,
} from '../types/agentThread'
import type { BlueprintWorkspaceFile } from '../types/blueprint'
import type { DocumentFile } from '../types/document'
import { useBlueprintStore } from './blueprintStore'

const AGENT_THREAD_SCHEMA_VERSION = 'agent-threads-v1'
const DEFAULT_THREAD_TITLE = 'Agent thread'
const THREAD_STATUSES = new Set<AgentThreadStatus>(['active', 'archived'])
const TOOL_MESSAGE_STATUSES = new Set<AgentThreadToolMessageStatus>(['running', 'success', 'error'])

export interface AgentThreadMessageOptions {
  threadId?: string
  title?: string
}

export interface AgentThreadCandidateInsertionContext {
  mainDocument: DocumentFile
  filePath: string | null
  issues?: AgentResponseParseIssue[]
}

export interface AgentThreadCandidateInsertionOptions {
  threadId?: string
  toolName?: string
  summary?: string
  status?: AgentThreadToolMessageStatus
}

export interface AgentThreadState {
  threads: AgentThread[]
  selectedThreadId: string | null
  ensureThread(options?: { title?: string }): AgentThread
  createThread(options?: { title?: string }): AgentThread
  selectThread(id: string | null): void
  archiveThread(id: string): void
  deleteThread(id: string): void
  renameThread(id: string, title: string): void
  appendUserMessage(content: string, options?: AgentThreadMessageOptions): AgentThreadUserMessage | null
  appendAssistantMessage(content: string, options?: AgentThreadMessageOptions): AgentThreadAssistantMessage | null
  appendToolMessage(
    input: AppendAgentThreadToolMessageInput,
    options?: AgentThreadMessageOptions,
  ): AgentThreadToolMessage | null
  addAgentBlueprintCandidatesToCurrentThread(
    candidates: AgentBlueprintCandidate[],
    context: AgentThreadCandidateInsertionContext,
    options?: AgentThreadCandidateInsertionOptions,
  ): Promise<string[]>
}

export function createEmptyAgentThreadWorkspace(): AgentThreadWorkspace {
  return {
    schemaVersion: AGENT_THREAD_SCHEMA_VERSION,
    selectedThreadId: null,
    threads: [],
  }
}

export function normalizeAgentThreadWorkspace(value: unknown): AgentThreadWorkspace {
  if (!isRecord(value)) {
    return createEmptyAgentThreadWorkspace()
  }

  const threads = Array.isArray(value.threads)
    ? value.threads.map(normalizeAgentThread).filter((thread): thread is AgentThread => thread !== null)
    : []
  const selectedThreadId =
    typeof value.selectedThreadId === 'string' && threads.some((thread) => thread.id === value.selectedThreadId)
      ? value.selectedThreadId
      : null

  return {
    schemaVersion: AGENT_THREAD_SCHEMA_VERSION,
    selectedThreadId,
    threads,
  }
}

export function getAgentThreadsFromWorkspace(workspace: BlueprintWorkspaceFile | null): AgentThreadWorkspace {
  return normalizeAgentThreadWorkspace(workspace?.extensions?.agentThreads)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function timestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function normalizeAgentThread(value: unknown): AgentThread | null {
  if (!isRecord(value)) {
    return null
  }

  const id = nonEmptyString(value.id)
  if (id === null) {
    return null
  }

  const now = new Date().toISOString()
  const status = THREAD_STATUSES.has(value.status as AgentThreadStatus) ? (value.status as AgentThreadStatus) : 'active'
  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeAgentThreadMessage).filter((message): message is AgentThreadMessage => message !== null)
    : []

  return {
    id,
    title: nonEmptyString(value.title) ?? DEFAULT_THREAD_TITLE,
    createdAt: timestamp(value.createdAt, now),
    updatedAt: timestamp(value.updatedAt, now),
    status,
    messages,
  }
}

function normalizeAgentThreadMessage(value: unknown): AgentThreadMessage | null {
  if (!isRecord(value)) {
    return null
  }

  const id = nonEmptyString(value.id) ?? makeId('agent-message')
  const createdAt = timestamp(value.createdAt, new Date().toISOString())

  if (value.role === 'user') {
    return {
      id,
      role: 'user',
      createdAt,
      content: typeof value.content === 'string' ? value.content : '',
    }
  }

  if (value.role === 'assistant') {
    return {
      id,
      role: 'assistant',
      createdAt,
      content: typeof value.content === 'string' ? value.content : '',
    }
  }

  if (value.role === 'tool') {
    return {
      id,
      role: 'tool',
      createdAt,
      toolName: nonEmptyString(value.toolName) ?? 'tool',
      status: TOOL_MESSAGE_STATUSES.has(value.status as AgentThreadToolMessageStatus)
        ? (value.status as AgentThreadToolMessageStatus)
        : 'success',
      summary: typeof value.summary === 'string' ? value.summary : '',
      blueprintIds: stringArray(value.blueprintIds),
      issueCount: nonNegativeInteger(value.issueCount),
    }
  }

  return null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function titleFromContent(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ')
  return normalized.length > 0 ? normalized.slice(0, 80) : DEFAULT_THREAD_TITLE
}

function createAgentThread(title?: string): AgentThread {
  const now = new Date().toISOString()
  return {
    id: makeId('agent-thread'),
    title: title?.trim() || DEFAULT_THREAD_TITLE,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    messages: [],
  }
}

function stateToAgentThreadWorkspace(state: Pick<AgentThreadState, 'threads' | 'selectedThreadId'>): AgentThreadWorkspace {
  const selectedThreadId = state.selectedThreadId && state.threads.some((thread) => thread.id === state.selectedThreadId)
    ? state.selectedThreadId
    : null
  return {
    schemaVersion: AGENT_THREAD_SCHEMA_VERSION,
    selectedThreadId,
    threads: state.threads,
  }
}

function getMutationWorkspace(state: Pick<AgentThreadState, 'threads' | 'selectedThreadId'>): AgentThreadWorkspace {
  const blueprintWorkspace = useBlueprintStore.getState().workspace
  return blueprintWorkspace === null ? stateToAgentThreadWorkspace(state) : getAgentThreadsFromWorkspace(blueprintWorkspace)
}

function ensureActiveThreadInWorkspace(
  workspace: AgentThreadWorkspace,
  title?: string,
): { workspace: AgentThreadWorkspace; thread: AgentThread } {
  const selectedThread = workspace.threads.find(
    (thread) => thread.id === workspace.selectedThreadId && thread.status === 'active',
  )
  if (selectedThread !== undefined) {
    return { workspace, thread: selectedThread }
  }

  const firstActiveThread = workspace.threads.find((thread) => thread.status === 'active')
  if (firstActiveThread !== undefined) {
    return {
      workspace: {
        ...workspace,
        selectedThreadId: firstActiveThread.id,
      },
      thread: firstActiveThread,
    }
  }

  const thread = createAgentThread(title)
  return {
    workspace: {
      ...workspace,
      selectedThreadId: thread.id,
      threads: [...workspace.threads, thread],
    },
    thread,
  }
}

function appendMessage(
  workspace: AgentThreadWorkspace,
  threadId: string,
  message: AgentThreadMessage,
): AgentThreadWorkspace {
  const now = new Date().toISOString()
  return {
    ...workspace,
    selectedThreadId: threadId,
    threads: workspace.threads.map((thread) =>
      thread.id === threadId
        ? {
            ...thread,
            updatedAt: now,
            messages: [...thread.messages, message],
          }
        : thread,
    ),
  }
}

function candidateIssueCount(candidates: AgentBlueprintCandidate[], issues?: AgentResponseParseIssue[]): number {
  return (
    (issues?.length ?? 0) +
    candidates.reduce(
      (count, candidate) => count + candidate.issues.length + (candidate.toolIssues?.length ?? 0),
      0,
    )
  )
}

function getInsertionSummary(count: number): string {
  return count === 1 ? 'Stored 1 agent blueprint candidate.' : `Stored ${count} agent blueprint candidates.`
}

const initialAgentThreads = getAgentThreadsFromWorkspace(useBlueprintStore.getState().workspace)
let pendingAgentThreadsForNextWorkspace: AgentThreadWorkspace | null = null

export const useAgentThreadStore = create<AgentThreadState>((set, get) => {
  const commit = (agentThreads: AgentThreadWorkspace): AgentThreadWorkspace => {
    const normalized = normalizeAgentThreadWorkspace(agentThreads)
    if (useBlueprintStore.getState().workspace === null) {
      pendingAgentThreadsForNextWorkspace = normalized
    } else {
      pendingAgentThreadsForNextWorkspace = null
      useBlueprintStore.getState().setWorkspaceAgentThreads(normalized)
    }
    set({
      threads: normalized.threads,
      selectedThreadId: normalized.selectedThreadId,
    })
    return normalized
  }

  const appendToThread = (
    message: AgentThreadMessage,
    options?: AgentThreadMessageOptions,
  ): AgentThreadMessage | null => {
    const current = getMutationWorkspace(get())
    const ensured = options?.threadId
      ? { workspace: current, thread: current.threads.find((thread) => thread.id === options.threadId) }
      : ensureActiveThreadInWorkspace(current, options?.title)
    const thread = ensured.thread

    if (thread === undefined || thread.status !== 'active') {
      return null
    }

    commit(appendMessage(ensured.workspace, thread.id, message))
    return message
  }

  return {
    threads: initialAgentThreads.threads,
    selectedThreadId: initialAgentThreads.selectedThreadId,

    ensureThread: (options) => {
      const ensured = ensureActiveThreadInWorkspace(getMutationWorkspace(get()), options?.title)
      commit(ensured.workspace)
      return ensured.thread
    },

    createThread: (options) => {
      const current = getMutationWorkspace(get())
      const thread = createAgentThread(options?.title)
      commit({
        ...current,
        selectedThreadId: thread.id,
        threads: [...current.threads, thread],
      })
      return thread
    },

    selectThread: (id) => {
      const current = getMutationWorkspace(get())
      if (id !== null && !current.threads.some((thread) => thread.id === id)) {
        return
      }
      if (current.selectedThreadId === id) {
        return
      }
      commit({
        ...current,
        selectedThreadId: id,
      })
    },

    archiveThread: (id) => {
      const current = getMutationWorkspace(get())
      const target = current.threads.find((thread) => thread.id === id)
      if (target === undefined || target.status === 'archived') {
        return
      }

      const now = new Date().toISOString()
      const threads = current.threads.map((thread) =>
        thread.id === id
          ? {
              ...thread,
              status: 'archived' as const,
              updatedAt: now,
            }
          : thread,
      )
      const selectedThreadId =
        current.selectedThreadId === id
          ? (threads.find((thread) => thread.status === 'active')?.id ?? null)
          : current.selectedThreadId

      commit({
        ...current,
        selectedThreadId,
        threads,
      })
    },

    deleteThread: (id) => {
      const current = getMutationWorkspace(get())
      if (!current.threads.some((thread) => thread.id === id)) {
        return
      }

      const threads = current.threads.filter((thread) => thread.id !== id)
      const selectedThreadId =
        current.selectedThreadId === id
          ? (threads.find((thread) => thread.status === 'active')?.id ?? null)
          : current.selectedThreadId

      commit({
        ...current,
        selectedThreadId,
        threads,
      })
    },

    renameThread: (id, title) => {
      const nextTitle = title.trim()
      if (nextTitle.length === 0) {
        return
      }

      const current = getMutationWorkspace(get())
      const target = current.threads.find((thread) => thread.id === id)
      if (target === undefined || target.title === nextTitle) {
        return
      }

      const now = new Date().toISOString()
      commit({
        ...current,
        threads: current.threads.map((thread) =>
          thread.id === id
            ? {
                ...thread,
                title: nextTitle,
                updatedAt: now,
              }
            : thread,
        ),
      })
    },

    appendUserMessage: (content, options) => {
      const message: AgentThreadUserMessage = {
        id: makeId('agent-message'),
        role: 'user',
        createdAt: new Date().toISOString(),
        content,
      }
      return appendToThread(message, { title: titleFromContent(content), ...options }) as AgentThreadUserMessage | null
    },

    appendAssistantMessage: (content, options) => {
      const message: AgentThreadAssistantMessage = {
        id: makeId('agent-message'),
        role: 'assistant',
        createdAt: new Date().toISOString(),
        content,
      }
      return appendToThread(message, options) as AgentThreadAssistantMessage | null
    },

    appendToolMessage: (input, options) => {
      const message: AgentThreadToolMessage = {
        id: makeId('agent-message'),
        role: 'tool',
        createdAt: new Date().toISOString(),
        toolName: input.toolName.trim() || 'tool',
        status: TOOL_MESSAGE_STATUSES.has(input.status) ? input.status : 'success',
        summary: input.summary ?? '',
        blueprintIds: stringArray(input.blueprintIds),
        issueCount: nonNegativeInteger(input.issueCount),
      }
      return appendToThread(message, options) as AgentThreadToolMessage | null
    },

    addAgentBlueprintCandidatesToCurrentThread: async (candidates, context, options) => {
      const toolName = options?.toolName ?? 'addAgentBlueprintCandidates'
      const issueCount = candidateIssueCount(candidates, context.issues)

      try {
        const inserted = await useBlueprintStore.getState().addAgentBlueprintCandidates(candidates, context)
        const blueprintIds = inserted.map((record) => record.id)
        get().appendToolMessage(
          {
            toolName,
            status: options?.status ?? 'success',
            summary: options?.summary ?? getInsertionSummary(blueprintIds.length),
            blueprintIds,
            issueCount,
          },
          { threadId: options?.threadId },
        )
        return blueprintIds
      } catch (error) {
        get().appendToolMessage(
          {
            toolName,
            status: 'error',
            summary: 'Failed to store agent blueprint candidates.',
            blueprintIds: [],
            issueCount,
          },
          { threadId: options?.threadId },
        )
        throw new Error(getErrorMessage(error))
      }
    },
  }
})

useBlueprintStore.subscribe((state, previousState) => {
  if (state.workspace === previousState.workspace) {
    return
  }

  if (state.workspace === null) {
    pendingAgentThreadsForNextWorkspace = null
    useAgentThreadStore.setState({
      threads: [],
      selectedThreadId: null,
    })
    return
  }

  if (
    previousState.workspace === null &&
    state.workspace.extensions?.agentThreads === undefined &&
    pendingAgentThreadsForNextWorkspace !== null
  ) {
    const pending = pendingAgentThreadsForNextWorkspace
    pendingAgentThreadsForNextWorkspace = null
    useBlueprintStore.getState().setWorkspaceAgentThreads(pending)
    useAgentThreadStore.setState({
      threads: pending.threads,
      selectedThreadId: pending.selectedThreadId,
    })
    return
  }

  pendingAgentThreadsForNextWorkspace = null
  const agentThreads = getAgentThreadsFromWorkspace(state.workspace)
  useAgentThreadStore.setState({
    threads: agentThreads.threads,
    selectedThreadId: agentThreads.selectedThreadId,
  })
})
