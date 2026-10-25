import type { Locale } from '../types'

export const LOCALE_OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
]

export function normalizeLocale(value: unknown): Locale | null {
  if (value === 'zh-CN' || value === 'en' || value === 'ja' || value === 'ko') return value
  return null
}

export function detectLocale(language = typeof navigator === 'undefined' ? '' : navigator.language): Locale {
  const normalized = language.toLowerCase()
  if (normalized.startsWith('en')) return 'en'
  if (normalized.startsWith('ja')) return 'ja'
  if (normalized.startsWith('ko')) return 'ko'
  return 'zh-CN'
}
