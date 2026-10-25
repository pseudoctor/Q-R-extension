import type { AiSettings, StorageState } from '../types'
import { defaultAiSettings, normalizeAiSettings } from '../ai/providers'

export const AI_SETTINGS_KEY = 'aiSettings'

export async function readAiSettings(): Promise<AiSettings> {
  const stored = await chrome.storage.local.get(AI_SETTINGS_KEY) as StorageState
  return stored.aiSettings ? normalizeAiSettings(stored.aiSettings) : defaultAiSettings()
}

export async function writeAiSettings(settings: AiSettings) {
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: normalizeAiSettings(settings) })
}

