import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettingsStorage } from '../lib/appSettings'
import { useSettingsStore } from './settingsStore'

describe('settings store storage warnings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, loaded: false, warnings: [] })
  })

  it('surfaces reset storage warnings in state', () => {
    const storage: AppSettingsStorage = {
      load: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: [] }),
      save: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: ['Unable to save app settings storage. QuotaExceededError: full'] }),
      clear: () => ({ settings: DEFAULT_APP_SETTINGS, warnings: [] }),
    }

    useSettingsStore.getState().reset(storage)

    expect(useSettingsStore.getState().warnings).toEqual(['Unable to save app settings storage. QuotaExceededError: full'])
  })
})