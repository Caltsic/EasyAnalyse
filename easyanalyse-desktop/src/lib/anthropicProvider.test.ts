import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentFile } from '../types/document'
import { AGENT_RESPONSE_SEMANTIC_VERSION } from './agentResponse'
import { AgentProviderError, type ProviderBuildInput } from './openAiCompatibleProvider'
import {
  anthropicProviderAdapter,
  buildAnthropicPayload,
  createAnthropicProviderAdapter,
  parseAnthropicResponse,
  runAnthropicProvider,
  type AnthropicFetch,
} from './anthropicProvider'

const apiKey = ['fake', 'anthropic', 'key', 'm5'].join('-')

function createDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    schemaVersion: '4.0.0',
    document: {
      id: 'doc-1',
      title: 'Reference circuit',
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

function baseBuildInput(overrides: Partial<ProviderBuildInput> = {}): ProviderBuildInput {
  return {
    provider: {
      id: 'anthropic-provider-1',
      name: 'Unit Test Anthropic',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-test'],
      defaultModel: 'claude-test',
    },
    model: { id: 'claude-test', name: 'Claude Test' },
    apiKey,
    systemPrompt: 'You are the EasyAnalyse circuit assistant.',
    userPrompt: 'Summarize the current semantic v4 circuit.',
    generation: {
      temperature: 0.25,
      topP: 0.9,
      maxTokens: 1234,
    },
    ...overrides,
  }
}

function agentMessage(markdown = 'Hello from Anthropic') {
  return {
    schemaVersion: 'agent-response-v1',
    semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
    kind: 'message',
    requestId: 'anthropic-message-1',
    summary: 'Provider message',
    markdown,
  }
}

function agentBlueprints(candidateDocument: DocumentFile) {
  return {
    schemaVersion: 'agent-response-v1',
    semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
    kind: 'blueprints',
    requestId: 'anthropic-blueprints-1',
    summary: 'One retained alternative',
    blueprints: [
      {
        title: 'Candidate A',
        summary: 'A retained object-shaped semantic v4 candidate.',
        rationale: 'Tests parseAgentResponse integration without mutating the main document.',
        tradeoffs: ['Mocked provider response only'],
        document: candidateDocument,
      },
    ],
  }
}

function anthropicMessagesBody(content: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content: Array.isArray(content)
      ? content
      : [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content) }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 17,
      output_tokens: 9,
    },
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(body: string, status: number, contentType = 'text/plain'): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': contentType },
  })
}

function expectNoApiKey(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(apiKey)
}

function expectSafeProviderError(error: unknown): asserts error is AgentProviderError {
  expect(error).toBeInstanceOf(AgentProviderError)
  expect(String(error)).not.toContain(apiKey)
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(apiKey)
  if (error instanceof AgentProviderError) expect(JSON.stringify(error.toJSON())).not.toContain(apiKey)
}

