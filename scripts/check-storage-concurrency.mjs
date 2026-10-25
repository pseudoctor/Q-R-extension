import assert from 'node:assert/strict'
import { createServer } from 'vite'

const storage = {}
const clone = (value) => value === undefined ? undefined : structuredClone(value)
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        await delay(1)
        if (typeof keys === 'string') return { [keys]: clone(storage[keys]) }
        return Object.fromEntries(keys.map((key) => [key, clone(storage[key])]))
      },
      async set(values) {
        await delay(1)
        Object.assign(storage, clone(values))
      },
    },
  },
}

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'silent' })
const { upsertSavedArticle } = await server.ssrLoadModule('/src/storage/articles.ts')
const {
  TRAINING_SESSIONS_KEY,
  TRAINING_SESSIONS_V2_KEY,
  commitTrainingFeedback,
  getTrainingSession,
  readTrainingSessions,
  removeTrainingSession,
  rewindTrainingSession,
  saveTrainingDraft,
  setTrainingQuestion,
  startTrainingSession,
} = await server.ssrLoadModule('/src/storage/training.ts')

const article = (id) => ({
  id,
  title: id,
  url: `https://example.com/${id}`,
  text: 'This article contains enough text for the storage test.',
  capturedAt: '2026-01-01T00:00:00.000Z',
  source: 'manual',
  savedAt: '2026-01-01T00:00:00.000Z',
  isFavorite: false,
})

await Promise.all([upsertSavedArticle(article('one')), upsertSavedArticle(article('two'))])
assert.deepEqual(
  (storage.savedArticles?.items ?? []).map((item) => item.id).sort(),
  ['one', 'two'],
)

await upsertSavedArticle({ ...article('favorite'), isFavorite: true })
const savedWithFavorite = await upsertSavedArticle({ ...article('favorite'), title: 'updated', isFavorite: false })
assert.equal(savedWithFavorite.isFavorite, true)
assert.equal(storage.savedArticles.items.find((item) => item.id === 'favorite')?.isFavorite, true)

await Promise.all([
  startTrainingSession('training-article'),
  startTrainingSession('second-training-article'),
  startTrainingSession('training-article'),
])
assert.equal((await readTrainingSessions()).filter((session) => session.articleId === 'training-article').length, 1)
assert.equal((await readTrainingSessions()).filter((session) => session.articleId === 'second-training-article').length, 1)
assert.equal(storage[TRAINING_SESSIONS_V2_KEY].version, 2)
assert.equal(storage[TRAINING_SESSIONS_KEY], undefined)

await Promise.all([
  saveTrainingDraft('training-article', '独立回答内容'),
  setTrainingQuestion('training-article', '并发更新后的问题'),
])
const session = (await readTrainingSessions()).find((item) => item.articleId === 'training-article')
assert.equal(session?.draft, '独立回答内容')
assert.equal(session?.currentQuestion, '并发更新后的问题')

await commitTrainingFeedback('training-article', { nextQuestion: '下一轮问题', nextStepId: 'quick-browse' })
const rewound = await rewindTrainingSession('training-article')
assert.equal(rewound?.currentStep, 0)
assert.equal(rewound?.flowId, 'reading-10')
assert.equal(rewound?.currentQuestion, '并发更新后的问题')
assert.equal(rewound?.draft, '独立回答内容')
assert.equal(rewound?.turns.length, 0)

storage[TRAINING_SESSIONS_KEY] = {
  version: 1,
  items: [{
    articleId: 'legacy-article',
    currentStep: 8,
    currentQuestion: '旧版问题？',
    draft: '',
    turns: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }],
}
assert.equal((await getTrainingSession('legacy-article'))?.flowId, 'legacy-8')
const upgraded = await startTrainingSession('legacy-article')
assert.equal(upgraded.flowId, 'reading-10')
assert.equal(storage[TRAINING_SESSIONS_KEY].items.length, 1)
assert.equal((await readTrainingSessions()).filter((session) => session.articleId === 'legacy-article').length, 1)
await removeTrainingSession('legacy-article')
assert.equal((await getTrainingSession('legacy-article')), null)

console.log('PASS: article and training storage mutations remain lossless under concurrent updates.')
await server.close()
