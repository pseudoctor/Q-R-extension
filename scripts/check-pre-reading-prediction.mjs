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

assert.match(coach, /preReadingPrediction/)
assert.match(messages, /ai\.startReflection/)
assert.match(messages, /coach\.transitionAfterPreview/)
assert.match(background, /article\.preReadingPrediction/)
assert.match(background, /session\.currentStep === 0/)
assert.match(storage, /TRAINING_SESSIONS_V2_KEY/)
assert.doesNotMatch(app, /type: 'ai-start'/)
assert.match(background, /pendingCapture: null/)
assert.match(background, /preReadingPredictionDraft/)
assert.match(background, /save-pre-reading-prediction-draft/)
assert.match(reading, /preReadingPrediction/)
assert.match(app, /open-manual-paste-page/)
assert.match(app, /save-pre-reading-prediction-draft/)
assert.match(messages, /training\.prediction/)
assert.match(messages, /export\.prediction/)
assert.ok(app.includes('maxLength={2000}'))

console.log('PASS: pre-reading prediction is wired into the editor, AI prompts, and exports.')
