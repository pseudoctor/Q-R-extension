import type {
  AiFeedback,
  AiReferenceAnswer,
  Locale,
  StorageState,
  TrainingSession,
  TrainingSessionStore,
  TrainingSessionStoreV2,
  TrainingSessionStoreV3,
  TrainingAnswerVersion,
  TrainingArticleSnapshot,
  TrainingAiRequest,
  TrainingRequestKind,
  TrainingRequestStatus,
  TrainingStepRecord,
  TrainingStructuredDraft,
  TrainingRevision,
} from '../types'
import { getLegacyLessonSteps, getLessonSteps, getNextLessonStepId, LESSON_STEPS, normalizeThreeSentenceDrafts, normalizeTrainingStructuredDraft, STRUCTURED_ANSWER_MAX_LENGTH, structuredFieldsForStep, THREE_SENTENCE_ANSWER_MAX_LENGTH, TRAINING_ANSWER_MAX_LENGTH } from '../training/lessons'
import { createKeyedMutationQueue } from './mutation-queue'
import { trainingProgress, trainingEditPreview } from '../training/state'
import { STRUCTURED_FIELD_DEFINITIONS, structuredFieldLimit, isTrainingDraftValid } from '../training/lessons'

export const TRAINING_SESSIONS_KEY = 'trainingSessions'
export const TRAINING_SESSIONS_V2_KEY = 'trainingSessionsV2'
export const TRAINING_SESSIONS_V3_KEY = 'trainingSessionsV3'
export const TRAINING_TEST_SESSIONS_V3_KEY = 'trainingTestSessionsV3'
const runTrainingMutation = createKeyedMutationQueue()
const trainingMutation = <T>(mutation: () => Promise<T>) => runTrainingMutation(TRAINING_SESSIONS_V3_KEY, mutation)

export function normalizeTrainingSessionStore(value: unknown, locale: Locale = 'zh-CN'): TrainingSessionStore {
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && value.version === 1 && Array.isArray(value.items)
      ? value.items
      : []
  return {
    version: 1,
    items: items
      .filter((item) => isTrainingSession(item, 8, 'legacy-8'))
      .map((item) => withQuestionDefault(normalizeLegacyTrainingSession(item), locale)),
  }
}

export function normalizeTrainingSessionStoreV2(value: unknown, locale: Locale = 'zh-CN'): TrainingSessionStoreV2 {
  const items = isRecord(value) && value.version === 2 && Array.isArray(value.items) ? value.items : []
  return {
    version: 2,
    items: items
      .filter((item) => isTrainingSession(item, LESSON_STEPS.length, 'reading-10'))
      .map((item) => withQuestionDefault({
        ...item,
        flowId: 'reading-10',
        courseVersion: item.courseVersion === 'guided-reading-10-v1' ? 'guided-reading-10-v1' : 'guided-reading-10-v0',
      }, locale)),
  }
}

export function normalizeTrainingSessionStoreV3(value: unknown, locale: Locale = 'zh-CN'): TrainingSessionStoreV3 {
  const items = isRecord(value) && value.version === 3 && Array.isArray(value.items) ? value.items : []
  return {
    version: 3,
    items: items
      .filter((item) => isTrainingSession(item, LESSON_STEPS.length, 'reading-10'))
      .filter((item) => item.courseVersion === 'guided-reading-10-v1')
      .map((item) => withQuestionDefault({
        ...item,
        flowId: 'reading-10',
        courseVersion: 'guided-reading-10-v1',
        sessionId: typeof item.sessionId === 'string' && item.sessionId ? item.sessionId : createTrainingId(),
        currentStepId: typeof item.currentStepId === 'string' ? item.currentStepId : getLessonSteps(locale)[item.currentStep]?.id,
        draftRevision: typeof item.draftRevision === 'number' && Number.isInteger(item.draftRevision) && item.draftRevision >= 0 ? item.draftRevision : 0,
        ...(Array.isArray(item.aiRequests) ? { aiRequests: normalizeTrainingAiRequests(item.aiRequests) } : {}),
      }, locale)),
  }
}

export async function readTrainingSessions(locale: Locale = 'zh-CN'): Promise<TrainingSession[]> {
  if (await isTestModeEnabled()) return readTrainingSessionsV3(locale, true)
  const { legacy, current, currentV3 } = await readTrainingStores(locale)
  const currentArticleIds = new Set([...currentV3, ...current].map((session) => session.articleId))
  return [...currentV3, ...current, ...legacy.filter((session) => !currentArticleIds.has(session.articleId))]
}

export async function getTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  return (await readTrainingSessions(locale)).find((session) => session.articleId === articleId) ?? null
}

export function isLegacyTrainingSession(session: TrainingSession | null | undefined) {
  return session?.flowId === 'legacy-8'
}

export function isHistoricalTrainingSession(session: TrainingSession | null | undefined) {
  return session?.flowId === 'reading-10' && session.courseVersion === 'guided-reading-10-v0'
}

function questionForNextStep(nextStep: number, feedback: AiFeedback, locale: Locale) {
  return getLessonSteps(locale)[nextStep]?.question || feedback.nextQuestion
}

export async function startTrainingSession(
  articleId: string,
  locale: Locale = 'zh-CN',
  articleSnapshot?: TrainingArticleSnapshot,
) {
  return trainingMutation(async () => {
    const testMode = await isTestModeEnabled()
    const current = await readTrainingSessionsV3(locale, testMode)
    const existing = current.find((session) => session.articleId === articleId)
    if (existing) {
      if (articleSnapshot && !existing.articleSnapshot) {
        const updated = { ...existing, articleSnapshotId: articleSnapshot.id, articleSnapshot, updatedAt: new Date().toISOString() }
        await writeTrainingSessionsV3(replaceCurrentSession(current, updated), testMode)
        return updated
      }
      return existing
    }

    const now = new Date().toISOString()
    const firstStep = getLessonSteps(locale)[0]
    const session: TrainingSession = {
      articleId,
      flowId: 'reading-10',
      courseVersion: 'guided-reading-10-v1',
      sessionId: createTrainingId(),
      isTest: testMode,
      ...(articleSnapshot ? { articleSnapshotId: articleSnapshot.id, articleSnapshot } : {}),
      currentStepId: firstStep.id,
      draftRevision: 0,
      currentStep: 0,
      currentQuestion: firstStep.question,
      draft: '',
      turns: [],
      startedAt: now,
      updatedAt: now,
    }
    await writeTrainingSessionsV3([session, ...current], testMode)
    return session
  })
}

