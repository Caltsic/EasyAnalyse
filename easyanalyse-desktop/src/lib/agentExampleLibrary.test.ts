import { describe, expect, it } from 'vitest'
import { AGENT_REFERENCE_EXAMPLES, formatAgentReferenceExamplesForPrompt, selectAgentReferenceExamples } from './agentExampleLibrary'
import { checkLayoutOverlaps } from './layoutValidation'

describe('agentExampleLibrary', () => {
  it('selects relevant RS-485 high-complexity example for interface requests', () => {
    const examples = selectAgentReferenceExamples('Generate an MCU RS485 interface with protection', null)
    expect(examples[0]?.id).toBe('mcu-rs485-node-reference')
  })

  it('selects active low-pass reference for high-Q filter requests', () => {
    const examples = selectAgentReferenceExamples('生成一个截止频率为2kHz的高Q值的低通滤波器电路，输入为500Hz方波', null)
    expect(examples[0]?.id).toBe('sallen-key-lowpass-reference')
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

  it('keeps reference example device and network-line layout checks clean', () => {
    for (const example of AGENT_REFERENCE_EXAMPLES) {
      expect(checkLayoutOverlaps(example.document).issues, example.id).toEqual([])
    }
  })
})
