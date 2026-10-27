import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file) => readFileSync(resolve(import.meta.dirname, '..', file), 'utf8')
const coach = read('src/ai/coach.ts')
const background = read('src/background.ts')
const reading = read('src/export/reading.ts')
const app = read('src/App.tsx')
const messages = read('src/i18n/messages.ts')
const storage = read('src/storage/training.ts')

assert.doesNotMatch(coach, /preReadingPrediction/)
assert.doesNotMatch(messages, /ai\.startReflection/)
assert.match(messages, /coach\.transitionAfterPreview/)
assert.doesNotMatch(background, /article\.preReadingPrediction/)
assert.match(background, /async function startAiTraining/)
assert.doesNotMatch(background, /session\.currentStep === 0\s*\|\|\s*session\.currentStep >= LESSON_STEPS\.length/)
assert.match(storage, /TRAINING_SESSIONS_V2_KEY/)
assert.match(app, /type: 'ai-start'/)
assert.match(background, /pendingCapture: null/)
assert.match(reading, /preReadingPrediction/)
assert.match(app, /open-manual-paste-page/)
assert.match(app, /coach\.field\.expectedQuestion/)
assert.doesNotMatch(app, /training\.prediction/)
assert.doesNotMatch(messages, /training\.prediction/)
assert.match(messages, /export\.prediction/)

console.log('PASS: the standalone prediction field is removed; expectedQuestion remains the canonical pre-read question, and legacy exports remain readable.')
