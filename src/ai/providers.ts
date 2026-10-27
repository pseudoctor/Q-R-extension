import type { AiProviderId, AiSettings } from '../types'

export type AiProvider = {
  id: AiProviderId
  baseUrl: string
  defaultModel: string
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4-mini',
  },
  {
    id: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
  },
  {
    id: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
  },
  {
    id: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
  {
    id: 'glm',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
  },
  {
    id: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
  },
  {
    id: 'custom',
    baseUrl: '',
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

export function providerEndpoint(settings: Pick<AiSettings, 'provider' | 'endpoint'>) {
  const provider = providerById(settings.provider)
  return provider.id === 'custom'
    ? settings.endpoint.trim()
    : `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`
}

export function isValidCustomEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint.trim())
    return isAllowedEndpointProtocol(url) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /\/chat\/completions\/?$/i.test(url.pathname)
  } catch {
    return false
  }
}

function isAllowedEndpointProtocol(url: URL) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1'].includes(hostname) && !isDangerousPort(url.port)
  if (url.protocol !== 'https:') return false
  if (isIpLiteral(hostname) || isLocalHostname(hostname) || isDnsAlias(hostname) || isDangerousPort(url.port)) return false
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(hostname)
}

function isIpLiteral(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data.ec2.internal'
}

function isDnsAlias(hostname: string) {
  return ['.nip.io', '.sslip.io', '.xip.io', '.localtest.me', '.lvh.me', '.vcap.me'].some((suffix) => hostname.endsWith(suffix))
}

function isDangerousPort(port: string) {
  return new Set(['22', '23', '25', '53', '110', '143', '445', '2375', '3306', '5432', '6379', '9200', '11211', '27017']).has(port)
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

