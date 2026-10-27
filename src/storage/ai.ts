import type { AiSettings, AiSettingsView, StorageState, StoredAiSettings } from '../types'
import { defaultAiSettings, normalizeAiSettings } from '../ai/providers'

export const AI_SETTINGS_KEY = 'aiSettings'
export const AI_API_KEY_SESSION_KEY = 'aiApiKey'

export async function readAiSettings(): Promise<AiSettings> {
  const [stored, session] = await Promise.all([
    chrome.storage.local.get(AI_SETTINGS_KEY) as Promise<StorageState>,
    chrome.storage.session.get(AI_API_KEY_SESSION_KEY) as Promise<{ [AI_API_KEY_SESSION_KEY]?: unknown }>,
  ])
  const normalized = stored.aiSettings ? normalizeAiSettings(stored.aiSettings) : defaultAiSettings()
  const sessionApiKey = typeof session[AI_API_KEY_SESSION_KEY] === 'string' ? session[AI_API_KEY_SESSION_KEY].trim() : ''
  const legacyApiKey = normalized.apiKey
  const apiKey = sessionApiKey || legacyApiKey
  if (legacyApiKey && !sessionApiKey) {
    await chrome.storage.session.set({ [AI_API_KEY_SESSION_KEY]: legacyApiKey })
  }
  if (stored.aiSettings && legacyApiKey) {
    try {
      await chrome.storage.local.set({ [AI_SETTINGS_KEY]: withoutApiKey(normalized) })
    } catch {
      // Keep the session copy as the source of truth and retry local cleanup later.
    }
  }
  return { ...normalized, apiKey }
}

export async function readAiSettingsView(): Promise<AiSettingsView> {
  const settings = await readAiSettings()
  const { apiKey: _apiKey, ...view } = settings
  return { ...view, apiKeyConfigured: Boolean(settings.apiKey) }
}

export async function writeAiSettings(
  settings: AiSettings,
  options: { preserveApiKey?: boolean; clearApiKey?: boolean } = {},
) {
  const normalized = normalizeAiSettings(settings)
  const existing = options.preserveApiKey && !options.clearApiKey ? await readAiSettings() : null
  const apiKey = options.clearApiKey ? '' : normalized.apiKey || existing?.apiKey || ''
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: withoutApiKey(normalized) })
  if (apiKey) await chrome.storage.session.set({ [AI_API_KEY_SESSION_KEY]: apiKey })
  else await chrome.storage.session.remove(AI_API_KEY_SESSION_KEY)
  return { ...normalized, apiKey }
}

function withoutApiKey(settings: AiSettings): StoredAiSettings {
  const { apiKey: _apiKey, ...safeSettings } = settings
  return safeSettings
}

