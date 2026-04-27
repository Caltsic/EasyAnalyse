// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_SETTINGS_STORAGE_KEY } from './appSettings'
import {
  LEGACY_THEME_STORAGE_KEY,
  applyTheme,
  getInitialTheme,
  getInitialThemePreference,
  persistThemePreference,
  resolveThemePreference,
} from './theme'

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mql = {
    get matches() {
      return matches
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === 'change') listeners.add(listener)
    }),
    removeEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === 'change') listeners.delete(listener)
    }),
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => mql),
  })

  return {
    setMatches(nextMatches: boolean) {
      matches = nextMatches
      listeners.forEach((listener) => listener({ matches: nextMatches } as MediaQueryListEvent))
    },
  }
}

describe('theme preference migration and resolution', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults AppSettings appearance.theme=system to the current system color scheme', () => {
    installMatchMedia(true)
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ appearance: { theme: 'system' } }))

    expect(getInitialThemePreference()).toBe('system')
    expect(getInitialTheme()).toBe('dark')
    expect(resolveThemePreference('system')).toBe('dark')
  })

  it('honors forced light/dark from AppSettings over system color scheme', () => {
    installMatchMedia(true)
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ appearance: { theme: 'light' } }))
    expect(getInitialThemePreference()).toBe('light')
    expect(getInitialTheme()).toBe('light')

    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ appearance: { theme: 'dark' } }))
    expect(getInitialThemePreference()).toBe('dark')
    expect(getInitialTheme()).toBe('dark')
  })

  it('migrates the legacy easyanalyse.theme key into AppSettings appearance.theme and removes the legacy key', () => {
    installMatchMedia(false)
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')

    expect(getInitialThemePreference()).toBe('dark')

    const rawSettings = localStorage.getItem(APP_SETTINGS_STORAGE_KEY)
    expect(rawSettings).not.toBeNull()
    expect(JSON.parse(rawSettings ?? '{}').appearance.theme).toBe('dark')
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull()
  })

  it('removes a divergent legacy theme key when AppSettings already provides the theme', () => {
    installMatchMedia(false)
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ appearance: { theme: 'light' } }))
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')

    expect(getInitialThemePreference()).toBe('light')

    expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}').appearance.theme).toBe('light')
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull()
  })

  it('persists explicit theme preferences only through AppSettings', () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'light')

    persistThemePreference('system')

    expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}').appearance.theme).toBe('system')
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull()
  })

  it('applies the resolved light/dark theme to the document only', () => {
    applyTheme('dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})
