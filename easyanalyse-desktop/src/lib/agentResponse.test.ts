import { describe, expect, it } from 'vitest'
import type { AgentBlueprintCandidate } from '../types/agent'
import type { DocumentFile } from '../types/document'
import { parseAgentResponse } from './agentResponse'

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-1',
      title: 'Reference circuit',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T01:00:00.000Z',
      tags: ['demo'],
    },
    devices: [
      {
        id: 'r1',
        name: 'R1',
        kind: 'resistor',
        terminals: [
          { id: 'r1-a', name: 'A', label: 'VIN', direction: 'input' },
          { id: 'r1-b', name: 'B', label: 'VOUT', direction: 'output' },
        ],
      },
    ],
    view: {
      canvas: { units: 'px', grid: { enabled: true, size: 16 } },
      devices: { r1: { position: { x: 10, y: 20 }, shape: 'rectangle' } },
      networkLines: { vin: { label: 'VIN', position: { x: 0, y: 20 } } },
    },
    ...overrides,
  }
}

describe('parseAgentResponse', () => {
  it('parses a valid message response from a JSON string and normalizes base fields', () => {
    const parsed = parseAgentResponse(
      JSON.stringify({
        schemaVersion: 'agent-response-v1',
        semanticVersion: '1.0.0',
        kind: 'message',
        requestId: 'req-1',
        summary: 'Short answer',
        warnings: ['check values'],
        capabilities: ['message', 'blueprints'],
        markdown: '**Hello**',
      }),
    )

    expect(parsed.ok).toBe(true)
    expect(parsed.response).toMatchObject({
      schemaVersion: 'agent-response-v1',
      semanticVersion: '1.0.0',
      kind: 'message',
      requestId: 'req-1',
      summary: 'Short answer',
      warnings: ['check values'],
      capabilities: { message: true, blueprints: true },
      markdown: '**Hello**',
    })
    expect(parsed.issues).toEqual([])
  })

  it('parses valid blueprints and deep-clones retained candidate documents', () => {
    const sourceDocument = createDocument()
    const parsed = parseAgentResponse({
      schemaVersion: 'agent-response-v1',
      kind: 'blueprints',
      summary: 'Two safer options',
      capabilities: { blueprints: true, patch: false },
      blueprints: [
        {
          title: 'Option A',
          summary: 'A safer divider',
          rationale: 'Keeps current topology simple',
          tradeoffs: ['More components'],
          highlightedLabels: ['VIN'],
          notes: ['Review resistor power rating'],
          document: sourceDocument,
        },
      ],
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.response.kind).toBe('blueprints')
    if (parsed.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(parsed.response.capabilities).toEqual({ blueprints: true, patch: false })
    expect(parsed.response.blueprints).toHaveLength(1)
    expect(parsed.response.blueprints[0].document).toEqual(sourceDocument)
    expect(parsed.response.blueprints[0].document).not.toBe(sourceDocument)
    expect(parsed.response.blueprints[0].issues).toEqual([])
  })

  it('treats candidate notes as optional in provider payloads and the public type', () => {
    const sourceDocument = createDocument()
    const parsed = parseAgentResponse({
      schemaVersion: 'agent-response-v1',
      kind: 'blueprints',
      summary: 'One option',
      blueprints: [
        {
          title: 'Option without notes',
          summary: 'Notes are omitted by the provider',
          rationale: 'AgentResponse v1 defines notes as optional',
          tradeoffs: [],
          document: sourceDocument,
        },
      ],
    })

    const candidateWithoutNotes: AgentBlueprintCandidate = {
      title: 'Type-level candidate without notes',
      summary: 'Consumers should not have to provide notes',
      rationale: 'The provider protocol declares notes?: string[]',
      tradeoffs: [],
      document: sourceDocument,
      issues: [],
    }

    expect(candidateWithoutNotes.notes).toBeUndefined()
    expect(parsed.ok).toBe(true)
    expect(parsed.response.kind).toBe('blueprints')
    if (parsed.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(parsed.response.blueprints[0].notes).toEqual([])
  })

  it('parses question and error responses', () => {
    expect(
      parseAgentResponse({
        schemaVersion: 'agent-response-v1',
        kind: 'question',
        question: 'Which rail should be optimized?',
        options: ['VIN', 'VOUT'],
      }).response,
    ).toMatchObject({ kind: 'question', question: 'Which rail should be optimized?', options: ['VIN', 'VOUT'] })

    expect(
      parseAgentResponse({
        schemaVersion: 'agent-response-v1',
        kind: 'error',
        message: 'Unable to infer load current.',
        recoverable: true,
      }).response,
    ).toMatchObject({ kind: 'error', message: 'Unable to infer load current.', recoverable: true })
  })

  it('rejects unknown schemaVersion with a readable error', () => {
    expect(() =>
      parseAgentResponse({ schemaVersion: 'agent-response-v0', kind: 'message', markdown: 'hello' }),
    ).toThrow(/schemaVersion.*agent-response-v1/i)
  })

  it('rejects unknown kind with a readable error', () => {
    expect(() =>
      parseAgentResponse({ schemaVersion: 'agent-response-v1', kind: 'telepathy', markdown: 'hello' }),
    ).toThrow(/kind.*message.*blueprints.*question.*error.*patch/i)
  })

  it('normalizes capabilities from arrays and objects without accepting unknown schema or kind', () => {
    expect(
      parseAgentResponse({
        schemaVersion: 'agent-response-v1',
        kind: 'message',
        capabilities: ['message', 'question'],
        markdown: 'hello',
      }).response.capabilities,
    ).toEqual({ message: true, question: true })

    expect(
      parseAgentResponse({
        schemaVersion: 'agent-response-v1',
        kind: 'message',
        capabilities: { message: true, patch: 'deferred', unknown: true, error: 1 },
        markdown: 'hello',
      }).response.capabilities,
    ).toEqual({ message: true, patch: 'deferred', error: true })
  })

  it('retains semantically invalid document candidates with issues instead of dropping them', () => {
    const invalidDocument = createDocument({
      devices: [
        {
          id: 'u1',
          name: 'U1',
          kind: 'ic',
          terminals: [{ id: 'u1-x', name: 'X', label: 'FLOATING', direction: 'bidirectional' as 'input' }],
        },
      ],
      view: {
        canvas: { units: 'px' },
        networkLines: { unused: { label: 'NOT_USED', position: { x: 0, y: 0 } } },
      },
    })

    const parsed = parseAgentResponse({
      schemaVersion: 'agent-response-v1',
      kind: 'blueprints',
      summary: 'Candidate with warnings',
      blueprints: [
        {
          title: 'Invalid but retained',
          summary: 'Needs repair',
          rationale: 'Still useful as a draft',
          tradeoffs: [],
          document: invalidDocument,
        },
      ],
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.response.kind).toBe('blueprints')
    if (parsed.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(parsed.response.blueprints).toHaveLength(1)
    expect(parsed.response.blueprints[0].document).toEqual(invalidDocument)
    expect(parsed.response.blueprints[0].issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid-terminal-direction', 'unused-network-line-label']),
    )
    expect(parsed.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['blueprints[0].document.devices[0].terminals[0].direction']),
    )
  })

  it('rejects non-object blueprint candidate documents with a readable error', () => {
    const createPayload = (document: unknown) => ({
      schemaVersion: 'agent-response-v1',
      kind: 'blueprints',
      summary: 'Invalid document shape',
      blueprints: [
        {
          title: 'Invalid shape',
          summary: 'Provider returned a non-object document',
          rationale: 'Only object-shaped candidates can be retained',
          tradeoffs: [],
          document,
        },
      ],
    })

    expect(() => parseAgentResponse(createPayload(null))).toThrow(
      /blueprints\[0\]\.document.*object-shaped.*DocumentFile candidate/i,
    )
    expect(() => parseAgentResponse(createPayload('not a document'))).toThrow(
      /blueprints\[0\]\.document.*object-shaped.*DocumentFile candidate/i,
    )
    expect(() => parseAgentResponse(createPayload([]))).toThrow(
      /blueprints\[0\]\.document.*object-shaped.*DocumentFile candidate/i,
    )
  })

  it('reports forbidden old-topology fields as candidate issues and does not silently ignore them', () => {
    const documentWithOldTopology = {
      ...createDocument(),
      wires: [],
      nodes: [],
      signals: [],
      devices: [
        {
          id: 'u1',
          name: 'U1',
          kind: 'ic',
          components: [],
          terminals: [
            { id: 'u1-a', name: 'A', label: 'VIN', direction: 'input', signalId: 'sig-vin', ports: [] },
          ],
        },
      ],
    }

    const parsed = parseAgentResponse({
      schemaVersion: 'agent-response-v1',
      kind: 'blueprints',
      summary: 'Candidate with legacy fields',
      blueprints: [
        {
          title: 'Legacy',
          summary: 'Contains old topology',
          rationale: 'Provider mixed schemas',
          tradeoffs: ['Needs cleanup'],
          document: documentWithOldTopology,
        },
      ],
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.response.kind).toBe('blueprints')
    if (parsed.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(parsed.response.blueprints[0].document).toMatchObject({ wires: [], nodes: [], signals: [] })
    expect(parsed.response.blueprints[0].issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['forbidden-old-topology-field']),
    )
    expect(parsed.response.blueprints[0].issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'blueprints[0].document.wires',
        'blueprints[0].document.devices[0].components',
        'blueprints[0].document.devices[0].terminals[0].signalId',
      ]),
    )
  })

  it('limits forbidden old-topology warnings to schema locations and ignores metadata subtrees', () => {
    const documentWithMetadataKeys = {
      ...createDocument(),
      wires: [],
      properties: { ports: ['metadata-port'], nodes: ['metadata-node'] },
      extensions: { nodes: ['extension-node'], signals: ['extension-signal'] },
      metadata: { components: ['metadata-component'], signalId: 'metadata-signal' },
      devices: [
        {
          id: 'u1',
          name: 'U1',
          kind: 'ic',
          properties: { ports: ['device-metadata-port'] },
          terminals: [
            {
              id: 'u1-a',
              name: 'A',
              label: 'VIN',
              direction: 'input',
              signalId: 'sig-vin',
              extensions: { nodes: ['terminal-extension-node'] },
            },
          ],
        },
      ],
    }

    const parsed = parseAgentResponse({
      schemaVersion: 'agent-response-v1',
      kind: 'blueprints',
      summary: 'Candidate with legacy fields and metadata',
      blueprints: [
        {
          title: 'Metadata keys',
          summary: 'Metadata may use legacy-looking names',
          rationale: 'Open metadata subtrees should not be scanned as topology',
          tradeoffs: [],
          document: documentWithMetadataKeys,
        },
      ],
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.response.kind).toBe('blueprints')
    if (parsed.response.kind !== 'blueprints') throw new Error('expected blueprints')
    const forbiddenPaths = parsed.response.blueprints[0].issues
      .filter((issue) => issue.code === 'forbidden-old-topology-field')
      .map((issue) => issue.path)

    expect(forbiddenPaths).toEqual(
      expect.arrayContaining([
        'blueprints[0].document.wires',
        'blueprints[0].document.devices[0].terminals[0].signalId',
      ]),
    )
    expect(forbiddenPaths).not.toEqual(expect.arrayContaining([expect.stringContaining('.properties.')]))
    expect(forbiddenPaths).not.toEqual(expect.arrayContaining([expect.stringContaining('.extensions.')]))
    expect(forbiddenPaths).not.toEqual(expect.arrayContaining([expect.stringContaining('.metadata.')]))
  })

  it('does not mutate a supplied main document or source response object', () => {
    const mainDocument = createDocument({ document: { id: 'main', title: 'Main' } })
    const candidateDocument = createDocument({ document: { id: 'candidate', title: 'Candidate' } })
    const payload = {
      schemaVersion: 'agent-response-v1',
      kind: 'blueprints',
      summary: 'Candidate only',
      blueprints: [
        {
          title: 'Candidate',
          summary: 'Different document',
          rationale: 'No mutation',
          tradeoffs: [],
          document: candidateDocument,
        },
      ],
    }
    const beforeMain = structuredClone(mainDocument)
    const beforePayload = structuredClone(payload)

    const parsed = parseAgentResponse(payload, { mainDocument })

    expect(parsed.ok).toBe(true)
    expect(mainDocument).toEqual(beforeMain)
    expect(payload).toEqual(beforePayload)
    if (parsed.response.kind !== 'blueprints') throw new Error('expected blueprints')
    parsed.response.blueprints[0].document.document.title = 'Mutated parsed clone'
    expect(candidateDocument.document.title).toBe('Candidate')
    expect(mainDocument.document.title).toBe('Main')
  })
})