export async function getTrainingHistory(articleId: string, locale: Locale = 'zh-CN') {
  const testMode = await isTestModeEnabled()
  const store = testMode
    ? await readAllTrainingSessionsV3(locale, true)
    : (() => {
      return [] as TrainingSession[]
    })()
  if (!testMode) {
    const { legacy, current, currentV3 } = await readTrainingStores(locale)
    store.push(...currentV3, ...current, ...legacy)
    store.push(...(await readAllTrainingSessionsV3(locale, false)).filter((session) => session.isArchived))
  }
  return store
    .filter((session) => session.articleId === articleId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function setTrainingStep(
  articleId: string,
  stepIndex: number,
  locale: Locale = 'zh-CN',
  expected?: { sessionId?: string; draftRevision?: number },
) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session || session.flowId !== 'reading-10') return null
    if (!matchesSessionIdentity(session, expected)) return null
    const requestedStep = Number.isFinite(stepIndex) ? Math.trunc(stepIndex) : 0
    const nextStep = Math.min(LESSON_STEPS.length - 1, Math.max(0, requestedStep))
    const step = getLessonSteps(locale)[nextStep]
    const restored = restoreStepRecord(session, nextStep, locale)
    const updated = {
      ...session,
      currentStep: nextStep,
      currentStepId: step.id,
      currentQuestion: step.question,
      draft: restored.draft,
      structuredDraft: restored.structuredDraft,
      importantParagraphs: restored.importantParagraphs,
      threeSentenceDrafts: restored.threeSentenceDrafts,
      paragraphCursor: restored.paragraphCursor,
      updatedAt: new Date().toISOString(),
    }
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export async function saveTrainingDraft(
  articleId: string,
  answer: string,
  locale: Locale = 'zh-CN',
  structuredDraft?: TrainingStructuredDraft,
  importantParagraphs?: unknown,
  threeSentenceDrafts?: unknown,
  paragraphCursor?: unknown,
  expected?: { sessionId?: string; stepId?: string; draftRevision?: number },
) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session) return null
    if (!matchesSessionIdentity(session, expected) || (expected?.stepId && expected.stepId !== session.currentStepId)) return null
    const currentStep = getLessonSteps(locale)[session.currentStep]
    for (const field of STRUCTURED_FIELD_DEFINITIONS[currentStep?.id ?? ''] ?? []) {
      const value = structuredDraft?.[field.id]
      if (value !== undefined && value !== session.structuredDraft?.[field.id] && value.length > structuredFieldLimit(field)) {
        throw new Error(`字段 ${field.id} 超过 ${structuredFieldLimit(field)} 字符；原草稿已保留。`)
      }
    }
    const isStructured = Boolean(currentStep && structuredFieldsForStep(currentStep.id).length > 0)
    const maxLength = threeSentenceDrafts === undefined
      ? isStructured ? STRUCTURED_ANSWER_MAX_LENGTH : TRAINING_ANSWER_MAX_LENGTH
      : THREE_SENTENCE_ANSWER_MAX_LENGTH
    if (answer.length > maxLength) {
      throw new Error(`回答需要不超过 ${maxLength.toLocaleString()} 个字符。`)
    }

    const stepId = session.currentStepId ?? getLessonSteps(locale)[session.currentStep]?.id ?? ''
    const nextDraft = {
      ...session,
      draft: answer,
      ...(structuredDraft === undefined ? {} : { structuredDraft: normalizeTrainingStructuredDraft(structuredDraft) }),
      ...(importantParagraphs === undefined ? {} : { importantParagraphs: normalizeImportantParagraphs(importantParagraphs) }),
      ...(threeSentenceDrafts === undefined ? {} : { threeSentenceDrafts: normalizeThreeSentenceDrafts(threeSentenceDrafts) }),
      ...(paragraphCursor === undefined
        ? {}
        : { paragraphCursor: typeof paragraphCursor === 'number' && Number.isInteger(paragraphCursor) && paragraphCursor >= 0 ? paragraphCursor : 0 }),
    }
    if (sameDraft(session, nextDraft)) return session
    const updated = {
      ...nextDraft,
      answerVersionId: undefined,
      stepRecords: updateStepRecord(session.stepRecords, stepId, nextDraft, 'draft'),
      draftRevision: (session.draftRevision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    }
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export async function freezeTrainingAnswer(
  articleId: string,
  locale: Locale = 'zh-CN',
  expected?: { sessionId?: string; stepId?: string; draftRevision?: number },
) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session || !session.draft.trim()) return null
    if (!matchesSessionIdentity(session, expected) || (expected?.stepId && expected.stepId !== session.currentStepId)) return null
    const step = getLessonSteps(locale)[session.currentStep]
    if (!step) return null
    const frozen = session.answerVersions?.find((version) => version.id === session.answerVersionId)
    if (frozen?.stepId === step.id && sameDraft(session, { ...frozen, draft: frozen.answer })) return session
    const version: TrainingAnswerVersion = {
      id: createTrainingId(),
      stepId: step.id,
      stepIndex: session.currentStep,
      answer: session.draft.trim(),
      ...(session.structuredDraft ? { structuredDraft: session.structuredDraft } : {}),
      ...(session.importantParagraphs ? { importantParagraphs: session.importantParagraphs } : {}),
      ...(session.threeSentenceDrafts ? { threeSentenceDrafts: session.threeSentenceDrafts } : {}),
      ...(session.paragraphCursor !== undefined ? { paragraphCursor: session.paragraphCursor } : {}),
      createdAt: new Date().toISOString(),
      ...(session.stepRecords?.[step.id]?.answerVersionId ? { basedOnVersionId: session.stepRecords[step.id].answerVersionId } : {}),
    }
    const updated = {
      ...session,
      answerVersionId: version.id,
      ...(step.id === 'toulmin-simple' && session.structuredDraft?.['toulminSimple.argumentId']
        ? { argumentId: session.structuredDraft['toulminSimple.argumentId'].trim() }
        : {}),
      answerVersions: [...(session.answerVersions ?? []), version],
      stepRecords: updateStepRecord(session.stepRecords, step.id, session, 'frozen', version.id),
      updatedAt: new Date().toISOString(),
    }
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export async function confirmTrainingStep(
  articleId: string,
  locale: Locale = 'zh-CN',
  expected?: { sessionId?: string; stepId?: string; draftRevision?: number },
  targetStepId?: string,
) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session || !matchesSessionIdentity(session, expected) || (expected?.stepId && expected.stepId !== session.currentStepId)) return null
    const step = targetStepId ? getLessonSteps(locale).find((candidate) => candidate.id === targetStepId) : getLessonSteps(locale)[session.currentStep]
    const record = step ? session.stepRecords?.[step.id] : undefined
    if (!step || record?.status !== 'needs-review' || !record.answerVersionId) return null
    const turn = session.turns.find((candidate) => candidate.answerVersionId === record.answerVersionId)
    if (!turn) return null

    const now = new Date().toISOString()
    const nextStep = Math.min(LESSON_STEPS.length, session.currentStep + 1)
    const nextStepDefinition = getLessonSteps(locale)[nextStep]
    const nextRecord = nextStepDefinition ? session.stepRecords?.[nextStepDefinition.id] : undefined
    const updated = {
      ...session,
      currentStep: nextStep,
      currentStepId: nextStepDefinition?.id,
      currentQuestion: nextStepDefinition?.question ?? '',
      draft: nextRecord?.status === 'needs-review' ? nextRecord.draft : '',
      structuredDraft: nextRecord?.status === 'needs-review' ? nextRecord.structuredDraft : undefined,
      importantParagraphs: nextRecord?.status === 'needs-review' ? nextRecord.importantParagraphs : undefined,
      threeSentenceDrafts: nextRecord?.status === 'needs-review' ? nextRecord.threeSentenceDrafts : undefined,
      paragraphCursor: nextRecord?.status === 'needs-review' ? nextRecord.paragraphCursor : undefined,
      answerVersionId: nextRecord?.status === 'needs-review' ? nextRecord.answerVersionId : turn.answerVersionId,
      stepRecords: {
        ...(session.stepRecords ?? {}),
        [step.id]: { ...record, status: 'completed' as const, needsReviewBecause: undefined, completedAt: record.completedAt ?? now },
      },
      updatedAt: now,
      ...(nextStep === LESSON_STEPS.length ? { completedAt: now } : { completedAt: undefined }),
    }
    updated.draftRevision = (session.draftRevision ?? 0) + 1
    if (targetStepId) Object.assign(updated, {
      currentStep: session.currentStep, currentStepId: session.currentStepId, currentQuestion: session.currentQuestion,
      draft: session.draft, structuredDraft: session.structuredDraft, importantParagraphs: session.importantParagraphs,
      threeSentenceDrafts: session.threeSentenceDrafts, paragraphCursor: session.paragraphCursor, answerVersionId: session.answerVersionId,
    })
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export function createTrainingRequestId(
  kind: TrainingRequestKind,
  sessionId: string | undefined,
  stepId: string | undefined,
  answerVersionId: string | undefined,
) {
  const identity = JSON.stringify([kind, sessionId ?? '', stepId ?? '', answerVersionId ?? ''])
  let hash = 14695981039346656037n
  for (const byte of new TextEncoder().encode(identity)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n)
  }
  return `ai-${kind}-${hash.toString(16).padStart(16, '0')}`
}

