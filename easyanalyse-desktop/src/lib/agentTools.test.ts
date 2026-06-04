import { describe, expect, it, vi } from 'vitest'
import { runAgentTool, getAgentToolSchemas, selfCheckBlueprintCandidates } from './agentTools'
import type { DocumentFile, ValidationReport } from '../types/document'
import type { AgentBlueprintCandidate } from '../types/agent'
import type { AgentCircuitCorrectnessReviewReport } from '../types/agentTools'
import type { BlueprintWorkspaceFile } from '../types/blueprint'

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
  it('exposes hard-format, creation, context, and advisory OpenAI-compatible tool schemas', () => {
    const schemas = getAgentToolSchemas()
    expect(schemas.map((schema) => schema.function.name)).toEqual([
      'get_current_document',
      'get_blueprint_workspace',
      'get_blueprint_candidate',
      'compare_blueprint_candidate',
      'get_current_selection',
      'summarize_topology',
      'get_easyanalyse_format_rules',
      'generate_filter_blueprint',
      'check_document_format',
      'check_blueprint_format',
      'create_blueprint_candidate',
      'validate_document',
      'check_layout_overlaps',
      'review_circuit_correctness',
      'check_blueprint_candidate',
    ])
    expect(JSON.stringify(schemas)).toContain('Hard-check one EasyAnalyse DocumentFile candidate')
    expect(JSON.stringify(schemas)).toContain('issueCount>0 is not a hard finalization gate by itself')
    expect(JSON.stringify(schemas)).toContain('wires, nodes, junctions')
    expect(JSON.stringify(schemas)).toContain('visual network lines crossing device bounds')
    expect(JSON.stringify(schemas)).toContain('Return the current blueprint workspace summary')
    expect(JSON.stringify(schemas)).toContain('deterministic filter blueprint candidate')
    expect(JSON.stringify(schemas)).toContain('strict EasyAnalyse circuit correctness reviewer')
    expect(JSON.stringify(schemas)).not.toMatch(/Authorization|apiKey|sk-/i)
  })

  it('generates a deterministic filter blueprint candidate without mutating the main document', async () => {
    const mainDocument = documentAt()
    const validateDocument = vi.fn((document: DocumentFile) => validReport(document))
    const result = await runAgentTool(
      'generate_filter_blueprint',
      { filterType: 'lowpass', topology: 'auto', cutoffFrequencyHz: 5000, q: 1 },
      { currentDocument: mainDocument, validateDocument },
    )

    expect(result).toMatchObject({ ok: true, toolName: 'generate_filter_blueprint', issueCount: 0 })
    const data = result.data as {
      candidate: AgentBlueprintCandidate
      calculatedValues: Record<string, number | string>
      assumptions: string[]
    }
    expect(data.candidate.title).toContain('Sallen-Key low-pass')
    expect(data.candidate.document.schemaVersion).toBe('4.0.0')
    expect(data.candidate.document.devices.map((device) => device.id)).toEqual(expect.arrayContaining(['r1', 'r2', 'c1', 'c2', 'u1']))
    expect(data.candidate.document.devices.flatMap((device) => device.terminals.map((terminal) => terminal.label))).toEqual(expect.arrayContaining(['VIN', 'VOUT', 'GND', 'SK_N1', 'SK_N2']))
    expect(data.calculatedValues.topology).toBe('sallen-key')
    expect(data.assumptions.join(' ')).toContain('Sallen-Key')
    expect(mainDocument.document.title).toBe('Tool test')
    expect(validateDocument).toHaveBeenCalledTimes(1)
  })

  it('returns detailed errors for invalid filter blueprint arguments', async () => {
    const result = await runAgentTool('generate_filter_blueprint', { filterType: 'bandstop', topology: 'sallen-key', cutoffFrequencyHz: -1 })

    expect(result.ok).toBe(false)
    expect(result.toolName).toBe('generate_filter_blueprint')
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'filterType', message: expect.stringContaining('filterType') }),
      expect.objectContaining({ path: 'cutoffFrequencyHz', message: expect.stringContaining('cutoffFrequencyHz') }),
    ]))
    expect(result.data).toMatchObject({ candidate: null, format: null })
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
    expect(unknown.toolName).toBe('check_blueprint_format')
  })

  it('reviews circuit correctness through an injected strict reviewer callback', async () => {
    const candidate: AgentBlueprintCandidate = {
      title: 'RC candidate',
      summary: 'Candidate summary',
      rationale: 'Candidate rationale',
      tradeoffs: [],
      document: documentAt(),
      issues: [],
    }
    const reviewerReport: AgentCircuitCorrectnessReviewReport = {
      schemaVersion: 'agent-circuit-correctness-review-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      verdict: 'fail',
      confidence: 0.82,
      summary: 'The requested low-pass function is not proven by this topology.',
      reasons: ['The capacitor is not connected as a shunt filter element.'],
      suggestions: ['Move the capacitor from VOUT to GND for a first-order low-pass.'],
      checkedAssumptions: ['Connectivity is terminal-label based.'],
      reviewer: { providerId: 'reviewer', modelId: 'strict-model' },
    }
    const reviewCircuitCorrectness = vi.fn(async () => reviewerReport)

    const result = await runAgentTool('review_circuit_correctness', {
      candidate,
      userRequest: 'Build an RC low-pass filter.',
    }, {
      userRequest: 'Build an RC low-pass filter.',
      validateDocument: () => validReport(candidate.document),
      reviewCircuitCorrectness,
    })

    expect(reviewCircuitCorrectness).toHaveBeenCalledWith(expect.objectContaining({
      userRequest: 'Build an RC low-pass filter.',
      candidateTitle: 'RC candidate',
      document: candidate.document,
    }))
    expect(result).toMatchObject({
      ok: true,
      toolName: 'review_circuit_correctness',
      issueCount: 1,
      data: {
        reviewed: true,
        report: { verdict: 'fail', confidence: 0.82 },
      },
    })
  })

  it('skips strict correctness review until hard format issues are fixed', async () => {
    const malformed = {
      title: 'Broken candidate',
      summary: 'Broken',
      rationale: 'Broken',
      tradeoffs: [],
      document: { ...documentAt(), wires: [] },
      issues: [],
    }
    const reviewCircuitCorrectness = vi.fn()

    const result = await runAgentTool('review_circuit_correctness', { candidate: malformed }, {
      validateDocument: () => validReport(documentAt()),
      reviewCircuitCorrectness,
    })

    expect(reviewCircuitCorrectness).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      toolName: 'review_circuit_correctness',
      data: { reviewed: false, report: { verdict: 'unknown' } },
    })
    expect(result.issues.map((issue) => issue.code)).toContain('format.unknown_field')
  })

  it('check_document_format treats schema/openability errors as hard failures but ignores semantic issues', async () => {
    const semanticIssue = { severity: 'error' as const, code: 'semantic.device.name', message: 'semantic only', entityId: 'a', path: 'devices[0].name' }
    const result = await runAgentTool('check_document_format', { document: documentAt() }, {
      validateDocument: () => ({
        detectedFormat: 'semantic-v4',
        schemaValid: true,
        semanticValid: false,
        issueCount: 1,
        issues: [semanticIssue],
        normalizedDocument: documentAt(),
      }),
    })
    expect(result).toMatchObject({ ok: true, toolName: 'check_document_format', issueCount: 0 })

    const malformed = await runAgentTool('check_document_format', { document: { ...documentAt(), wires: [] } }, { validateDocument: () => validReport(documentAt()) })
    expect(malformed).toMatchObject({ ok: false, toolName: 'check_document_format' })
    expect(malformed.issues.map((issue) => issue.code)).toContain('format.unknown_field')
    expect(malformed.issues[0]?.details).toMatchObject({
      field: 'wires',
      fix: expect.stringContaining('Remove this old topology field'),
    })
  })

  it('returns detailed hard-format diagnostics for missing required fields and invalid enum values', async () => {
    const malformed = structuredClone(documentAt()) as unknown as Record<string, unknown>
    const devices = malformed.devices as Array<Record<string, unknown>>
    delete devices[0]!.name
    devices[0]!.terminals = [{ id: 'a-1', direction: 'passive' }]
    const result = await runAgentTool('check_document_format', { document: malformed }, { validateDocument: () => validReport(documentAt()) })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'devices[0].name',
        details: expect.objectContaining({
          expected: 'non-empty string',
          actualType: 'undefined',
          fix: expect.stringContaining('device name'),
        }),
      }),
      expect.objectContaining({
        path: 'devices[0].terminals[0].direction',
        details: expect.objectContaining({
          expected: '"input" | "output"',
          actualSummary: '"passive"',
          fix: expect.stringContaining('do not use passive'),
        }),
      }),
    ]))
  })

  it('exposes blueprint workspace, selected candidate, diff, selection, and topology as read-only tools', async () => {
    const current = documentAt(0, 0)
    const candidateDocument = documentAt(300, 0)
    candidateDocument.document.id = 'doc-candidate'
    candidateDocument.document.title = 'Candidate document'
    const workspace: BlueprintWorkspaceFile = {
      blueprintWorkspaceVersion: '1.0.0',
      workspaceId: 'workspace-1',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:01:00.000Z',
      mainDocument: { documentId: current.document.id, hash: 'hash-main', hashAlgorithm: 'easyanalyse-document-canonical-sha256-v1' },
      blueprints: [{
        id: 'bp-1',
        title: 'Candidate one',
        lifecycleStatus: 'active',
        validationState: 'valid',
        document: candidateDocument,
        documentHash: 'hash-bp',
        baseMainDocumentHash: 'hash-main',
        source: 'agent',
        createdAt: '2026-05-20T00:00:30.000Z',
        updatedAt: '2026-05-20T00:00:30.000Z',
      }],
    }
    const context = {
      currentDocument: current,
      blueprintWorkspace: workspace,
      selectedBlueprintId: 'bp-1',
      currentSelection: { entityType: 'device' as const, id: 'a' },
      getEditorFocus: () => ({ focusedDeviceId: 'a', focusedLabelKey: null, focusedNetworkLineId: null }),
    }

    const workspaceResult = await runAgentTool('get_blueprint_workspace', {}, context)
    expect(workspaceResult).toMatchObject({ ok: true, toolName: 'get_blueprint_workspace' })
    expect(JSON.stringify(workspaceResult.data)).not.toContain('"schemaVersion":"4.0.0"')

    const candidateResult = await runAgentTool('get_blueprint_candidate', {}, context)
    expect(candidateResult).toMatchObject({
      ok: true,
      data: {
        selectedBlueprintId: 'bp-1',
        found: true,
        blueprint: {
          id: 'bp-1',
          document: expect.objectContaining({ schemaVersion: '4.0.0' }),
        },
      },
    })

    const diffResult = await runAgentTool('compare_blueprint_candidate', {}, context)
    expect(diffResult).toMatchObject({
      ok: true,
      data: {
        found: true,
        hasCurrentDocument: true,
        diff: expect.objectContaining({ hasChanges: true }),
      },
    })

    const selectionResult = await runAgentTool('get_current_selection', {}, context)
    expect(selectionResult).toMatchObject({
      ok: true,
      data: {
        selection: { entityType: 'device', id: 'a' },
        focus: { focusedDeviceId: 'a' },
        selectedBlueprintId: 'bp-1',
      },
    })

    const topologyResult = await runAgentTool('summarize_topology', { source: 'selected_blueprint' }, context)
    expect(topologyResult).toMatchObject({
      ok: true,
      data: {
        source: 'selected_blueprint',
        blueprintId: 'bp-1',
        documentSummary: { id: 'doc-candidate', deviceCount: 2 },
      },
    })
    const topologyData = topologyResult.data as { devices: Array<{ id: string; bounds: { x: number; y: number } }> }
    expect(topologyData.devices.map((device) => device.id).sort()).toEqual(['a', 'b'])
  })

  it('create_blueprint_candidate gates storage on hard format and uses injected callback after a pass', async () => {
    const createBlueprintCandidate = vi.fn(async (candidate: AgentBlueprintCandidate) => {
      void candidate
      return { id: 'bp-1' }
    })
    const invalid = await runAgentTool(
      'create_blueprint_candidate',
      { candidate: { title: 'C', summary: 'S', rationale: 'R', tradeoffs: [], document: { ...documentAt(), schemaVersion: '3.0.0' }, issues: [] } },
      { validateDocument: () => validReport(documentAt()), createBlueprintCandidate },
    )
    expect(invalid.ok).toBe(false)
    expect(createBlueprintCandidate).not.toHaveBeenCalled()

    const candidate: AgentBlueprintCandidate = { title: 'C', summary: 'S', rationale: 'R', tradeoffs: [], document: documentAt(300, 0), issues: [] }
    const created = await runAgentTool('create_blueprint_candidate', { candidate }, {
      validateDocument: () => validReport(candidate.document),
      createBlueprintCandidate,
    })
    expect(created).toMatchObject({ ok: true, toolName: 'create_blueprint_candidate', data: { created: true, result: { id: 'bp-1' } } })
    expect(createBlueprintCandidate).toHaveBeenCalledTimes(1)
    expect(createBlueprintCandidate.mock.calls[0]![0]).toEqual(candidate)
  })

  it('surfaces runtime rejections from create_blueprint_candidate without storing', async () => {
    const candidate: AgentBlueprintCandidate = { title: 'C', summary: 'S', rationale: 'R', tradeoffs: [], document: documentAt(300, 0), issues: [] }
    const rejected = await runAgentTool('create_blueprint_candidate', { candidate }, {
      validateDocument: () => validReport(candidate.document),
      createBlueprintCandidate: () => ({
        ok: false,
        code: 'agent_tool.stale_context',
        message: 'Current document changed while the agent was creating a blueprint candidate.',
      }),
    })
    expect(rejected).toMatchObject({
      ok: false,
      toolName: 'create_blueprint_candidate',
      issues: [expect.objectContaining({ code: 'agent_tool.stale_context' })],
      data: { created: false },
    })
  })

  it('check_blueprint_candidate combines validation and layout and does not mutate candidate', async () => {
    const candidate: AgentBlueprintCandidate = { title: 'C', summary: 'S', rationale: 'R', tradeoffs: [], document: documentAt(), issues: [] }
    const before = structuredClone(candidate)
    const result = await runAgentTool('check_blueprint_candidate', { candidate }, { validateDocument: () => validReport(candidate.document) })
    expect(candidate).toEqual(before)
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toMatchObject({
      code: 'layout.device.overlap',
      details: {
        leftDeviceId: 'a',
        rightDeviceId: 'b',
        overlapWidth: 100,
        overlapHeight: 100,
      },
    })
    const data = result.data as { selfCheck: { candidates: Array<{ title?: string; validation: { ok: boolean }; layout: { ok: boolean; issueCount: number } }> } }
    expect(data.selfCheck.candidates[0]).toMatchObject({ title: 'C', validation: { ok: true }, layout: { ok: false, issueCount: 1 } })
  })

  it('selfCheckBlueprintCandidates returns metadata-ready reports for each candidate', async () => {
    const reports = await selfCheckBlueprintCandidates([{ title: 'C', summary: 'S', rationale: 'R', tradeoffs: [], document: documentAt(300, 0), issues: [] }], { validateDocument: () => validReport(documentAt(300, 0)) })
    expect(reports).toHaveLength(1)
    expect(reports[0]!.schemaVersion).toBe('agent-self-check-v1')
  })
})
