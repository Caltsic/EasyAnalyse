import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  APP_SETTINGS_STORAGE_KEY,
  createAppSettingsStorage,
} from './appSettings'
import {
  LEGACY_THEME_STORAGE_KEY,
  applyTheme,
  getInitialThemePreference,
  getSystemTheme,
  getSystemThemeMediaQuery,
  resolveThemePreference,
  type ThemeMode,
  type ThemePreference,
} from './theme'
import { useSettingsStore } from '../store/settingsStore'

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function useTheme() {
  const settingsTheme = useSettingsStore((state) => state.settings.appearance.theme)
  const settingsLoaded = useSettingsStore((state) => state.loaded)
  const loadSettings = useSettingsStore((state) => state.load)
  const replaceSettings = useSettingsStore((state) => state.replaceSettings)
  const settings = useSettingsStore((state) => state.settings)
  const [initialThemePreference] = useState<ThemePreference>(() => getInitialThemePreference())
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() => getSystemTheme())
  const themePreference = settingsLoaded ? settingsTheme : initialThemePreference

  useEffect(() => {
    if (!settingsLoaded) {
      loadSettings(createAppSettingsStorage())
    }
  }, [loadSettings, settingsLoaded])

  useEffect(() => {
    const mediaQuery = getSystemThemeMediaQuery()
    if (mediaQuery === null) {
      return
    }

    const handleChange = () => setSystemTheme(getSystemTheme())
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  const theme = useMemo<ThemeMode>(() => (themePreference === 'system' ? systemTheme : themePreference), [systemTheme, themePreference])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setThemePreference = useCallback(
    (nextPreference: ThemePreference) => {
      replaceSettings(
        {
          ...settings,
          appearance: {
            ...settings.appearance,
            theme: nextPreference,
          },
        },
        createAppSettingsStorage(),
      )
    },
    [replaceSettings, settings],
  )

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === APP_SETTINGS_STORAGE_KEY) {
        const nextSettings = createAppSettingsStorage().load().settings
        useSettingsStore.setState({ settings: nextSettings, loaded: true })
        return
      }

      if (event.key === LEGACY_THEME_STORAGE_KEY && isThemePreference(event.newValue)) {
        setThemePreference(event.newValue)
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [setThemePreference])

  const toggleTheme = useCallback(() => {
    setThemePreference(resolveThemePreference(themePreference) === 'dark' ? 'light' : 'dark')
  }, [setThemePreference, themePreference])

  return {
    theme,
    themePreference,
    isDarkTheme: theme === 'dark',
    toggleTheme,
    setThemePreference,
  }
}