type TrainingRequestSpec = Pick<TrainingAiRequest, 'id' | 'kind' | 'sessionId' | 'stepId' | 'answerVersionId'>

export async function beginTrainingRequest(
  articleId: string,
  spec: TrainingRequestSpec,
  locale: Locale = 'zh-CN',
) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session || session.sessionId !== spec.sessionId) return null
    if (spec.answerVersionId && !session.answerVersions?.some((version) => version.id === spec.answerVersionId && version.stepId === spec.stepId)) return null

    const existing = session.aiRequests?.find((request) => request.id === spec.id)
    const pending = existing?.status === 'pending' && Date.now() - Date.parse(existing.updatedAt) < 120_000
    if (pending || existing?.status === 'succeeded' || existing?.status === 'stale') {
      return { session, request: existing, shouldRun: false }
    }

    const now = new Date().toISOString()
    const request: TrainingAiRequest = {
      ...spec,
      status: 'pending',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    const updated = {
      ...session,
      aiRequests: [...(session.aiRequests ?? []).filter((candidate) => candidate.id !== spec.id), request],
      updatedAt: now,
    }
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return { session: updated, request, shouldRun: true }
  })
}

export async function getTrainingRequestSession(articleId: string, requestId: string, locale: Locale = 'zh-CN') {
  for (const testMode of [false, true]) {
    const sessions = await readAllTrainingSessionsV3(locale, testMode)
    const owner = sessions.find((item) => item.articleId === articleId && item.aiRequests?.some((request) => request.id === requestId))
    if (owner) return owner
  }
  return null
}

export async function finishTrainingRequest(
  articleId: string,
  requestId: string,
  status: TrainingRequestStatus,
  locale: Locale = 'zh-CN',
  error?: { code: TrainingAiRequest['errorCode']; message: string },
) {
  return trainingMutation(async () => {
    for (const testMode of [false, true]) {
      const sessions = await readAllTrainingSessionsV3(locale, testMode)
      const session = sessions.find((item) => item.articleId === articleId && item.aiRequests?.some((request) => request.id === requestId))
      if (!session) continue
      const now = new Date().toISOString()
      const aiRequests = session.aiRequests?.map((request) => request.id === requestId && request.status !== 'succeeded'
        ? { ...request, status, updatedAt: now, errorCode: error?.code, errorMessage: error?.message }
        : request)
      const updated = { ...session, aiRequests, updatedAt: now }
      await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated), testMode)
      return updated
    }
    return null
  })
}

