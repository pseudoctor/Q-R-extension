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
const { readTrainingSessions, saveTrainingDraft, setTrainingQuestion, startTrainingSession } = await server.ssrLoadModule('/src/storage/training.ts')

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

await Promise.all([startTrainingSession('training-article'), startTrainingSession('training-article')])
assert.equal((await readTrainingSessions()).filter((session) => session.articleId === 'training-article').length, 1)

await Promise.all([
  saveTrainingDraft('training-article', '独立回答'),
  setTrainingQuestion('training-article', '并发更新后的问题'),
])
const session = (await readTrainingSessions()).find((item) => item.articleId === 'training-article')
assert.equal(session?.draft, '独立回答')
assert.equal(session?.currentQuestion, '并发更新后的问题')

console.log('PASS: article and training storage mutations remain lossless under concurrent updates.')
await server.close()
