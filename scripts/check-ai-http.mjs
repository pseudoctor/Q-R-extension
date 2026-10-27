import assert from 'node:assert/strict'
import { withResponseTimeout, withTimeout } from '../src/ai/http.ts'

let aborted = false
await assert.rejects(
  withTimeout(20, (signal) => {
    signal.addEventListener('abort', () => { aborted = true }, { once: true })
    return new Promise(() => {})
  }),
  (error) => error instanceof DOMException && error.name === 'AbortError',
)
assert.equal(aborted, true)
assert.equal(await withTimeout(100, async () => 'ok'), 'ok')

let responseBodyAborted = false
await assert.rejects(
  withResponseTimeout(20, async (signal) => {
    signal.addEventListener('abort', () => { responseBodyAborted = true }, { once: true })
    return { json: () => new Promise(() => {}) }
  }),
  (error) => error instanceof DOMException && error.name === 'AbortError',
)
assert.equal(responseBodyAborted, true)

console.log('PASS: timed-out AI operations abort and resolve normally before the deadline.')
