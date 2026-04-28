import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentFile } from '../types/document'
import { AGENT_RESPONSE_SEMANTIC_VERSION } from './agentResponse'
import {
  AgentProviderError,
  buildOpenAiCompatiblePayload,
  createOpenAiCompatibleProviderAdapter,
  openAiCompatibleProviderAdapter,
  parseOpenAiCompatibleResponse,
  runOpenAiCompatibleProvider,
  type OpenAiCompatibleFetch,
  type ProviderBuildInput,
} from './openAiCompatibleProvider'
import { DEEPSEEK_PROVIDER_PRESET } from './providerPresets'

const apiKey = ['sk', 'test', 'm5'].join('-')

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
      id: 'provider-1',
      name: 'Unit Test OpenAI Compatible',
      kind: 'openai-compatible',
      baseUrl: 'https://llm.example.test/v1',
      models: ['gpt-test'],
      defaultModel: 'gpt-test',
    },
    model: { id: 'gpt-test', name: 'GPT Test' },
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

function agentMessage(markdown = 'Hello from the provider') {
  return {
    schemaVersion: 'agent-response-v1',
    semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
    kind: 'message',
    requestId: 'agent-message-1',
    summary: 'Provider message',
    markdown,
  }
}

function agentBlueprints(candidateDocument: DocumentFile) {
  return {
    schemaVersion: 'agent-response-v1',
    semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
    kind: 'blueprints',
    requestId: 'agent-blueprints-1',
    summary: 'One safe alternative',
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

function openAiChatBody(content: unknown) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: 'gpt-test',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: typeof content === 'string' ? content : JSON.stringify(content),
        },
      },
    ],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function expectNoApiKey(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(apiKey)
}

function expectSafeProviderError(error: unknown): asserts error is AgentProviderError {
  expect(error).toBeInstanceOf(AgentProviderError)
  expect(String(error)).not.toContain(apiKey)
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(apiKey)
}

