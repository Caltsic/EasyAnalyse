import { describe, expect, it, vi } from 'vitest'
import { parseCircuitCorrectnessReviewReport, runCircuitCorrectnessReviewer } from './agentCircuitReviewer'
import type { DocumentFile } from '../types/document'
import type { AgentProviderPublicConfig } from '../types/settings'

function document(): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: { id: 'doc-review', title: 'Review document' },
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
      {
        id: 'c1',
        name: 'C1',
        kind: 'capacitor',
        terminals: [
          { id: 'c1-a', name: 'A', direction: 'input', label: 'VOUT' },
          { id: 'c1-b', name: 'B', direction: 'output', label: 'GND' },
        ],
      },
    ],
    view: { canvas: { units: 'px' }, devices: {}, networkLines: {} },
  }
}

function provider(overrides: Partial<AgentProviderPublicConfig> = {}): AgentProviderPublicConfig {
  return {
    id: 'reviewer',
    name: 'Reviewer',
    kind: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    models: ['strict-model'],
    defaultModel: 'strict-model',
    apiKeyRef: 'secret-ref:reviewer',
    ...overrides,
  }
}

describe('agentCircuitReviewer', () => {
  it('parses strict reviewer JSON reports and clamps confidence', () => {
    const report = parseCircuitCorrectnessReviewReport(JSON.stringify({
      verdict: 'warning',
      confidence: 3,
      summary: 'Mostly plausible.',
      reasons: ['Requires tolerance review.'],
      suggestions: ['Check op-amp bandwidth.'],
      checkedAssumptions: ['Ideal op-amp.'],
    }), { providerId: 'p', modelId: 'm' })

    expect(report).toEqual({
      schemaVersion: 'agent-circuit-correctness-review-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      verdict: 'warning',
      confidence: 1,
      summary: 'Mostly plausible.',
      reasons: ['Requires tolerance review.'],
      suggestions: ['Check op-amp bandwidth.'],
      checkedAssumptions: ['Ideal op-amp.'],
      reviewer: { providerId: 'p', modelId: 'm' },
    })
  })

  it('returns unknown report for invalid reviewer output without leaking secrets', () => {
    const apiKey = ['sk', 'secret', 'reviewer'].join('-')
    const report = parseCircuitCorrectnessReviewReport(`not json ${apiKey}`, {
      providerId: 'p',
      modelId: 'm',
      redactions: [apiKey],
    })

    expect(report.verdict).toBe('unknown')
    expect(JSON.stringify(report)).not.toContain(apiKey)
  })

  it('calls OpenAI-compatible reviewer without tool access', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>
      expect(body).not.toHaveProperty('tools')
      expect(body).not.toHaveProperty('tool_choice')
      expect(body).toMatchObject({ model: 'strict-model', response_format: { type: 'json_object' } })
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'pass',
                confidence: 0.9,
                summary: 'The RC low-pass topology is valid.',
                reasons: ['R is series and C shunts VOUT to GND.'],
                suggestions: [],
                checkedAssumptions: ['Load is high impedance.'],
              }),
            },
          },
        ],
      }), { status: 200 })
    })

    const report = await runCircuitCorrectnessReviewer({
      provider: provider(),
      modelId: 'strict-model',
      apiKey: 'test-key',
      userRequest: 'Make an RC low-pass filter.',
      document: document(),
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(report.verdict).toBe('pass')
  })
})
