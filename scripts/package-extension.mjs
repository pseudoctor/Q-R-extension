import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const release = resolve(root, 'release')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const output = resolve(release, `toulmin-reader-extension-v${packageJson.version}.zip`)

if (!existsSync(dist)) throw new Error('缺少 dist/，请先运行 pnpm build。')
mkdirSync(release, { recursive: true })
if (existsSync(output)) unlinkSync(output)

try {
  execFileSync('zip', ['-qr', '-X', output, '.', '-x', '.DS_Store', '*/.DS_Store'], { cwd: dist, stdio: 'inherit' })
} catch (error) {
  throw new Error(`无法调用系统 zip 工具生成发布包：${error instanceof Error ? error.message : String(error)}`)
}

const size = statSync(output).size
if (size <= 0) throw new Error('发布压缩包为空。')
console.log(`Extension package created: ${output} (${size} bytes).`)
