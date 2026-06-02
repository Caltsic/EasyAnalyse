import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentFile, ValidationReport } from '../types/document'
import { AGENT_RESPONSE_SEMANTIC_VERSION } from './agentResponse'
import { buildAgentSystemPrompt, buildAgentThreadHistorySummary, buildAgentUserPrompt, runConfiguredAgentProvider } from './agentProviderClient'
import type { OpenAiCompatibleFetch } from './openAiCompatibleProvider'

function createDocument(position = { x: 10, y: 10 }): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: { id: `doc-${position.x}-${position.y}`, title: 'Fixture', createdAt: '2026-05-06T00:00:00.000Z', updatedAt: '2026-05-06T00:00:00.000Z' },
    devices: [
      { id: 'r1', name: 'R1', kind: 'resistor', terminals: [
        { id: 'r1-a', name: 'A', label: 'VIN', direction: 'input' },
        { id: 'r1-b', name: 'B', label: 'VOUT', direction: 'output' },
      ] },
      { id: 'c1', name: 'C1', kind: 'capacitor', terminals: [
        { id: 'c1-a', name: 'A', label: 'VOUT', direction: 'input' },
        { id: 'c1-b', name: 'B', label: 'GND', direction: 'output' },
      ] },
    ],
    view: {
      canvas: { units: 'px', grid: { enabled: true, size: 16 } },
      devices: {
        r1: { position, shape: 'rectangle' },
        c1: { position, shape: 'rectangle' },
      },
      networkLines: {},
    },
  }
}

function responseFor(document: DocumentFile) {
  return {
    schemaVersion: 'agent-response-v1',
    semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
    kind: 'blueprints',
    summary: 'candidate',
    blueprints: [{ title: 'Candidate', summary: 'summary', rationale: 'rationale', tradeoffs: [], document, issues: [] }],
  }
}

function body(content: unknown) {
  return { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }] }
}

const validationOk: ValidationReport = { detectedFormat: 'semantic-v4', schemaValid: true, semanticValid: true, issueCount: 0, issues: [] }

