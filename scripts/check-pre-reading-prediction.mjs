import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file) => readFileSync(resolve(import.meta.dirname, '..', file), 'utf8')
const coach = read('src/ai/coach.ts')
const background = read('src/background.ts')
const reading = read('src/export/reading.ts')
const markdown = read('src/export/markdown.ts')
const app = read('src/App.tsx')

assert.match(coach, /preReadingPrediction/)
assert.match(coach, /stepIndex === 0 && prediction/)
assert.match(coach, /阅读前预测与文章实际主张有哪些重合和偏差/)
assert.match(coach, /允许预测合理但不完整或不准确/)
assert.match(background, /article\.preReadingPrediction/)
assert.match(background, /pendingCapture: null/)
assert.match(background, /preReadingPredictionDraft/)
assert.match(background, /save-pre-reading-prediction-draft/)
assert.match(reading, /preReadingPrediction/)
assert.match(reading, /## 阅读前预测/)
assert.match(markdown, /preReadingPrediction/)
assert.match(app, /阅读前预测（可选）/)
assert.match(app, /open-manual-paste-page/)
assert.match(app, /save-pre-reading-prediction-draft/)
assert.ok(app.includes('maxLength={2000}'))

console.log('PASS: pre-reading prediction is wired into the editor, AI prompts, and exports.')
