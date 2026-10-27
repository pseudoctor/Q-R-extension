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
  isTrainingDraftNavigable,
  isStructuredDraftComplete,
  isLessonAnswerFormatValid,
  normalizeTrainingStructuredDraft,
  STRUCTURED_FIELD_DEFINITIONS,
  structuredFieldsForStep,
} = await server.ssrLoadModule('/src/training/lessons.ts')
const {
  TRAINING_SESSIONS_KEY,
  TRAINING_SESSIONS_V2_KEY,
  getTrainingSession,
  normalizeTrainingSessionStore,
  normalizeTrainingSessionStoreV2,
  readTrainingSessions,
  removeTrainingSession,
  saveTrainingDraft,
  setTrainingStep,
  startTrainingSession,
} = await server.ssrLoadModule('/src/storage/training.ts')
const { readTestMode, writeTestMode } = await server.ssrLoadModule('/src/storage/preferences.ts')
const { buildFieldAssistPrompt, buildGradePrompt, buildReferenceAnswerPrompt, buildStartPrompt, validateAiFeedback, validateAiReferenceAnswer } = await server.ssrLoadModule('/src/ai/coach.ts')
const { buildReadingExportModel, generateReadingJson, generateReadingMarkdown } = await server.ssrLoadModule('/src/export/reading.ts')

