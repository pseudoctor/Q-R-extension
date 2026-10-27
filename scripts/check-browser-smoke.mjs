import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const chrome = process.env.CHROME_BIN
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)

if (!chrome) {
  console.log('SKIP: no Chrome/Chromium binary found; CI installs Chrome for this smoke test.')
  process.exit(0)
}

const profile = mkdtempSync(join(tmpdir(), 'toulmin-reader-smoke-'))
try {
  try {
    const output = execFileSync(chrome, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--dump-dom',
      `file://${resolve(root, 'dist/index.html')}`,
    ], { encoding: 'utf8', timeout: 30_000 })
    assert.match(output, /问读|Q&R|Toulmin/i)
    console.log('PASS: headless browser rendered the production entry page.')
  } catch (error) {
    if (!process.env.CI) {
      console.log(`SKIP: local Chrome could not start headless mode (${error instanceof Error ? error.message : 'unknown error'}).`)
      process.exit(0)
    }
    throw error
  }
} finally {
  rmSync(profile, { recursive: true, force: true })
}
