import { APP_SETTINGS_STORAGE_KEY, createAppSettingsStorage } from './appSettings'
import type { AppThemeMode } from '../types/settings'

export type ThemeMode = 'light' | 'dark'
export type ThemePreference = AppThemeMode

export const LEGACY_THEME_STORAGE_KEY = 'easyanalyse.theme'
export const THEME_STORAGE_KEY = LEGACY_THEME_STORAGE_KEY

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function getSystemTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  try {
    return window.matchMedia?.(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function getSystemThemeMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }

  try {
    return window.matchMedia(SYSTEM_DARK_QUERY)
  } catch {
    return null
  }
}

export function resolveThemePreference(preference: ThemePreference): ThemeMode {
  return preference === 'system' ? getSystemTheme() : preference
}

function removeLegacyThemePreference(storage: Storage): void {
  try {
    storage.removeItem(LEGACY_THEME_STORAGE_KEY)
  } catch {
    // Best-effort cleanup only: AppSettings is now the source of truth.
  }
}

function readStoredAppThemePreference(storage: Storage): ThemePreference | null {
  try {
    const raw = storage.getItem(APP_SETTINGS_STORAGE_KEY)
    if (raw === null) {
      return null
    }
    return createAppSettingsStorage(storage).load().settings.appearance.theme
  } catch {
    return null
  }
}

function readLegacyThemePreference(storage: Storage): ThemePreference | null {
  try {
    const legacy = storage.getItem(LEGACY_THEME_STORAGE_KEY)
    return legacy === 'light' || legacy === 'dark' ? legacy : null
  } catch {
    return null
  }
}

export function persistThemePreference(preference: ThemePreference): void {
  const storage = getLocalStorage()
  if (storage === null) {
    return
  }

  const appSettingsStorage = createAppSettingsStorage(storage)
  const loaded = appSettingsStorage.load().settings
  appSettingsStorage.save({
    ...loaded,
    appearance: {
      ...loaded.appearance,
      theme: preference,
    },
  })

  removeLegacyThemePreference(storage)
}

export function getInitialThemePreference(): ThemePreference {
  const storage = getLocalStorage()
  if (storage === null) {
    return 'system'
  }

  const appTheme = readStoredAppThemePreference(storage)
  if (appTheme !== null) {
    removeLegacyThemePreference(storage)
    return appTheme
  }

  const legacyTheme = readLegacyThemePreference(storage)
  if (legacyTheme !== null) {
    persistThemePreference(legacyTheme)
    return legacyTheme
  }

  return 'system'
}

export function getInitialTheme(): ThemeMode {
  return resolveThemePreference(getInitialThemePreference())
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function storeTheme(theme: ThemeMode) {
  persistThemePreference(theme)
}
