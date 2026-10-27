import { createContext } from 'react'
import type { Locale } from '../types'

export type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => Promise<void>
  t: (key: string, variables?: Record<string, string | number>) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)
