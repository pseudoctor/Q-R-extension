import type { Locale, StorageState } from '../types'
import { detectLocale, normalizeLocale } from '../i18n/types'

export const LOCALE_KEY = 'locale'
export const TEST_MODE_KEY = 'testMode'

export async function readLocale(): Promise<Locale> {
  const stored = await chrome.storage.local.get(LOCALE_KEY) as StorageState
  return normalizeLocale(stored.locale) ?? detectLocale()
}

export async function writeLocale(locale: Locale) {
  await chrome.storage.local.set({ [LOCALE_KEY]: locale })
  return locale
}

export async function readTestMode(): Promise<boolean> {
  const stored = await chrome.storage.local.get(TEST_MODE_KEY) as StorageState
  return stored.testMode === true
}

export async function writeTestMode(enabled: boolean) {
  await chrome.storage.local.set({ [TEST_MODE_KEY]: enabled })
  return enabled
}
