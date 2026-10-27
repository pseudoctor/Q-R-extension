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
const { limitSavedArticlesForStorage, SAVED_ARTICLE_STORAGE_LIMITS, upsertSavedArticle } = await server.ssrLoadModule('/src/storage/articles.ts')
const {
  TRAINING_SESSIONS_KEY,
  TRAINING_SESSIONS_V2_KEY,
  TRAINING_SESSIONS_V3_KEY,
  TRAINING_TEST_SESSIONS_V3_KEY,
  beginTrainingRequest,
  commitTrainingFeedback,
  confirmTrainingStep,
  createTrainingRequestId,
  editTrainingTurn,
  freezeTrainingAnswer,
  finishTrainingRequest,
  getTrainingSession,
  getTrainingHistory,
  readTrainingSessions,
  removeTrainingSession,
  resetTrainingSession,
  advanceTrainingSession,
  rewindTrainingSession,
  saveTrainingDraft,
  setTrainingQuestion,
  startTrainingSession,
  TRAINING_STORAGE_LIMITS,
  isTrainingSessionWithinStorageLimit,
  limitTrainingSessionsForStorage,
  trimTrainingSessionForStorage,
} = await server.ssrLoadModule('/src/storage/training.ts')
const { writeTestMode } = await server.ssrLoadModule('/src/storage/preferences.ts')
const { createTrainingArticleSnapshot } = await server.ssrLoadModule('/src/articles/format.ts')

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
assert.equal(storage[TRAINING_SESSIONS_V3_KEY].version, 3)
assert.equal(storage[TRAINING_SESSIONS_V2_KEY], undefined)
assert.equal(storage[TRAINING_SESSIONS_KEY], undefined)

await Promise.all([
  saveTrainingDraft('training-article', '独立回答内容'),
  setTrainingQuestion('training-article', '并发更新后的问题'),
])
const session = (await readTrainingSessions()).find((item) => item.articleId === 'training-article')
assert.equal(session?.draft, '独立回答内容')
assert.equal(session?.currentQuestion, '并发更新后的问题')
const staleRevision = session?.draftRevision
await saveTrainingDraft('training-article', '更新后的新回答')
const staleCommit = await commitTrainingFeedback(
  'training-article',
  { nextQuestion: '旧请求的下一轮问题', nextStepId: 'quick-browse' },
  'zh-CN',
  { sessionId: session?.sessionId, draftRevision: staleRevision, draft: '独立回答内容' },
)
assert.equal(staleCommit, null)
await saveTrainingDraft('training-article', '独立回答内容')

await commitTrainingFeedback('training-article', { nextQuestion: '下一轮问题', nextStepId: 'quick-browse' })
const rewound = await rewindTrainingSession('training-article')
assert.equal(rewound?.currentStep, 1)
assert.equal(rewound?.flowId, 'reading-10')
assert.equal(rewound?.draft, '')
assert.equal(rewound?.turns.length, 1)
const edited = await editTrainingTurn('training-article', 0, 'zh-CN', {
  sessionId: rewound?.sessionId,
  draftRevision: rewound?.draftRevision,
})
assert.equal(edited?.currentStep, 0)
assert.equal(edited?.currentStepId, 'preview')
assert.equal(edited?.draft, '独立回答内容')
assert.equal(edited?.turns.length, 1)

await writeTestMode(true)
const testSession = await startTrainingSession('training-article')
assert.equal(testSession.isTest, true)
assert.notEqual(testSession.sessionId, edited?.sessionId)
assert.equal(storage[TRAINING_TEST_SESSIONS_V3_KEY].items.length, 1)
assert.equal((await getTrainingSession('training-article'))?.sessionId, testSession.sessionId)
await writeTestMode(false)
assert.equal((await getTrainingSession('training-article'))?.sessionId, edited?.sessionId)
assert.equal((await getTrainingSession('training-article'))?.turns.length, 1)

