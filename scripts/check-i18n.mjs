import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const locales = [
  { source: 'zh-CN', chrome: 'zh_CN' },
  { source: 'en', chrome: 'en' },
  { source: 'ja', chrome: 'ja' },
  { source: 'ko', chrome: 'ko' },
]

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function extractMessageKeys(source, locale) {
  const marker = new RegExp(`^  (?:'${locale}'|${locale}): \\{`, 'm')
  const match = marker.exec(source)
  const start = match?.index ?? -1
  if (start < 0) throw new Error(`消息目录缺少语言：${locale}`)
  const blockStart = start + match[0].length
  const blockEnd = source.indexOf('\n  },', blockStart)
  if (blockEnd < 0) throw new Error(`消息目录语言块未闭合：${locale}`)
  const block = source.slice(blockStart, blockEnd)
  const keys = [...block.matchAll(/^\s+'([^']+)':/gm)].map((match) => match[1])
  if (keys.length !== new Set(keys).size) throw new Error(`消息目录存在重复键：${locale}`)
  return new Set(keys)
}

function compareKeys(label, expected, actual) {
  const missing = [...expected].filter((key) => !actual.has(key))
  const extra = [...actual].filter((key) => !expected.has(key))
  if (missing.length || extra.length) {
    throw new Error(`${label} 键不一致：缺少 ${missing.join(', ') || '无'}；多出 ${extra.join(', ') || '无'}`)
  }
}

const source = readFileSync(resolve(root, 'src/i18n/messages.ts'), 'utf8')
const sourceKeys = new Map(locales.map(({ source: locale }) => [locale, extractMessageKeys(source, locale)]))
const expectedSourceKeys = sourceKeys.get('zh-CN')
for (const { source: locale } of locales) {
  compareKeys(`src/i18n/messages.ts ${locale}`, expectedSourceKeys, sourceKeys.get(locale))
}

const manifest = readJson(resolve(root, 'public/manifest.json'))
if (manifest.default_locale !== 'zh_CN') throw new Error('manifest.default_locale 必须是 zh_CN。')
if (manifest.name !== '__MSG_extName__' || manifest.description !== '__MSG_extDescription__') {
  throw new Error('manifest 的名称和描述必须使用 Chrome 国际化占位符。')
}
if (manifest.action?.default_title !== '__MSG_actionTitle__') {
  throw new Error('manifest.action.default_title 必须使用 Chrome 国际化占位符。')
}
if (manifest.commands?.['capture-and-open']?.description !== '__MSG_captureCommand__') {
  throw new Error('capture-and-open 快捷键描述必须使用 Chrome 国际化占位符。')
}

let chromeKeys
for (const { chrome: locale } of locales) {
  const path = resolve(root, 'public/_locales', locale, 'messages.json')
  if (!existsSync(path)) throw new Error(`缺少 Chrome 本地化文件：${path}`)
  const values = readJson(path)
  const keys = new Set(Object.keys(values))
  if (!chromeKeys) chromeKeys = keys
  else compareKeys(`public/_locales/${locale}/messages.json`, chromeKeys, keys)
  for (const [key, value] of Object.entries(values)) {
    if (!value || typeof value.message !== 'string' || !value.message.trim()) {
      throw new Error(`Chrome 本地化消息无效：${locale}/${key}`)
    }
  }
}

const requiredKeys = [
  'common.productName',
  'settings.language',
  'settings.apiEndpoint',
  'settings.customEndpointNote',
  'coach.startAi',
  'provider.custom',
  'error.AI_INVALID_ENDPOINT',
  'export.sourceText',
]
for (const key of requiredKeys) {
  if (!expectedSourceKeys.has(key)) throw new Error(`消息目录缺少核心键：${key}`)
}

console.log(`i18n catalogs are valid: ${locales.length} languages, ${expectedSourceKeys.size} UI messages.`)
