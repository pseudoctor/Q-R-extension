import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const manifestPath = resolve(dist, 'manifest.json')

if (!existsSync(manifestPath)) {
  throw new Error('dist/manifest.json 不存在，请先运行 pnpm build。')
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.default_locale !== 'zh_CN') {
  throw new Error('构建产物缺少默认语言配置：zh_CN')
}
const requiredFiles = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  'training.html',
  'print.html',
  'settings.html',
  manifest.icons?.['16'],
  manifest.icons?.['32'],
  manifest.icons?.['48'],
  manifest.icons?.['128'],
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

if (Array.isArray(manifest.host_permissions) && manifest.host_permissions.length > 0) {
  throw new Error('manifest 不应声明全站 host_permissions；当前页抓取应使用 activeTab 临时权限。')
}

const extensionCsp = manifest.content_security_policy?.extension_pages ?? ''
if (!extensionCsp.includes("img-src 'self' data:")) {
  throw new Error('manifest 未限制扩展页图片来源为自身资源和 data 图片。')
}
if (extensionCsp.includes('img-src \'self\' data: http: https:')) {
  throw new Error('manifest 仍允许扩展页加载任意 HTTP(S) 图片。')
}

const command = manifest.commands?.['capture-and-open']
if (!command?.suggested_key?.default || !command?.description) {
  throw new Error('manifest 缺少 capture-and-open 快捷键配置。')
}

const optionalHostPermissions = new Set(manifest.optional_host_permissions ?? [])
for (const origin of ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']) {
  if (!optionalHostPermissions.has(origin)) {
    throw new Error(`manifest 缺少 AI endpoint 的 optional host permission：${origin}`)
  }
}

const background = readFileSync(resolve(dist, manifest.background.service_worker), 'utf8')
for (const marker of ['ai-start', 'ai-grade', 'ai-reference-answer', 'rewind-training-session', 'continue-training', 'confirm-training-step', 'list-ai-models', 'open-manual-paste-page', 'currentStep', 'currentStepId', 'answerVersionId', 'aiRequests', 'nextStepId', 'flowId', 'trainingSessionsV2', 'trainingSessionsV3', 'trainingTestSessionsV3', 'TRAINING_READ_ONLY', 'TRAINING_AI_REQUIRED', 'sourceCitationRule', 'articleBody', 'blocks', 'chart', 'svg', 'canvas', 'advertisement', 'narrated by', 'itemprop=', '#rm_txt_zw', 'div, section', '浏览器内部页', '/chat/completions', 'AI_INVALID_ENDPOINT', 'AI_RESPONSE_INVALID_JSON', 'AbortController', 'response_format', 'reasoning_effort']) {
  if (!background.includes(marker)) {
    throw new Error(`Service Worker 缺少 AI 核心逻辑：${marker}`)
  }
}

const appBundle = readdirSync(resolve(dist, 'assets'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(resolve(dist, 'assets', file), 'utf8'))
  .join('\n')
for (const marker of ['AI FEEDBACK', '提交并评分', '配置 AI 后评分', '刷新模型', 'model-options-select', 'model-status', 'settings.apiEndpoint', 'provider.custom', '文章架', '成长记录', 'READING PREVIEW', 'articleBlocks', 'source-heading', 'obsidian://new', '十步训练', 'quick-browse', 'final-review', 'transitionAfterPreview', 'legacyReadOnly', 'historicalReadOnly', 'saveContinue', 'round-transition', 'review-required', 'confirmStillApplies', 'historyView', '手动粘贴文章', '快速开始', '获取当前文章', 'coach.field.expectedQuestion', 'side.quick.previewTitle', 'onChanged']) {
  if (!appBundle.includes(marker)) {
    throw new Error(`训练页面缺少核心交互：${marker}`)
  }
}
for (const forbidden of ['prepare-ai-bridge', 'import-ai-feedback', 'CHATGPT ASSISTED REVIEW', 'chatgpt.com', 'bridge-card']) {
  if (background.includes(forbidden) || appBundle.includes(forbidden)) {
    throw new Error(`构建产物仍包含已移除的桥接评分入口：${forbidden}`)
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

for (const locale of ['zh_CN', 'en', 'ja', 'ko']) {
  if (!existsSync(resolve(dist, '_locales', locale, 'messages.json'))) {
    throw new Error(`构建产物缺少本地化资源：_locales/${locale}/messages.json`)
  }
}

if (manifest.background?.type !== 'module') {
  throw new Error('Service Worker 必须以 module 模式运行。')
}

console.log('Extension manifest and build outputs are valid.')

