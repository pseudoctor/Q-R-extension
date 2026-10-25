import { existsSync, readFileSync } from 'node:fs'
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

if (manifest.background?.type !== 'module') {
  throw new Error('Service Worker 必须以 module 模式运行。')
}

console.log('Extension manifest and build outputs are valid.')