export async function setTrainingQuestion(articleId: string, question: string, locale: Locale = 'zh-CN') {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session) return null
    const updated = {
      ...session,
      currentQuestion: question,
      updatedAt: new Date().toISOString(),
    }
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export async function commitTrainingFeedback(
  articleId: string,
  feedback: AiFeedback,
  locale: Locale = 'zh-CN',
  expected?: { sessionId?: string; draftRevision?: number; draft: string; answerVersionId?: string },
) {
  return trainingMutation(async () => {
    if (expected?.sessionId && expected.answerVersionId) {
      for (const testMode of [false, true]) {
        const all = await readAllTrainingSessionsV3(locale, testMode)
        const owner = all.find((item) => item.articleId === articleId && item.sessionId === expected.sessionId)
        if (!owner) continue
        const version = owner.answerVersions?.find((item) => item.id === expected.answerVersionId)
        if (!version || version.answer.trim() !== expected.draft.trim() || feedback.nextStepId !== getNextLessonStepId(version.stepIndex, locale)) return null
        const alreadySubmitted = owner.turns.some((turn) => turn.answerVersionId === version.id)
        const late = testMode !== await isTestModeEnabled() || owner.isArchived || owner.answerVersionId !== version.id || owner.currentStepId !== version.stepId || owner.draftRevision !== expected.draftRevision
        if (late || alreadySubmitted || version.feedback) {
          const updated = {
            ...owner,
            answerVersions: owner.answerVersions?.map((item) => item.id === version.id ? { ...item, feedback: item.feedback ?? feedback } : item),
            turns: owner.turns.map((turn) => turn.answerVersionId === version.id ? { ...turn, feedback: turn.feedback ?? feedback } : turn),
          }
          await writeTrainingSessionsV3(replaceCurrentSession(all, updated), testMode)
          return updated
        }
        break
      }
    }
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session) return null
    if (expected && (
      (expected.sessionId && session.sessionId !== expected.sessionId) ||
      (expected.draftRevision !== undefined && session.draftRevision !== expected.draftRevision) ||
      (expected.answerVersionId && session.answerVersionId !== expected.answerVersionId) ||
      (session.draft.trim() || session.turns.at(-1)?.answer.trim() || '') !== expected.draft.trim()
    )) return null
    const legacyTurn = session.turns.at(-1)
    const hasPendingTurn = Boolean(legacyTurn && !legacyTurn.feedback && !session.draft.trim())
    if (session.currentStep >= LESSON_STEPS.length && !hasPendingTurn && !session.draft.trim()) return null

    if (hasPendingTurn && legacyTurn) {
      const nextStep = Math.min(LESSON_STEPS.length, legacyTurn.stepIndex + 1)
      if (feedback.nextStepId !== getNextLessonStepId(legacyTurn.stepIndex, locale)) return null
      const turns = session.turns.map((turn, index) =>
        index === session.turns.length - 1 ? { ...turn, feedback } : turn,
      )
      const answerVersions = session.answerVersions?.map((version) =>
        version.id === legacyTurn.answerVersionId ? { ...version, feedback } : version,
      )
      const updated = {
        ...session,
        turns,
        ...(answerVersions ? { answerVersions } : {}),
        currentStep: nextStep,
        currentStepId: getLessonSteps(locale)[nextStep]?.id,
        currentQuestion: questionForNextStep(nextStep, feedback, locale),
        answerVersionId: legacyTurn.answerVersionId,
        draft: '',
        structuredDraft: undefined,
        importantParagraphs: undefined,
        threeSentenceDrafts: undefined,
        paragraphCursor: undefined,
        updatedAt: new Date().toISOString(),
        ...(nextStep === LESSON_STEPS.length ? { completedAt: new Date().toISOString() } : { completedAt: undefined }),
      }
      const sessions = await readTrainingSessionsV3(locale)
      await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
      return updated
    }

    const answer = session.draft.trim()
    const currentStep = LESSON_STEPS[session.currentStep]
    const maxLength = session.currentStep === 2
      ? THREE_SENTENCE_ANSWER_MAX_LENGTH
      : currentStep && structuredFieldsForStep(currentStep.id).length > 0
        ? STRUCTURED_ANSWER_MAX_LENGTH
        : TRAINING_ANSWER_MAX_LENGTH
    if (answer.length < 5 || answer.length > maxLength) return null
    const now = new Date().toISOString()
    const reinforcement = session.currentStep >= LESSON_STEPS.length
    if (feedback.nextStepId !== getNextLessonStepId(session.currentStep, locale)) return null
    const step = LESSON_STEPS[Math.min(LESSON_STEPS.length - 1, session.currentStep)]
    const currentQuestion = session.currentQuestion || getLessonSteps(locale)[session.currentStep]?.question || ''
    const answerVersionId = session.answerVersionId ?? createTrainingId()
    const turn = {
      stepIndex: reinforcement ? LESSON_STEPS.length - 1 : session.currentStep,
      stepId: step.id,
      courseVersion: session.courseVersion,
      answerVersionId,
      question: currentQuestion,
      answer,
      submittedAt: now,
      ...(session.currentStep === 2 && session.threeSentenceDrafts
        ? { threeSentenceDrafts: session.threeSentenceDrafts, paragraphCursor: session.paragraphCursor ?? 0 }
        : {}),
      ...(session.structuredDraft ? { structuredDraft: session.structuredDraft } : {}),
      ...(session.importantParagraphs ? { importantParagraphs: session.importantParagraphs } : {}),
      feedback,
    }
    const answerVersions = session.answerVersions?.map((version) =>
      version.id === answerVersionId ? { ...version, feedback } : version,
    )
    const nextStep = reinforcement ? session.currentStep : Math.min(LESSON_STEPS.length, session.currentStep + 1)
    const updated = {
      ...session,
      currentStep: nextStep,
      currentStepId: getLessonSteps(locale)[nextStep]?.id,
      currentQuestion: questionForNextStep(nextStep, feedback, locale),
      answerVersionId: turn.answerVersionId,
      draft: '',
      structuredDraft: undefined,
      importantParagraphs: undefined,
      threeSentenceDrafts: undefined,
      paragraphCursor: undefined,
      turns: [...session.turns, turn],
      ...(answerVersions ? { answerVersions } : {}),
      stepRecords: markStepCompleted(session.stepRecords, step.id, now, answerVersionId),
      updatedAt: now,
      ...(nextStep === LESSON_STEPS.length ? { completedAt: now } : { completedAt: undefined }),
    }
    Object.assign(updated, restoreStepRecord(session, nextStep, locale))
    Object.assign(updated, { answerVersionId: session.stepRecords?.[getLessonSteps(locale)[nextStep]?.id]?.answerVersionId })
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export async function advanceTrainingSession(
  articleId: string,
  locale: Locale = 'zh-CN',
  expected?: { sessionId?: string; stepId?: string; draftRevision?: number; answerVersionId?: string },
) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session || !session.draft.trim() || session.currentStep >= LESSON_STEPS.length) return null
    if (!matchesSessionIdentity(session, expected) || (expected?.stepId && expected.stepId !== session.currentStepId) || (expected?.answerVersionId && expected.answerVersionId !== session.answerVersionId)) return null
    const now = new Date().toISOString()
    const step = LESSON_STEPS[session.currentStep]
    const nextStep = Math.min(LESSON_STEPS.length, session.currentStep + 1)
    const answerVersionId = session.answerVersionId ?? createTrainingId()
    const answerVersions = session.answerVersionId
      ? session.answerVersions
      : [...(session.answerVersions ?? []), {
        id: answerVersionId,
        stepId: step.id,
        stepIndex: session.currentStep,
        answer: session.draft.trim(),
        ...(session.structuredDraft ? { structuredDraft: session.structuredDraft } : {}),
        ...(session.importantParagraphs ? { importantParagraphs: session.importantParagraphs } : {}),
        ...(session.threeSentenceDrafts ? { threeSentenceDrafts: session.threeSentenceDrafts } : {}),
        ...(session.paragraphCursor !== undefined ? { paragraphCursor: session.paragraphCursor } : {}),
        createdAt: now,
      }]
    const turn = {
      stepIndex: session.currentStep,
      stepId: step.id,
      courseVersion: session.courseVersion,
      answerVersionId,
      question: session.currentQuestion || getLessonSteps(locale)[session.currentStep]?.question || '',
      answer: session.draft.trim(),
      submittedAt: now,
      ...(session.currentStep === 2 && session.threeSentenceDrafts
        ? { threeSentenceDrafts: session.threeSentenceDrafts, paragraphCursor: session.paragraphCursor ?? 0 }
        : {}),
      ...(session.structuredDraft ? { structuredDraft: session.structuredDraft } : {}),
      ...(session.importantParagraphs ? { importantParagraphs: session.importantParagraphs } : {}),
    }
    const nextStepDefinition = getLessonSteps(locale)[nextStep]
    const nextRecord = nextStepDefinition ? session.stepRecords?.[nextStepDefinition.id] : undefined
    const updated = {
      ...session,
      currentStep: nextStep,
      currentStepId: getLessonSteps(locale)[nextStep]?.id,
      currentQuestion: getLessonSteps(locale)[nextStep]?.question || '',
      draft: nextRecord?.status === 'needs-review' ? nextRecord.draft : '',
      structuredDraft: nextRecord?.status === 'needs-review' ? nextRecord.structuredDraft : undefined,
      importantParagraphs: nextRecord?.status === 'needs-review' ? nextRecord.importantParagraphs : undefined,
      threeSentenceDrafts: nextRecord?.status === 'needs-review' ? nextRecord.threeSentenceDrafts : undefined,
      paragraphCursor: nextRecord?.status === 'needs-review' ? nextRecord.paragraphCursor : undefined,
      answerVersionId: nextRecord?.status === 'needs-review' ? nextRecord.answerVersionId : turn.answerVersionId,
      answerVersions,
      turns: [...session.turns, turn],
      stepRecords: markStepCompleted(session.stepRecords, step.id, now, answerVersionId),
      updatedAt: now,
      ...(nextStep === LESSON_STEPS.length ? { completedAt: now } : { completedAt: undefined }),
    }
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export async function saveTrainingReinforcement(articleId: string, id: string, answer: string, locale: Locale = 'zh-CN', sessionId?: string) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session || session.sessionId !== sessionId || !id || answer.trim().length < 5 || answer.length > TRAINING_ANSWER_MAX_LENGTH) return null
    if (session.reinforcements?.some((item) => item.id === id)) return session
    const updated = { ...session, reinforcements: [...(session.reinforcements ?? []), { id, answer: answer.trim(), createdAt: new Date().toISOString() }] }
    await writeTrainingSessionsV3(replaceCurrentSession(await readTrainingSessionsV3(locale), updated))
    return updated
  })
}

