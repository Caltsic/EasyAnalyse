// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_SETTINGS_STORAGE_KEY, DEFAULT_APP_SETTINGS } from './appSettings'
import { useTheme } from './useTheme'
import { useSettingsStore } from '../store/settingsStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function Probe({ onSnapshot }: { onSnapshot: (snapshot: ReturnType<typeof useTheme>) => void }) {
  const theme = useTheme()
  onSnapshot(theme)
  return <button onClick={theme.toggleTheme}>{theme.themePreference}:{theme.theme}</button>
}

describe('useTheme AppSettings integration', () => {
  let container: HTMLDivElement
  let root: Root
  let latest: ReturnType<typeof useTheme>

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, loaded: false, warnings: [] })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('keeps system mode live when the OS color scheme changes', async () => {
    const media = installMatchMedia(false)
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ appearance: { theme: 'system' } }))

    await act(async () => {
      root.render(<Probe onSnapshot={(snapshot) => { latest = snapshot }} />)
    })

    expect(latest.themePreference).toBe('system')
    expect(latest.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    await act(async () => {
      media.setMatches(true)
    })

    expect(latest.themePreference).toBe('system')
    expect(latest.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}').appearance.theme).toBe('system')
  })

  it('toggles from system-resolved dark to forced light and persists appearance.theme', async () => {
    installMatchMedia(true)
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ appearance: { theme: 'system' } }))

    await act(async () => {
      root.render(<Probe onSnapshot={(snapshot) => { latest = snapshot }} />)
    })

    await act(async () => {
      latest.toggleTheme()
    })

    expect(latest.themePreference).toBe('light')
    expect(latest.theme).toBe('light')
    expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}').appearance.theme).toBe('light')
  })
})
