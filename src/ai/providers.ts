import type { AiProviderId, AiSettings } from '../types'

export type AiProvider = {
  id: AiProviderId
  label: string
  baseUrl: string
  hostPattern: string
  defaultModel: string
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    hostPattern: 'https://api.openai.com/*',
    defaultModel: 'gpt-5.4-mini',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    hostPattern: 'https://api.deepseek.com/*',
    defaultModel: 'deepseek-flash',
  },
  {
    id: 'gemini',
    label: 'Gemini（兼容接口）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    hostPattern: 'https://generativelanguage.googleapis.com/*',
    defaultModel: 'gemini-2.5-flash',
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    hostPattern: 'https://dashscope.aliyuncs.com/*',
    defaultModel: 'qwen-plus',
  },
  {
    id: 'glm',
    label: 'GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hostPattern: 'https://open.bigmodel.cn/*',
    defaultModel: 'glm-4-plus',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    hostPattern: 'https://api.moonshot.cn/*',
    defaultModel: 'kimi-k2.5',
  },
]

export function providerById(id: AiProviderId) {
  return AI_PROVIDERS.find((provider) => provider.id === id) ?? AI_PROVIDERS[0]
}

export function defaultAiSettings(): AiSettings {
  const provider = AI_PROVIDERS[0]
  return { provider: provider.id, model: provider.defaultModel, apiKey: '' }
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
  return { provider, model: model || config.defaultModel, apiKey }
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

