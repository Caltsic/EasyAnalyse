import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { runMockAgentProvider } from '../../lib/agentMockProvider'
import { useBlueprintStore } from '../../store/blueprintStore'
import { useEditorStore } from '../../store/editorStore'
import type { AgentResponse, AgentResponseParseIssue } from '../../types/agent'

interface AgentRunState {
  status: 'idle' | 'running' | 'complete' | 'cancelled' | 'error'
  response: AgentResponse | null
  issues: AgentResponseParseIssue[]
  insertedCount: number
  error: string | null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function AgentPanel() {
  const document = useEditorStore((state) => state.document)
  const filePath = useEditorStore((state) => state.filePath)
  const addAgentBlueprintCandidates = useBlueprintStore((state) => state.addAgentBlueprintCandidates)
  const [prompt, setPrompt] = useState('')
  const [runState, setRunState] = useState<AgentRunState>({
    status: 'idle',
    response: null,
    issues: [],
    insertedCount: 0,
    error: null,
  })
  const activeRunRef = useRef(0)

  const running = runState.status === 'running'

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || running) return

    const runId = activeRunRef.current + 1
    activeRunRef.current = runId
    const documentAtStart = document
    const filePathAtStart = filePath
    const requestId = `agent-panel-${runId}`

    setRunState({ status: 'running', response: null, issues: [], insertedCount: 0, error: null })

    try {
      const result = await runMockAgentProvider({
        prompt: trimmedPrompt,
        currentDocument: documentAtStart,
        requestId,
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
    }
  }

  function cancelRun() {
    if (!running) return
    activeRunRef.current += 1
    setRunState((state) => ({ ...state, status: 'cancelled', error: 'Agent run cancelled.' }))
  }

  return (
    <section className="agent-panel" aria-label="Agent panel">
      <header className="agent-panel__header">
        <div>
          <h2>Agent</h2>
          <p>Local mock flow only. Candidates are stored as blueprints without changing the main document.</p>
        </div>
        <span className={`agent-panel__status agent-panel__status--${runState.status}`}>{runState.status}</span>
      </header>

      <form className="agent-panel__form" onSubmit={submitPrompt}>
        <label htmlFor="agent-panel-prompt">Prompt</label>
        <textarea
          id="agent-panel-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          placeholder="Ask the mock agent for a message, question, error, or blueprint candidates…"
          rows={4}
          disabled={running}
        />
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