const restartSnapshot = createTrainingArticleSnapshot(article('restart-article'))
const restartBefore = await startTrainingSession('restart-article', 'zh-CN', restartSnapshot)
await saveTrainingDraft('restart-article', '重新开始前的回答')
await resetTrainingSession('restart-article', 'zh-CN', restartSnapshot)
const restartAfter = await getTrainingSession('restart-article')
const restartHistory = await getTrainingHistory('restart-article')
assert.notEqual(restartAfter?.sessionId, restartBefore.sessionId)
assert.equal(restartHistory.filter((item) => item.isArchived).length, 1)
assert.equal(restartHistory.filter((item) => !item.isArchived).length, 1)
assert.equal(restartAfter?.articleSnapshotId, restartSnapshot.id)
await removeTrainingSession('restart-article')
assert.equal((await getTrainingHistory('restart-article')).length, 0)

const versionSession = await startTrainingSession('version-article')
await saveTrainingDraft('version-article', '版本冻结前的回答')
const versionDraft = await getTrainingSession('version-article')
const frozenVersion = await freezeTrainingAnswer('version-article', 'zh-CN', {
  sessionId: versionDraft?.sessionId,
  stepId: versionDraft?.currentStepId,
  draftRevision: versionDraft?.draftRevision,
})
assert.ok(frozenVersion?.answerVersionId)
assert.equal(frozenVersion?.answerVersions?.length, 1)
await saveTrainingDraft('version-article', '版本冻结后的新回答')
const staleFreeze = await freezeTrainingAnswer('version-article', 'zh-CN', {
  sessionId: versionSession.sessionId,
  stepId: versionDraft?.currentStepId,
  draftRevision: versionDraft?.draftRevision,
})
assert.equal(staleFreeze, null)

const requestId = createTrainingRequestId(
  'grade',
  frozenVersion?.sessionId,
  frozenVersion?.currentStepId,
  frozenVersion?.answerVersionId,
)
const firstRequest = await beginTrainingRequest('version-article', {
  id: requestId,
  kind: 'grade',
  sessionId: frozenVersion?.sessionId,
  stepId: frozenVersion?.currentStepId,
  answerVersionId: frozenVersion?.answerVersionId,
})
assert.equal(firstRequest?.shouldRun, true)
const duplicatePending = await beginTrainingRequest('version-article', {
  id: requestId,
  kind: 'grade',
  sessionId: frozenVersion?.sessionId,
  stepId: frozenVersion?.currentStepId,
  answerVersionId: frozenVersion?.answerVersionId,
})
assert.equal(duplicatePending?.shouldRun, false)
assert.equal(duplicatePending?.request.status, 'pending')
await finishTrainingRequest('version-article', requestId, 'failed', 'zh-CN', {
  code: 'AI_REQUEST_FAILED',
  message: '模拟失败',
})
const retryRequest = await beginTrainingRequest('version-article', {
  id: requestId,
  kind: 'grade',
  sessionId: frozenVersion?.sessionId,
  stepId: frozenVersion?.currentStepId,
  answerVersionId: frozenVersion?.answerVersionId,
})
assert.equal(retryRequest?.shouldRun, true)
const completedRequest = await finishTrainingRequest('version-article', requestId, 'succeeded', 'zh-CN')
assert.equal(completedRequest?.aiRequests?.find((request) => request.id === requestId)?.status, 'succeeded')
const duplicateCompleted = await beginTrainingRequest('version-article', {
  id: requestId,
  kind: 'grade',
  sessionId: frozenVersion?.sessionId,
  stepId: frozenVersion?.currentStepId,
  answerVersionId: frozenVersion?.answerVersionId,
})
assert.equal(duplicateCompleted?.shouldRun, false)
assert.equal(duplicateCompleted?.request.status, 'succeeded')

