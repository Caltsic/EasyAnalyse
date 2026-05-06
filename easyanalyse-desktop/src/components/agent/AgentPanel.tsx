import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { runMockAgentProvider } from '../../lib/agentMockProvider'
import { runConfiguredAgentProvider } from '../../lib/agentProviderClient'
import { defaultSecretStore, isManagedSecretRef, type SecretStore } from '../../lib/secretStore'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { AgentResponse, AgentResponseParseIssue, AgentResponseParseResult } from '../../types/agent'
import type { AgentProviderPublicConfig } from '../../types/settings'

interface AgentRunState {
  status: 'idle' | 'running' | 'complete' | 'cancelled' | 'error'
  response: AgentResponse | null
  issues: AgentResponseParseIssue[]
  insertedCount: number
  error: string | null
}

export interface AgentPanelProps {
  secretStore?: Pick<SecretStore, 'readSecret'>
  runProvider?: typeof runConfiguredAgentProvider
  runMockProvider?: typeof runMockAgentProvider
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
}: AgentPanelProps = {}) {
  const document = useEditorStore((state) => state.document)
  const filePath = useEditorStore((state) => state.filePath)
  const settings = useSettingsStore((state) => state.settings)
  const addAgentBlueprintCandidates = useBlueprintStore((state) => state.addAgentBlueprintCandidates)
  const [prompt, setPrompt] = useState('')
  const [includeDocumentContext, setIncludeDocumentContext] = useState(false)
  const [runState, setRunState] = useState<AgentRunState>({
    status: 'idle',
    response: null,
    issues: [],
    insertedCount: 0,
    error: null,
  })
  const activeRunRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const running = runState.status === 'running'
  const provider = settings.agent.providers.find((item) => item.id === settings.agent.selectedProviderId) ?? null
  const modelId = settings.agent.selectedModelId ?? provider?.defaultModel ?? provider?.models[0] ?? null
  const providerLabel = provider ? `${provider.name} / ${modelId ?? 'No model selected'}` : 'Mock provider'

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || running) return

    const runId = activeRunRef.current + 1
    activeRunRef.current = runId
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    const documentAtStart = document
    const filePathAtStart = filePath
    const requestId = `agent-panel-${runId}`

    setRunState({ status: 'running', response: null, issues: [], insertedCount: 0, error: null })

    try {
      const result = await runSelectedProvider({
        prompt: trimmedPrompt,
        currentDocument: documentAtStart,
        requestId,
        includeDocumentContext,
        signal: abortController.signal,
        secretStore,
        runProvider,
        runMockProvider,
      })
      if (activeRunRef.current !== runId) return

      const latestEditor = useEditorStore.getState()
      if (latestEditor.document !== documentAtStart || latestEditor.filePath !== filePathAtStart) {
        setRunState({
          status: 'cancelled',
          response: result.response,
          issues: result.issues,
          insertedCount: 0,
          error: 'Agent result ignored because the editor document or workspace changed.',
        })
        return
      }

      let insertedCount = 0
      if (result.response.kind === 'blueprints') {
        const inserted = await addAgentBlueprintCandidates(result.response.blueprints, {
          mainDocument: documentAtStart,
          filePath: filePathAtStart,
          issues: result.issues,
        })
        if (activeRunRef.current !== runId) return
        insertedCount = inserted.length
      }

      setRunState({ status: 'complete', response: result.response, issues: result.issues, insertedCount, error: null })
    } catch (error) {
      if (activeRunRef.current !== runId) return
      setRunState({ status: 'error', response: null, issues: [], insertedCount: 0, error: getErrorMessage(error) })
    } finally {
      if (activeRunRef.current === runId) {
        abortControllerRef.current = null
      }
    }
  }

  function cancelRun() {
    if (!running) return
    abortControllerRef.current?.abort()
    activeRunRef.current += 1
    setRunState((state) => ({ ...state, status: 'cancelled', error: 'Agent run cancelled.' }))
  }

  return (
    <section className="agent-panel" aria-label="Agent panel">
      <header className="agent-panel__header">
        <div>
          <h2>Agent</h2>
          <p>
            {provider
              ? 'Configured provider flow. Candidates are stored as blueprints without changing the main document.'
              : 'Local mock flow. Configure a provider in Settings to call a real model.'}
          </p>
          <p className="agent-panel__provider">Provider: {providerLabel}</p>
        </div>
        <span className={`agent-panel__status agent-panel__status--${runState.status}`}>{runState.status}</span>
      </header>

      <form className="agent-panel__form" onSubmit={submitPrompt}>
        <label htmlFor="agent-panel-prompt">Prompt</label>
        <textarea
          id="agent-panel-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          placeholder="Ask the agent for circuit explanations, blueprint candidates, or modifications…"
          rows={4}
          disabled={running}
        />
        <label className="agent-panel__checkbox" htmlFor="agent-panel-include-document">
          <input
            id="agent-panel-include-document"
            type="checkbox"
            checked={includeDocumentContext}
            disabled={running}
            onChange={(event) => setIncludeDocumentContext(event.currentTarget.checked)}
          />
          Include current document context in provider request
        </label>
        <p className="agent-panel__hint">
          When checked, the current semantic v4 document is sent to the selected provider so it can propose modification blueprints.
        </p>
        <div className="agent-panel__actions">
          <button type="submit" disabled={running || prompt.trim().length === 0}>
            {running ? 'Sending…' : 'Send'}
          </button>
          <button type="button" onClick={cancelRun} disabled={!running}>
            Cancel
          </button>
        </div>
      </form>

      <div className="agent-panel__results" aria-live="polite">
        {runState.error ? <p className="agent-panel__notice">{runState.error}</p> : null}
        {runState.response ? <AgentResponseCard response={runState.response} insertedCount={runState.insertedCount} /> : null}
        {runState.issues.length > 0 ? (
          <section className="agent-card agent-card--issues" aria-label="Agent parse issues">
            <h3>Parse issues retained</h3>
            <ul>
              {runState.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <strong>{issue.severity}</strong>: {issue.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </section>
  )
}

async function runSelectedProvider(input: {
  prompt: string
  currentDocument: import('../../types/document').DocumentFile
  requestId: string
  includeDocumentContext: boolean
  signal: AbortSignal
  secretStore: Pick<SecretStore, 'readSecret'>
  runProvider: typeof runConfiguredAgentProvider
  runMockProvider: typeof runMockAgentProvider
}): Promise<AgentResponseParseResult> {
  const { provider, modelId } = selectedProviderFromSettings()
  if (!provider) {
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
  const apiKey = await input.secretStore.readSecret(provider.apiKeyRef)
  if (!apiKey?.trim()) {
    throw new Error(`Saved API key for provider ${provider.name} was not found.`)
  }
  return input.runProvider({
    provider,
    modelId,
    apiKey,
    prompt: input.prompt,
    currentDocument: input.currentDocument,
    includeDocumentContext: input.includeDocumentContext,
    requestId: input.requestId,
    signal: input.signal,
  })
}

function AgentResponseCard({ response, insertedCount }: { response: AgentResponse; insertedCount: number }) {
  if (response.kind === 'message') {
    return (
      <section className="agent-card">
        <h3>{response.summary ?? 'Message'}</h3>
        <p>{response.markdown}</p>
      </section>
    )
  }

  if (response.kind === 'question') {
    return (
      <section className="agent-card">
        <h3>Question</h3>
        <p>{response.question}</p>
        {response.options ? <p>Options: {response.options.join(', ')}</p> : null}
      </section>
    )
  }

  if (response.kind === 'error') {
    return (
      <section className="agent-card agent-card--error">
        <h3>{response.summary ?? 'Agent error'}</h3>
        <p>{response.message}</p>
        <p>{response.recoverable ? 'Recoverable' : 'Not recoverable'}</p>
      </section>
    )
  }

  if (response.kind === 'blueprints') {
    return (
      <section className="agent-card">
        <h3>{response.summary}</h3>
        <p>{insertedCount} blueprint candidate{insertedCount === 1 ? '' : 's'} stored.</p>
        <ul className="agent-card__candidate-list">
          {response.blueprints.map((candidate, index) => (
            <li key={`${candidate.title}-${index}`}>
              <strong>{candidate.title}</strong>
              <span>{candidate.issues.length} issue{candidate.issues.length === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className="agent-card agent-card--issues">
      <h3>Patch deferred</h3>
      <p>{response.message}</p>
    </section>
  )
}
