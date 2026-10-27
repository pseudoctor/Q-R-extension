import assert from 'node:assert/strict'
import { isValidCustomEndpoint } from '../src/ai/providers.ts'
import { hostPermissionPattern } from '../src/permissions.ts'

assert.equal(isValidCustomEndpoint('https://[::1]/v1/chat/completions'), false)
assert.equal(isValidCustomEndpoint('http://[::1]/v1/chat/completions'), false)
assert.equal(isValidCustomEndpoint('http://localhost:8787/v1/chat/completions'), true)
assert.equal(isValidCustomEndpoint('http://example.com/v1/chat/completions'), false)
assert.equal(isValidCustomEndpoint('https://169.254.169.254/v1/chat/completions'), false)
assert.equal(isValidCustomEndpoint('https://service.internal/v1/chat/completions'), false)
assert.equal(isValidCustomEndpoint('https://api.example.com/v1/chat/completions?token=secret'), false)
assert.equal(isValidCustomEndpoint('https://api.example.com/v1/chat/completions#fragment'), false)
assert.equal(isValidCustomEndpoint('https://api.example.com/v1/chat/completions'), true)
assert.equal(isValidCustomEndpoint('https://user:pass@example.com/v1/chat/completions'), false)
assert.equal(hostPermissionPattern('https://api.example.com/v1/chat/completions'), 'https://api.example.com/*')
assert.equal(hostPermissionPattern('http://localhost:8787/v1/chat/completions'), 'http://localhost/*')
assert.equal(hostPermissionPattern('http://example.com/v1/chat/completions'), null)

console.log('PASS: custom endpoints and runtime host permission patterns allow HTTPS and documented local HTTP hosts only.')