await startTrainingSession('local-article')
await saveTrainingDraft('local-article', '没有 AI 也可以继续的回答')
const localDraft = await getTrainingSession('local-article')
const localFrozen = await freezeTrainingAnswer('local-article', 'zh-CN', {
  sessionId: localDraft?.sessionId,
  stepId: localDraft?.currentStepId,
  draftRevision: localDraft?.draftRevision,
})
const localAdvanced = await advanceTrainingSession('local-article', 'zh-CN', {
  sessionId: localFrozen?.sessionId,
  stepId: localFrozen?.currentStepId,
  draftRevision: localFrozen?.draftRevision,
  answerVersionId: localFrozen?.answerVersionId,
})
assert.equal(localAdvanced?.currentStep, 1)
assert.equal(localAdvanced?.turns.length, 1)
assert.equal(localAdvanced?.turns[0]?.answerVersionId, localFrozen?.answerVersionId)

await startTrainingSession('review-article')
await saveTrainingDraft('review-article', '第一步原始答案')
const reviewFirstDraft = await getTrainingSession('review-article')
const reviewFirstFrozen = await freezeTrainingAnswer('review-article', 'zh-CN', {
  sessionId: reviewFirstDraft?.sessionId,
  stepId: reviewFirstDraft?.currentStepId,
  draftRevision: reviewFirstDraft?.draftRevision,
})
await advanceTrainingSession('review-article', 'zh-CN', {
  sessionId: reviewFirstFrozen?.sessionId,
  stepId: reviewFirstFrozen?.currentStepId,
  draftRevision: reviewFirstFrozen?.draftRevision,
  answerVersionId: reviewFirstFrozen?.answerVersionId,
})
await saveTrainingDraft('review-article', '第二步原始答案')
const reviewSecondDraft = await getTrainingSession('review-article')
const reviewSecondFrozen = await freezeTrainingAnswer('review-article', 'zh-CN', {
  sessionId: reviewSecondDraft?.sessionId,
  stepId: reviewSecondDraft?.currentStepId,
  draftRevision: reviewSecondDraft?.draftRevision,
})
await advanceTrainingSession('review-article', 'zh-CN', {
  sessionId: reviewSecondFrozen?.sessionId,
  stepId: reviewSecondFrozen?.currentStepId,
  draftRevision: reviewSecondFrozen?.draftRevision,
  answerVersionId: reviewSecondFrozen?.answerVersionId,
})
const reviewBeforeEdit = await getTrainingSession('review-article')
const reviewEdited = await editTrainingTurn('review-article', 0, 'zh-CN', {
  sessionId: reviewBeforeEdit?.sessionId,
  draftRevision: reviewBeforeEdit?.draftRevision,
})
assert.equal(reviewEdited?.stepRecords?.['quick-browse']?.status, 'needs-review')
await saveTrainingDraft('review-article', '第一步修订答案')
const reviewRevisedDraft = await getTrainingSession('review-article')
const reviewRevisedFrozen = await freezeTrainingAnswer('review-article', 'zh-CN', {
  sessionId: reviewRevisedDraft?.sessionId,
  stepId: reviewRevisedDraft?.currentStepId,
  draftRevision: reviewRevisedDraft?.draftRevision,
})
const reviewAdvanced = await advanceTrainingSession('review-article', 'zh-CN', {
  sessionId: reviewRevisedFrozen?.sessionId,
  stepId: reviewRevisedFrozen?.currentStepId,
  draftRevision: reviewRevisedFrozen?.draftRevision,
  answerVersionId: reviewRevisedFrozen?.answerVersionId,
})
assert.equal(reviewAdvanced?.draft, '第二步原始答案')
assert.equal(reviewAdvanced?.turns.length, 3)
const reviewConfirmed = await confirmTrainingStep('review-article', 'zh-CN', {
  sessionId: reviewAdvanced?.sessionId,
  stepId: reviewAdvanced?.currentStepId,
  draftRevision: reviewAdvanced?.draftRevision,
})
assert.equal(reviewConfirmed?.currentStep, 2)
assert.equal(reviewConfirmed?.turns.length, 3)
assert.equal(reviewConfirmed?.stepRecords?.['quick-browse']?.status, 'completed')

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