export async function saveTrainingReferenceAnswer(
  articleId: string,
  submittedAt: string,
  referenceAnswer: AiReferenceAnswer,
  locale: Locale = 'zh-CN',
  expected?: { sessionId?: string; answerVersionId?: string },
) {
  return trainingMutation(async () => {
    if (expected?.sessionId) {
      for (const testMode of [false, true]) {
        const sessions = await readAllTrainingSessionsV3(locale, testMode)
        const owner = sessions.find((item) => item.articleId === articleId && item.sessionId === expected.sessionId)
        if (!owner) continue
        const turn = owner.turns.find((item) => item.submittedAt === submittedAt && item.answerVersionId === expected.answerVersionId && item.feedback)
        if (!turn) return null
        const updated = { ...owner, turns: owner.turns.map((item) => item === turn ? { ...item, referenceAnswer: item.referenceAnswer ?? referenceAnswer } : item) }
        await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated), testMode)
        return updated
      }
      return null
    }
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session) return null
    const turnIndex = session.turns.findIndex((turn) => turn.submittedAt === submittedAt && Boolean(turn.feedback))
    if (turnIndex < 0) return null
    if (session.turns[turnIndex].referenceAnswer) return session
    const turns = session.turns.map((turn, index) => index === turnIndex ? { ...turn, referenceAnswer } : turn)
    const updated = { ...session, turns, updatedAt: new Date().toISOString() }
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export async function rewindTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  return getWritableTrainingSession(articleId, locale)
}

