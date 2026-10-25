import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const manifestPath = resolve(dist, 'manifest.json')

if (!existsSync(manifestPath)) {
  throw new Error('dist/manifest.json 不存在，请先运行 pnpm build。')
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const requiredFiles = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  'training.html',
  'print.html',
  'settings.html',
]

for (const file of requiredFiles) {
  if (typeof file !== 'string' || !existsSync(resolve(dist, file))) {
    throw new Error(`构建产物缺少 manifest 引用的文件：${file}`)
  }
}

const permissions = new Set(manifest.permissions ?? [])
for (const permission of ['activeTab', 'scripting', 'sidePanel', 'storage']) {
  if (!permissions.has(permission)) {
    throw new Error(`manifest 缺少必要权限：${permission}`)
  }
}

if (manifest.host_permissions) {
  throw new Error('当前 MVP 不应声明 host_permissions。')
}

const command = manifest.commands?.['capture-and-open']
if (!command?.suggested_key?.default || !command?.description) {
  throw new Error('manifest 缺少 capture-and-open 快捷键配置。')
}

const optionalOrigins = new Set(manifest.optional_host_permissions ?? [])
for (const origin of [
  'https://api.openai.com/*',
  'https://api.deepseek.com/*',
  'https://generativelanguage.googleapis.com/*',
  'https://dashscope.aliyuncs.com/*',
  'https://open.bigmodel.cn/*',
  'https://api.moonshot.cn/*',
]) {
  if (!optionalOrigins.has(origin)) {
    throw new Error(`manifest 缺少 AI 服务的可选网络权限：${origin}`)
  }
}

const background = readFileSync(resolve(dist, manifest.background.service_worker), 'utf8')
for (const marker of ['ai-start', 'ai-grade', 'list-ai-models', 'prepare-ai-bridge', 'import-ai-feedback', 'currentStep', 'articleBody', 'itemprop=', '浏览器内部页', '/chat/completions', 'AbortController']) {
  if (!background.includes(marker)) {
    throw new Error(`Service Worker 缺少 AI 核心逻辑：${marker}`)
  }
}

const appBundle = readdirSync(resolve(dist, 'assets'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(resolve(dist, 'assets', file), 'utf8'))
  .join('\n')
for (const marker of ['AI FEEDBACK', '提交并评分', 'CHATGPT ASSISTED REVIEW', '刷新模型', 'model-options-select', 'model-status', '文章架', '成长记录', 'obsidian://new']) {
  if (!appBundle.includes(marker)) {
    throw new Error(`训练页面缺少核心交互：${marker}`)
  }
}
if (!appBundle.includes('generateReadingMarkdown') && !appBundle.includes('完整 Markdown')) {
  throw new Error('训练页面缺少完整阅读记录导出。')
}

for (const asset of ['assets/donate-alipay.jpg', 'assets/donate-paypal.jpg']) {
  if (!existsSync(resolve(dist, asset))) {
    throw new Error(`构建产物缺少打赏资源：${asset}`)
  }
}

if (manifest.background?.type !== 'module') {
  throw new Error('Service Worker 必须以 module 模式运行。')
}

console.log('Extension manifest and build outputs are valid.')

