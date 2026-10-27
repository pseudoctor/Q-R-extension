import assert from 'node:assert/strict'
import { isExtensionMessage } from '../src/extension-message-validation.ts'

assert.equal(isExtensionMessage({ type: 'open-settings' }), true)
assert.equal(isExtensionMessage({ type: 'capture-current-page', source: 'side-panel' }), true)
assert.equal(isExtensionMessage({ type: 'save-locale', locale: 'zh-CN' }), true)
assert.equal(isExtensionMessage({
  type: 'save-ai-settings',
  settings: { provider: 'openai', model: 'gpt-5.4-mini', apiKey: '', endpoint: '' },
  preserveApiKey: true,
}), true)
assert.equal(isExtensionMessage({ type: 'capture-current-page', source: 'manual' }), false)
assert.equal(isExtensionMessage({ type: 'save-test-mode', enabled: 'true' }), false)
assert.equal(isExtensionMessage({ type: 'unknown-message' }), false)
assert.equal(isExtensionMessage({ type: 'delete-article', articleId: '' }), false)
assert.equal(isExtensionMessage({ type: 'get-training-session', articleId: 'article', extra: 'ignored' }), true)
assert.equal(isExtensionMessage({ type: 'save-training-draft', articleId: 'article', draft: 'x'.repeat(40_001) }), false)

console.log('PASS: runtime extension message validation rejects unknown, malformed, oversized, and invalid-source messages.')
