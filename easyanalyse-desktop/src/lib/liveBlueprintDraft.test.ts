import { describe, expect, it } from 'vitest'
import type { DocumentFile } from '../types/document'
import {
  LIVE_BLUEPRINT_JSON_MARKER,
  extractLastCompleteJsonObjectAfterMarker,
  parseLiveBlueprintDraft,
} from './liveBlueprintDraft'

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-live',
      title: 'Live draft',
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
      canvas: { units: 'px' },
      devices: { r1: { position: { x: 10, y: 20 } } },
      networkLines: { vin: { label: 'VIN', position: { x: 0, y: 20 } } },
    },
    ...overrides,
  }
}

describe('liveBlueprintDraft', () => {
  it('keeps lastGood when the stream has not emitted the blueprint marker yet', () => {
    const lastGood = createDocument({ document: { id: 'last', title: 'Last good' } })
    const result = parseLiveBlueprintDraft('assistant text without marker', { lastGood })

    expect(result.status).toBe('marker-missing')
    expect(result.displayDocument).toBe(lastGood)
    expect(result.updated).toBe(false)
  })

  it('reports partial JSON after the marker without replacing lastGood', () => {
    const lastGood = createDocument({ document: { id: 'last', title: 'Last good' } })
    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n{"schemaVersion":"4.0.0"`, {
      lastGood,
    })

    expect(result.status).toBe('partial-json')
    expect(result.partial).toMatchObject({ depth: 1 })
    expect(result.candidate).toBeNull()
    expect(result.displayDocument).toBe(lastGood)
  })

  it('waits for JSON when the marker has arrived but no object has started', () => {
    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\nPreparing blueprint JSON...`)

    expect(result.status).toBe('waiting-for-json')
    expect(result.markerFound).toBe(true)
    expect(result.hasCompleteJson).toBe(false)
    expect(result.displayDocument).toBeNull()
  })

  it('extracts the last complete JSON object after the marker and ignores braces inside strings', () => {
    const first = createDocument({ document: { id: 'first', title: 'First' } })
    const second = createDocument({ document: { id: 'second', title: 'Second {with braces}' } })
    const buffer = [
      'provider preface',
      LIVE_BLUEPRINT_JSON_MARKER,
      JSON.stringify(first),
      'stream correction',
      JSON.stringify(second),
      '{"schemaVersion":"4.0.0"',
    ].join('\n')

    const extraction = extractLastCompleteJsonObjectAfterMarker(buffer)
    const result = parseLiveBlueprintDraft(buffer, { lastGood: first })

    expect(extraction.candidate?.json).toBe(JSON.stringify(second))
    expect(extraction.partial).toMatchObject({ depth: 1 })
    expect(result.status).toBe('ready')
    expect(result.updated).toBe(true)
    expect(result.displayDocument?.document.id).toBe('second')
    expect(result.lastGood?.document.title).toBe('Second {with braces}')
  })

  it('extracts the first blueprint document from a streamed AgentResponse wrapper', () => {
    const document = createDocument({ document: { id: 'wrapped', title: 'Wrapped draft' } })
    const agentResponse = {
      schemaVersion: 'agent-response-v1',
      semanticVersion: 'easyanalyse-semantic-v4',
      kind: 'blueprints',
      summary: 'Wrapped response',
      blueprints: [
        {
          title: 'Candidate',
          summary: 'Candidate summary',
          rationale: 'Candidate rationale',
          tradeoffs: [],
          document,
          issues: [],
        },
      ],
    }

    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(agentResponse)}`)

    expect(result.status).toBe('ready')
    expect(result.displayDocument?.document.id).toBe('wrapped')
    expect(result.candidate?.json).toContain('"kind":"blueprints"')
  })

  it('extracts a nested blueprint document before the streamed AgentResponse wrapper closes', () => {
    const document = createDocument({ document: { id: 'early-doc', title: 'Early nested draft' } })
    const partialWrapper = [
      '{',
      '"schemaVersion":"agent-response-v1",',
      '"semanticVersion":"easyanalyse-semantic-v4",',
      '"kind":"blueprints",',
      '"summary":"Streaming wrapper",',
      '"blueprints":[{',
      '"title":"Candidate",',
      '"summary":"Candidate summary",',
      '"rationale":"Candidate rationale",',
      '"tradeoffs":[],',
      `"document":${JSON.stringify(document)},`,
      '"issues":[]',
    ].join('')

    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n${partialWrapper}`)

    expect(result.status).toBe('ready')
    expect(result.hasCompleteJson).toBe(true)
    expect(result.partial).toMatchObject({ depth: expect.any(Number) })
    expect(result.displayDocument?.document.id).toBe('early-doc')
    expect(result.candidate?.json).toBe(JSON.stringify(document))
  })

  it('synthesizes a displayable direct document before the root object closes when required fields are complete', () => {
    const document = createDocument({ document: { id: 'partial-direct', title: 'Partial direct draft' } })
    const partialDirectDocument = [
      '{',
      '"schemaVersion":"4.0.0",',
      `"document":${JSON.stringify(document.document)},`,
      `"devices":${JSON.stringify(document.devices)},`,
      `"view":${JSON.stringify(document.view)},`,
      '"extensions":{',
    ].join('')

    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n${partialDirectDocument}`)

    expect(result.status).toBe('partial-json')
    expect(result.hasCompleteJson).toBe(false)
    expect(result.partial).toMatchObject({ depth: expect.any(Number) })
    expect(result.displayDocument?.document.id).toBe('partial-direct')
    expect(result.displayDocument?.devices[0]?.id).toBe('r1')
    expect(result.candidate?.json).toBe(JSON.stringify(document))
  })

  it('synthesizes a nested blueprint document before that document object closes when required fields are complete', () => {
    const document = createDocument({ document: { id: 'partial-nested', title: 'Partial nested draft' } })
    const partialWrapper = [
      '{',
      '"schemaVersion":"agent-response-v1",',
      '"semanticVersion":"easyanalyse-semantic-v4",',
      '"kind":"blueprints",',
      '"blueprints":[{',
      '"title":"Candidate",',
      '"summary":"Candidate summary",',
      '"rationale":"Candidate rationale",',
      '"tradeoffs":[],',
      '"document":{',
      '"schemaVersion":"4.0.0",',
      `"document":${JSON.stringify(document.document)},`,
      `"devices":${JSON.stringify(document.devices)},`,
      `"view":${JSON.stringify(document.view)},`,
      '"extensions":{',
    ].join('')

    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n${partialWrapper}`)

    expect(result.status).toBe('partial-json')
    expect(result.hasCompleteJson).toBe(false)
    expect(result.partial).toMatchObject({ depth: expect.any(Number) })
    expect(result.displayDocument?.document.id).toBe('partial-nested')
    expect(result.candidate?.json).toBe(JSON.stringify(document))
  })

  it('does not synthesize a partial document before all required fields are complete', () => {
    const lastGood = createDocument({ document: { id: 'last', title: 'Last good' } })
    const document = createDocument({ document: { id: 'missing-view', title: 'Missing view' } })
    const partialDirectDocument = [
      '{',
      '"schemaVersion":"4.0.0",',
      `"document":${JSON.stringify(document.document)},`,
      `"devices":${JSON.stringify(document.devices)},`,
    ].join('')

    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n${partialDirectDocument}`, { lastGood })

    expect(result.status).toBe('partial-json')
    expect(result.displayDocument).toBe(lastGood)
    expect(result.candidate).toBeNull()
  })

  it('ignores document-like text in strings while extracting the first nested blueprint document', () => {
    const document = createDocument({ document: { id: 'string-safe', title: 'String safe draft' } })
    const partialWrapper = [
      '{',
      '"schemaVersion":"agent-response-v1",',
      '"semanticVersion":"easyanalyse-semantic-v4",',
      '"kind":"blueprints",',
      '"summary":"mentions \\"document\\": {\\"schemaVersion\\":\\"4.0.0\\"} and braces { }",',
      '"blueprints":[{',
      '"title":"Candidate",',
      '"rationale":"ignore the word document in this text",',
      '"summary":"Candidate summary",',
      '"tradeoffs":[],',
      `"document":${JSON.stringify(document)},`,
      '"issues":[]',
    ].join('')

    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n${partialWrapper}`)

    expect(result.status).toBe('ready')
    expect(result.displayDocument?.document.id).toBe('string-safe')
  })

  it('does not preview a later candidate when the first candidate document is not complete yet', () => {
    const lastGood = createDocument({ document: { id: 'last', title: 'Last good' } })
    const second = createDocument({ document: { id: 'second-candidate', title: 'Second candidate' } })
    const partialWrapper = [
      '{',
      '"schemaVersion":"agent-response-v1",',
      '"semanticVersion":"easyanalyse-semantic-v4",',
      '"kind":"blueprints",',
      '"blueprints":[{',
      '"title":"First",',
      '"document":{"schemaVersion":"4.0.0","document":{"id":"first","title":"First"}',
      '},{"title":"Second",',
      `"document":${JSON.stringify(second)},`,
      '"issues":[]',
    ].join('')

    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n${partialWrapper}`, { lastGood })

    expect(result.status).toBe('partial-json')
    expect(result.displayDocument).toBe(lastGood)
    expect(result.candidate).toBeNull()
  })

  it('does not mistake DocumentFile metadata for a displayable nested document while a direct document is still partial', () => {
    const lastGood = createDocument({ document: { id: 'last', title: 'Last good' } })
    const partialDirectDocument = [
      '{',
      '"schemaVersion":"4.0.0",',
      '"document":{"id":"metadata-only","title":"Metadata only"}',
    ].join('')

    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n${partialDirectDocument}`, { lastGood })

    expect(result.status).toBe('partial-json')
    expect(result.displayDocument).toBe(lastGood)
    expect(result.candidate).toBeNull()
  })

  it('returns detailed invalid-json status for a balanced but malformed object', () => {
    const lastGood = createDocument({ document: { id: 'last', title: 'Last good' } })
    const result = parseLiveBlueprintDraft(
      `${LIVE_BLUEPRINT_JSON_MARKER}\n{"schemaVersion":"4.0.0","document":{},}`,
      { lastGood },
    )

    expect(result.status).toBe('invalid-json')
    expect(result.displayDocument).toBe(lastGood)
    expect(result.error).toMatchObject({ code: 'invalid-json', line: expect.any(Number), column: expect.any(Number) })
    expect(result.error?.message).toContain('JSON.parse failed')
    expect(result.error?.excerpt).toContain('schemaVersion')
  })

  it('returns invalid-document status with shape issues and preserves lastGood', () => {
    const lastGood = createDocument({ document: { id: 'last', title: 'Last good' } })
    const invalidDocument = {
      schemaVersion: '4.0.0',
      document: { id: 'bad', title: 'Bad draft' },
      devices: [{ id: 'u1', name: 'U1', kind: 'ic', terminals: [{ id: 'u1-a', name: 'A', direction: 'bad' }] }],
      view: { canvas: { units: 'mm' } },
    }
    const result = parseLiveBlueprintDraft(`${LIVE_BLUEPRINT_JSON_MARKER}\n${JSON.stringify(invalidDocument)}`, {
      lastGood,
    })

    expect(result.status).toBe('invalid-document')
    expect(result.displayDocument).toBe(lastGood)
    expect(result.error?.issues?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid-terminal-direction', 'invalid-view-canvas-units']),
    )
  })
})
