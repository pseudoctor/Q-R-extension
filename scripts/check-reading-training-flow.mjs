import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'silent' })
const {
  LESSON_STEPS,
  areThreeSentenceDraftsComplete,
  formatThreeSentenceAnswer,
  getLessonSteps,
  getLegacyLessonSteps,
  getNextLessonStepId,
  isLessonAnswerFormatValid,
} = await server.ssrLoadModule('/src/training/lessons.ts')
const {
  TRAINING_SESSIONS_KEY,
  TRAINING_SESSIONS_V2_KEY,
  getTrainingSession,
  normalizeTrainingSessionStore,
  normalizeTrainingSessionStoreV2,
  readTrainingSessions,
  removeTrainingSession,
  startTrainingSession,
} = await server.ssrLoadModule('/src/storage/training.ts')
const { buildGradePrompt, buildReferenceAnswerPrompt, buildStartPrompt, validateAiFeedback, validateAiReferenceAnswer } = await server.ssrLoadModule('/src/ai/coach.ts')

assert.deepEqual(LESSON_STEPS.map((step) => step.id), [
  'preview',
  'quick-browse',
  'three-sentence',
  'three-points',
  'questions',
  'assumptions',
  'logic-check',
  'toulmin-simple',
  'toulmin-full',
  'feynman-review',
])
assert.equal(LESSON_STEPS.length, 10)
assert.equal(getLessonSteps('zh-CN')[0].name, '预读')
assert.match(getLessonSteps('zh-CN')[0].question, /标题、副标题、作者和来源已由系统填写，无需重复记录/)
assert.doesNotMatch(getLessonSteps('zh-CN')[0].question, /请记录标题、副标题、作者、来源/)
assert.match(getLessonSteps('zh-CN')[0].question, /第一段、最后一段、小标题、图表以及强调内容/)
assert.equal(getLessonSteps('zh-CN')[2].name, '分层阅读·3句法')
assert.match(getLessonSteps('zh-CN')[2].hint, /原文内容和你的推断/)
assert.equal(getLessonSteps('zh-CN')[5].name, '识别隐藏假设')
assert.equal(getLessonSteps('zh-CN')[6].name, '检查逻辑漏洞')
assert.equal(getLegacyLessonSteps('zh-CN')[0].name, '读后线索')
assert.equal(getNextLessonStepId(0), 'quick-browse')
assert.equal(getNextLessonStepId(9), null)
assert.equal(getNextLessonStepId(10), 'feynman-review')
assert.equal(isLessonAnswerFormatValid(2, '主题。因为证据。作者想告诉我结论。'), true)
assert.equal(isLessonAnswerFormatValid(3, '第一点\n第二点\n第三点'), true)
assert.equal(isLessonAnswerFormatValid(3, '第一点\n第二点'), false)
assert.equal(isLessonAnswerFormatValid(4, '为什么会这样？'), true)
assert.equal(isLessonAnswerFormatValid(9, '核心观点。因为原因。例如像这样。适用边界是这里。'), true)
const singleSentenceDraft = [{ paragraph: 1, what: '这段只说明一个事实', why: '原文未提供', takeaway: '这段先交代事实' }]
assert.equal(areThreeSentenceDraftsComplete(singleSentenceDraft, [1]), true)
assert.equal(areThreeSentenceDraftsComplete([{ ...singleSentenceDraft[0], takeaway: '' }], [1]), false)
assert.match(formatThreeSentenceAnswer(singleSentenceDraft), /为什么这么说：原文未提供/)

const fixedStart = buildStartPrompt('原文', '标题')
assert.equal(JSON.parse(fixedStart.user).stepId, 'preview')
assert.match(fixedStart.system, /预读/)
assert.equal(fixedStart.responseFormat.type, 'json_schema')
assert.equal(fixedStart.responseFormat.json_schema.name, 'training_question')

