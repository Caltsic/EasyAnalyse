import { describe, expect, it, vi } from 'vitest'
import { runAgentTool, getAgentToolSchemas, selfCheckBlueprintCandidates } from './agentTools'
import type { DocumentFile, ValidationReport } from '../types/document'
import type { AgentBlueprintCandidate } from '../types/agent'

function documentAt(x = 0, y = 0): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: { id: 'doc-1', title: 'Tool test' },
    devices: [
      { id: 'a', name: 'A', kind: 'resistor', terminals: [] },
      { id: 'b', name: 'B', kind: 'capacitor', terminals: [] },
    ],
    view: {
      canvas: { units: 'px' },
      devices: { a: { position: { x, y }, size: { width: 100, height: 100 } }, b: { position: { x: x + 50, y }, size: { width: 100, height: 100 } } },
      networkLines: {},
    },
  }
}

function validReport(document = documentAt()): ValidationReport {
  return { detectedFormat: 'semantic-v4', schemaValid: true, semanticValid: true, issueCount: 0, issues: [], normalizedDocument: document }
}

describe('agentTools', () => {
  it('exposes only read-only OpenAI-compatible tool schema for check_blueprint_candidate', () => {
    const schemas = getAgentToolSchemas()
    expect(schemas).toHaveLength(1)
    expect(schemas[0]!.function.name).toBe('check_blueprint_candidate')
    expect(JSON.stringify(schemas)).toContain('wires/nodes/junctions/signalId')
    expect(JSON.stringify(schemas)).not.toMatch(/Authorization|apiKey|sk-/i)
  })

  it('validate_document calls injected validator and returns stable tool result', async () => {
    const validateDocument = vi.fn(async () => validReport())
    const result = await runAgentTool('validate_document', { document: documentAt() }, { validateDocument })
    expect(validateDocument).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ schemaVersion: 'agent-tool-result-v1', ok: true, toolName: 'validate_document', issueCount: 0 })
  })

  it('returns ok=false for malformed args and unknown tools without leaking secret-shaped content', async () => {
    const malformed = await runAgentTool('check_blueprint_candidate', { apiKey: ['sk', 'bad'].join('-'), Authorization: 'Bearer secret' })
    expect(malformed.ok).toBe(false)
    expect(JSON.stringify(malformed)).not.toMatch(/sk-|Authorization|Bearer|apiKey/)
    const unknown = await runAgentTool('unknown_tool', { document: documentAt() })
    expect(unknown.ok).toBe(false)
    expect(unknown.toolName).toBe('check_blueprint_candidate')
  })

  it('check_blueprint_candidate combines validation and layout and does not mutate candidate', async () => {
    const candidate: AgentBlueprintCandidate = { title: 'C', summary: 'S', rationale: 'R', tradeoffs: [], document: documentAt(), issues: [] }
    const before = structuredClone(candidate)
    const result = await runAgentTool('check_blueprint_candidate', { candidate }, { validateDocument: () => validReport(candidate.document) })
    expect(candidate).toEqual(before)
    expect(result.ok).toBe(false)
    const data = result.data as { selfCheck: { candidates: Array<{ title?: string; validation: { ok: boolean }; layout: { ok: boolean; issueCount: number } }> } }
    expect(data.selfCheck.candidates[0]).toMatchObject({ title: 'C', validation: { ok: true }, layout: { ok: false, issueCount: 1 } })
  })

  it('selfCheckBlueprintCandidates returns metadata-ready reports for each candidate', async () => {
    const reports = await selfCheckBlueprintCandidates([{ title: 'C', summary: 'S', rationale: 'R', tradeoffs: [], document: documentAt(300, 0), issues: [] }], { validateDocument: () => validReport(documentAt(300, 0)) })
    expect(reports).toHaveLength(1)
    expect(reports[0]!.schemaVersion).toBe('agent-self-check-v1')
  })
})
