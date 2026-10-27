import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const data = {}
globalThis.chrome = { storage: { local: {
  get: async (keys) => Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map((key) => [key, structuredClone(data[key])])),
  set: async (values) => Object.assign(data, structuredClone(values)),
} } }
const server = await createServer({ logLevel: 'silent' })
let failures = 0
try {
  const s = await server.ssrLoadModule('/src/storage/training.ts')
  const l = await server.ssrLoadModule('/src/training/lessons.ts')
  const e = await server.ssrLoadModule('/src/export/reading.ts')
  const c = await server.ssrLoadModule('/src/ai/coach.ts')
  const state = await server.ssrLoadModule('/src/training/state.ts')
  const test = async (name, run) => {
    try { await run(); console.log(`PASS ${name}`) }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`) }
  }
  const submit = async (id, answer) => {
    await s.saveTrainingDraft(id, answer)
    await s.freezeTrainingAnswer(id)
    return s.advanceTrainingSession(id)
  }
  await test('review editing is local; revisions preserve working draft and immutable answers', async () => {
    await s.startTrainingSession('local-edit')
    await submit('local-edit', 'original first answer')
    await submit('local-edit', 'original second answer')
    const before = await s.saveTrainingDraft('local-edit', 'unfinished current work')
    const preview = state.trainingEditPreview(before, 0)
    assert.equal(preview.draft, 'original first answer')
    assert.deepEqual(await s.getTrainingSession('local-edit'), before)
    const revision = { answer: 'revised observation', structuredDraft: Object.fromEntries(l.STRUCTURED_FIELD_DEFINITIONS.preview.filter((field) => field.id !== 'preview.metadata').map((field) => [field.id, 'Observed source information'])), reason: 'Separated observation from conclusion' }
    const updated = await s.reviseTrainingTurn('local-edit', 0, revision, 'zh-CN', { sessionId: before.sessionId, draftRevision: before.draftRevision })
    assert.ok(updated)
    assert.equal(updated.draft, before.draft)
    assert.equal(updated.currentStep, before.currentStep)
    assert.equal(updated.turns[0].answer, before.turns[0].answer)
    assert.equal(updated.turns.at(-1).revisionReason, revision.reason)
    assert.equal(updated.stepRecords['quick-browse'].status, 'needs-review')
    const model = e.buildReadingExportModel({ id: 'local-edit', title: 't', text: 'source', url: '', capturedAt: '2026-01-01', source: 'manual' }, updated)
    assert.ok(e.generateReadingMarkdown(model).includes(revision.reason))
    assert.ok(e.generateReadingPdfHtml(model).includes(revision.reason))
    assert.equal(JSON.parse(e.generateReadingJson(model)).answerVersions.at(-1).revisionReason, revision.reason)
    await assert.rejects(s.reviseTrainingTurn('local-edit', updated.turns.length - 1, { ...revision, answer: 'changed', structuredDraft: {} }, 'zh-CN', { sessionId: updated.sessionId, draftRevision: updated.draftRevision }))
    assert.deepEqual(await s.getTrainingSession('local-edit'), updated)
    assert.equal(await s.reviseTrainingTurn('local-edit', 0, revision, 'zh-CN', { sessionId: before.sessionId, draftRevision: before.draftRevision }), null)
    const confirmed = await s.confirmTrainingStep('local-edit', 'zh-CN', { sessionId: updated.sessionId, draftRevision: updated.draftRevision }, 'quick-browse')
    assert.equal(confirmed.currentStep, before.currentStep)
    assert.equal(confirmed.draft, before.draft)
    assert.equal(confirmed.stepRecords['quick-browse'].status, 'completed')
  })
  await test('library scores use only graded effective answers', async () => {
    const session = { flowId: 'reading-10', turns: [
      { stepId: 'preview', stepIndex: 0, answer: 'old answer', feedback: { total: 20 } },
      { stepId: 'preview', stepIndex: 0, answer: 'revised answer', feedback: { total: 80 } },
      { stepId: 'quick-browse', stepIndex: 1, answer: 'ungraded answer' },
    ] }
    assert.equal(state.trainingAverageScore(session), 80)
    assert.equal(state.trainingAverageScore({ ...session, turns: [session.turns[2]] }), null)
  })
  await test('late autosave cannot replace a new step, session or revision', async () => {
    const current = { sessionId: 'new', currentStepId: 'preview', draftRevision: 4, draft: 'keep input' }
    for (const saved of [ { ...current, sessionId: 'old' }, { ...current, currentStepId: 'quick-browse' }, { ...current, draftRevision: 3 } ]) {
      assert.strictEqual(state.acceptDraftSaveResponse(current, saved), current)
    }
    const saved = { ...current, draftRevision: 5 }
    assert.strictEqual(state.acceptDraftSaveResponse(current, saved), saved)
    assert.equal(state.canRetryTrainingDraft(current, { ...current, sessionId: 'different' }), false)
    assert.equal(state.canRetryTrainingDraft(current, { ...current, articleSnapshotId: 'changed' }), false)
  })
  await test('revising completed work returns to final review and preserves completed work count', async () => {
    await s.startTrainingSession('final-revision')
    for (let index = 0; index < 10; index++) await submit('final-revision', `answer for step ${index}`)
    const before = await s.getTrainingSession('final-revision')
    const revision = { answer: 'new observation', structuredDraft: Object.fromEntries(l.STRUCTURED_FIELD_DEFINITIONS.preview.filter((field) => field.id !== 'preview.metadata').map((field) => [field.id, 'Observed source information'])), reason: 'Correcting an inference' }
    const after = await s.reviseTrainingTurn('final-revision', 0, revision, 'zh-CN', { sessionId: before.sessionId, draftRevision: before.draftRevision })
    assert.equal(after.currentStep, 9)
    assert.equal(after.draft, before.turns[9].answer)
    assert.equal(state.trainingProgress(after).recorded, 10)
    assert.equal(state.trainingProgress(after).pendingReview, 9)
    assert.equal(state.trainingProgress(after).isComplete, false)
    assert.equal(after.completedAt, undefined)
    const count = after.answerVersions.length
    const unchanged = await s.reviseTrainingTurn('final-revision', after.turns.length - 1, revision, 'zh-CN', { sessionId: after.sessionId, draftRevision: after.draftRevision })
    assert.equal(unchanged.answerVersions.length, count)
    assert.equal(unchanged.draftRevision, after.draftRevision)
    for (const step of l.LESSON_STEPS.slice(1)) await s.confirmTrainingStep('final-revision', 'zh-CN', undefined, step.id)
    const confirmed = await s.getTrainingSession('final-revision')
    assert.equal(state.trainingProgress(confirmed).isComplete, true)
    assert.equal(confirmed.draft, before.turns[9].answer)
  })
  await test('feedback on a saved version preserves the active step and unfinished work', async () => {
    await s.startTrainingSession('saved-grade')
    await submit('saved-grade', 'saved answer')
    const before = await s.saveTrainingDraft('saved-grade', 'unfinished next step')
    const version = before.answerVersions[0]
    const feedback = { total: 85, nextStepId: 'quick-browse', nextQuestion: 'q' }
    await s.commitTrainingFeedback('saved-grade', feedback, 'zh-CN', { sessionId: before.sessionId, answerVersionId: version.id, draftRevision: before.draftRevision, draft: version.answer })
    const after = await s.getTrainingSession('saved-grade')
    assert.equal(after.draft, before.draft)
    assert.equal(after.currentStep, before.currentStep)
    assert.equal(after.turns.length, before.turns.length)
    assert.deepEqual(after.turns[0].feedback, feedback)
    const local = { ...before, draft: 'typing while feedback arrives', draftRevision: 99 }
    const merged = state.mergeTrainingFeedback(local, after)
    assert.equal(merged.draft, local.draft)
    assert.equal(merged.draftRevision, 99)
    assert.deepEqual(merged.turns[0].feedback, feedback)
    assert.strictEqual(state.mergeTrainingFeedback(local, { ...after, sessionId: 'different' }), local)
  })
  await test('formal advancement requires direct AI feedback and preserves active work', async () => {
    let listener
    chrome.commands = { onCommand: { addListener() {} } }
    chrome.runtime = { onInstalled: { addListener() {} }, onMessage: { addListener(callback) { listener = callback } } }
    data.locale = 'zh-CN'
    await server.ssrLoadModule('/src/background.ts')
    const send = (message) => new Promise((resolve) => listener(message, {}, resolve))
    const articles = await server.ssrLoadModule('/src/storage/articles.ts')
    await articles.upsertSavedArticle({ id: 'direct-ai-required', title: 'Article', text: 'First source paragraph.\n\nLast source paragraph.', url: '', source: 'manual', capturedAt: '2026-01-01', savedAt: '2026-01-01' })
    await s.startTrainingSession('direct-ai-required')
    const fields = Object.fromEntries(l.STRUCTURED_FIELD_DEFINITIONS.preview.filter((field) => field.id !== 'preview.metadata').map((field) => [field.id, 'Observed source information']))
    await s.saveTrainingDraft('direct-ai-required', 'saved independent observation', 'zh-CN', fields)
    const frozen = await s.freezeTrainingAnswer('direct-ai-required')
    const blocked = await send({ type: 'continue-training', articleId: 'direct-ai-required', sessionId: frozen.sessionId, stepId: frozen.currentStepId, draftRevision: frozen.draftRevision, answerVersionId: frozen.answerVersionId })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.error.code, 'TRAINING_AI_REQUIRED')
    const before = await s.saveTrainingDraft('direct-ai-required', 'unfinished current input')
    const after = await s.getTrainingSession('direct-ai-required')
    assert.equal(after.draft, before.draft)
    assert.equal(after.currentStep, before.currentStep)
  })
  await test('archive survives subsequent saves and other article creation', async () => {
    await s.startTrainingSession('archive')
    await s.saveTrainingDraft('archive', 'original answer')
    await s.resetTrainingSession('archive')
    await s.saveTrainingDraft('archive', 'new answer')
    await s.startTrainingSession('another')
    const history = await s.getTrainingHistory('archive')
    assert.equal(history.length, 2)
    assert.equal(history.find((item) => item.isArchived).draft, 'original answer')
  })
  await test('unchanged autosave preserves review and frozen identity', async () => {
    await s.startTrainingSession('review')
    await submit('review', 'first answer')
    await submit('review', 'second answer')
    await s.editTrainingTurn('review', 0)
    const next = await submit('review', 'changed first answer')
    const saved = await s.saveTrainingDraft('review', next.draft)
    assert.equal(saved.stepRecords['quick-browse'].status, 'needs-review')
    assert.equal((await s.confirmTrainingStep('review')).currentStep, 2)
    await s.saveTrainingDraft('review', 'third answer')
    const frozen = await s.freezeTrainingAnswer('review')
    await s.saveTrainingDraft('review', 'third answer')
    const refrozen = await s.freezeTrainingAnswer('review')
    assert.equal(refrozen.answerVersionId, frozen.answerVersionId)
  })
  await test('pending review is excluded from completion and obsolete AI context', async () => {
    const turns = l.LESSON_STEPS.map((step, stepIndex) => ({ stepId: step.id, stepIndex, answer: 'old answer', question: 'q', answerVersionId: `v${stepIndex}`, submittedAt: '2026-01-01' }))
    const session = { articleId: 'p', flowId: 'reading-10', courseVersion: 'guided-reading-10-v1', currentStep: 0, currentStepId: 'preview', draft: 'new draft', turns, stepRecords: Object.fromEntries(turns.map((turn) => [turn.stepId, { stepId: turn.stepId, draft: turn.answer, answerVersionId: turn.answerVersionId, status: turn.stepIndex === 0 ? 'draft' : 'needs-review' }])) }
    const model = e.buildReadingExportModel({ id: 'p', title: 't', text: 'source', url: '', capturedAt: '2026-01-01', source: 'manual' }, session)
    assert.equal(model.progress.completed, 0)
    assert.notEqual(model.status, 'completed')
    assert.equal(JSON.parse(c.buildGradePrompt('source', 't', undefined, session).user).precedingResults.length, 0)
  })
  await test('CJK whitespace excluded and old oversized fields retained', async () => {
    assert.equal(l.isLessonAnswerFormatValid(3, Array(3).fill('一 二 三 四 五 六 七 八 九 十').join('\n')), true)
    const old = '字'.repeat(4001)
    assert.equal(l.normalizeTrainingStructuredDraft({ 'preview.firstParagraph': old })['preview.firstParagraph'], old)
  })
  await test('late feedback attaches to frozen version without replacing draft', async () => {
    await s.startTrainingSession('late')
    await s.saveTrainingDraft('late', 'original answer')
    const frozen = await s.freezeTrainingAnswer('late')
    await s.saveTrainingDraft('late', 'new draft remains')
    const feedback = { nextStepId: 'quick-browse', nextQuestion: 'q' }
    await s.commitTrainingFeedback('late', feedback, 'zh-CN', { sessionId: frozen.sessionId, answerVersionId: frozen.answerVersionId, draftRevision: frozen.draftRevision, draft: frozen.draft })
    const latest = await s.getTrainingSession('late')
    assert.equal(latest.draft, 'new draft remains')
    assert.deepEqual(latest.answerVersions[0].feedback, feedback)
    assert.equal(latest.currentStep, 0)
  })
  await test('archived requests receive late feedback without changing the new session', async () => {
    await s.startTrainingSession('archived-late')
    await s.saveTrainingDraft('archived-late', 'frozen original')
    const frozen = await s.freezeTrainingAnswer('archived-late')
    await s.beginTrainingRequest('archived-late', { id: 'late-request', kind: 'grade', sessionId: frozen.sessionId, stepId: frozen.currentStepId, answerVersionId: frozen.answerVersionId })
    await s.resetTrainingSession('archived-late')
    await s.saveTrainingDraft('archived-late', 'keep new session input')
    const feedback = { nextStepId: 'quick-browse', nextQuestion: 'q' }
    const expected = { sessionId: frozen.sessionId, answerVersionId: frozen.answerVersionId, draftRevision: frozen.draftRevision, draft: frozen.draft }
    await s.commitTrainingFeedback('archived-late', feedback, 'zh-CN', expected)
    await s.commitTrainingFeedback('archived-late', { ...feedback, nextQuestion: 'duplicate' }, 'zh-CN', expected)
    await s.finishTrainingRequest('archived-late', 'late-request', 'succeeded')
    await s.finishTrainingRequest('archived-late', 'late-request', 'failed')
    const history = await s.getTrainingHistory('archived-late')
    const archived = history.find((item) => item.isArchived)
    assert.deepEqual(archived.answerVersions[0].feedback, feedback)
    assert.equal(archived.aiRequests[0].status, 'succeeded')
    assert.equal((await s.getTrainingSession('archived-late')).draft, 'keep new session input')
  })
  await test('AI advancement restores the next step awaiting review', async () => {
    await s.startTrainingSession('ai-review')
    await submit('ai-review', 'first answer')
    await submit('ai-review', 'second answer to retain')
    await s.editTrainingTurn('ai-review', 0)
    await s.saveTrainingDraft('ai-review', 'changed first answer')
    const frozen = await s.freezeTrainingAnswer('ai-review')
    const result = await s.commitTrainingFeedback('ai-review', { nextStepId: 'quick-browse', nextQuestion: 'q' }, 'zh-CN', { sessionId: frozen.sessionId, answerVersionId: frozen.answerVersionId, draftRevision: frozen.draftRevision, draft: frozen.draft })
    assert.equal(result.currentStep, 1)
    assert.equal(result.draft, 'second answer to retain')
    assert.equal(result.stepRecords['quick-browse'].status, 'needs-review')
  })
  await test('new oversized fields are rejected without erasing existing input', async () => {
    await s.startTrainingSession('limits')
    await s.saveTrainingDraft('limits', 'retained answer')
    await assert.rejects(s.saveTrainingDraft('limits', 'oversized replacement', 'zh-CN', { 'preview.firstParagraph': '字'.repeat(801) }))
    assert.equal((await s.getTrainingSession('limits')).draft, 'retained answer')
  })
  await test('reinforcement is separate, idempotent, and cannot change formal progress', async () => {
    const session = await s.startTrainingSession('practice')
    await s.saveTrainingDraft('practice', 'formal draft to retain')
    const before = await s.getTrainingSession('practice')
    await s.saveTrainingReinforcement('practice', 'practice-1', 'independent practice', 'zh-CN', session.sessionId)
    await s.saveTrainingReinforcement('practice', 'practice-1', 'independent practice', 'zh-CN', session.sessionId)
    const after = await s.getTrainingSession('practice')
    assert.equal(after.draft, before.draft)
    assert.deepEqual(after.turns, before.turns)
    assert.deepEqual(after.stepRecords, before.stepRecords)
    assert.equal(after.reinforcements.length, 1)
    assert.equal(after.reinforcements[0].answer, 'independent practice')
  })
  await test('snapshot metadata and body stay consistent in exports', async () => {
    const article = { id: 'snapshot', title: 'edited title', text: 'edited body', metadata: { author: 'edited author', subtitle: '', source: '' }, url: '', capturedAt: '2026-01-01', source: 'manual' }
    const snapshot = { id: 'snapshot-1', title: 'original title', text: 'original body', metadata: { author: 'original author', subtitle: '', source: '' }, blocks: [{ id: 'original-block', type: 'paragraph', text: 'original body' }] }
    const session = await s.startTrainingSession('snapshot', 'zh-CN', snapshot)
    const model = e.buildReadingExportModel(article, session)
    assert.equal(model.title, 'original title')
    assert.equal(model.metadata.author, 'original author')
    assert.equal(model.articleBlocks[0].text, 'original body')
    assert.ok(e.generateReadingMarkdown(model).includes('original author'))
    assert.ok(!e.generateReadingPdfHtml(model).includes('edited body'))
  })
  await test('summary validation enforces three points and language boundaries', async () => {
    for (const locale of ['zh-CN', 'ja', 'ko', 'en']) {
      const point = (count) => locale === 'en' ? Array(count).fill('word').join(' ') : '字'.repeat(count)
      const session = { currentStep: 3, draft: Array(3).fill(point(15)).join('\n'), structuredDraft: { 'threePoints.sources': 'source block 1' } }
      assert.equal(l.isTrainingDraftValid(session, locale), true)
      assert.equal(l.isTrainingDraftValid({ ...session, draft: Array(3).fill(point(16)).join('\n') }, locale), false)
      assert.equal(l.isTrainingDraftValid({ ...session, draft: point(15) }, locale), false)
      assert.equal(l.isTrainingDraftValid({ ...session, draft: Array(4).fill(point(15)).join('\n') }, locale), false)
    }
  })
  await test('reference answers remain bound to archived scored versions', async () => {
    await s.startTrainingSession('reference')
    await s.saveTrainingDraft('reference', 'original reference answer')
    const frozen = await s.freezeTrainingAnswer('reference')
    const graded = await s.commitTrainingFeedback('reference', { nextStepId: 'quick-browse', nextQuestion: 'q' }, 'zh-CN', { sessionId: frozen.sessionId, answerVersionId: frozen.answerVersionId, draftRevision: frozen.draftRevision, draft: frozen.draft })
    const turn = graded.turns[0]
    await s.resetTrainingSession('reference')
    const reference = { answer: 'reference result', sources: [] }
    await s.saveTrainingReferenceAnswer('reference', turn.submittedAt, reference, 'zh-CN', { sessionId: frozen.sessionId, answerVersionId: frozen.answerVersionId })
    const archived = (await s.getTrainingHistory('reference')).find((item) => item.isArchived)
    assert.deepEqual(archived.turns[0].referenceAnswer, reference)
    assert.equal((await s.getTrainingSession('reference')).turns.length, 0)
  })
  await test('browse rows persist source identity and validate quotes against the snapshot', async () => {
    const b = await server.ssrLoadModule('/src/training/browse.ts')
    const blocks = [{ id: 'p1', type: 'paragraph', text: 'First sentence. Last sentence.' }, { id: 'p2', type: 'paragraph', text: 'Only one sentence.' }]
    const rows = b.createBrowseRows(blocks).map((row) => ({ ...row, role: 'background', important: row.paragraph === 2 }))
    assert.equal(rows[1].first, rows[1].last)
    const encoded = JSON.stringify(rows)
    assert.deepEqual(b.readBrowseRows(encoded), rows)
    assert.equal(b.areBrowseRowsValid(encoded, blocks), true)
    assert.equal(b.areBrowseRowsValid(JSON.stringify([{ ...rows[0], first: 'Invented quote.' }, rows[1]]), blocks), false)
    assert.equal(b.areBrowseRowsValid(JSON.stringify([{ ...rows[0], sourceId: 'wrong' }, rows[1]]), blocks), false)
    assert.equal(b.areBrowseRowsValid(JSON.stringify([rows[0], rows[0]]), blocks), false)
    const session = await s.startTrainingSession('browse-rows', 'zh-CN', { id: 'snap', title: 't', text: blocks.map((x) => x.text).join('\n\n'), blocks })
    await s.setTrainingStep('browse-rows', 1)
    await s.saveTrainingDraft('browse-rows', 'Full article structure', 'zh-CN', { 'quickBrowse.structure': 'Two sections', 'quickBrowse.paragraphMap': encoded })
    const saved = await s.getTrainingSession('browse-rows')
    assert.equal(saved.structuredDraft['quickBrowse.paragraphMap'], encoded)
    assert.equal(l.isTrainingDraftValid(saved), true)
    assert.equal(l.isTrainingDraftValid({ ...saved, structuredDraft: { ...saved.structuredDraft, 'quickBrowse.paragraphMap': '[]' } }), false)
    assert.ok(session.sessionId)
  })
  await test('candidate paragraphs initialize only an untouched third step', async () => {
    const state = await server.ssrLoadModule('/src/training/state.ts')
    const row = { sourceId: 'p2', paragraph: 2, role: 'example', first: 'Example.', last: 'Example.', important: true }
    const session = { turns: [{ stepId: 'quick-browse', stepIndex: 1, answer: 'browse answer', structuredDraft: { 'quickBrowse.paragraphMap': JSON.stringify([row]) } }] }
    assert.deepEqual(state.initialImportantParagraphs(session), [2])
    assert.deepEqual(state.initialImportantParagraphs({ ...session, importantParagraphs: [] }), [])
    assert.deepEqual(state.initialImportantParagraphs({ ...session, importantParagraphs: [1] }), [1])
  })
  await test('question lists require one or two fully developed key questions', async () => {
    const q = await server.ssrLoadModule('/src/training/questions.ts')
    const first = { id: 'q1', category: 'why', question: 'Why does the claim follow?', selected: true, whyImportant: 'The central conclusion depends on it.', relatedParagraphs: 'p1', answered: 'It gives one example.', unanswered: 'It does not explain the mechanism.' }
    const second = { ...first, id: 'q2', category: 'who', selected: false, whyImportant: '', relatedParagraphs: '', answered: '', unanswered: '' }
    const encode = (rows) => JSON.stringify(rows)
    assert.equal(q.areQuestionsComplete(encode([first, second])), true)
    assert.equal(q.areQuestionsComplete(encode([{ ...first, selected: false }, second])), false)
    assert.equal(q.areQuestionsComplete(encode([first, { ...first, id: 'q2' }, { ...first, id: 'q3' }])), false)
    assert.equal(q.areQuestionsComplete(encode([{ ...first, question: '原文未提供' }])), false)
    assert.equal(q.areQuestionsComplete(encode([{ ...first, whyImportant: 'not provided' }])), false)
    assert.equal(q.areQuestionsComplete(encode([{ ...first, category: 'other' }])), false)
    assert.equal(q.areQuestionsComplete(encode([first, first])), false)
    const draft = { 'questions.items': encode([first, second]) }
    assert.deepEqual(l.normalizeTrainingStructuredDraft(draft), draft)
    assert.equal(l.isTrainingDraftValid({ currentStep: 4, draft: 'Selected important questions', structuredDraft: draft }), true)
  })
  await test('non-argumentative material can complete analysis with a grounded explanation', async () => {
    const blocks = [{ id: 'recipe', type: 'paragraph', text: 'Mix flour and water. Bake for twenty minutes.' }]
    const structuredDraft = { 'applicability.mode': 'not-applicable', 'applicability.reason': 'This is a sequence of instructions, with no supported claim to decompose.', 'applicability.sourceId': 'recipe', 'applicability.quote': 'Mix flour and water.', 'toulminSimple.argumentId': 'argument-1' }
    for (const currentStep of [5, 6, 7]) {
      const session = { currentStep, draft: 'No argument found: instructional material.', argumentId: 'argument-1', structuredDraft, articleSnapshot: { blocks } }
      assert.equal(l.isTrainingDraftValid(session), true)
      assert.equal(l.isTrainingDraftValid({ ...session, structuredDraft: { ...structuredDraft, 'applicability.quote': 'Fabricated quotation.' } }), false)
      assert.equal(l.isTrainingDraftValid({ ...session, structuredDraft: { ...structuredDraft, 'applicability.reason': '' } }), false)
      const prompt = JSON.parse(c.buildGradePrompt(blocks[0].text, 'Instructions', undefined, { ...session, turns: [], structuredDraft: { ...structuredDraft, 'toulminSimple.claim': 'Hidden prior claim' } }, 'zh-CN', blocks).user)
      assert.ok(prompt.requiredFields.includes('applicability.reason'))
      assert.ok(!prompt.requiredFields.includes('toulminSimple.claim'))
      assert.equal(prompt.structuredDraft['toulminSimple.claim'], undefined)
      const reference = JSON.parse(c.buildReferenceAnswerPrompt(blocks[0].text, 'Instructions', undefined, { stepIndex: currentStep, stepId: l.LESSON_STEPS[currentStep].id, answer: session.draft, structuredDraft, question: 'task' }, 'zh-CN', blocks).user)
      assert.ok(reference.requiredFields.includes('applicability.reason'))
    }
    await s.startTrainingSession('nonargument', 'zh-CN', { id: 'recipe-snapshot', title: 'Instructions', text: blocks[0].text, blocks })
    for (const currentStep of [5, 6, 7]) {
      await s.setTrainingStep('nonargument', currentStep)
      await s.saveTrainingDraft('nonargument', 'No argument found. Evidence: Mix flour and water.', 'zh-CN', structuredDraft)
      const frozen = await s.freezeTrainingAnswer('nonargument')
      assert.equal(l.isTrainingDraftValid(frozen), true)
      await s.advanceTrainingSession('nonargument')
    }
    const complete = await s.getTrainingSession('nonargument')
    assert.equal(complete.currentStep, 8)
    assert.equal(complete.argumentId, 'argument-1')
    assert.equal(complete.turns.length, 3)
    const model = e.buildReadingExportModel({ id: 'nonargument', title: 'Instructions', text: blocks[0].text, url: '', source: 'manual', capturedAt: '2026-01-01' }, complete)
    assert.equal(model.progress.completed, 3)
    assert.ok(e.generateReadingJson(model).includes('applicability.reason'))
    assert.ok(e.generateReadingMarkdown(model).includes('Mix flour and water.'))
    assert.ok(e.generateReadingPdfHtml(model).includes('Mix flour and water.'))
  })
  await test('applicability controls are wired inside the structured-step branch', async () => {
    const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let count = 0
    const visit = (node) => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'ApplicabilityForm') {
        count++
        let ancestor = node.parent
        let correctBranch = false
        while (ancestor) {
          if (ts.isConditionalExpression(ancestor) && ancestor.condition.getText(source) === 'isStructuredStep' && ancestor.whenTrue.pos <= node.pos && ancestor.whenTrue.end >= node.end) correctBranch = true
          ancestor = ancestor.parent
        }
        assert.equal(correctBranch, true)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    assert.equal(count, 1)
  })
  await test('metadata distinguishes extraction gaps from verified absence and requires review', async () => {
    const m = await server.ssrLoadModule('/src/training/evidence.ts')
    const metadata = m.initialMetadataReview({ title: 'Title', metadata: { author: '', source: 'Journal', subtitle: '' } })
    assert.equal(metadata.fields.author.status, 'not-extracted')
    assert.equal(metadata.fields.source.status, 'found')
    assert.equal(metadata.fields.date.status, 'not-extracted')
    assert.equal(m.isMetadataReviewComplete(JSON.stringify(metadata)), false)
    metadata.reviewed = true
    metadata.fields.author.status = 'verified-absent'
    assert.equal(m.isMetadataReviewComplete(JSON.stringify(metadata)), true)
    metadata.fields.author.status = 'found'
    assert.equal(m.isMetadataReviewComplete(JSON.stringify(metadata)), false)
    metadata.fields.author.value = 'Author supplied by reader'
    assert.equal(m.isMetadataReviewComplete(JSON.stringify(metadata)), true)
  })
  await test('each summary point needs a quote bound to its own snapshot source', async () => {
    const m = await server.ssrLoadModule('/src/training/evidence.ts')
    const snapshot = { id: 'snap', blocks: [{ id: 'p1', type: 'paragraph', text: 'One fact supports the first point.' }, { id: 'chart', type: 'chart', text: 'Twenty participants improved.', alt: 'Chart' }] }
    const evidence = { snapshotId: 'snap', checked: true, points: [{ blockId: 'p1', quote: 'One fact' }, { blockId: 'chart', quote: 'Twenty participants' }, { blockId: 'p1', quote: 'first point' }] }
    const session = { currentStep: 3, draft: '一点\n二点\n三点', articleSnapshot: snapshot, structuredDraft: { 'threePoints.evidence': JSON.stringify(evidence) } }
    assert.equal(m.isSummaryEvidenceValid(JSON.stringify(evidence), snapshot), true)
    assert.equal(l.isTrainingDraftValid(session), true)
    for (const invalid of [{ ...evidence, snapshotId: 'other' }, { ...evidence, checked: false }, { ...evidence, points: evidence.points.slice(1) }, { ...evidence, points: [{ blockId: 'p1', quote: 'fabricated' }, ...evidence.points.slice(1)] }]) {
      assert.equal(m.isSummaryEvidenceValid(JSON.stringify(invalid), snapshot), false)
      assert.equal(l.isTrainingDraftValid({ ...session, structuredDraft: { 'threePoints.evidence': JSON.stringify(invalid) } }), false)
    }
  })
  await test('all steps provide explicit grading criteria and preview hides unseen body', async () => {
    const blocks = [{ id: 'first', type: 'paragraph', text: 'Opening observation.' }, { id: 'middle', type: 'paragraph', text: 'HIDDEN_BODY_CONCLUSION' }, { id: 'last', type: 'paragraph', text: 'Final observation.' }]
    for (const [currentStep, step] of l.LESSON_STEPS.entries()) {
      const session = { currentStep, draft: 'An independent answer.', turns: [], importantParagraphs: [1] }
      const prompt = JSON.parse(c.buildGradePrompt(blocks.map((block) => block.text).join('\n\n'), 'Title', undefined, session, 'zh-CN', blocks).user)
      assert.deepEqual(Object.keys(prompt.rubric.criteria).sort(), [...step.dimensions].sort())
      assert.ok(prompt.rubric.scoreBands.length >= 4)
      assert.ok(prompt.rubric.allowedAbsence.length)
      if (currentStep === 0) assert.ok(!JSON.stringify(prompt).includes('HIDDEN_BODY_CONCLUSION'))
      if (currentStep === 2) assert.deepEqual(prompt.assessmentScope.paragraphs, [1])
    }
  })
  await test('invented block identities cannot fall back to a valid paragraph number', async () => {
    const blocks = [{ id: 'stable-1', type: 'paragraph', text: 'Original source material for citation.' }]
    assert.throws(() => c.validateAiReferenceAnswer({ answer: 'A sufficiently long independent reference answer.', sources: [{ paragraph: 1, blockId: 'invented-id', quote: 'Original source', comment: 'Supports the answer.' }] }, blocks[0].text, blocks))
  })
  await test('feedback must cite the assessed preview or selected-paragraph scope', async () => {
    const blocks = [{ id: 'p1', type: 'paragraph', text: 'First paragraph facts.' }, { id: 'p2', type: 'paragraph', text: 'Hidden middle paragraph facts.' }, { id: 'p3', type: 'paragraph', text: 'Last paragraph facts.' }]
    for (const stepIndex of [0, 2]) {
      const value = { dimensions: Object.fromEntries(['fidelity', 'claim', 'cause', 'structure'].map((dimension) => [dimension, { score: l.LESSON_STEPS[stepIndex].dimensions.includes(dimension) ? 8 : null, reason: 'Accurate for this task.' }])), strengths: [], gaps: [], sources: [{ paragraph: 2, blockId: 'p2', quote: 'Hidden middle', comment: 'Supports the response.' }], nextQuestion: 'What should I consider next?', nextStepId: l.getNextLessonStepId(stepIndex) }
      assert.throws(() => c.validateAiFeedback(value, blocks.map((block) => block.text).join('\n\n'), 'My independent response.', blocks, stepIndex, 'en', [1]))
      assert.throws(() => c.validateAiReferenceAnswer({ answer: 'A sufficiently long reference response.', sources: value.sources }, '', blocks, { stepIndex, importantParagraphs: [1] }))
    }
  })
  await test('reviewed metadata and per-point evidence survive versions and all exports', async () => {
    const m = await server.ssrLoadModule('/src/training/evidence.ts')
    const f = await server.ssrLoadModule('/src/articles/format.ts')
    const article = { id: 'evidence-flow', title: 'Study', text: 'Twenty people read daily.\n\nThe study was short.', metadata: { author: '', source: 'Journal', subtitle: '' }, url: '', source: 'manual', capturedAt: '2026-01-01' }
    const snapshot = f.createTrainingArticleSnapshot(article)
    assert.equal(snapshot.metadataReview.fields.author.status, 'not-extracted')
    assert.notEqual(f.createTrainingArticleSnapshot({ ...article, title: 'Changed title' }).id, snapshot.id)
    await s.startTrainingSession(article.id, 'zh-CN', snapshot)
    const metadata = m.initialMetadataReview(article)
    metadata.fields.author.status = 'verified-absent'
    metadata.reviewed = true
    const draft = Object.fromEntries(['firstParagraph', 'lastParagraph', 'structure', 'expectedQuestion', 'unknown'].map((field) => [`preview.${field}`, 'Independent observation and question.']))
    draft['preview.metadata'] = JSON.stringify(metadata)
    await s.saveTrainingDraft(article.id, 'Observed title and source; author verified absent.', 'zh-CN', draft)
    assert.equal(l.isTrainingDraftValid(await s.getTrainingSession(article.id)), true)
    await s.freezeTrainingAnswer(article.id)
    await s.advanceTrainingSession(article.id)
    await s.setTrainingStep(article.id, 3)
    const evidence = { snapshotId: snapshot.id, checked: true, points: [{ blockId: snapshot.blocks[0].id, quote: 'Twenty people' }, { blockId: snapshot.blocks[0].id, quote: 'read daily' }, { blockId: snapshot.blocks[1].id, quote: 'study was short' }] }
    await s.saveTrainingDraft(article.id, '二十人参与\n每日阅读\n研究期短', 'zh-CN', { 'threePoints.evidence': JSON.stringify(evidence) })
    assert.equal(l.isTrainingDraftValid(await s.getTrainingSession(article.id)), true)
    await s.freezeTrainingAnswer(article.id)
    await s.advanceTrainingSession(article.id)
    const session = await s.getTrainingSession(article.id)
    const model = e.buildReadingExportModel(article, session)
    assert.equal(model.turns[0].metadataReview.fields.author.status, 'verified-absent')
    assert.deepEqual(model.turns[1].summaryEvidence, evidence)
    assert.equal(session.answerVersions[0].structuredDraft['preview.metadata'], JSON.stringify(metadata))
    for (const output of [e.generateReadingJson(model), e.generateReadingMarkdown(model), e.generateReadingPdfHtml(model)]) {
      assert.ok(output.includes('study was short'))
      assert.ok(output.includes(snapshot.blocks[1].id))
    }
  })
  await test('metadata and summary controls render with all four localized catalogs', async () => {
    const { I18nProvider } = await server.ssrLoadModule('/src/i18n/context.tsx')
    const { MetadataReviewForm, SummaryEvidenceForm } = await server.ssrLoadModule('/src/training/EvidenceForms.tsx')
    const { FieldAssist } = await server.ssrLoadModule('/src/training/FieldAssist.tsx')
    const m = await server.ssrLoadModule('/src/training/evidence.ts')
    const { translate } = await server.ssrLoadModule('/src/i18n/messages.ts')
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    try {
      for (const locale of ['zh-CN', 'en', 'ja', 'ko']) {
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: locale } })
        const metadataHtml = renderToStaticMarkup(createElement(I18nProvider, null, createElement(MetadataReviewForm, { value: JSON.stringify(m.initialMetadataReview({ title: 'Title' })), disabled: false, onChange() {} })))
        assert.ok(metadataHtml.includes(translate(locale, 'coach.metadata.not-extracted')))
        const summaryHtml = renderToStaticMarkup(createElement(I18nProvider, null, createElement(SummaryEvidenceForm, { value: JSON.stringify(m.emptySummaryEvidence('snap')), snapshot: { id: 'snap', blocks: [{ id: 'p', type: 'paragraph', text: 'Source text.' }] }, disabled: false, onChange() {} })))
        assert.equal((summaryHtml.match(/<fieldset/g) ?? []).length, 3)
        assert.ok(summaryHtml.includes(translate(locale, 'coach.summary.checked')))
        const assistProps = { fieldId: 'preview.title', aiConfigured: true, busyKey: null, disabled: false, onRequest() {} }
        const hiddenAssistHtml = renderToStaticMarkup(createElement(I18nProvider, null, createElement(FieldAssist, { ...assistProps, showFieldAssist: false })))
        assert.equal(hiddenAssistHtml, '')
        const visibleAssistHtml = renderToStaticMarkup(createElement(I18nProvider, null, createElement(FieldAssist, { ...assistProps, showFieldAssist: true })))
        assert.ok(visibleAssistHtml.includes(translate(locale, 'coach.fieldAssist.hint')))
      }
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
      else delete globalThis.navigator
    }
  })
} finally { await server.close() }
if (failures) process.exitCode = 1