describe('agentProviderClient M7 self-check and examples', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('injects relevant semantic v4 examples into the user prompt', () => {
    const prompt = buildAgentUserPrompt({ prompt: 'Design an MCU RS485 interface', includeDocumentContext: false })
    expect(prompt).toContain('Reference EasyAnalyse semantic v4 examples')
    expect(prompt).toContain('mcu-rs485-node-reference')
    expect(prompt).not.toMatch(/"wires"|"nodes"|"junction"|"signalId"/)
  })

  it('system prompt explains EasyAnalyse connectivity and recoverable-format/advisory tool boundary', () => {
    const prompt = buildAgentSystemPrompt()
    expect(prompt).toContain('Connectivity is defined only by exact terminal.label equality')
    expect(prompt).toContain('check_blueprint_format reports display/openability diagnostics')
    expect(prompt).toContain('ok=false results are recoverable')
    expect(prompt).toContain('For filter requests, prefer generate_filter_blueprint')
    expect(prompt).toContain('semantic/layout issues are hints, not a requirement to reach 0 issues')
    expect(prompt).toContain('view.networkLines are optional visual rails')
    expect(prompt).toContain('layout.network-line.device-overlap')
  })

  it('injects bounded thread history summary before the current request', () => {
    const prompt = buildAgentUserPrompt({
      prompt: '继续把这个候选改成 5kHz',
      includeDocumentContext: false,
      threadMessages: [
        { id: 'u1', role: 'user', createdAt: '2026-05-20T00:00:00.000Z', content: '先做一个低通滤波器' },
        { id: 'a1', role: 'assistant', createdAt: '2026-05-20T00:00:01.000Z', content: '已经生成一个 RC 候选。' },
        { id: 't1', role: 'tool', createdAt: '2026-05-20T00:00:02.000Z', toolName: 'create_blueprint_candidate', status: 'success', summary: 'Stored candidate', blueprintIds: ['bp-1'], issueCount: 0 },
      ],
    })

    expect(prompt).toContain('Recent conversation summary for this Agent thread')
    expect(prompt).toContain('先做一个低通滤波器')
    expect(prompt).toContain('Tool create_blueprint_candidate [success]')
    expect(prompt.indexOf('Recent conversation summary')).toBeLessThan(prompt.indexOf('Current user request'))
    expect(prompt).toContain('继续把这个候选改成 5kHz')
  })

  it('redacts and truncates thread history summaries', () => {
    const summary = buildAgentThreadHistorySummary([
      { id: 'u1', role: 'user', createdAt: 'now', content: `apiKey=sk-secret-value ${'x'.repeat(400)}` },
    ], { maxContentChars: 120, maxChars: 200 })

    expect(summary).toContain('[redacted')
    expect(summary).not.toContain('sk-secret-value')
    expect(summary.length).toBeLessThanOrEqual(220)
  })

  it('runs post-provider self-check without repairing advisory-only layout candidates', async () => {
    const overlapping = createDocument({ x: 10, y: 10 })
    const repaired = createDocument({ x: 10, y: 10 })
    repaired.view.devices = {
      ...repaired.view.devices,
      c1: { position: { x: 240, y: 10 }, shape: 'rectangle' },
    }

    let callCount = 0
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(async (_url, init) => {
      const requestBody = JSON.parse(init.body)
      expect(JSON.stringify(requestBody.messages)).not.toContain('Machine-readable self-check reports')
      return new Response(JSON.stringify(body(callCount++ === 0 ? responseFor(overlapping) : responseFor(repaired))), { status: 200 })
    })
    const progress = vi.fn()

    const result = await runConfiguredAgentProvider({
      provider: { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.test/v1', models: ['deepseek-chat'], defaultModel: 'deepseek-chat' },
      modelId: 'deepseek-chat',
      apiKey: ['sk', 'unit', 'key'].join('-'),
      prompt: 'Create an RC filter',
      fetchImpl: fetchMock,
      validateDocument: () => validationOk,
      progress,
      selfCheck: { enabled: true, repairOnIssues: true, maxRepairAttempts: 1 },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.response.kind).toBe('blueprints')
    if (result.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(result.response.blueprints[0].selfCheck?.ok).toBe(false)
    expect(result.response.blueprints[0].toolIssues?.map((issue) => issue.code)).toContain('layout.device.overlap')
    expect(result.repairTrace).toBeUndefined()
    expect(result.toolTrace?.some((entry) => entry.toolName === 'check_blueprint_candidate')).toBe(true)
    expect(progress.mock.calls.map(([event]) => event.message)).toEqual(expect.arrayContaining([
      'Built provider prompt.',
      'Provider context budget check passed.',
      'Running local blueprint self-check.',
      'Agent provider run completed.',
    ]))
    expect(progress.mock.calls.map(([event]) => event.message)).not.toContain('Requesting self-check repair attempt 1.')
  })

  it('preserves simulation artifacts across self-check repair attempts', async () => {
    const initial = responseFor(createDocument({ x: 10, y: 10 }))
    const initialCandidateWithSimulation = {
      ...initial.blueprints[0],
      simulation: {
        schemaVersion: 'easyanalyse-simulation-v1',
        manifest: {
          schemaVersion: 'easyanalyse-simulation-v1',
          name: 'RC low-pass frequency response',
        },
        workerScript: 'function run() { return { points: [{ frequencyHz: 5000, magnitudeDb: -3 }] }; }',
        defaultInput: { parameters: { cutoffFrequencyHz: 5000 } },
      },
    }
    initial.blueprints[0] = initialCandidateWithSimulation as typeof initial.blueprints[number]
    const repaired = responseFor(createDocument({ x: 320, y: 10 }))

    let callCount = 0
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(async (_url, init) => {
      const requestBody = JSON.parse(init.body)
      if (callCount === 1) {
        expect(JSON.stringify(requestBody.messages)).toContain('Machine-readable self-check reports')
      }
      return new Response(JSON.stringify(body(callCount++ === 0 ? initial : repaired)), { status: 200 })
    })
    const hardValidationIssue = {
      severity: 'error' as const,
      code: 'schema.test-hard-format',
      message: 'Synthetic hard format issue.',
      entityId: null,
      path: 'devices[0].name',
    }

    const result = await runConfiguredAgentProvider({
      provider: { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.test/v1', models: ['deepseek-chat'], defaultModel: 'deepseek-chat' },
      modelId: 'deepseek-chat',
      apiKey: ['sk', 'unit', 'key'].join('-'),
      prompt: 'Create an RC filter with simulation',
      fetchImpl: fetchMock,
      validateDocument: () => ({ ...validationOk, semanticValid: false, issueCount: 1, issues: [hardValidationIssue] }),
      selfCheck: { enabled: true, repairOnIssues: true, maxRepairAttempts: 1 },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.response.kind).toBe('blueprints')
    if (result.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(result.response.blueprints[0].simulation).toMatchObject({
      schemaVersion: 'easyanalyse-simulation-v1',
      manifest: { name: 'RC low-pass frequency response' },
    })
    expect(result.repairTrace?.[0]?.attempt).toBe(1)
  })

  it('keeps the last usable blueprints when a self-check repair attempt fails', async () => {
    const initial = responseFor(createDocument({ x: 10, y: 10 }))
    let callCount = 0
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(async () => {
      callCount += 1
      if (callCount === 1) {
        return new Response(JSON.stringify(body(initial)), { status: 200 })
      }
      return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const hardValidationIssue = {
      severity: 'error' as const,
      code: 'schema.test-hard-format',
      message: 'Synthetic hard format issue.',
      entityId: null,
      path: 'devices[0].name',
    }

    const result = await runConfiguredAgentProvider({
      provider: { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.test/v1', models: ['deepseek-chat'], defaultModel: 'deepseek-chat' },
      modelId: 'deepseek-chat',
      apiKey: ['sk', 'unit', 'key'].join('-'),
      prompt: 'Create an RC filter with simulation',
      fetchImpl: fetchMock,
      validateDocument: () => ({ ...validationOk, semanticValid: false, issueCount: 1, issues: [hardValidationIssue] }),
      selfCheck: { enabled: true, repairOnIssues: true, maxRepairAttempts: 1 },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.response.kind).toBe('blueprints')
    expect(result.repairTrace?.[0]?.ok).toBe(false)
    expect(result.repairTrace?.[0]?.summary).toContain('keeping the last usable provider result')
  })

  it('falls back to the deterministic filter tool when an explicit filter request gets unusable provider content', async () => {
    const candidate = {
      ...responseFor(createDocument({ x: 120, y: 10 })).blueprints[0],
      simulation: {
        schemaVersion: 'easyanalyse-simulation-v1' as const,
        manifest: {
          schemaVersion: 'easyanalyse-simulation-v1' as const,
          name: 'RC low-pass frequency response',
        },
        workerScript: 'function run() { return { points: [{ frequencyHz: 5000, magnitudeDb: -3 }] }; }',
        defaultInput: { parameters: { cutoffFrequencyHz: 5000 } },
      },
    }
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(
      async () => new Response('{ "broken": ', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const toolExecutor = vi.fn(async () => ({
      schemaVersion: 'agent-tool-result-v1' as const,
      semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
      ok: true,
      toolName: 'generate_filter_blueprint' as const,
      summary: 'Filter blueprint candidate generated.',
      issueCount: 0,
      issues: [],
      data: { candidate },
    }))
    const progress = vi.fn()

    const result = await runConfiguredAgentProvider({
      provider: { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.test/v1', models: ['deepseek-v4-flash'], defaultModel: 'deepseek-v4-flash' },
      modelId: 'deepseek-v4-flash',
      apiKey: ['sk', 'unit', 'key'].join('-'),
      prompt: '请使用generate_filter_blueprint工具生成一个一阶RC低通滤波器蓝图，截止频率5kHz，并保留工具返回的blueprints[0].simulation仿真卡。只返回一个候选。',
      fetchImpl: fetchMock,
      toolExecutor,
      validateDocument: () => validationOk,
      progress,
      selfCheck: { enabled: false, repairOnIssues: false, maxRepairAttempts: 0 },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(toolExecutor).toHaveBeenCalledWith(
      'generate_filter_blueprint',
      expect.objectContaining({
        filterType: 'lowpass',
        topology: 'passive-rc',
        cutoffFrequencyHz: 5000,
      }),
      expect.anything(),
    )
    expect(result.response.kind).toBe('blueprints')
    expect(result.metadata.responseId).toBe('easyanalyse-configured-filter-fallback')
    expect(result.toolTrace).toEqual([expect.objectContaining({ toolName: 'generate_filter_blueprint', ok: true })])
    expect(progress.mock.calls.map(([event]) => event.message)).toContain(
      'Provider response was not usable; running tool generate_filter_blueprint from inferred filter parameters.',
    )
  })

  it('does not impose a default timeout on long provider runs', async () => {
    vi.useFakeTimers()
    const document = createDocument({ x: 240, y: 10 })
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(new Response(JSON.stringify(body(responseFor(document))), { status: 200 }))
          }, 300_001)
        }),
    )

    const run = runConfiguredAgentProvider({
      provider: { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.test/v1', models: ['deepseek-chat'], defaultModel: 'deepseek-chat' },
      modelId: 'deepseek-chat',
      apiKey: ['sk', 'unit', 'key'].join('-'),
      prompt: 'Create a long-running blueprint',
      fetchImpl: fetchMock,
      selfCheck: { enabled: false, repairOnIssues: false, maxRepairAttempts: 0 },
    })
    const observed = vi.fn()
    void run.then(
      () => observed('resolved'),
      (error: unknown) => observed(error),
    )

    await vi.advanceTimersByTimeAsync(300_000)
    await Promise.resolve()
    expect(observed).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(run).resolves.toMatchObject({ response: expect.objectContaining({ kind: 'blueprints' }) })
  })

  it('retains malformed blueprint candidates without crashing local self-check sorting', async () => {
    const malformedDocument = {
      schemaVersion: '4.0.0',
      document: { id: 'malformed-agent-doc', title: 'Malformed agent document' },
      devices: [
        {
          id: 'r1',
          kind: 'resistor',
          terminals: [
            { id: 'r1-a', label: 'VIN', direction: 'input' },
            { id: 'r1-b', label: 'VOUT', direction: 'output' },
          ],
        },
        {
          id: 'led1',
          name: 'LED1',
          kind: 'led',
          terminals: [
            { id: 'led1-a', name: 'A', label: 'VOUT', direction: 'input' },
            { id: 'led1-k', label: 'GND', direction: 'output' },
          ],
        },
      ],
      view: {
        canvas: { units: 'px' },
        devices: {
          r1: { position: { x: 10, y: 10 }, shape: 'rectangle' },
          led1: { position: { x: 260, y: 10 }, shape: 'rectangle' },
        },
        networkLines: {
          vin: { position: { x: 0, y: 10 } },
        },
      },
    } as unknown as DocumentFile
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(async () =>
      new Response(JSON.stringify(body(responseFor(malformedDocument))), { status: 200 }),
    )

    const result = await runConfiguredAgentProvider({
      provider: { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.test/v1', models: ['deepseek-chat'], defaultModel: 'deepseek-chat' },
      modelId: 'deepseek-chat',
      apiKey: ['sk', 'unit', 'key'].join('-'),
      prompt: 'Return a malformed candidate',
      fetchImpl: fetchMock,
      validateDocument: () => validationOk,
      selfCheck: { enabled: true, repairOnIssues: false, maxRepairAttempts: 0 },
    })

    expect(result.response.kind).toBe('blueprints')
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'missing-device-name',
      'missing-terminal-name',
    ]))
    expect(result.toolTrace?.some((entry) => entry.toolName === 'check_blueprint_candidate')).toBe(true)
  })
})