export async function reviseTrainingTurn(articleId: string, turnIndex: number, revision: TrainingRevision, locale: Locale = 'zh-CN', expected?: { sessionId?: string; draftRevision?: number }) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session || !matchesSessionIdentity(session, expected)) return null
    const turn = session.turns[turnIndex]
    if (!turn || !turn.stepId || session.stepRecords?.[turn.stepId]?.answerVersionId !== turn.answerVersionId) return null
    const preview = trainingEditPreview(session, turnIndex, locale)
    const edited = { ...preview, draft: revision.answer, structuredDraft: revision.structuredDraft,
      importantParagraphs: revision.importantParagraphs, threeSentenceDrafts: revision.threeSentenceDrafts, paragraphCursor: revision.paragraphCursor }
    if (sameDraft(preview, edited)) return session
    if (!revision.reason.trim() || revision.reason.length > 1000 || !isTrainingDraftValid(edited, locale)) throw new Error('TRAINING_ANSWER_FORMAT_INVALID')
    const now = new Date().toISOString()
    const version: TrainingAnswerVersion = {
      id: createTrainingId(), stepId: turn.stepId, stepIndex: turn.stepIndex, answer: revision.answer,
      structuredDraft: revision.structuredDraft, importantParagraphs: revision.importantParagraphs,
      threeSentenceDrafts: revision.threeSentenceDrafts, paragraphCursor: revision.paragraphCursor,
      createdAt: now, basedOnVersionId: turn.answerVersionId, revisionReason: revision.reason.trim(),
    }
    const records = updateStepRecord(session.stepRecords, turn.stepId, edited, 'completed', version.id)
    for (const step of getLessonSteps(locale).slice(turn.stepIndex + 1)) {
      const record = records[step.id]
      if (record?.status === 'completed' || record?.status === 'frozen') records[step.id] = { ...record, status: 'needs-review', needsReviewBecause: turn.stepId }
    }
    const updated: TrainingSession = { ...session, stepRecords: records, answerVersions: [...(session.answerVersions ?? []), version],
      turns: [...session.turns, { ...turn, answer: version.answer, structuredDraft: version.structuredDraft,
        importantParagraphs: version.importantParagraphs, threeSentenceDrafts: version.threeSentenceDrafts, paragraphCursor: version.paragraphCursor,
        revisionReason: version.revisionReason, answerVersionId: version.id, submittedAt: now, feedback: undefined, referenceAnswer: undefined }],
      draftRevision: (session.draftRevision ?? 0) + 1, completedAt: undefined, updatedAt: now,
      ...(turn.stepId === 'toulmin-simple' ? { argumentId: revision.structuredDraft?.['toulminSimple.argumentId'] } : {}),
    }
    if (session.currentStep >= LESSON_STEPS.length) {
      const finalStep = getLessonSteps(locale).at(-1)!
      Object.assign(updated, { currentStep: LESSON_STEPS.length - 1, currentStepId: finalStep.id, currentQuestion: finalStep.question, ...restoreStepRecord(updated, LESSON_STEPS.length - 1, locale) })
    }
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export async function editTrainingTurn(
  articleId: string,
  turnIndex: number,
  locale: Locale = 'zh-CN',
  expected?: { sessionId?: string; draftRevision?: number },
) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session || !matchesSessionIdentity(session, expected)) return null
    const turn = session.turns[turnIndex]
    if (!turn || turn.stepIndex < 0 || turn.stepIndex >= LESSON_STEPS.length) return null
    const step = getLessonSteps(locale)[turn.stepIndex]
    if (!step) return null
    const nextStepRecords = { ...(session.stepRecords ?? {}) }
    nextStepRecords[step.id] = {
      ...nextStepRecords[step.id], stepId: step.id, status: 'draft', draft: turn.answer,
      structuredDraft: turn.structuredDraft, importantParagraphs: turn.importantParagraphs,
      threeSentenceDrafts: turn.threeSentenceDrafts, paragraphCursor: turn.paragraphCursor,
      answerVersionId: turn.answerVersionId,
    }
    for (const candidate of getLessonSteps(locale).slice(turn.stepIndex + 1)) {
      const record = nextStepRecords[candidate.id]
      if (record?.status === 'completed' || record?.status === 'frozen') {
        nextStepRecords[candidate.id] = {
          ...record,
          status: 'needs-review',
          needsReviewBecause: step.id,
        }
      }
    }
    const updated = {
      ...session,
      currentStep: turn.stepIndex,
      currentStepId: step.id,
      currentQuestion: step.question,
      draft: turn.answer,
      structuredDraft: turn.structuredDraft,
      importantParagraphs: turn.importantParagraphs,
      threeSentenceDrafts: turn.threeSentenceDrafts,
      paragraphCursor: turn.paragraphCursor,
      answerVersionId: undefined,
      ...(turn.stepId === 'toulmin-simple' && turn.structuredDraft?.['toulminSimple.argumentId']
        ? { argumentId: turn.structuredDraft['toulminSimple.argumentId'].trim() }
        : {}),
      stepRecords: nextStepRecords,
      draftRevision: (session.draftRevision ?? 0) + 1,
      completedAt: undefined,
      updatedAt: new Date().toISOString(),
    }
    const sessions = await readTrainingSessionsV3(locale)
    await writeTrainingSessionsV3(replaceCurrentSession(sessions, updated))
    return updated
  })
}

export async function resetTrainingSession(
  articleId: string,
  locale: Locale = 'zh-CN',
  articleSnapshot?: TrainingArticleSnapshot,
) {
  await trainingMutation(async () => {
    const testMode = await isTestModeEnabled()
    const allSessions = await readAllTrainingSessionsV3(locale, testMode)
    const now = new Date().toISOString()
    const archived = allSessions
      .filter((session) => session.articleId === articleId && !session.isArchived)
      .map((session) => ({ ...session, isArchived: true, archivedAt: now, updatedAt: now }))
    const retained = allSessions.filter((session) => session.articleId !== articleId || session.isArchived)
    const firstStep = getLessonSteps(locale)[0]
    const fresh: TrainingSession = {
      articleId,
      flowId: 'reading-10',
      courseVersion: 'guided-reading-10-v1',
      sessionId: createTrainingId(),
      isTest: testMode,
      ...(articleSnapshot ? { articleSnapshotId: articleSnapshot.id, articleSnapshot } : {}),
      currentStepId: firstStep.id,
      draftRevision: 0,
      currentStep: 0,
      currentQuestion: firstStep.question,
      draft: '',
      turns: [],
      startedAt: now,
      updatedAt: now,
    }
    await writeTrainingSessionsV3([...retained, ...archived, fresh], testMode)
  })
}

