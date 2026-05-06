import { describe, expect, it } from 'vitest'
import { formatAgentReferenceExamplesForPrompt, selectAgentReferenceExamples } from './agentExampleLibrary'

describe('agentExampleLibrary', () => {
  it('selects relevant RS-485 high-complexity example for interface requests', () => {
    const examples = selectAgentReferenceExamples('Generate an MCU RS485 interface with protection', null)
    expect(examples[0]?.id).toBe('mcu-rs485-node-reference')
  })

  it('does not inject unrelated examples for generic non-circuit prompts', () => {
    expect(selectAgentReferenceExamples('hello, explain the current file', null)).toEqual([])
  })

  it('formats compact semantic v4 JSON examples without legacy wires or nodes', () => {
    const text = formatAgentReferenceExamplesForPrompt(selectAgentReferenceExamples('opamp amplifier', null, 2))
    expect(text).toContain('schemaVersion')
    expect(text).toContain('terminal labels define connectivity')
    expect(text).not.toMatch(/"wires"|"nodes"|"junction"|"signalId"/)
  })
})
