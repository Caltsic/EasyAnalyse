import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  FileText,
  History,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  Square,
  User,
  Wrench,
} from 'lucide-react'
import { runMockAgentProvider } from '../../lib/agentMockProvider'
import { runConfiguredAgentProvider } from '../../lib/agentProviderClient'
import type { AgentProviderProgressEvent } from '../../lib/agentProviderClient'
import { isEasyAnalyseProjectPath } from '../../lib/easyAnalyseProject'
import { getErrorMessage } from '../../lib/errors'
import { translate, type TranslationKey } from '../../lib/i18n'
import { parseLiveBlueprintDraft } from '../../lib/liveBlueprintDraft'
import { defaultSecretStore, isManagedSecretRef, type SecretStore } from '../../lib/secretStore'
import { writeLiveBlueprintDraftPartialCommand } from '../../lib/tauri'
import { useAgentThreadStore } from '../../store/agentThreadStore'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import { useSettingsStore } from '../../store/settingsStore'
import type {
  AgentBlueprintCandidate,
  AgentResponse,
  AgentResponseParseIssue,
  AgentResponseParseResult,
} from '../../types/agent'
import type {
  AgentRepairTraceEntry,
  AgentToolTraceEntry,
  BeginBlueprintGenerationAction,
  BeginBlueprintGenerationData,
  BeginBlueprintGenerationRequest,
} from '../../types/agentTools'
import type { AgentThread, AgentThreadMessage } from '../../types/agentThread'
import type { DocumentFile } from '../../types/document'
import type { AgentProviderPublicConfig } from '../../types/settings'
import { Button, ModalShell } from '../ui'

const MAX_ACTIVITY_ENTRIES = 40
const DEFAULT_THREAD_ID = 'agent-thread-local'

interface AgentActivityEntry {
  id: string
  elapsedMs: number
  phase: string
  message: string
}

interface AgentRunState {
  status: 'idle' | 'running' | 'complete' | 'cancelled' | 'error'
  response: AgentResponse | null
  issues: AgentResponseParseIssue[]
  toolTrace: AgentToolTraceEntry[]
  repairTrace: AgentRepairTraceEntry[]
  insertedCount: number
  error: string | null
  activity: AgentActivityEntry[]
  startedAtMs: number | null
  elapsedMs: number
}

export interface AgentThreadSummary {
  id: string
  title: string
  createdAtMs?: number
  updatedAtMs?: number
}

type AgentChatRole = 'user' | 'assistant' | 'tool'
type AgentMessageTone = 'neutral' | 'running' | 'success' | 'warning' | 'error'

interface AgentChatMessage {
  id: string
  role: AgentChatRole
  title?: string
  content: string
  meta?: string
  tone?: AgentMessageTone
}

interface BeginBlueprintGateState {
  runId: number
  requestId: string
  document: DocumentFile
  intent?: string
  title?: string
  canvasDeviceCount: number
  selectedBlueprintId: string | null
  busyAction: BeginBlueprintGenerationAction | null
  error: string | null
}

export interface AgentPanelProps {
  secretStore?: Pick<SecretStore, 'readSecret'>
  runProvider?: typeof runConfiguredAgentProvider
  runMockProvider?: typeof runMockAgentProvider
  writeLiveBlueprintDraftPartial?: (projectPath: string, raw: string) => Promise<string | null>
  threads?: AgentThreadSummary[]
  activeThreadId?: string
  onThreadChange?: (threadId: string) => void
  onNewThread?: () => void
}

function selectedProviderFromSettings(): { provider: AgentProviderPublicConfig | null; modelId: string | null } {
  const settings = useSettingsStore.getState().settings
  const provider = settings.agent.providers.find((item) => item.id === settings.agent.selectedProviderId) ?? null
  const modelId = settings.agent.selectedModelId ?? provider?.defaultModel ?? provider?.models[0] ?? null
  return { provider, modelId }
}