describe('openAiCompatibleProvider', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('real network must not be used by OpenAI-compatible adapter tests')
      }),
    )
  })

  it('buildPayload trims baseUrl and appends /chat/completions without duplicating slashes', () => {
    const cases = [
      [' https://llm.example.test/v1 ', 'https://llm.example.test/v1/chat/completions'],
      ['https://llm.example.test/v1/', 'https://llm.example.test/v1/chat/completions'],
      ['https://llm.example.test/v1//', 'https://llm.example.test/v1/chat/completions'],
    ] as const

    cases.forEach(([baseUrl, expectedUrl]) => {
      const request = buildOpenAiCompatiblePayload(
        baseBuildInput({
          provider: { ...baseBuildInput().provider, baseUrl },
        }),
      )

      expect(request.url).toBe(expectedUrl)
      expect(request.method).toBe('POST')
      expect(request.headers).toMatchObject({
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      })
      expectNoApiKey(request.metadata)
    })
  })

  it('buildPayload emits the OpenAI chat completions JSON body with generation options and JSON response_format', () => {
    const request = openAiCompatibleProviderAdapter.buildPayload(baseBuildInput())
    const body = JSON.parse(request.body)

    expect(body).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'You are the EasyAnalyse circuit assistant.' },
        { role: 'user', content: 'Summarize the current semantic v4 circuit.' },
      ],
      temperature: 0.25,
      top_p: 0.9,
      max_tokens: 1234,
      stream: false,
      response_format: { type: 'json_object' },
    })
    expect(request.body).not.toContain(apiKey)
    expectNoApiKey(request.metadata)
  })

  it('run uses only the injected fetch and parses choices[0].message.content as an AgentResponse v1 message', async () => {
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(async () => jsonResponse(openAiChatBody(agentMessage('Injected fetch only'))))

    const result = await runOpenAiCompatibleProvider({
      ...baseBuildInput(),
      fetch: fetchMock,
      currentDocument: createDocument(),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://llm.example.test/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` })
    expect(JSON.stringify(init.body)).not.toContain(apiKey)
    expect(result.ok).toBe(true)
    expect(result.response).toMatchObject({
      schemaVersion: 'agent-response-v1',
      semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
      kind: 'message',
      requestId: 'agent-message-1',
      markdown: 'Injected fetch only',
    })
    expect(result.metadata).toMatchObject({
      adapterId: 'openai-compatible',
      requestFormat: 'openai-chat-completions',
      providerId: 'provider-1',
      modelId: 'gpt-test',
      responseId: 'chatcmpl-test',
      finishReason: 'stop',
    })
    expectNoApiKey(result.metadata)
  })

  it('supports the DeepSeek preset through the OpenAI-compatible injected fetch path', async () => {
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(async () => jsonResponse(openAiChatBody(agentMessage('DeepSeek preset response'))))

    const result = await runOpenAiCompatibleProvider({
      ...baseBuildInput(),
      provider: DEEPSEEK_PROVIDER_PRESET,
      model: { id: DEEPSEEK_PROVIDER_PRESET.defaultModel ?? 'deepseek-chat' },
      fetch: fetchMock,
      currentDocument: createDocument(),
    })

    expect(openAiCompatibleProviderAdapter.supports(DEEPSEEK_PROVIDER_PRESET, { id: 'deepseek-chat' })).toBe(true)
    expect(openAiCompatibleProviderAdapter.supports(DEEPSEEK_PROVIDER_PRESET, { id: 'deepseek-reasoner' })).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` })
    expect(JSON.parse(init.body).model).toBe('deepseek-chat')
    expect(result.metadata).toMatchObject({
      adapterId: 'openai-compatible',
      requestFormat: 'openai-chat-completions',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
    })
    expectNoApiKey(result.metadata)
  })

  it('parseResponse maps blueprint AgentResponse content through parseAgentResponse without mutating the main document', () => {
    const mainDocument = createDocument({ document: { id: 'main-doc', title: 'Main document' } })
    const candidateDocument = createDocument({ document: { id: 'candidate-doc', title: 'Candidate document' } })
    const beforeMainDocument = structuredClone(mainDocument)

    const result = parseOpenAiCompatibleResponse({
      responseBody: openAiChatBody(agentBlueprints(candidateDocument)),
      mainDocument,
      provider: baseBuildInput().provider,
      model: baseBuildInput().model,
    })

    expect(result.response.kind).toBe('blueprints')
    if (result.response.kind !== 'blueprints') throw new Error('expected blueprints')
    expect(result.response.blueprints).toHaveLength(1)
    expect(result.response.blueprints[0].document).toEqual(candidateDocument)
    expect(result.response.blueprints[0].document).not.toBe(candidateDocument)
    expect(mainDocument).toEqual(beforeMainDocument)
    expectNoApiKey(result.metadata)
  })

  it('reports missing or empty choices/content as readable protocol errors without mutating the main document', () => {
    const mainDocument = createDocument({ document: { id: 'main-doc', title: 'Main document' } })
    const beforeMainDocument = structuredClone(mainDocument)

    const badBodies = [
      {},
      { choices: [] },
      { choices: [{ message: {} }] },
      { choices: [{ message: { content: '   ' } }] },
    ]

    badBodies.forEach((responseBody) => {
      expect(() => parseOpenAiCompatibleResponse({ responseBody, mainDocument })).toThrowError(
        /choices\[0\]\.message\.content/i,
      )
    })
    expect(mainDocument).toEqual(beforeMainDocument)

    try {
      parseOpenAiCompatibleResponse({ responseBody: { choices: [] }, mainDocument })
    } catch (error) {
      expectSafeProviderError(error)
      expect(error.code).toBe('AGENT_PROVIDER_PROTOCOL_ERROR')
      expect(error.retryable).toBe(false)
      expect(error.message).toMatch(/provider response/i)
    }
  })

  it('maps HTTP provider errors to stable readable codes without leaking the API key', async () => {
    const cases = [
      [401, { error: { message: `bad key ${apiKey}`, type: 'authentication_error' } }, 'AGENT_PROVIDER_AUTH_FAILED', false],
      [403, { error: { message: `forbidden ${apiKey}`, type: 'authentication_error' } }, 'AGENT_PROVIDER_AUTH_FAILED', false],
      [404, { error: { message: 'model endpoint missing' } }, 'AGENT_PROVIDER_MODEL_UNAVAILABLE', false],
      [
        400,
        { error: { message: `model gpt-test does not exist ${apiKey}`, code: 'model_not_found', param: 'model' } },
        'AGENT_PROVIDER_MODEL_UNAVAILABLE',
        false,
      ],
      [429, { error: { message: `slow down ${apiKey}`, type: 'rate_limit_error' } }, 'AGENT_RATE_LIMITED', true],
      [500, { error: { message: `upstream exploded ${apiKey}` } }, 'AGENT_PROVIDER_SERVER_ERROR', true],
    ] as const

    for (const [status, body, code, retryable] of cases) {
      const fetchMock = vi.fn<OpenAiCompatibleFetch>(async () => jsonResponse(body, status))

      try {
        await runOpenAiCompatibleProvider({ ...baseBuildInput(), fetch: fetchMock })
        throw new Error(`expected HTTP ${status} to throw`)
      } catch (error) {
        expectSafeProviderError(error)
        expect(error.code).toBe(code)
        expect(error.status).toBe(status)
        expect(error.retryable).toBe(retryable)
      }
    }
  })

  it('keeps non-availability model errors as bad requests while preserving model-not-found detection', async () => {
    const cases = [
      [
        { error: { message: `max_tokens is too large for this model ${apiKey}`, type: 'invalid_request_error', param: 'max_tokens' } },
        'AGENT_PROVIDER_BAD_REQUEST',
      ],
      [
        { error: { message: `The model gpt-test does not exist ${apiKey}`, code: 'model_not_found', param: 'model' } },
        'AGENT_PROVIDER_MODEL_UNAVAILABLE',
      ],
    ] as const

    for (const [body, code] of cases) {
      const fetchMock = vi.fn<OpenAiCompatibleFetch>(async () => jsonResponse(body, 400))

      try {
        await runOpenAiCompatibleProvider({ ...baseBuildInput(), fetch: fetchMock })
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
    const fetchMock = vi.fn<OpenAiCompatibleFetch>(async () => {
      throw new Error(`socket closed while sending ${apiKey}`)
    })

    try {
      await runOpenAiCompatibleProvider({ ...baseBuildInput(), fetch: fetchMock })
      throw new Error('expected network failure to throw')
    } catch (error) {
      expectSafeProviderError(error)
      expect(error.code).toBe('AGENT_PROVIDER_NETWORK_ERROR')
      expect(error.retryable).toBe(true)
    }

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('maps invalid HTTP JSON, protocol issues, and AgentResponse schema failures to parse/schema errors', async () => {
    const invalidJsonFetch = vi.fn<OpenAiCompatibleFetch>(
      async () => new Response(`{ "error": "not-json", "apiKey": "${apiKey}"`, { status: 200 }),
    )
    await expect(runOpenAiCompatibleProvider({ ...baseBuildInput(), fetch: invalidJsonFetch })).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_PARSE_ERROR',
      retryable: false,
    })

    try {
      await runOpenAiCompatibleProvider({ ...baseBuildInput(), fetch: invalidJsonFetch })
    } catch (error) {
      expectSafeProviderError(error)
    }

    const schemaFailureFetch = vi.fn<OpenAiCompatibleFetch>(async () =>
      jsonResponse(
        openAiChatBody({
          schemaVersion: 'agent-response-v0',
          semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
          kind: 'message',
          markdown: 'wrong schema',
        }),
      ),
    )
    await expect(runOpenAiCompatibleProvider({ ...baseBuildInput(), fetch: schemaFailureFetch })).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_SCHEMA_ERROR',
      retryable: false,
    })

    await expect(
      runOpenAiCompatibleProvider({
        ...baseBuildInput(),
        fetch: vi.fn<OpenAiCompatibleFetch>(async () => jsonResponse({ choices: [] })),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_PROTOCOL_ERROR',
      retryable: false,
    })
  })

  it('requires injected fetch and never defaults to global network access', async () => {
    await expect(
      runOpenAiCompatibleProvider({
        ...baseBuildInput(),
        fetch: undefined as unknown as OpenAiCompatibleFetch,
      }),
    ).rejects.toMatchObject({ code: 'AGENT_PROVIDER_CONFIGURATION_ERROR', retryable: false })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('supports openai-compatible and deepseek providers, but not anthropic', () => {
    const adapter = createOpenAiCompatibleProviderAdapter()
    expect(adapter.id).toBe('openai-compatible')
    expect(adapter.requestFormat).toBe('openai-chat-completions')
    expect(adapter.supports(baseBuildInput().provider, baseBuildInput().model)).toBe(true)
    expect(
      adapter.supports(
        { ...baseBuildInput().provider, id: 'deepseek-provider', kind: 'deepseek', baseUrl: 'https://api.deepseek.example/v1' },
        baseBuildInput().model,
      ),
    ).toBe(true)
    expect(adapter.supports({ ...baseBuildInput().provider, kind: 'anthropic' }, baseBuildInput().model)).toBe(false)
    expect(adapter.supports({ ...baseBuildInput().provider, models: ['other-model'] }, baseBuildInput().model)).toBe(false)
  })
})
