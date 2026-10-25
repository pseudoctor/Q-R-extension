import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file) => readFileSync(resolve(import.meta.dirname, '..', file), 'utf8')
const coach = read('src/ai/coach.ts')
const background = read('src/background.ts')
const reading = read('src/export/reading.ts')
const markdown = read('src/export/markdown.ts')
const app = read('src/App.tsx')
const messages = read('src/i18n/messages.ts')

assert.match(coach, /preReadingPrediction/)
assert.match(coach, /stepIndex === 0 && prediction/)
assert.match(messages, /ai\.startReflection/)
assert.match(messages, /阅读前预测与文章实际主张有哪些重合和偏差/)
assert.match(messages, /允许预测合理但不完整或不准确/)
assert.match(background, /article\.preReadingPrediction/)
assert.match(background, /pendingCapture: null/)
assert.match(background, /preReadingPredictionDraft/)
assert.match(background, /save-pre-reading-prediction-draft/)
assert.match(reading, /preReadingPrediction/)
assert.match(markdown, /preReadingPrediction/)
assert.match(app, /open-manual-paste-page/)
assert.match(app, /save-pre-reading-prediction-draft/)
assert.match(messages, /training\.prediction/)
assert.match(messages, /export\.prediction/)
assert.ok(app.includes('maxLength={2000}'))

console.log('PASS: pre-reading prediction is wired into the editor, AI prompts, and exports.')
