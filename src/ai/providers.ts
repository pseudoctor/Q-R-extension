import type { AiProviderId, AiSettings } from '../types'

export type AiProvider = {
  id: AiProviderId
  baseUrl: string
  hostPattern: string
  defaultModel: string
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    hostPattern: 'https://api.openai.com/*',
    defaultModel: 'gpt-5.4-mini',
  },
  {
    id: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    hostPattern: 'https://api.deepseek.com/*',
    defaultModel: 'deepseek-flash',
  },
  {
    id: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    hostPattern: 'https://generativelanguage.googleapis.com/*',
    defaultModel: 'gemini-2.5-flash',
  },
  {
    id: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    hostPattern: 'https://dashscope.aliyuncs.com/*',
    defaultModel: 'qwen-plus',
  },
  {
    id: 'glm',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hostPattern: 'https://open.bigmodel.cn/*',
    defaultModel: 'glm-4-plus',
  },
  {
    id: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    hostPattern: 'https://api.moonshot.cn/*',
    defaultModel: 'kimi-k2.5',
  },
  {
    id: 'custom',
    baseUrl: '',
    hostPattern: '',
    defaultModel: '',
  },
]

export function providerById(id: AiProviderId) {
  return AI_PROVIDERS.find((provider) => provider.id === id) ?? AI_PROVIDERS[0]
}

export function defaultAiSettings(): AiSettings {
  const provider = AI_PROVIDERS[0]
  return { provider: provider.id, model: provider.defaultModel, apiKey: '', endpoint: '' }
}

export function normalizeAiSettings(value: unknown): AiSettings {
  if (!isRecord(value)) return defaultAiSettings()
  const rawProvider = value.provider
  const provider = typeof rawProvider === 'string' && AI_PROVIDERS.some((item) => item.id === rawProvider)
    ? rawProvider as AiProviderId
    : AI_PROVIDERS[0].id
  const config = providerById(provider)
  const model = typeof value.model === 'string' && /^[A-Za-z0-9._:/-]{0,120}$/.test(value.model.trim())
    ? value.model.trim()
    : config.defaultModel
  const apiKey = typeof value.apiKey === 'string' && value.apiKey.length <= 500 && !hasControlCharacter(value.apiKey)
    ? value.apiKey.trim()
    : ''
  const endpoint = typeof value.endpoint === 'string' && value.endpoint.length <= 1_000 && !hasControlCharacter(value.endpoint)
    ? value.endpoint.trim()
    : ''
  return { provider, model: model || config.defaultModel, apiKey, endpoint }
}

export function providerEndpoint(settings: AiSettings) {
  const provider = providerById(settings.provider)
  return provider.id === 'custom'
    ? settings.endpoint.trim()
    : `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`
}

export function providerOriginPattern(settings: AiSettings) {
  const provider = providerById(settings.provider)
  if (provider.id !== 'custom') return provider.hostPattern
  if (!isValidCustomEndpoint(settings.endpoint)) return ''
  try {
    const url = new URL(providerEndpoint(settings))
    if (!isAllowedEndpointProtocol(url)) return ''
    return `${url.protocol}//${url.host}/*`
  } catch {
    return ''
  }
}

export function isValidCustomEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint.trim())
    return isAllowedEndpointProtocol(url) &&
      !url.username &&
      !url.password &&
      /\/chat\/completions\/?$/i.test(url.pathname)
  } catch {
    return false
  }
}

function isAllowedEndpointProtocol(url: URL) {
  return url.protocol === 'https:' || (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