export async function removeTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  await trainingMutation(async () => {
    const { legacy, current } = await readTrainingStores(locale)
    const allCurrentV3 = await readAllTrainingSessionsV3(locale, false)
    await Promise.all([
      writeLegacyTrainingSessions(legacy.filter((session) => session.articleId !== articleId)),
      writeTrainingSessionsV2(current.filter((session) => session.articleId !== articleId)),
      writeTrainingSessionsV3(allCurrentV3.filter((session) => session.articleId !== articleId), false, true),
      writeTrainingSessionsV3((await readAllTrainingSessionsV3(locale, true)).filter((session) => session.articleId !== articleId), true, true),
    ])
  })
}

async function getWritableTrainingSession(articleId: string, locale: Locale) {
  return (await readTrainingSessionsV3(locale)).find((session) => session.articleId === articleId && session.courseVersion === 'guided-reading-10-v1') ?? null
}

async function readTrainingSessionsV3(locale: Locale = 'zh-CN', testMode?: boolean) {
  return (await readAllTrainingSessionsV3(locale, testMode)).filter((session) => !session.isArchived)
}

async function readAllTrainingSessionsV3(locale: Locale = 'zh-CN', testMode?: boolean) {
  const useTestMode = testMode ?? await isTestModeEnabled()
  const key = useTestMode ? TRAINING_TEST_SESSIONS_V3_KEY : TRAINING_SESSIONS_V3_KEY
  const stored = await chrome.storage.local.get(key) as StorageState
  return normalizeTrainingSessionStoreV3(useTestMode ? stored.trainingTestSessionsV3 : stored.trainingSessionsV3, locale).items
}

async function readTrainingStores(locale: Locale) {
  const stored = await chrome.storage.local.get([TRAINING_SESSIONS_KEY, TRAINING_SESSIONS_V2_KEY, TRAINING_SESSIONS_V3_KEY, TRAINING_TEST_SESSIONS_V3_KEY]) as StorageState
  return {
    legacy: normalizeTrainingSessionStore(stored.trainingSessions, locale).items,
    current: normalizeTrainingSessionStoreV2(stored.trainingSessionsV2, locale).items,
    currentV3: normalizeTrainingSessionStoreV3(stored.trainingSessionsV3, locale).items.filter((session) => !session.isArchived),
    testV3: normalizeTrainingSessionStoreV3(stored.trainingTestSessionsV3, locale).items.filter((session) => !session.isArchived),
  }
}

async function writeLegacyTrainingSessions(items: TrainingSession[]) {
  const store: TrainingSessionStore = { version: 1, items }
  await chrome.storage.local.set({ [TRAINING_SESSIONS_KEY]: store })
}

async function writeTrainingSessionsV2(items: TrainingSession[]) {
  const store: TrainingSessionStoreV2 = { version: 2, items }
  await chrome.storage.local.set({ [TRAINING_SESSIONS_V2_KEY]: store })
}

async function writeTrainingSessionsV3(items: TrainingSession[], testMode?: boolean, replaceAll = false) {
  const useTestMode = testMode ?? await isTestModeEnabled()
  const archived = replaceAll ? [] : (await readAllTrainingSessionsV3('zh-CN', useTestMode))
    .filter((item) => item.isArchived && !items.some((candidate) => candidate.sessionId === item.sessionId))
  const store: TrainingSessionStoreV3 = { version: 3, items: [...archived, ...items] }
  await chrome.storage.local.set({ [useTestMode ? TRAINING_TEST_SESSIONS_V3_KEY : TRAINING_SESSIONS_V3_KEY]: store })
}

async function isTestModeEnabled() {
  const stored = await chrome.storage.local.get('testMode') as StorageState
  return stored.testMode === true
}

