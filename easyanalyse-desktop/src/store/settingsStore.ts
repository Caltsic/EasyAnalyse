import { create } from 'zustand'
import {
  createAppSettingsStorage,
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  type AppSettingsStorage,
} from '../lib/appSettings'
import type { AppSettings } from '../types/settings'

export interface SettingsState {
  settings: AppSettings
  loaded: boolean
  warnings: string[]
  load(storage?: AppSettingsStorage): void
  replaceSettings(settings: unknown, storage?: AppSettingsStorage): void
  reset(storage?: AppSettingsStorage): void
}

function defaultStorage() {
  return createAppSettingsStorage()
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_APP_SETTINGS,
  loaded: false,
  warnings: [],

  load: (storage = defaultStorage()) => {
    const result = storage.load()
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
  },

  replaceSettings: (settings, storage = defaultStorage()) => {
    const result = storage.save(normalizeAppSettings(settings).settings)
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
  },

  reset: (storage = defaultStorage()) => {
    const result = storage.save(DEFAULT_APP_SETTINGS)
    set({ settings: result.settings, loaded: true, warnings: result.warnings })
  },
}))