const session = {
  articleId: 'article',
  flowId: 'reading-10',
  currentStep: 6,
  currentQuestion: '当前问题？',
  draft: '学生回答内容',
  turns: [],
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const grade = buildGradePrompt('第一段。\n\n第二段。', '标题', { subtitle: '', author: '', source: '' }, session)
const gradeInput = JSON.parse(grade.user)
assert.equal(gradeInput.stepId, 'logic-check')
assert.equal(gradeInput.nextStepId, 'toulmin-simple')
assert.deepEqual(gradeInput.allowedDimensions, ['fidelity', 'cause', 'structure'])
assert.match(grade.system, /logic-check/)
assert.equal(grade.responseFormat.type, 'json_schema')
const gradeSchema = grade.responseFormat.json_schema.schema
const gradeDimensions = gradeSchema.properties.dimensions.properties
assert.equal(gradeDimensions.fidelity.properties.score.type, 'integer')
assert.equal(gradeDimensions.claim.properties.score.type, 'null')

const firstRoundGrade = buildGradePrompt('第一段。\n\n第二段。', '标题', { subtitle: '', author: '', source: '' }, {
  ...session,
  currentStep: 0,
  currentQuestion: '预读问题？',
}, '', 'zh-CN')
const firstRoundSchema = firstRoundGrade.responseFormat.json_schema.schema
const firstRoundDimensions = firstRoundSchema.properties.dimensions.properties
assert.equal(firstRoundDimensions.fidelity.properties.score.type, 'integer')
assert.equal(firstRoundDimensions.structure.properties.score.type, 'integer')
assert.equal(firstRoundDimensions.claim.properties.score.type, 'null')
assert.equal(firstRoundDimensions.cause.properties.score.type, 'null')

const threeSentenceGrade = buildGradePrompt('第一句。\n\n第二段。', '标题', { subtitle: '', author: '', source: '' }, {
  ...session,
  currentStep: 2,
  currentQuestion: '逐段回答？',
  draft: formatThreeSentenceAnswer([
    { paragraph: 1, what: '第一段说了事实', why: '原文未提供', takeaway: '第一段先交代事实' },
    { paragraph: 2, what: '第二段补充说明', why: '因为第二段给出依据', takeaway: '第二段推进说明' },
  ]),
  threeSentenceDrafts: [
    { paragraph: 1, what: '第一段说了事实', why: '原文未提供', takeaway: '第一段先交代事实' },
    { paragraph: 2, what: '第二段补充说明', why: '因为第二段给出依据', takeaway: '第二段推进说明' },
  ],
})
const threeSentenceInput = JSON.parse(threeSentenceGrade.user)
assert.equal(threeSentenceInput.stepId, 'three-sentence')
assert.equal(threeSentenceInput.threeSentenceDrafts[0].why, '原文未提供')

const referencePrompt = buildReferenceAnswerPrompt('第一段。\n\n第二段。', '标题', { subtitle: '', author: '', source: '' }, {
  stepIndex: 2,
  stepId: 'three-sentence',
  question: '逐段回答？',
  answer: '学生回答。',
  submittedAt: '2026-01-01T00:00:00.000Z',
})
assert.equal(referencePrompt.responseFormat.json_schema.name, 'training_reference_answer')
assert.equal(JSON.parse(referencePrompt.user).studentAnswer, '学生回答。')
const referenceAnswer = {
  answer: '参考答案只根据原文整理段落内容，并明确区分原文依据与阅读推断。',
  sources: [{ paragraph: 1, quote: '第一段。', comment: '这段提供了参考答案的原文依据。' }],
}
assert.doesNotThrow(() => validateAiReferenceAnswer(referenceAnswer, '第一段。\n\n第二段。'))
assert.throws(() => validateAiReferenceAnswer({ ...referenceAnswer, sources: [{ ...referenceAnswer.sources[0], quote: '不存在的引文。' }] }, '第一段。\n\n第二段。'))

const feedback = {
  dimensions: {
    fidelity: { score: 8, reason: '回答引用了原文。' },
    claim: { score: null, reason: '本题未测' },
    cause: { score: 7, reason: '指出了因果关系。' },
    structure: { score: 6, reason: '说明了论证关系。' },
  },
  strengths: [],
  gaps: [],
  sources: [{ paragraph: 1, quote: '第一段。', comment: '这段对应原文依据。' }],
  nextQuestion: '还需要检查什么？',
  nextStepId: 'toulmin-simple',
}
assert.doesNotThrow(() => validateAiFeedback(feedback, '第一段。\n\n第二段。', '学生回答内容', undefined, 6))
assert.throws(() => validateAiFeedback({
  ...feedback,
  dimensions: { ...feedback.dimensions, claim: { score: 5, reason: '不应在本轮评分。' } },
}, '第一段。\n\n第二段。', '学生回答内容', undefined, 6))
assert.throws(() => validateAiFeedback({
  ...feedback,
  nextStepId: 'assumptions',
}, '第一段。\n\n第二段。', '学生回答内容', undefined, 6))

const storage = {}
const clone = (value) => value === undefined ? undefined : structuredClone(value)
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (typeof keys === 'string') return { [keys]: clone(storage[keys]) }
        return Object.fromEntries(keys.map((key) => [key, clone(storage[key])]))
      },
      async set(values) {
        Object.assign(storage, clone(values))
      },
    },
  },
}

const legacy = {
  articleId: 'legacy',
  currentStep: 8,
  currentQuestion: '旧问题？',
  draft: '',
  turns: [],
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
storage[TRAINING_SESSIONS_KEY] = { version: 1, items: [legacy] }
assert.equal(normalizeTrainingSessionStore(storage[TRAINING_SESSIONS_KEY]).items[0].flowId, 'legacy-8')
assert.equal(normalizeTrainingSessionStoreV2(undefined).items.length, 0)

const visibleLegacy = await getTrainingSession('legacy')
assert.equal(visibleLegacy?.flowId, 'legacy-8')
const current = await startTrainingSession('legacy')
assert.equal(current.flowId, 'reading-10')
assert.equal(current.currentStep, 0)
assert.equal(storage[TRAINING_SESSIONS_KEY].items.length, 1)
assert.equal(storage[TRAINING_SESSIONS_V2_KEY].items[0].flowId, 'reading-10')
assert.equal((await readTrainingSessions()).filter((item) => item.articleId === 'legacy').length, 1)
await removeTrainingSession('legacy')
assert.equal((await readTrainingSessions()).some((item) => item.articleId === 'legacy'), false)

console.log('PASS: ten-step training order, step-scoped AI validation, and legacy/V2 storage coexistence are wired.')
await server.close()
