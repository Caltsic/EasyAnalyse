import { useCallback, useEffect, useState } from 'react'
import { applyTheme, getInitialTheme, storeTheme, THEME_STORAGE_KEY, type ThemeMode } from './theme'

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme())

  useEffect(() => {
    applyTheme(theme)
    storeTheme(theme)
  }, [theme])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) {
        return
      }
      if (event.newValue === 'light' || event.newValue === 'dark') {
        setTheme(event.newValue)
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return {
    theme,
    isDarkTheme: theme === 'dark',
    toggleTheme,
  }
}