assert.deepEqual(LESSON_STEPS.map((step) => step.id), [
  'preview',
  'quick-browse',
  'three-sentence',
  'three-points',
  'questions',
  'assumptions',
  'toulmin-simple',
  'toulmin-full',
  'feynman-review',
  'final-review',
])
assert.deepEqual(LESSON_STEPS.map((step) => step.dependsOn), [
  [],
  ['preview'],
  ['quick-browse'],
  ['three-sentence'],
  ['three-points'],
  ['questions'],
  ['assumptions'],
  ['toulmin-simple'],
  ['toulmin-full'],
  ['feynman-review'],
])
assert.equal(LESSON_STEPS.length, 10)
assert.equal(getLessonSteps('zh-CN')[0].name, '预读')
assert.equal(getLessonSteps('zh-CN')[0].focus, '观察而不是评价')
assert.equal(getLessonSteps('zh-CN')[0].question, '文章的外部线索透露了哪些信息？你预计它要回答什么问题？')
assert.equal(getLessonSteps('zh-CN')[0].instruction, '先看文章外围信息和首尾段，只记录观察，不要急着评价。')
assert.equal(getLessonSteps('zh-CN')[0].hint, '先核对标题、副标题、作者、来源和日期的状态。提取未获得不等于原文未提供；再记录首末段和小标题、图表、强调信息显示了什么，最后提出预计问题。')
assert.equal(getLessonSteps('zh-CN')[1].instruction, '快速浏览全文，先看清文章如何分段、转折和收束。')
assert.equal(getLessonSteps('zh-CN')[1].question, '请为每段标记功能，并选出下一步要重点阅读的段落。')
assert.equal(getLessonSteps('zh-CN')[1].hint, '只建立文章结构地图；核对首末句和转折，发现系统识别不准确时再修改。第3步再用三句法分析候选段落。')
assert.equal(STRUCTURED_FIELD_DEFINITIONS.preview.find((field) => field.id === 'preview.structure')?.labelKey, 'coach.field.externalClues')
assert.equal(STRUCTURED_FIELD_DEFINITIONS['quick-browse'].find((field) => field.id === 'quickBrowse.structure')?.labelKey, 'coach.field.structureOverview')
assert.deepEqual(structuredFieldsForStep('quick-browse'), ['quickBrowse.paragraphMap', 'quickBrowse.structure'])
assert.equal(normalizeTrainingStructuredDraft({ 'quickBrowse.paragraphLabels': 'legacy labels' })?.['quickBrowse.paragraphLabels'], 'legacy labels')
assert.equal(normalizeTrainingStructuredDraft({ 'quickBrowse.representativeSentences': 'legacy sentences' })?.['quickBrowse.representativeSentences'], 'legacy sentences')
assert.equal(getLessonSteps('zh-CN')[2].question, '对选出的重要段落分别回答：说了什么？为什么？想告诉你什么？')
assert.equal(getLessonSteps('zh-CN')[2].name, '分层阅读·3句法')
assert.match(getLessonSteps('zh-CN')[2].hint, /原文内容和你的推断/)
assert.equal(getLessonSteps('zh-CN')[5].name, '隐藏假设与风险')
assert.equal(getLessonSteps('zh-CN')[6].name, '简化图尔敏')
assert.equal(getLessonSteps('zh-CN')[9].name, '全文复盘')
assert.equal(getLegacyLessonSteps('zh-CN')[0].name, '读后线索')
assert.equal(getNextLessonStepId(0), 'quick-browse')
assert.equal(getNextLessonStepId(9), null)
assert.equal(getNextLessonStepId(10), 'final-review')
assert.equal(isLessonAnswerFormatValid(2, '主题。因为证据。作者想告诉我结论。'), true)
assert.equal(isLessonAnswerFormatValid(3, '第一点\n第二点\n第三点'), true)
assert.equal(isLessonAnswerFormatValid(3, '第一点\n第二点'), false)
assert.equal(isLessonAnswerFormatValid(3, 'one two three four five\none two three four five\none two three four five', 'en'), true)
assert.equal(isLessonAnswerFormatValid(3, 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen\none two three four five\none two three four five', 'en'), false)
const partialPreviewSession = {
  currentStep: 0,
  draft: '我预计文章会回答公共图书馆如何服务城市居民。',
  structuredDraft: { 'preview.expectedQuestion': '公共图书馆如何服务城市居民？' },
}
assert.equal(isTrainingDraftNavigable(partialPreviewSession), true)
assert.equal(isStructuredDraftComplete('preview', partialPreviewSession.structuredDraft), false)
assert.equal(isTrainingDraftNavigable({ currentStep: 4, draft: '问题列表暂未填写。', structuredDraft: { 'questions.items': '[]' } }), false)
assert.equal(isTrainingDraftNavigable({ currentStep: 4, draft: '我想知道作者为什么这样解释。', structuredDraft: { 'questions.items': JSON.stringify([{ id: 'q1', category: 'why', question: '作者为什么这样解释？', selected: false, whyImportant: '', relatedParagraphs: '', answered: '', unanswered: '' }]) } }), true)
const fieldAssistPrompt = buildFieldAssistPrompt(
  '第一段介绍背景。\n\n第二段补充证据。',
  '文章标题',
  { subtitle: '', author: '', source: '' },
  {
    articleId: 'assist-article',
    flowId: 'reading-10',
    currentStep: 1,
    currentStepId: 'quick-browse',
    currentQuestion: '请梳理文章结构。',
    draft: '文章结构由背景和证据组成。',
    draftRevision: 3,
    turns: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    structuredDraft: { 'quickBrowse.structure': '文章结构由背景和证据组成。' },
  },
  'quickBrowse.first:1',
  'hint',
  'zh-CN',
  [
    { type: 'paragraph', id: 'block-1', text: '第一段介绍背景。' },
    { type: 'paragraph', id: 'block-2', text: '第二段补充证据。' },
  ],
)
const fieldAssistInput = JSON.parse(fieldAssistPrompt.user)
assert.equal(fieldAssistInput.fieldId, 'quickBrowse.first:1')
assert.equal(fieldAssistInput.mode, 'hint')
assert.equal(fieldAssistInput.draftRevision, 3)
assert.equal(fieldAssistPrompt.responseFormat.json_schema.name, 'training_field_assist')
assert.match(JSON.stringify(fieldAssistInput.sourceBlocks), /第一段介绍背景/)
assert.equal(isStructuredDraftComplete('questions', { 'questions.items': JSON.stringify([{ id: 'q1', category: 'why', question: '为什么会这样？', selected: true, whyImportant: '影响结论。', relatedParagraphs: '第2段', answered: '描述了现象。', unanswered: '未解释机制。' }]) }), true)
assert.equal(isStructuredDraftComplete('questions', { 'questions.items': '[]' }), false)
assert.equal(isStructuredDraftComplete('questions', {
  'questions.category': 'Why',
  'questions.question': '为什么会这样？',
  'questions.relatedParagraphs': '第 2、3 段',
  'questions.whyImportant': '它会影响全文判断。',
  'questions.answered': '原文说明了现象。',
  'questions.unanswered': '原文没有说明长期影响。',
}), true)
assert.equal(isStructuredDraftComplete('questions', { 'questions.question': '为什么会这样？' }), false)
assert.equal(structuredFieldsForStep('final-review').length, 8)
assert.equal(isLessonAnswerFormatValid(8, '核心观点。因为原因。例如像这样。适用边界是这里。'), true)
assert.equal(isStructuredDraftComplete('feynman-review', {
  'feynman.explanation': '用简单的话解释核心关系。',
  'feynman.example': '例如带伞。',
  'feynman.exampleType': '自创类比',
  'feynman.boundary': '只解释部分原因。',
}), true)
assert.equal(isStructuredDraftComplete('feynman-review', {
  'feynman.explanation': '用简单的话解释核心关系。',
  'feynman.example': '例如带伞。',
  'feynman.exampleType': '原文未提供',
  'feynman.boundary': '只解释部分原因。',
}), false)
const singleSentenceDraft = [{ paragraph: 1, what: '这段只说明一个事实', why: '原文未提供', takeaway: '这段先交代事实', role: '背景', evidence: '这段只说明一个事实' }]
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
assert.equal(gradeInput.stepId, 'toulmin-simple')
assert.equal(gradeInput.sessionId, null)
assert.equal(gradeInput.draftRevision, 0)
assert.equal(gradeInput.nextStepId, 'toulmin-full')
assert.deepEqual(gradeInput.requiredFields, [
  'toulminSimple.argumentId',
  'toulminSimple.claim',
  'toulminSimple.claimStatus',
  'toulminSimple.evidence',
  'toulminSimple.evidenceStatus',
  'toulminSimple.warrant',
  'toulminSimple.warrantStatus',
])
assert.deepEqual(gradeInput.dependsOn, ['assumptions'])
assert.deepEqual(gradeInput.allowedDimensions, ['fidelity', 'claim', 'cause', 'structure'])
assert.match(grade.system, /toulmin-simple/)
assert.equal(grade.responseFormat.type, 'json_schema')
const gradeSchema = grade.responseFormat.json_schema.schema
const gradeDimensions = gradeSchema.properties.dimensions.properties
assert.equal(gradeDimensions.fidelity.properties.score.type, 'integer')
assert.equal(gradeDimensions.claim.properties.score.type, 'integer')

const firstRoundGrade = buildGradePrompt('第一段。\n\n第二段。', '标题', { subtitle: '', author: '', source: '' }, {
  ...session,
  currentStep: 0,
  currentQuestion: '预读问题？',
}, 'zh-CN')
const firstRoundSchema = firstRoundGrade.responseFormat.json_schema.schema
const firstRoundDimensions = firstRoundSchema.properties.dimensions.properties
assert.equal(firstRoundDimensions.fidelity.properties.score.type, 'integer')
assert.equal(firstRoundDimensions.structure.properties.score.type, 'integer')
assert.equal(firstRoundDimensions.claim.properties.score.type, 'null')
assert.equal(firstRoundDimensions.cause.properties.score.type, 'null')

const threeSentenceGrade = buildGradePrompt('第一句。\n\n第二段。', '标题', { subtitle: '', author: '', source: '' }, {
  ...session,
  currentStep: 2,
  currentQuestion: '请阅读第4段和第5段，用自己的话概括。',
  draft: formatThreeSentenceAnswer([
    { paragraph: 1, what: '第一段说了事实', why: '原文未提供', takeaway: '第一段先交代事实', role: '背景', evidence: '第一段说了事实' },
    { paragraph: 2, what: '第二段补充说明', why: '因为第二段给出依据', takeaway: '第二段推进说明', role: '解释', evidence: '因为第二段给出依据' },
  ]),
  threeSentenceDrafts: [
    { paragraph: 1, what: '第一段说了事实', why: '原文未提供', takeaway: '第一段先交代事实', role: '背景', evidence: '第一段说了事实' },
    { paragraph: 2, what: '第二段补充说明', why: '因为第二段给出依据', takeaway: '第二段推进说明', role: '解释', evidence: '因为第二段给出依据' },
  ],
})
const threeSentenceInput = JSON.parse(threeSentenceGrade.user)
assert.equal(threeSentenceInput.stepId, 'three-sentence')
assert.equal(threeSentenceInput.question, getLessonSteps('zh-CN')[2].question)
assert.equal(threeSentenceInput.threeSentenceDrafts[0].why, '原文未提供')

const referencePrompt = buildReferenceAnswerPrompt('第一段。\n\n第二段。', '标题', { subtitle: '', author: '', source: '' }, {
  stepIndex: 2,
  stepId: 'three-sentence',
  question: '请阅读第4段和第5段，用自己的话概括。',
  answer: '学生回答。',
  submittedAt: '2026-01-01T00:00:00.000Z',
})
assert.equal(referencePrompt.responseFormat.json_schema.name, 'training_reference_answer')
assert.equal(JSON.parse(referencePrompt.user).question, getLessonSteps('zh-CN')[2].question)
assert.equal(JSON.parse(referencePrompt.user).answerVersionId, null)
assert.match(referencePrompt.system, /逐字连续复制/)
assert.doesNotMatch(referencePrompt.system, /永远不输出文章摘要、标准答案/)
assert.match(referencePrompt.system, /明确允许输出参考答案/)
assert.equal(JSON.parse(referencePrompt.user).studentAnswer, '学生回答。')
const referenceAnswer = {
  answer: '参考答案只根据原文整理段落内容，并明确区分原文依据与阅读推断。',
  sources: [{ paragraph: 1, quote: '第一段。', comment: '这段提供了参考答案的原文依据。' }],
}
assert.doesNotThrow(() => validateAiReferenceAnswer(referenceAnswer, '第一段。\n\n第二段。'))
assert.doesNotThrow(() => validateAiReferenceAnswer({
  ...referenceAnswer,
  sources: [{ ...referenceAnswer.sources[0], quote: '第一段 内容' }],
}, '第一段\n内容\n\n第二段'))
assert.doesNotThrow(() => validateAiReferenceAnswer({
  answer: '这是一个包含正常问句、但仍然完全依据原文的参考答案？',
  sources: [{ paragraph: 1, quote: '第一段。', comment: '这段为什么重要？因为它提供了原文依据。' }],
}, '第一段。\n\n第二段。'))
const longSourceQuote = '原文'.repeat(100)
assert.doesNotThrow(() => validateAiReferenceAnswer({
  answer: '这是一个引用较长原文片段、但仍然完全依据文章内容整理的参考答案。',
  sources: [{ paragraph: 1, quote: longSourceQuote, comment: '这段提供了较长的原文依据。' }],
}, `${longSourceQuote}\n\n第二段。`))
assert.throws(() => validateAiReferenceAnswer({ ...referenceAnswer, sources: [{ ...referenceAnswer.sources[0], quote: '不存在的引文。' }] }, '第一段。\n\n第二段。'))
const structuredSourceBlocks = [
  { type: 'heading', level: 2, text: '结构标题' },
  { type: 'chart', text: '图表显示储蓄率上升', alt: '储蓄率趋势' },
]
assert.doesNotThrow(() => validateAiReferenceAnswer({
  answer: '参考答案引用了标题和图表文字，并把来源块与正文段落区分开来。',
  sources: [
    { paragraph: 0, blockId: 'block-1', quote: '结构标题', comment: '标题给出文章结构线索。' },
    { paragraph: 0, blockId: 'block-2', quote: '图表显示储蓄率上升', comment: '图表文字提供了趋势信息。' },
  ],
}, '无正文段落', structuredSourceBlocks))
assert.throws(() => validateAiReferenceAnswer({
  answer: '参考答案引用了不存在的来源块，因此不应通过本地校验。',
  sources: [{ paragraph: 0, blockId: 'block-9', quote: '结构标题', comment: '无效来源块。' }],
}, '无正文段落', structuredSourceBlocks))
const exportModel = buildReadingExportModel({
  id: 'article',
  title: '导出文章',
  url: '',
  text: '正文段落。',
  capturedAt: '2026-01-01T00:00:00.000Z',
  source: 'manual',
}, {
  articleId: 'article',
  flowId: 'reading-10',
  courseVersion: 'guided-reading-10-v1',
  sessionId: 'session-1',
  currentStep: 1,
  currentStepId: 'quick-browse',
  currentQuestion: '下一题？',
  draft: '',
  turns: [{
    stepIndex: 0,
    stepId: 'preview',
    answerVersionId: 'answer-1',
    question: '预读？',
    answer: '观察记录',
    submittedAt: '2026-01-01T00:00:00.000Z',
  }],
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})
assert.equal(exportModel.courseVersion, 'guided-reading-10-v1')
assert.equal(exportModel.turns[0].answerVersionId, 'answer-1')
assert.match(generateReadingJson(exportModel), /"courseVersion": "guided-reading-10-v1"/)
assert.match(generateReadingMarkdown(exportModel), /course_version: "guided-reading-10-v1"/)
const duplicateProgress = buildReadingExportModel({
  id: 'duplicate-progress',
  title: '重复回合',
  url: '',
  text: '正文段落。',
  capturedAt: '2026-01-01T00:00:00.000Z',
  source: 'manual',
}, {
  articleId: 'duplicate-progress',
  flowId: 'reading-10',
  courseVersion: 'guided-reading-10-v1',
  sessionId: 'duplicate-session',
  currentStep: 2,
  currentQuestion: '下一题？',
  draft: '',
  turns: [
    { stepIndex: 0, stepId: 'preview', question: '预读？', answer: '观察', submittedAt: '2026-01-01T00:00:00.000Z' },
    { stepIndex: 0, stepId: 'preview', question: '预读？', answer: '修订后的观察', submittedAt: '2026-01-01T00:01:00.000Z' },
  ],
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:01:00.000Z',
})
assert.equal(duplicateProgress.progress.completed, 1)

const feedback = {
  dimensions: {
    fidelity: { score: 8, reason: '回答引用了原文。' },
    claim: { score: 5, reason: '提炼了核心主张。' },
    cause: { score: 7, reason: '指出了因果关系。' },
    structure: { score: 6, reason: '说明了论证关系。' },
  },
  strengths: [],
  gaps: [],
  sources: [{ paragraph: 1, quote: '第一段。', comment: '这段对应原文依据。' }],
  nextQuestion: '还需要检查什么？',
  nextStepId: 'toulmin-full',
}
assert.doesNotThrow(() => validateAiFeedback(feedback, '第一段。\n\n第二段。', '学生回答内容', undefined, 6))
assert.throws(() => validateAiFeedback({
  ...feedback,
  dimensions: { ...feedback.dimensions, claim: { score: null, reason: '本题未测' } },
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
storage[TRAINING_SESSIONS_V2_KEY] = {
  version: 2,
  items: [{
    articleId: 'stale-opening',
    flowId: 'reading-10',
    currentStep: 0,
    currentQuestion: '请记录第一段、最后一段、小标题、图表以及强调内容带来的观察。',
    draft: '',
    turns: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }],
}
assert.equal(normalizeTrainingSessionStore(storage[TRAINING_SESSIONS_KEY]).items[0].flowId, 'legacy-8')
assert.equal(normalizeTrainingSessionStoreV2(undefined).items.length, 0)
assert.equal((await getTrainingSession('stale-opening'))?.currentQuestion, getLessonSteps('zh-CN')[0].question)

const visibleLegacy = await getTrainingSession('legacy')
assert.equal(visibleLegacy?.flowId, 'legacy-8')
const current = await startTrainingSession('legacy')
assert.equal(current.flowId, 'reading-10')
assert.equal(current.currentStep, 0)
assert.equal(storage[TRAINING_SESSIONS_KEY].items.length, 1)
assert.equal(storage[TRAINING_SESSIONS_V2_KEY].items[0].flowId, 'reading-10')
assert.equal((await readTrainingSessions()).filter((item) => item.articleId === 'legacy').length, 1)
assert.equal(await readTestMode(), false)
assert.equal(await writeTestMode(true), true)
assert.equal(await readTestMode(), true)
assert.equal(await writeTestMode(false), false)
storage[TRAINING_SESSIONS_V2_KEY].items[0] = {
  ...storage[TRAINING_SESSIONS_V2_KEY].items[0],
  currentStep: 0,
  currentQuestion: '旧步骤问题？',
  draft: '旧草稿',
  threeSentenceDrafts: [{ paragraph: 1, what: '旧记录', why: '旧原因', takeaway: '旧结论' }],
  paragraphCursor: 1,
  completedAt: '2026-01-01T00:00:00.000Z',
}
const jumped = await setTrainingStep('legacy', 2)
assert.equal(jumped?.currentStep, 2)
assert.equal(jumped?.currentQuestion, getLessonSteps('zh-CN')[2].question)
assert.equal(jumped?.draft, '')
assert.equal(jumped?.threeSentenceDrafts, undefined)
assert.equal(jumped?.paragraphCursor, undefined)
assert.equal(jumped?.completedAt, undefined)
await saveTrainingDraft(
  'legacy',
  formatThreeSentenceAnswer([{ paragraph: 2, what: '重要段落的事实', why: '原文提供了依据', takeaway: '它推进了文章结构', role: '解释', evidence: '原文提供了依据' }]),
  'zh-CN',
  undefined,
  [2],
  [{ paragraph: 2, what: '重要段落的事实', why: '原文提供了依据', takeaway: '它推进了文章结构', role: '解释', evidence: '原文提供了依据' }],
  1,
)
const savedDraft = await getTrainingSession('legacy')
assert.deepEqual(savedDraft?.importantParagraphs, [2])
assert.deepEqual(savedDraft?.threeSentenceDrafts?.map(({ paragraph }) => paragraph), [2])
assert.equal(savedDraft?.paragraphCursor, 1)
await removeTrainingSession('legacy')
assert.equal((await readTrainingSessions()).some((item) => item.articleId === 'legacy'), false)

console.log('PASS: ten-step order, structured completion, source-block validation, V3 export metadata, and legacy coexistence are wired.')
await server.close()
