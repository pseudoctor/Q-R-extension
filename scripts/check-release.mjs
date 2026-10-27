import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const sourceManifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8'))
const distManifestPath = resolve(root, 'dist/manifest.json')

if (packageJson.version !== sourceManifest.version) {
  throw new Error(`版本未同步：package.json=${packageJson.version}，public/manifest.json=${sourceManifest.version}`)
}
if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
  throw new Error(`版本必须是三段式 semver：${packageJson.version}`)
}
if (!existsSync(distManifestPath)) {
  throw new Error('缺少 dist/manifest.json，请先运行 pnpm build。')
}

const distManifest = JSON.parse(readFileSync(distManifestPath, 'utf8'))
if (distManifest.version !== packageJson.version) {
  throw new Error(`构建产物版本未同步：dist/manifest.json=${distManifest.version}，package.json=${packageJson.version}`)
}

execFileSync(process.execPath, [resolve(root, 'scripts/check-store-assets.mjs')], { stdio: 'inherit' })
console.log(`Release metadata is valid: v${packageJson.version}.`)
