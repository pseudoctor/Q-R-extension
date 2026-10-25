import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ExtensionResponse, Locale } from '../types'
import { detectLocale, LOCALE_OPTIONS, normalizeLocale } from './types'
import { translate } from './messages'

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => Promise<void>
  t: (key: string, variables?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale())

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      const nextLocale = normalizeLocale(changes.locale?.newValue)
      if (nextLocale) setLocaleState(nextLocale)
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    void chrome.runtime.sendMessage({ type: 'get-locale' }).then((response: ExtensionResponse<Locale>) => {
      if (response.ok) setLocaleState(response.data)
    })
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  const setLocale = async (nextLocale: Locale) => {
    setLocaleState(nextLocale)
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return
    await chrome.runtime.sendMessage({ type: 'save-locale', locale: nextLocale })
  }

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, variables) => translate(locale, key, variables),
  }), [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within I18nProvider')
  return { ...context, localeOptions: LOCALE_OPTIONS }
}
