import assert from 'node:assert/strict'
import { createServer } from 'vite'

const local = {}
const session = {}
const clone = (value) => value === undefined ? undefined : structuredClone(value)

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return { [key]: clone(local[key]) }
      },
      async set(values) {
        Object.assign(local, clone(values))
      },
    },
    session: {
      async get(key) {
        return { [key]: clone(session[key]) }
      },
      async set(values) {
        Object.assign(session, clone(values))
      },
      async remove(key) {
        delete session[key]
      },
    },
  },
}

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'silent' })
const { readAiSettings, readAiSettingsView, writeAiSettings } = await server.ssrLoadModule('/src/storage/ai.ts')

local.aiSettings = { provider: 'openai', model: 'gpt-5.4-mini', apiKey: 'legacy-secret', endpoint: '' }
const migrated = await readAiSettings()
assert.equal(migrated.apiKey, 'legacy-secret')
assert.equal(local.aiSettings.apiKey, undefined)
assert.equal(session.aiApiKey, 'legacy-secret')

await writeAiSettings({ provider: 'openai', model: 'gpt-5.4-mini', apiKey: 'new-secret', endpoint: '' })
assert.equal(local.aiSettings.apiKey, undefined)
assert.equal(session.aiApiKey, 'new-secret')
const view = await readAiSettingsView()
assert.equal(view.apiKeyConfigured, true)
assert.equal('apiKey' in view, false)

await writeAiSettings({ provider: 'openai', model: 'gpt-5.4-mini', apiKey: '', endpoint: '' }, { preserveApiKey: true })
assert.equal(session.aiApiKey, 'new-secret')
await writeAiSettings({ provider: 'openai', model: 'gpt-5.4-mini', apiKey: '', endpoint: '' }, { clearApiKey: true })
assert.equal(session.aiApiKey, undefined)
assert.equal((await readAiSettingsView()).apiKeyConfigured, false)

console.log('PASS: AI keys migrate out of local storage, remain session-only, and never appear in the settings view.')
await server.close()
