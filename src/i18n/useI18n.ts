import { useContext } from 'react'
import { I18nContext } from './context-value'
import { LOCALE_OPTIONS } from './types'

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within I18nProvider')
  return { ...context, localeOptions: LOCALE_OPTIONS }
}
