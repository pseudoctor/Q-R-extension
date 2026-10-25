import assert from 'node:assert/strict'
import { isValidCustomEndpoint } from '../src/ai/providers.ts'

assert.equal(isValidCustomEndpoint('https://[::1]/v1/chat/completions'), true)
assert.equal(isValidCustomEndpoint('http://[::1]/v1/chat/completions'), false)
assert.equal(isValidCustomEndpoint('http://localhost:8787/v1/chat/completions'), true)
assert.equal(isValidCustomEndpoint('http://example.com/v1/chat/completions'), false)

console.log('PASS: custom endpoints allow HTTPS and documented local HTTP hosts only.')
