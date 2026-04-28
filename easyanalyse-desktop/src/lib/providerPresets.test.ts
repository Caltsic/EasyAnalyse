import { describe, expect, it } from 'vitest'
import { DEEPSEEK_PROVIDER_PRESET, PROVIDER_PRESETS } from './providerPresets'

describe('provider presets', () => {
  it('exports exact DeepSeek public metadata without apiKeyRef or secret-shaped fields', () => {
    expect(DEEPSEEK_PROVIDER_PRESET).toEqual({
      id: 'deepseek',
      name: 'DeepSeek',
      kind: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      defaultModel: 'deepseek-chat',
    })

    expect(DEEPSEEK_PROVIDER_PRESET).not.toHaveProperty('apiKeyRef')
    expect(PROVIDER_PRESETS).toContain(DEEPSEEK_PROVIDER_PRESET)

    const secretShapedFieldPattern = /(?:apiKey|apiKeyRef|secret|token|password|authorization)/i
    for (const fieldName of Object.keys(DEEPSEEK_PROVIDER_PRESET)) {
      expect(fieldName).not.toMatch(secretShapedFieldPattern)
    }
    expect(JSON.stringify(DEEPSEEK_PROVIDER_PRESET)).not.toMatch(/(?:apiKeyRef|secret-ref:|keychain:\/\/|Bearer\s+)/i)
  })

  it('does not allow exported preset metadata or the registry to be mutated by importers', () => {
    const originalPreset = structuredClone(DEEPSEEK_PROVIDER_PRESET)
    const originalRegistry = structuredClone(PROVIDER_PRESETS)
    const originalRegistryItems = [...PROVIDER_PRESETS]
    const mutablePreset = DEEPSEEK_PROVIDER_PRESET as unknown as { name: string; models: string[]; apiKeyRef?: string }
    const mutableRegistry = PROVIDER_PRESETS as unknown as unknown[]
    const attemptMutation = (mutation: () => void) => {
      try {
        mutation()
      } catch {
        // Runtime-frozen exports may throw in strict mode; that is acceptable.
      }
    }

    attemptMutation(() => { mutablePreset.name = 'Mutated DeepSeek' })
    attemptMutation(() => { mutablePreset.models.push('mutated-model') })
    attemptMutation(() => { mutablePreset.apiKeyRef = 'secret-ref:attempted-mutation' })
    attemptMutation(() => {
      mutableRegistry.push({
        id: 'mutated-preset',
        name: 'Mutated Preset',
        kind: 'deepseek',
        baseUrl: 'https://example.invalid/mutated',
        models: ['mutated-model'],
      })
    })

    const mutatedPreset = structuredClone(DEEPSEEK_PROVIDER_PRESET)
    const mutatedRegistry = structuredClone(PROVIDER_PRESETS)

    attemptMutation(() => { mutablePreset.name = originalPreset.name })
    attemptMutation(() => { mutablePreset.models.splice(0, mutablePreset.models.length, ...originalPreset.models) })
    attemptMutation(() => { delete mutablePreset.apiKeyRef })
    attemptMutation(() => { mutableRegistry.splice(0, mutableRegistry.length, ...originalRegistryItems) })

    expect(mutatedPreset).toEqual(originalPreset)
    expect(mutatedRegistry).toEqual(originalRegistry)
  })
})