function normalizeLegacyTrainingSession(value: TrainingSession): TrainingSession {
  return { ...value, flowId: 'legacy-8' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTrainingSession(value: unknown, maxStep: number, expectedFlow: 'legacy-8' | 'reading-10'): value is TrainingSession {
  if (!isRecord(value)) return false
  const currentStep = value.currentStep
  const flowId = value.flowId
  return (
    typeof value.articleId === 'string' &&
    typeof currentStep === 'number' &&
    Number.isInteger(currentStep) &&
    currentStep >= 0 &&
    currentStep <= maxStep &&
    (flowId === undefined || flowId === expectedFlow) &&
    (value.courseVersion === undefined || value.courseVersion === 'guided-reading-10-v1' || value.courseVersion === 'guided-reading-10-v0') &&
    (value.isTest === undefined || typeof value.isTest === 'boolean') &&
    (value.sessionId === undefined || typeof value.sessionId === 'string') &&
    (value.currentStepId === undefined || typeof value.currentStepId === 'string') &&
    (value.draftRevision === undefined || (typeof value.draftRevision === 'number' && Number.isInteger(value.draftRevision) && value.draftRevision >= 0)) &&
    (value.answerVersionId === undefined || typeof value.answerVersionId === 'string') &&
    (value.isArchived === undefined || typeof value.isArchived === 'boolean') &&
    (value.archivedAt === undefined || typeof value.archivedAt === 'string') &&
    (value.answerVersions === undefined || Array.isArray(value.answerVersions)) &&
    (value.aiRequests === undefined || Array.isArray(value.aiRequests)) &&
    (value.stepRecords === undefined || isRecord(value.stepRecords)) &&
    (value.readingPosition === undefined || isRecord(value.readingPosition)) &&
    (typeof value.currentQuestion === 'string' || value.currentQuestion === undefined) &&
    (typeof value.draft === 'string' || value.draft === undefined) &&
    (value.structuredDraft === undefined || isRecord(value.structuredDraft)) &&
    (value.importantParagraphs === undefined || Array.isArray(value.importantParagraphs)) &&
    (value.threeSentenceDrafts === undefined || Array.isArray(value.threeSentenceDrafts)) &&
    (value.paragraphCursor === undefined || (typeof value.paragraphCursor === 'number' && Number.isInteger(value.paragraphCursor) && value.paragraphCursor >= 0)) &&
    Array.isArray(value.turns) &&
    typeof value.startedAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function withQuestionDefault(session: TrainingSession, locale: Locale): TrainingSession {
  const steps = session.flowId === 'legacy-8' ? getLegacyLessonSteps(locale) : getLessonSteps(locale)
  const isUnansweredOpening = session.flowId === 'reading-10' && session.currentStep === 0 && session.turns.length === 0 && !session.draft.trim()
  return {
    ...session,
    ...(session.currentStepId ? { currentStepId: session.currentStepId } : {}),
    currentQuestion: isUnansweredOpening ? steps[0]?.question || '' : session.currentQuestion || steps[session.currentStep]?.question || '',
    draft: session.draft || '',
    ...(session.structuredDraft ? { structuredDraft: normalizeTrainingStructuredDraft(session.structuredDraft) } : {}),
    ...(Array.isArray(session.aiRequests) ? { aiRequests: normalizeTrainingAiRequests(session.aiRequests) } : {}),
    ...(Array.isArray(session.importantParagraphs) ? { importantParagraphs: normalizeImportantParagraphs(session.importantParagraphs) } : {}),
    ...(session.threeSentenceDrafts ? { threeSentenceDrafts: normalizeThreeSentenceDrafts(session.threeSentenceDrafts) } : {}),
    ...(typeof session.paragraphCursor === 'number' && Number.isInteger(session.paragraphCursor) && session.paragraphCursor >= 0
      ? { paragraphCursor: session.paragraphCursor }
      : {}),
  }
}

function replaceCurrentSession(sessions: TrainingSession[], updated: TrainingSession) {
  const progress = trainingProgress(updated)
  updated.completedAt = progress.isComplete ? updated.completedAt ?? new Date().toISOString() : undefined
  if (!progress.isComplete && updated.currentStep >= LESSON_STEPS.length) {
    const index = LESSON_STEPS.findIndex((step) => updated.stepRecords?.[step.id]?.status !== 'completed')
    if (index >= 0) {
      Object.assign(updated, { currentStep: index, currentStepId: LESSON_STEPS[index].id, currentQuestion: LESSON_STEPS[index].question, ...restoreStepRecord(updated, index, 'zh-CN') })
    }
  }
  return sessions.map((item) => {
    const sameSession = updated.sessionId
      ? item.sessionId === updated.sessionId
      : item.articleId === updated.articleId && item.courseVersion === updated.courseVersion
    return sameSession ? updated : item
  })
}

function matchesSessionIdentity(
  session: TrainingSession,
  expected?: { sessionId?: string; stepId?: string; draftRevision?: number },
) {
  if (!expected) return true
  if (expected.sessionId && expected.sessionId !== session.sessionId) return false
  if (expected.stepId && expected.stepId !== session.currentStepId) return false
  if (expected.draftRevision !== undefined && expected.draftRevision !== session.draftRevision) return false
  return true
}

type TrainingDraftSnapshot = Pick<TrainingSession, 'draft' | 'structuredDraft' | 'importantParagraphs' | 'threeSentenceDrafts' | 'paragraphCursor'>

function sameDraft(left: TrainingDraftSnapshot, right: TrainingDraftSnapshot) {
  return left.draft === right.draft &&
    JSON.stringify(left.structuredDraft ?? {}) === JSON.stringify(right.structuredDraft ?? {}) &&
    JSON.stringify(left.importantParagraphs ?? []) === JSON.stringify(right.importantParagraphs ?? []) &&
    JSON.stringify(left.threeSentenceDrafts ?? []) === JSON.stringify(right.threeSentenceDrafts ?? []) &&
    (left.paragraphCursor ?? 0) === (right.paragraphCursor ?? 0)
}

function updateStepRecord(
  records: TrainingSession['stepRecords'],
  stepId: string,
  draft: TrainingDraftSnapshot,
  status: TrainingStepRecord['status'],
  answerVersionId?: string,
) {
  const previous = records?.[stepId]
  return {
    ...(records ?? {}),
    [stepId]: {
      stepId,
      status,
      draft: draft.draft,
      ...(draft.structuredDraft ? { structuredDraft: draft.structuredDraft } : {}),
      ...(draft.importantParagraphs ? { importantParagraphs: draft.importantParagraphs } : {}),
      ...(draft.threeSentenceDrafts ? { threeSentenceDrafts: draft.threeSentenceDrafts } : {}),
      ...(draft.paragraphCursor !== undefined ? { paragraphCursor: draft.paragraphCursor } : {}),
      ...(answerVersionId ? { answerVersionId } : previous?.answerVersionId ? { answerVersionId: previous.answerVersionId } : {}),
      ...(previous?.completedAt ? { completedAt: previous.completedAt } : {}),
      ...(previous?.needsReviewBecause ? { needsReviewBecause: previous.needsReviewBecause } : {}),
    },
  }
}

function markStepCompleted(
  records: TrainingSession['stepRecords'],
  stepId: string,
  completedAt: string,
  answerVersionId: string,
) {
  const current = records?.[stepId]
  return {
    ...(records ?? {}),
    [stepId]: {
      ...(current ?? { stepId, draft: '' }),
      stepId,
      status: 'completed' as const,
      needsReviewBecause: undefined,
      answerVersionId,
      completedAt,
    },
  }
}

function restoreStepRecord(session: TrainingSession, stepIndex: number, locale: Locale): TrainingDraftSnapshot {
  const stepId = getLessonSteps(locale)[stepIndex]?.id
  const record = stepId ? session.stepRecords?.[stepId] : undefined
  if (!record) return { draft: '' }
  return {
    draft: record.draft,
    structuredDraft: record.structuredDraft,
    importantParagraphs: record.importantParagraphs,
    threeSentenceDrafts: record.threeSentenceDrafts,
    paragraphCursor: record.paragraphCursor,
  }
}

function createTrainingId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `training-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeTrainingAiRequests(value: unknown): TrainingAiRequest[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is TrainingAiRequest => {
    if (!isRecord(item)) return false
    return typeof item.id === 'string' && item.id.length > 0 &&
      (item.kind === 'grade' || item.kind === 'reference') &&
      typeof item.sessionId === 'string' && item.sessionId.length > 0 &&
      typeof item.stepId === 'string' && item.stepId.length > 0 &&
      (item.answerVersionId === undefined || typeof item.answerVersionId === 'string') &&
      (item.status === 'pending' || item.status === 'succeeded' || item.status === 'failed' || item.status === 'stale') &&
      typeof item.createdAt === 'string' && typeof item.updatedAt === 'string'
  })
}

function normalizeImportantParagraphs(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0))].sort((left, right) => left - right)
}
