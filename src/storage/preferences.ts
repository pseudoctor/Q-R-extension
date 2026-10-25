import type { Locale, StorageState } from '../types'
import { detectLocale, normalizeLocale } from '../i18n/types'

export const LOCALE_KEY = 'locale'

export async function readLocale(): Promise<Locale> {
  const stored = await chrome.storage.local.get(LOCALE_KEY) as StorageState
  return normalizeLocale(stored.locale) ?? detectLocale()
}

export async function writeLocale(locale: Locale) {
  await chrome.storage.local.set({ [LOCALE_KEY]: locale })
  return locale
}
