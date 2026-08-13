import { describe, expect, it, vi } from 'vitest'
import { createFauxCore, fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai/providers/faux'
import { buildDefaultDocument } from './document'
import { buildPiSystemPrompt, createPiModel, createPiTools, runPiAgentWithStream } from './piAgentRuntime'
import type { AgentBlueprintCandidate } from '../types/agent'
import type { AgentProviderPublicConfig } from '../types/settings'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ValidationReport } from '../types/document'

const provider: AgentProviderPublicConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  kind: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  models: ['deepseek-chat'],
  defaultModel: 'deepseek-chat',
}

function candidate(): AgentBlueprintCandidate {
  return {
    title: 'Pi candidate',
    summary: 'Stored through the only artifact tool.',
    rationale: 'Test the isolated Pi bridge.',
    tradeoffs: [],
    document: {
      ...buildDefaultDocument(),
      devices: [],
      view: {
        canvas: { units: 'px', grid: { enabled: true, size: 16 } },
        devices: {},
        networkLines: {},
      },
    },
    issues: [],
  }
}

describe('piAgentRuntime', () => {
  it('normalizes OpenAI-compatible and Anthropic base URLs', () => {
    expect(createPiModel(provider, 'deepseek-chat')).toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://api.deepseek.com/v1',
      compat: expect.objectContaining({ thinkingFormat: 'deepseek' }),
    })
    expect(createPiModel({ ...provider, id: 'anthropic', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1/messages' }, 'claude-test')).toMatchObject({
      api: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com',
    })
  })

  it('streams plain text through EASYAnalyse events without requiring AgentResponse JSON', async () => {
    const faux = createFauxCore({ api: 'openai-completions', provider: 'deepseek', models: [{ id: 'deepseek-chat' }] })
    faux.setResponses([fauxAssistantMessage('Plain Pi answer')])
    const events: string[] = []

    const result = await runPiAgentWithStream({
      provider,
      modelId: 'deepseek-chat',
      apiKey: 'test-key',
      prompt: 'answer plainly',
      streamFn: faux.streamSimple,
      onEvent: (event) => events.push(event.type),
    })

    expect(result).toMatchObject({
      runtime: 'pi',
      conversation: { text: 'Plain Pi answer', status: 'complete' },
      artifactsStoredByTools: false,
    })
    expect(events).toContain('assistant-delta')
    expect(events.at(-1)).toBe('assistant-final')
  })

  it('runs create_blueprint_candidate sequentially and records one stored artifact', async () => {
    const createBlueprintCandidate = vi.fn(async () => ({ blueprintIds: ['blueprint-1'] }))
    const validation: ValidationReport = {
      detectedFormat: 'semantic-v4',
      schemaValid: true,
      semanticValid: true,
      issueCount: 0,
      issues: [],
    }
    const toolTrace: Array<{ toolName: string; ok: boolean; summary: string; issueCount: number }> = []
    const events: string[] = []
    const tools = createPiTools(
      { createBlueprintCandidate, validateDocument: () => validation },
      (event) => events.push(event.type),
      toolTrace,
    )
    const blueprintTool = tools.find((tool): tool is AgentTool => tool.name === 'create_blueprint_candidate')
    expect(blueprintTool).toBeDefined()

    const result = await blueprintTool!.execute('call-blueprint', { candidate: candidate() })

    expect(createBlueprintCandidate).toHaveBeenCalledTimes(1)
    expect(result.details).toMatchObject({ ok: true, toolName: 'create_blueprint_candidate' })
    expect(toolTrace).toEqual([
      expect.objectContaining({ toolName: 'create_blueprint_candidate', ok: true }),
    ])
    expect(events).toEqual(['artifact-created', 'tool-finished'])
  })

  it('preserves partial text and reports provider errors', async () => {
    const faux = createFauxCore({ api: 'openai-completions', provider: 'deepseek', models: [{ id: 'deepseek-chat' }] })
    faux.setResponses([fauxAssistantMessage(fauxText('Partial Pi answer'), { stopReason: 'error', errorMessage: 'synthetic failure' })])

    const result = await runPiAgentWithStream({
      provider,
      modelId: 'deepseek-chat',
      apiKey: 'test-key',
      prompt: 'fail after text',
      streamFn: faux.streamSimple,
    })

    expect(result.conversation).toEqual({ text: 'Partial Pi answer', status: 'partial' })
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', message: 'synthetic failure' }),
    ])
  })

  it('exposes only the three PoC tools with sequential execution', () => {
    const tools = createPiTools({})
    expect(tools.map((tool) => ({ name: tool.name, mode: tool.executionMode }))).toEqual([
      { name: 'get_current_document', mode: 'sequential' },
      { name: 'summarize_topology', mode: 'sequential' },
      { name: 'create_blueprint_candidate', mode: 'sequential' },
    ])
    const blueprintSchema = JSON.stringify(tools.find((tool) => tool.name === 'create_blueprint_candidate')?.parameters)
    expect(blueprintSchema).toContain('terminals')
    expect(blueprintSchema).toContain('networkLines')
    expect(blueprintSchema).toContain('orientation')
    expect(blueprintSchema).toContain('side')
  })

  it('keeps the complete semantic-v4 terminal and visual-network contract in the Pi prompt', () => {
    const prompt = buildPiSystemPrompt({
      provider,
      modelId: 'deepseek-chat',
      apiKey: 'test-key',
      prompt: 'Create a circuit',
    })
    expect(prompt).toContain('Connectivity is defined only by exact terminal.label equality')
    expect(prompt).toContain('Terminal pins, short terminal stubs, and terminal-label placement')
    expect(prompt).toContain('Preserve terminal definitions, labels, side, order, role, and pin metadata')
    expect(prompt).toContain('Each view.networkLines entry is { label, position:{x,y}, length?, orientation? }')
    expect(prompt).toContain('view.networkLines are optional visual rails')
    expect(prompt).toContain('A candidate must contain title, summary, rationale, tradeoffs array')
  })
})