describe('anthropicProvider', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('real network must not be used by Anthropic adapter tests')
      }),
    )
  })

  it('buildPayload trims baseUrl and appends the Anthropic Messages endpoint without duplicate slashes', () => {
    const cases = [
      [' https://api.anthropic.com ', 'https://api.anthropic.com/v1/messages'],
      ['https://api.anthropic.com/', 'https://api.anthropic.com/v1/messages'],
      ['https://api.anthropic.com/v1', 'https://api.anthropic.com/v1/messages'],
      ['https://api.anthropic.com/v1//', 'https://api.anthropic.com/v1/messages'],
      ['https://anthropic-proxy.example.test/root', 'https://anthropic-proxy.example.test/root/v1/messages'],
    ] as const

    cases.forEach(([baseUrl, expectedUrl]) => {
      const request = buildAnthropicPayload(
        baseBuildInput({
          provider: { ...baseBuildInput().provider, baseUrl },
        }),
      )

      expect(request.url).toBe(expectedUrl)
      expect(request.method).toBe('POST')
      expect(request.headers).toEqual({
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      })
      expect(request.metadata).toMatchObject({
        adapterId: 'anthropic',
        requestFormat: 'anthropic-messages',
        providerId: 'anthropic-provider-1',
        modelId: 'claude-test',
        endpoint: 'messages',
      })
      expectNoApiKey(request.metadata)
    })
  })

  it('buildPayload emits the Anthropic Messages JSON body with generation overrides and no response_format', () => {
    const request = anthropicProviderAdapter.buildPayload(baseBuildInput())
    const body = JSON.parse(request.body)

    expect(body).toEqual({
      model: 'claude-test',
      system: 'You are the EasyAnalyse circuit assistant.',
      messages: [{ role: 'user', content: 'Summarize the current semantic v4 circuit.' }],
      temperature: 0.25,
      top_p: 0.9,
      max_tokens: 1234,
      stream: false,
    })
    expect(body).not.toHaveProperty('response_format')
    expect(request.body).not.toContain(apiKey)
    expectNoApiKey(request.metadata)
  })

  it('buildPayload uses the shared generation defaults when options are omitted', () => {
    const input = baseBuildInput({ generation: undefined })
    const body = JSON.parse(buildAnthropicPayload(input).body)

    expect(body.temperature).toBe(0.2)
    expect(body.top_p).toBe(1)
    expect(body.max_tokens).toBe(8192)
    expect(body.stream).toBe(false)
    expect(body).not.toHaveProperty('response_format')
  })

  it('run uses only the injected fetch, forwards AbortSignal, and parses Anthropic text content as AgentResponse v1', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<AnthropicFetch>(async () => jsonResponse(anthropicMessagesBody(agentMessage('Injected fetch only'))))

    const result = await runAnthropicProvider({
      ...baseBuildInput(),
      fetch: fetchMock,
      currentDocument: createDocument(),
      signal: controller.signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(controller.signal)
    expect(init.headers).toEqual({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    })
    expect(JSON.stringify(init.body)).not.toContain(apiKey)
    expect(result.ok).toBe(true)
    expect(result.response).toMatchObject({
      schemaVersion: 'agent-response-v1',
      semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
      kind: 'message',
      requestId: 'anthropic-message-1',
      markdown: 'Injected fetch only',
    })
    expect(result.metadata).toMatchObject({
      adapterId: 'anthropic',
      requestFormat: 'anthropic-messages',
      providerId: 'anthropic-provider-1',
      modelId: 'claude-test',
      responseId: 'msg-test',
      stopReason: 'end_turn',
      usage: {
        promptTokens: 17,
        completionTokens: 9,
        totalTokens: 26,
      },
    })
    expectNoApiKey(result.metadata)
  })

  it('parseResponse maps blueprint content through parseAgentResponse without mutating the main document', () => {
    const mainDocument = createDocument({ document: { id: 'main-doc', title: 'Main document' } })
    const invalidButRetainableCandidate = {
      ...createDocument({
        schemaVersion: '3.0.0' as DocumentFile['schemaVersion'],
        document: { id: 'candidate-doc', title: 'Candidate document' },
      }),
      wires: [],
    } as unknown as DocumentFile
    const beforeMainDocument = structuredClone(mainDocument)

    const result = parseAnthropicResponse({
      responseBody: anthropicMessagesBody(agentBlueprints(invalidButRetainableCandidate)),
      mainDocument,
      provider: baseBuildInput().provider,
      model: baseBuildInput().model,
    })

    expect(result.response.kind).toBe('blueprints')
    if (result.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(result.response.blueprints).toHaveLength(1)
    expect(result.response.blueprints[0].document).toEqual(invalidButRetainableCandidate)
    expect(result.response.blueprints[0].document).not.toBe(invalidButRetainableCandidate)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid-document-schema-version', 'forbidden-old-topology-field']),
    )
    expect(mainDocument).toEqual(beforeMainDocument)
    expectNoApiKey(result.metadata)
  })

  it('concatenates Anthropic text blocks in order before parsing', () => {
    const serialized = JSON.stringify(agentMessage('Split text blocks'))
    const result = parseAnthropicResponse({
      responseBody: anthropicMessagesBody([
        { type: 'text', text: serialized.slice(0, 40) },
        { type: 'tool_use', id: 'tool-ignored', name: 'ignored', input: {} },
        { type: 'text', text: serialized.slice(40) },
      ]),
      provider: baseBuildInput().provider,
      model: baseBuildInput().model,
    })

    expect(result.response.kind).toBe('message')
    if (result.response.kind !== 'message') throw new Error('expected message')
    expect(result.response.markdown).toBe('Split text blocks')
  })

  it('preserves whitespace-only Anthropic text blocks when they split string content', () => {
    const whitespace = '   '
    const expectedMarkdown = `Whitespace must stay${whitespace}between words`
    const serialized = JSON.stringify(agentMessage(expectedMarkdown))
    const whitespaceIndex = serialized.indexOf(whitespace)
    expect(whitespaceIndex).toBeGreaterThan(0)

    const result = parseAnthropicResponse({
      responseBody: anthropicMessagesBody([
        { type: 'text', text: serialized.slice(0, whitespaceIndex) },
        { type: 'text', text: whitespace },
        { type: 'text', text: serialized.slice(whitespaceIndex + whitespace.length) },
      ]),
      provider: baseBuildInput().provider,
      model: baseBuildInput().model,
    })

    expect(result.response.kind).toBe('message')
    if (result.response.kind !== 'message') throw new Error('expected message')
    expect(result.response.markdown).toBe(expectedMarkdown)
  })

  it('reports missing or empty Anthropic content as readable protocol errors without mutating the main document', () => {
    const mainDocument = createDocument({ document: { id: 'main-doc', title: 'Main document' } })
    const beforeMainDocument = structuredClone(mainDocument)

    const badBodies = [
      {},
      { content: [] },
      { content: [{ type: 'image', source: {} }] },
      { content: [{ type: 'text', text: '   ' }] },
      { content: [{ type: 'text', text: 123 }] },
    ]

    badBodies.forEach((responseBody) => {
      expect(() => parseAnthropicResponse({ responseBody, mainDocument })).toThrowError(/content.*text/i)
    })
    expect(mainDocument).toEqual(beforeMainDocument)

    try {
      parseAnthropicResponse({ responseBody: { content: [] }, mainDocument })
    } catch (error) {
      expectSafeProviderError(error)
      expect(error.code).toBe('AGENT_PROVIDER_PROTOCOL_ERROR')
      expect(error.retryable).toBe(false)
      expect(error.message).toMatch(/provider response/i)
    }
  })

  it('maps HTTP provider errors to stable readable codes without leaking the API key', async () => {
    const cases = [
      [401, { type: 'error', error: { message: `bad key ${apiKey}`, type: 'authentication_error' } }, 'AGENT_PROVIDER_AUTH_FAILED', false],
      [403, { type: 'error', error: { message: `forbidden ${apiKey}`, type: 'permission_error' } }, 'AGENT_PROVIDER_AUTH_FAILED', false],
      [429, { type: 'error', error: { message: `slow down ${apiKey}`, type: 'rate_limit_error' } }, 'AGENT_RATE_LIMITED', true],
      [500, { type: 'error', error: { message: `upstream exploded ${apiKey}`, type: 'api_error' } }, 'AGENT_PROVIDER_SERVER_ERROR', true],
      [
        400,
        { type: 'error', error: { message: `model claude-missing not found ${apiKey}`, type: 'not_found_error' } },
        'AGENT_PROVIDER_MODEL_UNAVAILABLE',
        false,
      ],
      [
        400,
        { type: 'error', error: { message: `model claude-test is unavailable ${apiKey}`, type: 'invalid_request_error' } },
        'AGENT_PROVIDER_MODEL_UNAVAILABLE',
        false,
      ],
    ] as const

    for (const [status, body, code, retryable] of cases) {
      const fetchMock = vi.fn<AnthropicFetch>(async () => jsonResponse(body, status))

      try {
        await runAnthropicProvider({ ...baseBuildInput(), fetch: fetchMock })
        throw new Error(`expected HTTP ${status} to throw`)
      } catch (error) {
        expectSafeProviderError(error)
        expect(error.code).toBe(code)
        expect(error.status).toBe(status)
        expect(error.retryable).toBe(retryable)
      }
    }
  })

  it.each([
    [401, 'AGENT_PROVIDER_AUTH_FAILED', false, '<html>bad key fake-anthropic-key-m5</html>'],
    [403, 'AGENT_PROVIDER_AUTH_FAILED', false, 'forbidden fake-anthropic-key-m5'],
    [429, 'AGENT_RATE_LIMITED', true, 'rate limited fake-anthropic-key-m5'],
    [502, 'AGENT_PROVIDER_SERVER_ERROR', true, '<!doctype html><h1>bad gateway fake-anthropic-key-m5</h1>'],
  ] as const)(
    'maps non-JSON HTTP %i responses before attempting success-body JSON parsing',
    async (status, code, retryable, body) => {
      const fetchMock = vi.fn<AnthropicFetch>(async () =>
        textResponse(body, status, body.startsWith('<') ? 'text/html' : 'text/plain'),
      )

      try {
        await runAnthropicProvider({ ...baseBuildInput(), fetch: fetchMock })
        throw new Error(`expected HTTP ${status} to throw`)
      } catch (error) {
        expectSafeProviderError(error)
        expect(error.code).toBe(code)
        expect(error.status).toBe(status)
        expect(error.retryable).toBe(retryable)
      }
    },
  )

  it('keeps generic context or max-token model mentions as bad requests while preserving model-not-found detection', async () => {
    const cases = [
      [
        { type: 'error', error: { message: `max_tokens is too large for this model ${apiKey}`, type: 'invalid_request_error' } },
        'AGENT_PROVIDER_BAD_REQUEST',
      ],
      [
        { type: 'error', error: { message: `context window exceeded for model claude-test ${apiKey}`, type: 'invalid_request_error' } },
        'AGENT_PROVIDER_BAD_REQUEST',
      ],
      [
        { type: 'error', error: { message: `The model claude-test does not exist ${apiKey}`, type: 'not_found_error' } },
        'AGENT_PROVIDER_MODEL_UNAVAILABLE',
      ],
    ] as const

    for (const [body, code] of cases) {
      const fetchMock = vi.fn<AnthropicFetch>(async () => jsonResponse(body, 400))

      try {
        await runAnthropicProvider({ ...baseBuildInput(), fetch: fetchMock })
        throw new Error(`expected HTTP 400 to throw ${code}`)
      } catch (error) {
        expectSafeProviderError(error)
        expect(error.code).toBe(code)
        expect(error.status).toBe(400)
        expect(error.retryable).toBe(false)
      }
    }
  })

  it('maps network failures to retryable network errors without falling back to global fetch or leaking the API key', async () => {
    const fetchMock = vi.fn<AnthropicFetch>(async () => {
      throw new Error(`socket closed while sending ${apiKey}`)
    })

    try {
      await runAnthropicProvider({ ...baseBuildInput(), fetch: fetchMock })
      throw new Error('expected network failure to throw')
    } catch (error) {
      expectSafeProviderError(error)
      expect(error.code).toBe('AGENT_PROVIDER_NETWORK_ERROR')
      expect(error.retryable).toBe(true)
    }

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('maps invalid HTTP JSON, protocol issues, and AgentResponse parse/schema failures to provider errors', async () => {
    const invalidJsonFetch = vi.fn<AnthropicFetch>(
      async () => new Response(`{ "error": "not-json", "apiKey": "${apiKey}"`, { status: 200 }),
    )
    await expect(runAnthropicProvider({ ...baseBuildInput(), fetch: invalidJsonFetch })).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_PARSE_ERROR',
      retryable: false,
    })

    try {
      await runAnthropicProvider({ ...baseBuildInput(), fetch: invalidJsonFetch })
    } catch (error) {
      expectSafeProviderError(error)
    }

    const agentJsonParseFailureFetch = vi.fn<AnthropicFetch>(async () =>
      jsonResponse(anthropicMessagesBody('{ "schemaVersion": "agent-response-v1",')),
    )
    await expect(runAnthropicProvider({ ...baseBuildInput(), fetch: agentJsonParseFailureFetch })).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_PARSE_ERROR',
      retryable: false,
    })

    const schemaFailureFetch = vi.fn<AnthropicFetch>(async () =>
      jsonResponse(
        anthropicMessagesBody({
          schemaVersion: 'agent-response-v0',
          semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
          kind: 'message',
          markdown: 'wrong schema',
        }),
      ),
    )
    await expect(runAnthropicProvider({ ...baseBuildInput(), fetch: schemaFailureFetch })).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_SCHEMA_ERROR',
      retryable: false,
    })

    await expect(
      runAnthropicProvider({
        ...baseBuildInput(),
        fetch: vi.fn<AnthropicFetch>(async () => jsonResponse({ content: [] })),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_PROTOCOL_ERROR',
      retryable: false,
    })
  })

  it('requires injected fetch and never defaults to global network access', async () => {
    await expect(
      runAnthropicProvider({
        ...baseBuildInput(),
        fetch: undefined as unknown as AnthropicFetch,
      }),
    ).rejects.toMatchObject({ code: 'AGENT_PROVIDER_CONFIGURATION_ERROR', retryable: false })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('supports only anthropic providers and rejects non-configured models', () => {
    const adapter = createAnthropicProviderAdapter()
    expect(adapter.id).toBe('anthropic')
    expect(adapter.requestFormat).toBe('anthropic-messages')
    expect(adapter.supports(baseBuildInput().provider, baseBuildInput().model)).toBe(true)
    expect(adapter.supports({ ...baseBuildInput().provider, models: [] }, baseBuildInput().model)).toBe(true)
    expect(adapter.supports({ ...baseBuildInput().provider, kind: 'openai-compatible' }, baseBuildInput().model)).toBe(false)
    expect(adapter.supports({ ...baseBuildInput().provider, kind: 'deepseek' }, baseBuildInput().model)).toBe(false)
    expect(adapter.supports({ ...baseBuildInput().provider, models: ['claude-other'] }, baseBuildInput().model)).toBe(false)
    expect(adapter.supports({ ...baseBuildInput().provider, baseUrl: '   ' }, baseBuildInput().model)).toBe(false)
    expect(adapter.supports(baseBuildInput().provider, { id: '   ' })).toBe(false)
  })
})
