import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentFile } from '../types/document'
import { parseAgentResponse } from './agentResponse'

const invokeSpy = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeSpy,
}))

vi.mock('./secretStore', () => ({
  createSecretStore: vi.fn(() => {
    throw new Error('mock provider must not create or read SecretStore')
  }),
  createMemorySecretBackend: vi.fn(() => {
    throw new Error('mock provider must not create a secret backend')
  }),
  maskSecretRef: vi.fn(),
  SECRET_REF_PREFIX: 'secret-ref:',
}))

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'main-doc',
      title: 'Main circuit',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T01:00:00.000Z',
      tags: ['fixture'],
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

describe('agentMockProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('mock provider must not call fetch')
      }),
    )
  })

  it('returns a deterministic parsed AgentResponse v1 message without network, invoke, secrets, or document mutation', async () => {
    const { runMockAgentProvider, createMockAgentResponse } = await import('./agentMockProvider')
    const currentDocument = createDocument()
    const beforeDocument = structuredClone(currentDocument)

    const first = await runMockAgentProvider({
      prompt: 'summarize this circuit',
      currentDocument,
      scenario: 'message',
      requestId: 'req-message',
    })
    const secondRaw = createMockAgentResponse({
      prompt: 'summarize this circuit',
      currentDocument,
      scenario: 'message',
      requestId: 'req-message',
    })
    const second = parseAgentResponse(secondRaw, { mainDocument: currentDocument })

    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    expect(first.response).toMatchObject({
      schemaVersion: 'agent-response-v1',
      kind: 'message',
      requestId: 'req-message',
      markdown: expect.stringContaining('mock provider'),
    })
    expect(first.issues).toEqual([])
    expect(currentDocument).toEqual(beforeDocument)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  it('supports readable question and error scenarios as parseable AgentResponse v1 responses', async () => {
    const { runMockAgentProvider } = await import('./agentMockProvider')

    const question = await runMockAgentProvider({ prompt: 'optimize', scenario: 'question', requestId: 'req-q' })
    expect(question.response).toMatchObject({
      schemaVersion: 'agent-response-v1',
      kind: 'question',
      requestId: 'req-q',
      question: expect.stringContaining('rail'),
      options: ['VIN', 'VOUT', 'Both'],
    })
    expect(question.issues).toEqual([])

    const error = await runMockAgentProvider({ prompt: 'force error', scenario: 'error', requestId: 'req-e' })
    expect(error.response).toMatchObject({
      schemaVersion: 'agent-response-v1',
      kind: 'error',
      requestId: 'req-e',
      message: expect.stringContaining('Mock provider error'),
      recoverable: true,
    })
    expect(error.issues).toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  it('returns valid and invalid object-shaped blueprint candidates while preserving parser issues', async () => {
    const { runMockAgentProvider } = await import('./agentMockProvider')
    const currentDocument = createDocument()
    const beforeDocument = structuredClone(currentDocument)

    const parsed = await runMockAgentProvider({
      prompt: 'give blueprint alternatives',
      currentDocument,
      scenario: 'blueprints',
      requestId: 'req-blueprints',
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.response.kind).toBe('blueprints')
    if (parsed.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(parsed.response.requestId).toBe('req-blueprints')
    expect(parsed.response.blueprints).toHaveLength(2)
    expect(parsed.response.blueprints[0].title).toContain('Valid')
    expect(parsed.response.blueprints[0].issues).toEqual([])
    expect(parsed.response.blueprints[1].title).toContain('Invalid')
    expect(parsed.response.blueprints[1].document).toMatchObject({ schemaVersion: '4.0.0', document: expect.any(Object) })
    expect(parsed.response.blueprints[1].issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid-terminal-direction', 'unused-network-line-label']),
    )
    expect(parsed.issues.map((issue) => issue.candidateIndex)).toEqual(expect.arrayContaining([1]))
    expect(currentDocument).toEqual(beforeDocument)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  it('can return only the invalid candidate for Agent panel validation paths', async () => {
    const { runMockAgentProvider } = await import('./agentMockProvider')

    const parsed = await runMockAgentProvider({ prompt: 'invalid candidate', scenario: 'blueprints-invalid' })

    expect(parsed.response.kind).toBe('blueprints')
    if (parsed.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(parsed.response.blueprints).toHaveLength(1)
    expect(parsed.response.blueprints[0].title).toContain('Invalid')
    expect(parsed.issues.length).toBeGreaterThan(0)
  })
})
