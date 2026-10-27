import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ExtensionResponse, Locale } from '../types'
import { detectLocale, normalizeLocale } from './types'
import { translate } from './messages'
import { I18nContext, type I18nContextValue } from './context-value'

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