export function AgentPanel({
  secretStore = defaultSecretStore,
  runProvider = runConfiguredAgentProvider,
  runMockProvider = runMockAgentProvider,
  writeLiveBlueprintDraftPartial = writeLiveBlueprintDraftPartialCommand,
  threads,
  activeThreadId,
  onThreadChange,
  onNewThread,
}: AgentPanelProps = {}) {
  const document = useEditorStore((state) => state.document)
  const filePath = useEditorStore((state) => state.filePath)
  const locale = useEditorStore((state) => state.locale)
  const settings = useSettingsStore((state) => state.settings)
  const agentThreads = useAgentThreadStore((state) => state.threads)
  const selectedAgentThreadId = useAgentThreadStore((state) => state.selectedThreadId)
  const ensureAgentThread = useAgentThreadStore((state) => state.ensureThread)
  const createAgentThread = useAgentThreadStore((state) => state.createThread)
  const selectAgentThread = useAgentThreadStore((state) => state.selectThread)
  const renameAgentThread = useAgentThreadStore((state) => state.renameThread)
  const appendAgentUserMessage = useAgentThreadStore((state) => state.appendUserMessage)
  const appendAgentAssistantMessage = useAgentThreadStore((state) => state.appendAssistantMessage)
  const appendAgentToolMessage = useAgentThreadStore((state) => state.appendToolMessage)
  const addAgentBlueprintCandidatesToCurrentThread = useAgentThreadStore(
    (state) => state.addAgentBlueprintCandidatesToCurrentThread,
  )
  const [prompt, setPrompt] = useState('')
  const [includeDocumentContext, setIncludeDocumentContext] = useState(false)
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const [messagesByThread, setMessagesByThread] = useState<Record<string, AgentChatMessage[]>>({})
  const [runState, setRunState] = useState<AgentRunState>({
    status: 'idle',
    response: null,
    issues: [],
    toolTrace: [],
    repairTrace: [],
    insertedCount: 0,
    error: null,
    activity: [],
    startedAtMs: null,
    elapsedMs: 0,
  })
  const activeRunRef = useRef(0)
  const activityIdRef = useRef(0)
  const messageIdRef = useRef(0)
  const activeRunThreadRef = useRef(DEFAULT_THREAD_ID)
  const activeAssistantMessageRef = useRef<{ threadId: string; messageId: string } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const liveDraftLastGoodRef = useRef<DocumentFile | null>(null)
  const activeRunFilePathRef = useRef<string | null>(null)
  const liveDraftPartialTimerRef = useRef<number | null>(null)
  const liveDraftPartialPendingRef = useRef<{ runId: number; sessionId: string; projectPath: string; raw: string } | null>(null)
  const liveProgressTasksByRunRef = useRef(new Map<number, Set<Promise<void>>>())
  const beginGateResolveRef = useRef<((data: BeginBlueprintGenerationData) => void) | null>(null)
  const beginGateDecisionByRunRef = useRef(new Map<number, BeginBlueprintGenerationData>())
  const beginGatePendingByRunRef = useRef(new Map<number, Promise<BeginBlueprintGenerationData>>())
  const [beginGate, setBeginGate] = useState<BeginBlueprintGateState | null>(null)

  const running = runState.status === 'running'
  const provider = settings.agent.providers.find((item) => item.id === settings.agent.selectedProviderId) ?? null
  const modelId = settings.agent.selectedModelId ?? provider?.defaultModel ?? provider?.models[0] ?? null
  const t = useMemo(
    () => (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  )
  const providerLabel = provider ? `${provider.name} / ${modelId ?? t('noModelSelected')}` : t('mockProvider')
  const modelLabel = modelId ?? provider?.name ?? t('mockModel')
  const externalThreads = Array.isArray(threads)
  const activeAgentThreadSummaries = useMemo(
    () => agentThreads.filter((thread) => thread.status === 'active').map(agentThreadToSummary),
    [agentThreads],
  )
  const fallbackThreads = useMemo<AgentThreadSummary[]>(() => {
    const now = Date.now()
    return [{ id: DEFAULT_THREAD_ID, title: t('currentThread'), createdAtMs: now, updatedAtMs: now }]
  }, [t])
  const availableThreads = threads && threads.length > 0
    ? threads
    : activeAgentThreadSummaries.length > 0
      ? activeAgentThreadSummaries
      : fallbackThreads
  const requestedActiveThreadId = activeThreadId ?? selectedAgentThreadId ?? DEFAULT_THREAD_ID
  const activeThread = availableThreads.find((thread) => thread.id === requestedActiveThreadId) ?? availableThreads[0]
  const resolvedActiveThreadId = activeThread?.id ?? DEFAULT_THREAD_ID
  const persistedActiveThread = agentThreads.find((thread) => thread.id === resolvedActiveThreadId)
  const currentMessages = messagesByThread[resolvedActiveThreadId]
    ?? persistedActiveThread?.messages.map((message) => agentThreadMessageToChatMessage(message, t))
    ?? []
  const welcomeMessage = useMemo<AgentChatMessage>(() => ({
    id: 'agent-welcome',
    role: 'assistant',
    title: t('aiChat'),
    content: provider?.kind === 'anthropic'
      ? t('anthropicPlainChat')
      : t('agentReady'),
    meta: providerLabel,
    tone: 'neutral',
  }), [provider?.kind, providerLabel, t])
  const visibleMessages = currentMessages.length > 0 ? orderAgentMessagesForDisplay(currentMessages) : [welcomeMessage]

  useEffect(() => {
    if (!running || runState.startedAtMs === null) return undefined
    const updateElapsed = () => {
      setRunState((state) => {
        if (state.status !== 'running' || state.startedAtMs === null) return state
        return { ...state, elapsedMs: Math.max(0, Date.now() - state.startedAtMs) }
      })
    }
    const intervalId = window.setInterval(updateElapsed, 1_000)
    updateElapsed()
    return () => window.clearInterval(intervalId)
  }, [running, runState.startedAtMs])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ block: 'end' })
  }, [visibleMessages.length, running, resolvedActiveThreadId])

  useEffect(() => () => {
    if (liveDraftPartialTimerRef.current !== null) {
      window.clearTimeout(liveDraftPartialTimerRef.current)
      liveDraftPartialTimerRef.current = null
    }
    liveDraftPartialPendingRef.current = null
    if (beginGateResolveRef.current) {
      beginGateResolveRef.current({
        allowed: false,
        action: 'cancelled',
        canvasHadCircuit: true,
        message: 'Blueprint generation was cancelled because the Agent panel was unmounted.',
      })
      beginGateResolveRef.current = null
    }
  }, [])

  useEffect(() => {
    setThreadMenuOpen(false)
  }, [resolvedActiveThreadId])

  useEffect(() => {
    if (externalThreads) return
    if (agentThreads.some((thread) => thread.status === 'active')) return
    ensureAgentThread({ title: t('currentThread') })
  }, [agentThreads, ensureAgentThread, externalThreads, t])

  function nextMessageId(prefix: string): string {
    messageIdRef.current += 1
    return `${prefix}-${messageIdRef.current}`
  }

  function touchLocalThread(threadId: string, titleSeed?: string) {
    if (externalThreads) return
    const thread = agentThreads.find((item) => item.id === threadId)
    if (!thread || !titleSeed) return
    const defaultTitles = new Set(['Current thread', 'New thread', 'Agent thread', t('currentThread'), t('newThread')])
    if (!defaultTitles.has(thread.title)) return
    renameAgentThread(threadId, titleFromPrompt(titleSeed))
  }

  function persistedMessagesForThread(threadId: string): AgentChatMessage[] {
    return agentThreads.find((thread) => thread.id === threadId)?.messages.map((message) => agentThreadMessageToChatMessage(message, t)) ?? []
  }

  function appendThreadMessage(threadId: string, message: AgentChatMessage) {
    setMessagesByThread((state) => ({
      ...state,
      [threadId]: [...(state[threadId] ?? persistedMessagesForThread(threadId)), message],
    }))
    touchLocalThread(threadId)
  }

  function updateThreadMessage(
    threadId: string,
    messageId: string,
    updater: (message: AgentChatMessage) => AgentChatMessage,
  ) {
    setMessagesByThread((state) => ({
      ...state,
      [threadId]: (state[threadId] ?? persistedMessagesForThread(threadId)).map((message) => (
        message.id === messageId ? updater(message) : message
      )),
    }))
    touchLocalThread(threadId)
  }

  function persistThreadToolMessage(threadId: string, message: Omit<AgentChatMessage, 'id' | 'role'>) {
    if (externalThreads) return
    appendAgentToolMessage(
      {
        toolName: message.title ?? 'tool',
        status: threadToolStatusFromTone(message.tone),
        summary: message.content,
      },
      { threadId },
    )
  }

  function appendRunToolMessage(runId: number, message: Omit<AgentChatMessage, 'id' | 'role'>, persist = false) {
    if (activeRunRef.current !== runId) return
    const threadId = activeRunThreadRef.current
    appendThreadMessage(threadId, {
      id: nextMessageId('tool'),
      role: 'tool',
      ...message,
    })
    if (persist) {
      persistThreadToolMessage(threadId, message)
    }
  }

  function updateActiveAssistantMessage(message: Omit<AgentChatMessage, 'id' | 'role'>) {
    const activeAssistant = activeAssistantMessageRef.current
    if (!activeAssistant) return
    updateThreadMessage(activeAssistant.threadId, activeAssistant.messageId, (current) => ({
      ...current,
      ...message,
      role: 'assistant',
    }))
  }

  function appendActivity(runId: number, startedAtMs: number, event: AgentProviderProgressEvent) {
    if (activeRunRef.current !== runId) return
    const elapsedMs = Math.max(0, Date.now() - startedAtMs)
    setRunState((state) => {
      if (activeRunRef.current !== runId) return state
      activityIdRef.current += 1
      const entry: AgentActivityEntry = {
        id: `${runId}-${activityIdRef.current}`,
        elapsedMs,
        phase: event.phase,
        message: event.message,
      }
      return { ...state, elapsedMs, activity: [...state.activity, entry].slice(-MAX_ACTIVITY_ENTRIES) }
    })
    if (typeof event.detail?.streamedContent === 'string') {
      return
    }
    appendRunToolMessage(runId, {
      title: formatActivityPhase(event.phase),
      content: event.message,
      meta: formatElapsed(elapsedMs),
      tone: event.phase === 'complete' ? 'success' : 'neutral',
    })
  }

  function handleProviderProgress(
    runId: number,
    startedAtMs: number,
    requestId: string,
    documentAtStart: DocumentFile,
    filePathAtStart: string | null,
    event: AgentProviderProgressEvent,
  ) {
    appendActivity(runId, startedAtMs, event)
    const task = consumeLiveBlueprintProgress(runId, requestId, documentAtStart, filePathAtStart, event)
      .catch(() => undefined)
    const existingTasks = liveProgressTasksByRunRef.current.get(runId)
    const tasks = existingTasks ?? new Set<Promise<void>>()
    if (!existingTasks) {
      liveProgressTasksByRunRef.current.set(runId, tasks)
    }
    tasks.add(task)
    void task.finally(() => {
      const latestTasks = liveProgressTasksByRunRef.current.get(runId)
      if (!latestTasks) return
      latestTasks.delete(task)
      if (latestTasks.size === 0) {
        liveProgressTasksByRunRef.current.delete(runId)
      }
    })
  }

  async function waitForLiveBlueprintProgress(runId: number) {
    while (true) {
      const tasks = liveProgressTasksByRunRef.current.get(runId)
      if (!tasks || tasks.size === 0) return
      await Promise.all(Array.from(tasks))
    }
  }

  async function consumeLiveBlueprintProgress(
    runId: number,
    requestId: string,
    documentAtStart: DocumentFile,
    filePathAtStart: string | null,
    event: AgentProviderProgressEvent,
  ) {
    if (activeRunRef.current !== runId) return
    const liveDraftSessionId = liveDraftSessionIdForRun(runId)
    const blueprintStore = useBlueprintStore.getState()
    if (blueprintStore.isLiveBlueprintDraftSessionSuppressed(liveDraftSessionId)) return
    const streamedContent = typeof event.detail?.streamedContent === 'string' ? event.detail.streamedContent : null
    if (!streamedContent) return

    const result = parseLiveBlueprintDraft(streamedContent, {
      lastGood: liveDraftLastGoodRef.current,
    })
    if (!result.markerFound) return
    const allowed = await ensureBeginBlueprintGenerationAllowed(runId, requestId, documentAtStart, {
      intent: t('beginBlueprintLiveGateIntent'),
    })
    if (!allowed || activeRunRef.current !== runId) return
    const latestEditor = useEditorStore.getState()
    if (latestEditor.document !== documentAtStart || latestEditor.filePath !== filePathAtStart) return

    const latestBlueprintStore = useBlueprintStore.getState()
    if (latestBlueprintStore.isLiveBlueprintDraftSessionSuppressed(liveDraftSessionId)) return
    if (latestBlueprintStore.liveDraft.status === 'idle' || latestBlueprintStore.liveDraft.sessionId !== liveDraftSessionId) {
      const started = latestBlueprintStore.startLiveBlueprintDraft({ sessionId: liveDraftSessionId })
      if (!started) return
    }
    liveDraftLastGoodRef.current = result.lastGood
    const updated = useBlueprintStore.getState().updateLiveBlueprintDraft(result, streamedContent, { sessionId: liveDraftSessionId })
    if (!updated) return
    scheduleLiveBlueprintPartialWrite(runId, liveDraftSessionId, filePathAtStart, streamedContent)
  }

  function clearPendingLiveBlueprintPartialWrite() {
    if (liveDraftPartialTimerRef.current !== null) {
      window.clearTimeout(liveDraftPartialTimerRef.current)
      liveDraftPartialTimerRef.current = null
    }
    liveDraftPartialPendingRef.current = null
  }

  function scheduleLiveBlueprintPartialWrite(runId: number, sessionId: string, projectPath: string | null, raw: string) {
    if (!projectPath || !isEasyAnalyseProjectPath(projectPath)) return
    liveDraftPartialPendingRef.current = { runId, sessionId, projectPath, raw }
    if (liveDraftPartialTimerRef.current !== null) {
      window.clearTimeout(liveDraftPartialTimerRef.current)
    }
    liveDraftPartialTimerRef.current = window.setTimeout(() => {
      void flushLiveBlueprintPartialWrite(runId)
    }, 250)
  }

  async function flushLiveBlueprintPartialWrite(runId: number) {
    const pending = liveDraftPartialPendingRef.current
    if (pending === null || pending.runId !== runId) return
    if (liveDraftPartialTimerRef.current !== null) {
      window.clearTimeout(liveDraftPartialTimerRef.current)
      liveDraftPartialTimerRef.current = null
    }
    liveDraftPartialPendingRef.current = null
    if (activeRunRef.current !== runId) return
    if (useBlueprintStore.getState().isLiveBlueprintDraftSessionSuppressed(pending.sessionId)) return
    if (useEditorStore.getState().filePath !== pending.projectPath) return
    try {
      await writeLiveBlueprintDraftPartial(pending.projectPath, pending.raw)
    } catch {
      // Partial draft persistence is recovery data; live preview must keep running if it fails.
    }
  }

  async function sendPrompt() {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || running) return

    const ensuredThread = externalThreads
      ? null
      : (agentThreads.find((thread) => thread.id === resolvedActiveThreadId) ?? ensureAgentThread({
          title: titleFromPrompt(trimmedPrompt),
        }))
    const threadId = ensuredThread?.id ?? resolvedActiveThreadId
    const runId = activeRunRef.current + 1
    activeRunRef.current = runId
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    activeRunThreadRef.current = threadId
    const assistantMessageId = nextMessageId('assistant')
    activeAssistantMessageRef.current = { threadId, messageId: assistantMessageId }
    const documentAtStart = document
    const filePathAtStart = filePath
    activeRunFilePathRef.current = filePathAtStart
    const threadMessagesAtStart = agentThreads.find((thread) => thread.id === threadId)?.messages ?? []
    const requestId = `agent-panel-${runId}`
    const startedAtMs = Date.now()
    activityIdRef.current = 1
    liveDraftLastGoodRef.current = null
    liveProgressTasksByRunRef.current.delete(runId)
    beginGateDecisionByRunRef.current.delete(runId)
    beginGatePendingByRunRef.current.delete(runId)
    beginGateResolveRef.current = null
    setBeginGate(null)
    clearPendingLiveBlueprintPartialWrite()
    useBlueprintStore.getState().clearLiveBlueprintDraft()

    setPrompt('')
    touchLocalThread(threadId, trimmedPrompt)
    if (!externalThreads) {
      appendAgentUserMessage(trimmedPrompt, { threadId, title: titleFromPrompt(trimmedPrompt) })
    }
    setMessagesByThread((state) => ({
      ...state,
      [threadId]: [
        ...(state[threadId] ?? persistedMessagesForThread(threadId)),
        {
          id: nextMessageId('user'),
          role: 'user',
          title: t('you'),
          content: trimmedPrompt,
        },
        {
          id: assistantMessageId,
          role: 'assistant',
          title: t('aiChat'),
          content: t('working'),
          meta: providerLabel,
          tone: 'running',
        },
      ],
    }))

    setRunState({
      status: 'running',
      response: null,
      issues: [],
      toolTrace: [],
      repairTrace: [],
      insertedCount: 0,
      error: null,
      startedAtMs,
      elapsedMs: 0,
      activity: [{
        id: `${runId}-1`,
        elapsedMs: 0,
        phase: 'preparing',
        message: `Preparing request for ${providerLabel}.`,
      }],
    })

    appendThreadMessage(threadId, {
      id: nextMessageId('tool'),
      role: 'tool',
      title: t('preparing'),
      content: `Preparing request for ${providerLabel}.`,
      meta: '0s',
    })

    try {
      const result = await runSelectedProvider({
        prompt: trimmedPrompt,
        currentDocument: documentAtStart,
        filePath: filePathAtStart,
        threadMessages: threadMessagesAtStart,
        requestId,
        includeDocumentContext,
        signal: abortController.signal,
        secretStore,
        runProvider,
        runMockProvider,
        storeBlueprintCandidates: async (candidates, options) => {
          if (useBlueprintStore.getState().isLiveBlueprintDraftSessionSuppressed(requestId)) {
            return []
          }
          const allowed = await ensureBeginBlueprintGenerationAllowed(runId, requestId, documentAtStart, {
            intent: options?.summary ?? t('beginBlueprintStoreGateIntent'),
            title: candidates[0]?.title,
          })
          if (!allowed || activeRunRef.current !== runId) {
            return []
          }
          const insertedIds = await addAgentBlueprintCandidatesToCurrentThread(
            candidates,
            {
              mainDocument: documentAtStart,
              filePath: filePathAtStart,
              issues: options?.issues,
            },
            {
              threadId,
              toolName: options?.toolName,
              summary: options?.summary,
              status: options?.status,
            },
          )
          appendRunToolMessage(runId, {
            title: options?.toolName ?? 'create_blueprint_candidate',
            content: options?.summary ?? t('storedBlueprintCandidates', { count: insertedIds.length }),
            meta: `${insertedIds.length} blueprint${insertedIds.length === 1 ? '' : 's'}`,
            tone: options?.status === 'error' ? 'error' : 'success',
          })
          return insertedIds
        },
        beginBlueprintGeneration: (request) => handleBeginBlueprintGeneration(runId, requestId, documentAtStart, request),
        onProgress: (progressEvent) => handleProviderProgress(runId, startedAtMs, requestId, documentAtStart, filePathAtStart, progressEvent),
      })
      await waitForLiveBlueprintProgress(runId)
      if (activeRunRef.current !== runId) return

      const latestEditor = useEditorStore.getState()
      const toolTrace = (result as { toolTrace?: AgentToolTraceEntry[] }).toolTrace ?? []
      const repairTrace = (result as { repairTrace?: AgentRepairTraceEntry[] }).repairTrace ?? []
      if (latestEditor.document !== documentAtStart || latestEditor.filePath !== filePathAtStart) {
        const elapsedMs = Math.max(0, Date.now() - startedAtMs)
        setRunState((state) => ({
          ...state,
          status: 'cancelled',
          response: result.response,
          issues: result.issues,
          toolTrace,
          repairTrace,
          insertedCount: 0,
          error: t('resultIgnoredBecauseDocumentChanged'),
          elapsedMs,
        }))
        updateActiveAssistantMessage({
          title: t('resultIgnored'),
          content: t('resultIgnoredBecauseDocumentChanged'),
          meta: formatElapsed(elapsedMs),
          tone: 'warning',
        })
        if (!externalThreads) {
          appendAgentAssistantMessage(t('resultIgnoredBecauseDocumentChanged'), { threadId })
        }
        return
      }

      let insertedCount = 0
      let finalBlueprintStorageSkipped = false
      if (result.response.kind === 'blueprints') {
        if (useBlueprintStore.getState().isLiveBlueprintDraftSessionSuppressed(requestId)) {
          finalBlueprintStorageSkipped = true
          clearPendingLiveBlueprintPartialWrite()
          liveDraftLastGoodRef.current = null
          appendRunToolMessage(runId, {
            title: t('liveDraftFinalStorageSkippedTitle'),
            content: t('liveDraftFinalStorageSkipped'),
            tone: 'warning',
          }, true)
        } else {
          const allowed = await ensureBeginBlueprintGenerationAllowed(runId, requestId, documentAtStart, {
            intent: t('beginBlueprintFinalGateIntent'),
            title: result.response.blueprints[0]?.title,
          })
          if (!allowed || activeRunRef.current !== runId) {
            return
          }
          const inserted = await addAgentBlueprintCandidatesToCurrentThread(
            result.response.blueprints,
            {
              mainDocument: documentAtStart,
              filePath: filePathAtStart,
              issues: result.issues,
            },
            {
              threadId,
              toolName: 'final_blueprints',
              summary: t('finalBlueprintsStored', { count: result.response.blueprints.length }),
            },
          )
          if (activeRunRef.current !== runId) return
          insertedCount = inserted.length
          if (insertedCount === 0 && result.response.blueprints.length > 0) {
            throw new Error(t('generatedButNotStored'))
          }
          if (insertedCount > 0) {
            void flushLiveBlueprintPartialWrite(runId)
            useBlueprintStore.getState().clearLiveBlueprintDraft()
            liveDraftLastGoodRef.current = null
          }
        }
      }

      const elapsedMs = Math.max(0, Date.now() - startedAtMs)
      setRunState((state) => ({
        ...state,
        status: 'complete',
        response: result.response,
        issues: result.issues,
        toolTrace,
        repairTrace,
        insertedCount,
        error: null,
        elapsedMs,
      }))
      const assistantContent = finalBlueprintStorageSkipped && result.response.kind === 'blueprints'
        ? formatSuppressedBlueprintResponseMessage(result.response, t)
        : formatResponseMessage(result.response, insertedCount, t)
      updateActiveAssistantMessage({
        title: assistantTitleFromResponse(result.response, t),
        content: assistantContent,
        meta: formatElapsed(elapsedMs),
        tone: result.response.kind === 'error' ? 'error' : 'success',
      })
      if (!externalThreads) {
        appendAgentAssistantMessage(assistantContent, { threadId })
      }
      if (toolTrace.length > 0 || repairTrace.length > 0) {
        appendRunToolMessage(runId, {
          title: t('toolChecks'),
          content: formatToolTrace(toolTrace, repairTrace),
          meta: `${toolTrace.length} check${toolTrace.length === 1 ? '' : 's'}`,
          tone: toolTrace.some((entry) => entry.issueCount > 0) ? 'warning' : 'success',
        }, true)
      }
      if (result.issues.length > 0) {
        appendRunToolMessage(runId, {
          title: t('parseIssuesRetained'),
          content: formatParseIssues(result.issues),
          meta: `${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`,
          tone: 'warning',
        }, true)
      }
    } catch (error) {
      await waitForLiveBlueprintProgress(runId)
      if (activeRunRef.current !== runId) return
      const elapsedMs = Math.max(0, Date.now() - startedAtMs)
      const message = getErrorMessage(error)
      setRunState((state) => ({
        ...state,
        status: 'error',
        response: null,
        issues: [],
        toolTrace: [],
        repairTrace: [],
        insertedCount: 0,
        error: message,
        elapsedMs,
      }))
      updateActiveAssistantMessage({
        title: t('providerError'),
        content: message,
        meta: formatElapsed(elapsedMs),
        tone: 'error',
      })
      if (!externalThreads) {
        appendAgentAssistantMessage(message, { threadId })
      }
    } finally {
      if (activeRunRef.current === runId) {
        abortControllerRef.current = null
        activeAssistantMessageRef.current = null
        activeRunFilePathRef.current = null
      }
      beginGateDecisionByRunRef.current.delete(runId)
      beginGatePendingByRunRef.current.delete(runId)
      liveProgressTasksByRunRef.current.delete(runId)
    }
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendPrompt()
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void sendPrompt()
  }

  function cancelRun() {
    if (!running) return
    abortControllerRef.current?.abort()
    const cancelledRunId = activeRunRef.current
    const elapsedMs = runState.startedAtMs === null ? runState.elapsedMs : Math.max(0, Date.now() - runState.startedAtMs)
    activeRunRef.current += 1
    clearPendingLiveBlueprintPartialWrite()
    setRunState((state) => {
      activityIdRef.current += 1
      const entry: AgentActivityEntry = {
        id: `${cancelledRunId}-${activityIdRef.current}`,
        elapsedMs,
        phase: 'complete',
        message: 'Run cancelled by user.',
      }
      return {
        ...state,
        status: 'cancelled',
        error: t('agentRunCancelled'),
        elapsedMs,
        activity: [...state.activity, entry].slice(-MAX_ACTIVITY_ENTRIES),
      }
    })
    updateActiveAssistantMessage({
      title: t('cancelled'),
      content: t('agentRunCancelled'),
      meta: formatElapsed(elapsedMs),
      tone: 'warning',
    })
    const threadId = activeRunThreadRef.current
    if (!externalThreads) {
      appendAgentAssistantMessage(t('agentRunCancelled'), { threadId })
    }
    appendThreadMessage(threadId, {
      id: nextMessageId('tool'),
      role: 'tool',
      title: t('cancelled'),
      content: t('runCancelledByUser'),
      meta: formatElapsed(elapsedMs),
      tone: 'warning',
    })
    persistThreadToolMessage(threadId, {
      title: t('cancelled'),
      content: t('runCancelledByUser'),
      meta: formatElapsed(elapsedMs),
      tone: 'warning',
    })
    abortControllerRef.current = null
    activeAssistantMessageRef.current = null
    activeRunFilePathRef.current = null
    liveProgressTasksByRunRef.current.delete(cancelledRunId)
    beginGateDecisionByRunRef.current.delete(cancelledRunId)
    beginGatePendingByRunRef.current.delete(cancelledRunId)
    if (beginGate?.runId === cancelledRunId) {
      resolveBeginBlueprintGate({
        allowed: false,
        action: 'cancelled',
        canvasHadCircuit: beginGate.canvasDeviceCount > 0,
        message: t('beginBlueprintCancelled'),
      })
    }
  }

  function resolveBeginBlueprintGate(data: BeginBlueprintGenerationData) {
    const runId = beginGate?.runId ?? activeRunRef.current
    beginGateDecisionByRunRef.current.set(runId, data)
    beginGatePendingByRunRef.current.delete(runId)
    beginGateResolveRef.current?.(data)
    beginGateResolveRef.current = null
    setBeginGate(null)
  }

  function handleBeginBlueprintGeneration(
    runId: number,
    requestId: string,
    documentAtStart: DocumentFile,
    request: BeginBlueprintGenerationRequest,
  ): Promise<BeginBlueprintGenerationData> {
    const previousDecision = beginGateDecisionByRunRef.current.get(runId)
    if (previousDecision) return Promise.resolve(previousDecision)
    const pendingDecision = beginGatePendingByRunRef.current.get(runId)
    if (pendingDecision) return pendingDecision
    const canvasHadCircuit = documentAtStart.devices.length > 0
    if (!canvasHadCircuit) {
      const data: BeginBlueprintGenerationData = {
        allowed: true,
        action: 'auto_continue',
        canvasHadCircuit: false,
        message: t('beginBlueprintAutoContinue'),
      }
      beginGateDecisionByRunRef.current.set(runId, data)
      return Promise.resolve(data)
    }

    const pending = new Promise<BeginBlueprintGenerationData>((resolve) => {
      beginGateResolveRef.current = (data) => {
        beginGateDecisionByRunRef.current.set(runId, data)
        beginGatePendingByRunRef.current.delete(runId)
        resolve(data)
      }
      setBeginGate({
        runId,
        requestId,
        document: documentAtStart,
        ...(request.intent ? { intent: request.intent } : {}),
        ...(request.title ? { title: request.title } : {}),
        canvasDeviceCount: documentAtStart.devices.length,
        selectedBlueprintId: useBlueprintStore.getState().selectedBlueprintId,
        busyAction: null,
        error: null,
      })
    })
    beginGatePendingByRunRef.current.set(runId, pending)
    return pending
  }

  async function ensureBeginBlueprintGenerationAllowed(
    runId: number,
    requestId: string,
    documentAtStart: DocumentFile,
    request: BeginBlueprintGenerationRequest,
  ): Promise<boolean> {
    const result = await handleBeginBlueprintGeneration(runId, requestId, documentAtStart, request)
    return result.allowed && activeRunRef.current === runId
  }

  async function handleBeginGateAction(action: BeginBlueprintGenerationAction) {
    if (!beginGate) return
    setBeginGate((state) => state ? { ...state, busyAction: action, error: null } : state)
    try {
      if (action === 'cancelled') {
        const cancelledRunId = beginGate.runId
        if (running && activeRunRef.current === cancelledRunId) {
          cancelRun()
        } else {
          resolveBeginBlueprintGate({
            allowed: false,
            action: 'cancelled',
            canvasHadCircuit: beginGate.canvasDeviceCount > 0,
            message: t('beginBlueprintCancelled'),
          })
        }
        return
      }

      if (action === 'save_current_blueprint') {
        if (!beginGate.selectedBlueprintId) {
          throw new Error(t('beginBlueprintNoSelectedBlueprint'))
        }
        const updated = await useBlueprintStore.getState().replaceBlueprintFromDocument(beginGate.selectedBlueprintId, beginGate.document, {
          notes: t('beginBlueprintSavedBeforeGeneration'),
        })
        if (!updated) {
          throw new Error(t('beginBlueprintNoSelectedBlueprint'))
        }
        resolveBeginBlueprintGate({
          allowed: true,
          action,
          canvasHadCircuit: true,
          savedBlueprintId: updated.id,
          savedBlueprintTitle: updated.title,
          message: t('beginBlueprintSavedCurrentResult', { title: updated.title }),
        })
        return
      }

      if (action === 'save_new_blueprint') {
        const snapshot = await useBlueprintStore.getState().createSnapshotFromDocument(beginGate.document, {
          title: beginGate.title || beginGate.document.document.title,
          description: t('beginBlueprintSavedSnapshotDescription'),
        })
        resolveBeginBlueprintGate({
          allowed: true,
          action,
          canvasHadCircuit: true,
          savedBlueprintId: snapshot.id,
          savedBlueprintTitle: snapshot.title,
          message: t('beginBlueprintSavedNewResult', { title: snapshot.title }),
        })
        return
      }

      resolveBeginBlueprintGate({
        allowed: true,
        action: 'continue_without_saving',
        canvasHadCircuit: true,
        message: t('beginBlueprintContinueWithoutSavingResult'),
      })
    } catch (error) {
      setBeginGate((state) => state ? { ...state, busyAction: null, error: getErrorMessage(error) } : state)
    }
  }

  function changeThread(threadId: string) {
    onThreadChange?.(threadId)
    if (!activeThreadId && !externalThreads) selectAgentThread(threadId)
    setThreadMenuOpen(false)
  }

  function createThread() {
    if (running) return
    if (onNewThread) {
      onNewThread()
      setThreadMenuOpen(false)
      return
    }
    const thread = createAgentThread({ title: t('newThread') })
    setMessagesByThread((state) => ({ ...state, [thread.id]: [] }))
    if (!activeThreadId) selectAgentThread(thread.id)
    setThreadMenuOpen(false)
  }

  return (
    <section className="agent-panel" aria-label={t('aiChat')}>
      <div className="agent-panel__topline">
        <div className="agent-panel__model-pill" title={providerLabel}>
          <Sparkles size={16} strokeWidth={2.1} aria-hidden="true" />
          <span>{modelLabel}</span>
          <small>{provider?.name ?? t('mockProvider')}</small>
        </div>
        <AgentStatusBadge status={runState.status} label={t(runState.status)} />
      </div>

      {provider?.kind === 'anthropic' ? (
        <div className="agent-panel__compact-notice">
          <AlertCircle size={15} strokeWidth={2.1} aria-hidden="true" />
          <span>{t('anthropicPlainChat')}</span>
        </div>
      ) : null}

      <div className="agent-panel__threadbar">
        <div className="agent-panel__thread-menu-wrap">
          <button
            className="agent-panel__thread-button"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={threadMenuOpen}
            onClick={() => setThreadMenuOpen((open) => !open)}
          >
            <History size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{activeThread?.title ?? t('currentThread')}</span>
            <ChevronDown size={15} strokeWidth={2.1} aria-hidden="true" />
          </button>
          {threadMenuOpen ? (
            <div className="agent-panel__thread-menu" role="listbox" aria-label={t('agentThreads')}>
              {availableThreads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  role="option"
                  aria-selected={thread.id === resolvedActiveThreadId}
                  className={thread.id === resolvedActiveThreadId ? 'is-active' : undefined}
                  onClick={() => changeThread(thread.id)}
                >
                  <span>{thread.title}</span>
                  {thread.updatedAtMs ? <small>{formatThreadTime(thread.updatedAtMs)}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          className="agent-panel__new-thread"
          type="button"
          aria-label={t('newThread')}
          title={t('newThread')}
          disabled={running}
          onClick={createThread}
        >
          <MessageSquarePlus size={16} strokeWidth={2.1} aria-hidden="true" />
        </button>
      </div>

      <div className="agent-panel__messages" aria-live="polite">
        {visibleMessages.map((message) => (
          <AgentMessageView key={message.id} message={message} showToolDetailsLabel={t('showToolDetails')} />
        ))}
        {running ? (
          <div className="agent-panel__running-line">
            <Loader2 size={14} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('running')} {formatElapsed(runState.elapsedMs)}</span>
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>

      <form className="agent-composer" onSubmit={submitPrompt}>
        <textarea
          id="agent-panel-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder={t('typePrompt')}
          rows={3}
          disabled={running}
        />
        <div className="agent-composer__bar">
          <label className="agent-composer__context" htmlFor="agent-panel-include-document">
            <input
              id="agent-panel-include-document"
              type="checkbox"
              checked={includeDocumentContext}
              disabled={running}
              onChange={(event) => setIncludeDocumentContext(event.currentTarget.checked)}
            />
            <FileText size={14} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('context')}</span>
          </label>
          <span className="agent-composer__provider" title={providerLabel}>{providerLabel}</span>
          <button
            className="agent-composer__run-button"
            type={running ? 'button' : 'submit'}
            aria-label={running ? t('cancelRun') : t('sendMessage')}
            title={running ? t('cancelRun') : t('sendMessage')}
            disabled={!running && prompt.trim().length === 0}
            onClick={running ? cancelRun : undefined}
          >
            {running ? <Square size={17} strokeWidth={2.2} aria-hidden="true" /> : <Send size={17} strokeWidth={2.2} aria-hidden="true" />}
          </button>
        </div>
      </form>
      {beginGate ? (
        <BeginBlueprintGenerationDialog
          gate={beginGate}
          t={t}
          onAction={(action) => void handleBeginGateAction(action)}
        />
      ) : null}
    </section>
  )
}

function liveDraftSessionIdForRun(runId: number): string {
  return `agent-panel-${runId}`
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function formatActivityPhase(phase: string): string {
  const labels: Record<string, string> = {
    'self-check': 'Self-check',
  }
  const label = labels[phase] ?? phase.replace(/-/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 34) return normalized || 'New thread'
  return `${normalized.slice(0, 31)}...`
}

function formatThreadTime(timestampMs: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestampMs))
  } catch {
    return ''
  }
}

function orderAgentMessagesForDisplay(messages: AgentChatMessage[]): AgentChatMessage[] {
  const ordered: AgentChatMessage[] = []
  let segment: AgentChatMessage[] = []

  const flushSegment = () => {
    if (segment.length === 0) return
    const hasUser = segment.some((message) => message.role === 'user')
    const hasAssistant = segment.some((message) => message.role === 'assistant')
    const hasTool = segment.some((message) => message.role === 'tool')
    if (hasUser && hasAssistant && hasTool) {
      ordered.push(
        ...segment.filter((message) => message.role === 'user'),
        ...segment.filter((message) => message.role === 'tool'),
        ...segment.filter((message) => message.role === 'assistant'),
      )
    } else {
      ordered.push(...segment)
    }
    segment = []
  }

  messages.forEach((message) => {
    if (message.role === 'user' && segment.length > 0) {
      flushSegment()
    }
    segment.push(message)
  })
  flushSegment()
  return ordered
}

function parseTimestampMs(value: string): number | undefined {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function agentThreadToSummary(thread: AgentThread): AgentThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    createdAtMs: parseTimestampMs(thread.createdAt),
    updatedAtMs: parseTimestampMs(thread.updatedAt),
  }
}

