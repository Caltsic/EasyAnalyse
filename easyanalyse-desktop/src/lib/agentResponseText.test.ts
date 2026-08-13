import { describe, expect, it } from 'vitest'
import { extractAgentResponseText } from './agentResponseText'

function message(markdown: string) {
  return {
    schemaVersion: 'agent-response-v1',
    semanticVersion: 'easyanalyse-semantic-v4',
    kind: 'message',
    summary: 'Structured summary',
    markdown,
  }
}

describe('extractAgentResponseText', () => {
  it('preserves ordinary and malformed provider text instead of throwing', () => {
    expect(extractAgentResponseText('ordinary answer')).toMatchObject({
      conversationText: 'ordinary answer',
      extraction: 'plain-text',
      response: { kind: 'message', markdown: 'ordinary answer' },
    })

    const malformed = '{"schemaVersion":"agent-response-v1"'
    expect(extractAgentResponseText(malformed)).toMatchObject({
      rawText: malformed,
      conversationText: malformed,
      extraction: 'plain-text',
      response: { kind: 'message', markdown: malformed },
    })
  })

  it('keeps providerText byte-for-byte while parsing trimmed content', () => {
    const raw = `  ${JSON.stringify(message('body'))}\r\n`
    const result = extractAgentResponseText(raw)

    expect(result.rawText).toBe(raw)
    expect(result.response).toMatchObject({ kind: 'message', markdown: 'body' })
  })

  it('uses preceding prose as the conversation while retaining a trailing structured response', () => {
    const raw = `Readable answer first.\n${JSON.stringify(message('structured body'))}`
    const result = extractAgentResponseText(raw)

    expect(result.extraction).toBe('trailing-json')
    expect(result.conversationText).toBe('Readable answer first.')
    expect(result.response).toMatchObject({ kind: 'message', markdown: 'structured body' })
    expect(result.rawText).toBe(raw)
  })

  it('finds the outer trailing AgentResponse when its final field is a nested object', () => {
    const response = {
      ...message('nested response body'),
      capabilities: { message: true },
    }
    const result = extractAgentResponseText(`Readable prefix.\n${JSON.stringify(response)}`)

    expect(result.extraction).toBe('trailing-json')
    expect(result.conversationText).toBe('Readable prefix.')
    expect(result.response).toMatchObject({ kind: 'message', markdown: 'nested response body' })
  })

  it('extracts lenient provider message envelopes', () => {
    expect(extractAgentResponseText(JSON.stringify({ answer: ['first', 'second'] }))).toMatchObject({
      extraction: 'lenient-message',
      conversationText: 'first\nsecond',
      response: { kind: 'message', markdown: 'first\nsecond' },
    })
  })
})
