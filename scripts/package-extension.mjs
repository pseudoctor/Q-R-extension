import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const release = resolve(root, 'release')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'))
const output = resolve(release, `q-and-r-ai-critical-reading-coach-v${packageJson.version}.zip`)

if (!existsSync(dist)) throw new Error('缺少 dist/，请先运行 pnpm build。')
mkdirSync(release, { recursive: true })
if (existsSync(output)) unlinkSync(output)

try {
  const entries = releaseEntries(manifest)
  execFileSync('zip', ['-q', '-X', output, ...entries], { cwd: dist, stdio: 'inherit' })
} catch (error) {
  throw new Error(`无法调用系统 zip 工具生成发布包：${error instanceof Error ? error.message : String(error)}`)
}

const size = statSync(output).size
if (size <= 0) throw new Error('发布压缩包为空。')
console.log(`Extension package created: ${output} (${size} bytes).`)

function releaseEntries(manifest) {
  const entries = new Set([
    'manifest.json',
    'index.html',
    manifest.side_panel?.default_path,
    'training.html',
    'print.html',
    'settings.html',
    ...Object.values(manifest.icons ?? {}),
  ].filter((entry) => typeof entry === 'string'))

  const localeRoot = resolve(dist, '_locales')
  for (const locale of readdirSync(localeRoot, { withFileTypes: true })) {
    if (!locale.isDirectory()) continue
    entries.add(`_locales/${locale.name}/messages.json`)
  }

  const assetRoot = resolve(dist, 'assets')
  for (const asset of readdirSync(assetRoot, { withFileTypes: true })) {
    if (!asset.isFile() || !/\.(?:js|css|png|jpe?g|webp)$/i.test(asset.name)) {
      throw new Error(`发布 asset 不在允许白名单内：${asset.name}`)
    }
    entries.add(`assets/${asset.name}`)
  }

  for (const entry of entries) {
    if (!existsSync(resolve(dist, entry))) throw new Error(`发布白名单引用的文件不存在：${entry}`)
  }
  return [...entries]
}