const storageLimitSession = await startTrainingSession('storage-limits')
const bounded = trimTrainingSessionForStorage({
  ...storageLimitSession,
  turns: Array.from({ length: TRAINING_STORAGE_LIMITS.turns + 5 }, (_, index) => ({
    stepIndex: index,
    question: `q-${index}`,
    answer: `a-${index}`,
    submittedAt: `2026-01-${String(index + 1).padStart(2, '0')}`,
  })),
  answerVersions: Array.from({ length: TRAINING_STORAGE_LIMITS.answerVersions + 5 }, (_, index) => ({ id: `version-${index}`, answer: `a-${index}`, createdAt: `2026-01-${String(index + 1).padStart(2, '0')}` })),
  reinforcements: Array.from({ length: TRAINING_STORAGE_LIMITS.reinforcements + 5 }, (_, index) => ({ id: `practice-${index}`, answer: `a-${index}`, createdAt: `2026-01-${String(index + 1).padStart(2, '0')}` })),
  aiRequests: Array.from({ length: TRAINING_STORAGE_LIMITS.aiRequests + 5 }, (_, index) => ({ id: `request-${index}`, kind: 'grade', status: 'succeeded', createdAt: `2026-01-${String(index + 1).padStart(2, '0')}` })),
})
assert.equal(bounded.turns.length, TRAINING_STORAGE_LIMITS.turns)
assert.equal(bounded.answerVersions.length, TRAINING_STORAGE_LIMITS.answerVersions)
assert.equal(bounded.reinforcements.length, TRAINING_STORAGE_LIMITS.reinforcements)
assert.equal(bounded.aiRequests.length, TRAINING_STORAGE_LIMITS.aiRequests)

const oversizedArticles = Array.from({ length: SAVED_ARTICLE_STORAGE_LIMITS.items }, (_, index) => ({
  ...article(`budget-${index}`),
  title: `budget-${index}`,
  text: '文章'.repeat(18_000),
  isFavorite: index === SAVED_ARTICLE_STORAGE_LIMITS.items - 1,
}))
const boundedArticles = limitSavedArticlesForStorage(oversizedArticles)
assert.ok(new TextEncoder().encode(JSON.stringify({ version: 2, items: boundedArticles })).byteLength <= SAVED_ARTICLE_STORAGE_LIMITS.maxBytes)
assert.ok(boundedArticles.every((item) => new TextEncoder().encode(JSON.stringify(item)).byteLength <= SAVED_ARTICLE_STORAGE_LIMITS.maxArticleBytes))
assert.equal(boundedArticles.some((item) => item.id === `budget-${SAVED_ARTICLE_STORAGE_LIMITS.items - 1}`), true)

const activeSessions = Array.from({ length: TRAINING_STORAGE_LIMITS.activeSessions + 8 }, (_, index) => ({
  ...storageLimitSession,
  articleId: `active-budget-${index}`,
  sessionId: `active-session-${index}`,
  updatedAt: `2026-02-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
}))
const boundedSessions = limitTrainingSessionsForStorage(activeSessions)
assert.ok(boundedSessions.length <= TRAINING_STORAGE_LIMITS.activeSessions)
assert.ok(new TextEncoder().encode(JSON.stringify({ version: 3, items: boundedSessions })).byteLength <= TRAINING_STORAGE_LIMITS.maxBytes)
assert.equal(isTrainingSessionWithinStorageLimit({
  ...storageLimitSession,
  draft: 'x'.repeat(TRAINING_STORAGE_LIMITS.maxSessionBytes + 1),
}), false)

console.log('PASS: V3 article/training mutations, stale-response rejection, storage retention limits, and legacy storage coexistence remain lossless.')
await server.close()
