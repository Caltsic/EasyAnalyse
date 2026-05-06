import { describe, expect, it, vi } from 'vitest'
import type { DocumentFile, ValidationReport } from '../types/document'
import { AGENT_RESPONSE_SEMANTIC_VERSION } from './agentResponse'
import { buildAgentUserPrompt, runConfiguredAgentProvider } from './agentProviderClient'
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
  it('injects relevant semantic v4 examples into the user prompt', () => {
    const prompt = buildAgentUserPrompt({ prompt: 'Design an MCU RS485 interface', includeDocumentContext: false })
    expect(prompt).toContain('Reference EasyAnalyse semantic v4 examples')
    expect(prompt).toContain('mcu-rs485-node-reference')
    expect(prompt).not.toMatch(/"wires"|"nodes"|"junction"|"signalId"/)
  })

  it('runs post-provider self-check and asks the provider to repair overlapping candidates', async () => {
    const overlapping = createDocument({ x: 10, y: 10 })
    const repaired = createDocument({ x: 10, y: 10 })
    repaired.view.devices = {
      ...repaired.view.devices,
      c1: { position: { x: 240, y: 10 }, shape: 'rectangle' },
    }

    let callCount = 0
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(async (_url, init) => {
      const requestBody = JSON.parse(init.body)
      if (callCount === 1) {
        expect(JSON.stringify(requestBody.messages)).toContain('Machine-readable self-check reports')
      }
      return new Response(JSON.stringify(body(callCount++ === 0 ? responseFor(overlapping) : responseFor(repaired))), { status: 200 })
    })

    const result = await runConfiguredAgentProvider({
      provider: { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.test/v1', models: ['deepseek-chat'], defaultModel: 'deepseek-chat' },
      modelId: 'deepseek-chat',
      apiKey: ['sk', 'unit', 'key'].join('-'),
      prompt: 'Create an RC filter',
      fetchImpl: fetchMock,
      validateDocument: () => validationOk,
      selfCheck: { enabled: true, repairOnIssues: true, maxRepairAttempts: 1 },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.response.kind).toBe('blueprints')
    if (result.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(result.response.blueprints[0].selfCheck?.ok).toBe(true)
    expect(result.repairTrace).toEqual([expect.objectContaining({ attempt: 1, ok: true })])
    expect(result.toolTrace?.some((entry) => entry.toolName === 'check_blueprint_candidate')).toBe(true)
  })
})
