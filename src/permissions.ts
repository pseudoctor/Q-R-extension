import { isValidCustomEndpoint, providerEndpoint } from './ai/providers.ts'
import type { AiSettings } from './types.ts'

export function aiEndpoint(settings: Pick<AiSettings, 'provider' | 'endpoint'>) {
  if (settings.provider === 'custom' && !isValidCustomEndpoint(settings.endpoint)) return null
  return providerEndpoint(settings)
}

export function hostPermissionPattern(endpoint: string) {
  try {
    const url = new URL(endpoint)
    if (url.protocol === 'https:') return `https://${url.hostname}/*`
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) {
      return `http://${url.hostname}/*`
    }
  } catch {
    return null
  }
  return null
}

export async function hasAiHostPermission(endpoint: string) {
  const origin = hostPermissionPattern(endpoint)
  if (!origin || typeof chrome === 'undefined' || !chrome.permissions?.contains) return false
  return chrome.permissions.contains({ origins: [origin] })
}

export async function requestAiHostPermission(settings: Pick<AiSettings, 'provider' | 'endpoint'>) {
  const endpoint = aiEndpoint(settings)
  const origin = endpoint ? hostPermissionPattern(endpoint) : null
  if (!endpoint || !origin || typeof chrome === 'undefined' || !chrome.permissions?.request) return false
  try {
    return await chrome.permissions.request({ origins: [origin] })
  } catch {
    return false
  }
}