function agentThreadMessageToChatMessage(
  message: AgentThreadMessage,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): AgentChatMessage {
  if (message.role === 'user') {
    return {
      id: message.id,
      role: 'user',
      title: t('you'),
      content: message.content,
    }
  }

  if (message.role === 'assistant') {
    return {
      id: message.id,
      role: 'assistant',
      title: t('aiChat'),
      content: message.content,
    }
  }

  const metaParts = [
    message.blueprintIds.length > 0
      ? `${message.blueprintIds.length} blueprint${message.blueprintIds.length === 1 ? '' : 's'}`
      : '',
    message.issueCount > 0 ? `${message.issueCount} issue${message.issueCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean)

  return {
    id: message.id,
    role: 'tool',
    title: message.toolName,
    content: message.summary || t('toolCompleted'),
    meta: metaParts.length > 0 ? metaParts.join(' / ') : undefined,
    tone: message.status === 'error' ? 'error' : message.status === 'running' ? 'running' : 'success',
  }
}

function threadToolStatusFromTone(tone: AgentMessageTone | undefined): 'running' | 'success' | 'error' {
  if (tone === 'running') return 'running'
  if (tone === 'error') return 'error'
  return 'success'
}

function AgentStatusBadge({ status, label }: { status: AgentRunState['status']; label: string }) {
  const Icon = status === 'running' ? Loader2 : status === 'complete' ? CheckCircle2 : status === 'idle' ? Sparkles : AlertCircle
  return (
    <span className={`agent-panel__status agent-panel__status--${status}`}>
      <Icon size={14} strokeWidth={2.1} aria-hidden="true" />
      {label}
    </span>
  )
}

function BeginBlueprintGenerationDialog({
  gate,
  t,
  onAction,
}: {
  gate: BeginBlueprintGateState
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  onAction: (action: BeginBlueprintGenerationAction) => void
}) {
  const busy = gate.busyAction !== null
  return (
    <ModalShell
      rootClassName="agent-begin-blueprint-dialog__backdrop"
      panelClassName="agent-begin-blueprint-dialog"
      ariaLabelledBy="agent-begin-blueprint-dialog-title"
      ariaDescribedBy="agent-begin-blueprint-dialog-description"
      closeOnBackdrop={false}
      closeOnEscape={false}
      trapFocus
      initialFocusSelector="button[data-modal-initial-focus]"
    >
      <div className="agent-begin-blueprint-dialog__header">
        <div>
          <h3 id="agent-begin-blueprint-dialog-title">{t('beginBlueprintGateTitle')}</h3>
          <p id="agent-begin-blueprint-dialog-description">
            {t('beginBlueprintGateDescription', { count: gate.canvasDeviceCount })}
          </p>
        </div>
      </div>
      {gate.intent ? (
        <div className="agent-begin-blueprint-dialog__note">
          <strong>{t('beginBlueprintIntent')}</strong>
          <span>{gate.intent}</span>
        </div>
      ) : null}
      {gate.error ? <p className="agent-begin-blueprint-dialog__error">{gate.error}</p> : null}
      <div className="agent-begin-blueprint-dialog__actions">
        <Button
          type="button"
          onClick={() => onAction('save_current_blueprint')}
          disabled={busy || !gate.selectedBlueprintId}
          title={!gate.selectedBlueprintId ? t('beginBlueprintNoSelectedBlueprint') : undefined}
        >
          {gate.busyAction === 'save_current_blueprint' ? t('saving') : t('beginBlueprintSaveCurrent')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="ghost-button"
          onClick={() => onAction('save_new_blueprint')}
          disabled={busy}
          data-modal-initial-focus
        >
          {gate.busyAction === 'save_new_blueprint' ? t('saving') : t('beginBlueprintSaveNew')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="ghost-button"
          onClick={() => onAction('continue_without_saving')}
          disabled={busy}
        >
          {t('beginBlueprintContinueWithoutSaving')}
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => onAction('cancelled')}
          disabled={busy}
        >
          {t('beginBlueprintCancelGeneration')}
        </Button>
      </div>
    </ModalShell>
  )
}

function AgentMessageView({
  message,
  showToolDetailsLabel,
}: {
  message: AgentChatMessage
  showToolDetailsLabel: string
}) {
  const Icon = message.role === 'user' ? User : message.role === 'tool' ? Wrench : Bot
  return (
    <article className={`agent-message agent-message--${message.role} agent-message--${message.tone ?? 'neutral'}`}>
      <div className="agent-message__avatar" aria-hidden="true">
        <Icon size={15} strokeWidth={2.1} />
      </div>
      <div className="agent-message__bubble">
        {message.role === 'tool' ? (
          <details className="agent-message__tool-details">
            <summary aria-label={showToolDetailsLabel}>
              <span className="agent-message__tool-summary-main">
                {message.title ? <strong>{message.title}</strong> : null}
                {message.meta ? <span>{message.meta}</span> : null}
              </span>
              <ChevronDown size={14} strokeWidth={2.1} aria-hidden="true" />
            </summary>
            <p>{message.content}</p>
          </details>
        ) : (
          <>
            {(message.title || message.meta) ? (
              <div className="agent-message__head">
                {message.title ? <strong>{message.title}</strong> : <span />}
                {message.meta ? <span>{message.meta}</span> : null}
              </div>
            ) : null}
            <p>{message.content}</p>
          </>
        )}
      </div>
    </article>
  )
}

async function runSelectedProvider(input: {
  prompt: string
  currentDocument: DocumentFile
  filePath: string | null
  threadMessages: AgentThreadMessage[]
  requestId: string
  includeDocumentContext: boolean
  signal: AbortSignal
  secretStore: Pick<SecretStore, 'readSecret'>
  runProvider: typeof runConfiguredAgentProvider
  runMockProvider: typeof runMockAgentProvider
  storeBlueprintCandidates: (
    candidates: AgentBlueprintCandidate[],
    options?: {
      issues?: AgentResponseParseIssue[]
      toolName?: string
      summary?: string
      status?: 'running' | 'success' | 'error'
    },
  ) => Promise<string[]>
  beginBlueprintGeneration?: (request: BeginBlueprintGenerationRequest) => Promise<BeginBlueprintGenerationData>
  onProgress?: (event: AgentProviderProgressEvent) => void
}): Promise<AgentResponseParseResult> {
  const { provider, modelId } = selectedProviderFromSettings()
  if (!provider) {
    input.onProgress?.({ phase: 'request', message: 'Running local mock provider.' })
    return input.runMockProvider({
      prompt: input.prompt,
      currentDocument: input.currentDocument,
      requestId: input.requestId,
    })
  }
  if (!modelId) {
    throw new Error(`Provider ${provider.name} has no selected model.`)
  }
  if (!provider.apiKeyRef) {
    throw new Error(`Provider ${provider.name} has no saved API key.`)
  }
  if (!isManagedSecretRef(provider.apiKeyRef)) {
    throw new Error(`Provider ${provider.name} uses an unsupported legacy API key reference. Please re-save the API key in Settings.`)
  }
  input.onProgress?.({ phase: 'preparing', message: `Reading saved API key for ${provider.name}.` })
  const apiKey = await input.secretStore.readSecret(provider.apiKeyRef)
  if (!apiKey?.trim()) {
    throw new Error(`Saved API key for provider ${provider.name} was not found.`)
  }
  input.onProgress?.({ phase: 'preparing', message: `Saved API key loaded for ${provider.name}.` })
  return input.runProvider({
    provider,
    modelId,
    apiKey,
    prompt: input.prompt,
    currentDocument: input.currentDocument,
    threadMessages: input.threadMessages,
    includeDocumentContext: input.includeDocumentContext,
    getCurrentDocument: () => input.currentDocument,
    getBlueprintWorkspace: () => useBlueprintStore.getState().workspace,
    getSelectedBlueprintId: () => useBlueprintStore.getState().selectedBlueprintId,
    getCurrentSelection: () => useEditorStore.getState().selection,
    getEditorFocus: () => {
      const state = useEditorStore.getState()
      return {
        focusedDeviceId: state.focusedDeviceId,
        focusedLabelKey: state.focusedLabelKey,
        focusedNetworkLineId: state.focusedNetworkLineId,
      }
    },
    beginBlueprintGeneration: input.beginBlueprintGeneration,
    createBlueprintCandidate: async (candidate) => {
      const latestEditor = useEditorStore.getState()
      if (latestEditor.document !== input.currentDocument || latestEditor.filePath !== input.filePath) {
        return {
          ok: false,
          code: 'agent_tool.stale_context',
          message: 'Current document changed while the agent was creating a blueprint candidate. The candidate was not stored; ask the user to retry against the current document.',
          details: {
            expectedFilePath: input.filePath,
            actualFilePath: latestEditor.filePath,
          },
        }
      }
      const blueprintIds = await input.storeBlueprintCandidates([candidate], {
        toolName: 'create_blueprint_candidate',
        summary: `Stored blueprint candidate "${candidate.title}".`,
      })
      if (blueprintIds.length === 0) {
        return {
          ok: false,
          code: 'agent_tool.blueprint_insert_not_stored',
          message: 'The blueprint candidate passed format checks, but EasyAnalyse did not store it because the active blueprint workspace was not compatible with the current main document or was reloaded during insertion.',
        }
      }
      return { blueprintIds }
    },
    requestId: input.requestId,
    signal: input.signal,
    progress: input.onProgress,
  })
}

function assistantTitleFromResponse(
  response: AgentResponse,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (response.kind === 'blueprints') return t('blueprintCandidates')
  if (response.kind === 'question') return t('question')
  if (response.kind === 'error') return response.summary ?? t('agentError')
  if (response.kind === 'patch') return t('patchDeferred')
  return response.summary ?? t('message')
}

function formatResponseMessage(
  response: AgentResponse,
  insertedCount: number,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (response.kind === 'message') {
    return response.summary ? `${response.summary}\n\n${response.markdown}` : response.markdown
  }

  if (response.kind === 'question') {
    return response.options?.length
      ? `${response.question}\n\n${t('optionsLabel')}: ${response.options.join(', ')}`
      : response.question
  }

  if (response.kind === 'error') {
    return `${response.message}\n\n${response.recoverable ? t('recoverable') : t('notRecoverable')}`
  }

  if (response.kind === 'blueprints') {
    const candidateLines = response.blueprints.map((candidate) => (
      `- ${candidate.title}: ${candidate.issues.length} issue${candidate.issues.length === 1 ? '' : 's'}`
    ))
    return [
      response.summary,
      '',
      t('storedBlueprintCandidates', { count: insertedCount }),
      ...candidateLines,
    ].join('\n')
  }

  return response.message
}

function formatSuppressedBlueprintResponseMessage(
  response: Extract<AgentResponse, { kind: 'blueprints' }>,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const candidateLines = response.blueprints.map((candidate) => (
    `- ${candidate.title}: ${candidate.issues.length} issue${candidate.issues.length === 1 ? '' : 's'}`
  ))
  return [
    response.summary,
    '',
    t('liveDraftFinalStorageSkipped'),
    ...candidateLines,
  ].join('\n')
}

function formatToolTrace(toolTrace: AgentToolTraceEntry[], repairTrace: AgentRepairTraceEntry[]): string {
  const checks = toolTrace.map((entry) => (
    `${entry.toolName}: ${entry.summary} (${entry.issueCount} issue${entry.issueCount === 1 ? '' : 's'})`
  ))
  const repairs = repairTrace.map((entry) => `repair ${entry.attempt}: ${entry.summary}`)
  return [...checks, ...repairs].join('\n') || 'No tool checks recorded.'
}

function formatParseIssues(issues: AgentResponseParseIssue[]): string {
  return issues.map((issue) => `${issue.severity}: ${issue.message}`).join('\n')
}
