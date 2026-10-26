import type {
  AiFeedback,
  AiReferenceAnswer,
  Locale,
  StorageState,
  TrainingSession,
  TrainingSessionStore,
  TrainingSessionStoreV2,
} from '../types'
import { getLegacyLessonSteps, getLessonSteps, getNextLessonStepId, LESSON_STEPS, normalizeThreeSentenceDrafts, THREE_SENTENCE_ANSWER_MAX_LENGTH, TRAINING_ANSWER_MAX_LENGTH } from '../training/lessons'
import { createKeyedMutationQueue } from './mutation-queue'

export const TRAINING_SESSIONS_KEY = 'trainingSessions'
export const TRAINING_SESSIONS_V2_KEY = 'trainingSessionsV2'
const runTrainingMutation = createKeyedMutationQueue()
const trainingMutation = <T>(mutation: () => Promise<T>) => runTrainingMutation(TRAINING_SESSIONS_V2_KEY, mutation)

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
      .map((item) => withQuestionDefault({ ...item, flowId: 'reading-10' }, locale)),
  }
}

export async function readTrainingSessions(locale: Locale = 'zh-CN'): Promise<TrainingSession[]> {
  const { legacy, current } = await readTrainingStores(locale)
  const currentArticleIds = new Set(current.map((session) => session.articleId))
  return [...current, ...legacy.filter((session) => !currentArticleIds.has(session.articleId))]
}

export async function getTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  return (await readTrainingSessions(locale)).find((session) => session.articleId === articleId) ?? null
}

export function isLegacyTrainingSession(session: TrainingSession | null | undefined) {
  return session?.flowId === 'legacy-8'
}

function questionForNextStep(nextStep: number, feedback: AiFeedback, locale: Locale) {
  return nextStep === 2 ? getLessonSteps(locale)[2]?.question || feedback.nextQuestion : feedback.nextQuestion
}

export async function startTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  return trainingMutation(async () => {
    const current = await readTrainingSessionsV2(locale)
    const existing = current.find((session) => session.articleId === articleId)
    if (existing) return existing

    const now = new Date().toISOString()
    const firstStep = getLessonSteps(locale)[0]
    const session: TrainingSession = {
      articleId,
      flowId: 'reading-10',
      currentStep: 0,
      currentQuestion: firstStep.question,
      draft: '',
      turns: [],
      startedAt: now,
      updatedAt: now,
    }
    await writeTrainingSessionsV2([session, ...current])
    return session
  })
}

export async function saveTrainingDraft(
  articleId: string,
  answer: string,
  locale: Locale = 'zh-CN',
  threeSentenceDrafts?: unknown,
  paragraphCursor?: unknown,
) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session) return null
    const maxLength = threeSentenceDrafts === undefined ? TRAINING_ANSWER_MAX_LENGTH : THREE_SENTENCE_ANSWER_MAX_LENGTH
    if (answer.length > maxLength) {
      throw new Error(`回答需要不超过 ${maxLength.toLocaleString()} 个字符。`)
    }

    const updated = {
      ...session,
      draft: answer,
      ...(threeSentenceDrafts === undefined ? {} : { threeSentenceDrafts: normalizeThreeSentenceDrafts(threeSentenceDrafts) }),
      ...(paragraphCursor === undefined
        ? {}
        : { paragraphCursor: typeof paragraphCursor === 'number' && Number.isInteger(paragraphCursor) && paragraphCursor >= 0 ? paragraphCursor : 0 }),
      updatedAt: new Date().toISOString(),
    }
    const sessions = await readTrainingSessionsV2(locale)
    await writeTrainingSessionsV2(sessions.map((item) => item.articleId === articleId ? updated : item))
    return updated
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
    const sessions = await readTrainingSessionsV2(locale)
    await writeTrainingSessionsV2(sessions.map((item) => item.articleId === articleId ? updated : item))
    return updated
  })
}

export async function commitTrainingFeedback(articleId: string, feedback: AiFeedback, locale: Locale = 'zh-CN') {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session) return null
    const legacyTurn = session.turns.at(-1)
    const hasPendingTurn = Boolean(legacyTurn && !legacyTurn.feedback && !session.draft.trim())
    if (session.currentStep >= LESSON_STEPS.length && !hasPendingTurn && !session.draft.trim()) return null

    if (hasPendingTurn && legacyTurn) {
      const nextStep = Math.min(LESSON_STEPS.length, legacyTurn.stepIndex + 1)
      if (feedback.nextStepId !== getNextLessonStepId(legacyTurn.stepIndex, locale)) return null
      const turns = session.turns.map((turn, index) =>
        index === session.turns.length - 1 ? { ...turn, feedback } : turn,
      )
      const updated = {
        ...session,
        turns,
        currentStep: nextStep,
        currentQuestion: questionForNextStep(nextStep, feedback, locale),
        draft: '',
        threeSentenceDrafts: undefined,
        paragraphCursor: undefined,
        updatedAt: new Date().toISOString(),
        ...(nextStep === LESSON_STEPS.length ? { completedAt: new Date().toISOString() } : { completedAt: undefined }),
      }
      const sessions = await readTrainingSessionsV2(locale)
      await writeTrainingSessionsV2(sessions.map((item) => item.articleId === articleId ? updated : item))
      return updated
    }

    const answer = session.draft.trim()
    const maxLength = session.currentStep === 2 ? THREE_SENTENCE_ANSWER_MAX_LENGTH : TRAINING_ANSWER_MAX_LENGTH
    if (answer.length < 5 || answer.length > maxLength) return null
    const now = new Date().toISOString()
    const reinforcement = session.currentStep >= LESSON_STEPS.length
    if (feedback.nextStepId !== getNextLessonStepId(session.currentStep, locale)) return null
    const step = LESSON_STEPS[Math.min(LESSON_STEPS.length - 1, session.currentStep)]
    const currentQuestion = session.currentStep === 2 ? getLessonSteps(locale)[2]?.question || session.currentQuestion : session.currentQuestion
    const turn = {
      stepIndex: reinforcement ? LESSON_STEPS.length - 1 : session.currentStep,
      stepId: step.id,
      question: currentQuestion,
      answer,
      submittedAt: now,
      ...(session.currentStep === 2 && session.threeSentenceDrafts
        ? { threeSentenceDrafts: session.threeSentenceDrafts, paragraphCursor: session.paragraphCursor ?? 0 }
        : {}),
      feedback,
    }
    const nextStep = reinforcement ? session.currentStep : Math.min(LESSON_STEPS.length, session.currentStep + 1)
    const updated = {
      ...session,
      currentStep: nextStep,
      currentQuestion: questionForNextStep(nextStep, feedback, locale),
      draft: '',
      threeSentenceDrafts: undefined,
      paragraphCursor: undefined,
      turns: [...session.turns, turn],
      updatedAt: now,
      ...(nextStep === LESSON_STEPS.length ? { completedAt: now } : { completedAt: undefined }),
    }
    const sessions = await readTrainingSessionsV2(locale)
    await writeTrainingSessionsV2(sessions.map((item) => item.articleId === articleId ? updated : item))
    return updated
  })
}

export async function saveTrainingReferenceAnswer(
  articleId: string,
  submittedAt: string,
  referenceAnswer: AiReferenceAnswer,
  locale: Locale = 'zh-CN',
) {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    if (!session) return null
    const turnIndex = session.turns.findIndex((turn) => turn.submittedAt === submittedAt && Boolean(turn.feedback))
    if (turnIndex < 0) return null
    if (session.turns[turnIndex].referenceAnswer) return session
    const turns = session.turns.map((turn, index) => index === turnIndex ? { ...turn, referenceAnswer } : turn)
    const updated = { ...session, turns, updatedAt: new Date().toISOString() }
    const sessions = await readTrainingSessionsV2(locale)
    await writeTrainingSessionsV2(sessions.map((item) => item.articleId === articleId ? updated : item))
    return updated
  })
}

export async function rewindTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  return trainingMutation(async () => {
    const session = await getWritableTrainingSession(articleId, locale)
    const lastTurn = session?.turns.at(-1)
    if (!session || !lastTurn?.feedback) return null

    const updated = {
      ...session,
      currentStep: lastTurn.stepIndex,
      currentQuestion: lastTurn.question,
      draft: lastTurn.answer,
      ...(lastTurn.threeSentenceDrafts
        ? { threeSentenceDrafts: lastTurn.threeSentenceDrafts, paragraphCursor: lastTurn.paragraphCursor ?? 0 }
        : { threeSentenceDrafts: undefined, paragraphCursor: undefined }),
      turns: session.turns.slice(0, -1),
      completedAt: undefined,
      updatedAt: new Date().toISOString(),
    }
    const sessions = await readTrainingSessionsV2(locale)
    await writeTrainingSessionsV2(sessions.map((item) => item.articleId === articleId ? updated : item))
    return updated
  })
}

export async function resetTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  await trainingMutation(async () => {
    const sessions = await readTrainingSessionsV2(locale)
    await writeTrainingSessionsV2(sessions.filter((session) => session.articleId !== articleId))
  })
}

export async function removeTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  await trainingMutation(async () => {
    const { legacy, current } = await readTrainingStores(locale)
    await Promise.all([
      writeLegacyTrainingSessions(legacy.filter((session) => session.articleId !== articleId)),
      writeTrainingSessionsV2(current.filter((session) => session.articleId !== articleId)),
    ])
  })
}

async function getWritableTrainingSession(articleId: string, locale: Locale) {
  return (await readTrainingSessionsV2(locale)).find((session) => session.articleId === articleId) ?? null
}

async function readTrainingSessionsV2(locale: Locale = 'zh-CN') {
  const stored = await chrome.storage.local.get(TRAINING_SESSIONS_V2_KEY) as StorageState
  return normalizeTrainingSessionStoreV2(stored.trainingSessionsV2, locale).items
}

async function readTrainingStores(locale: Locale) {
  const stored = await chrome.storage.local.get([TRAINING_SESSIONS_KEY, TRAINING_SESSIONS_V2_KEY]) as StorageState
  return {
    legacy: normalizeTrainingSessionStore(stored.trainingSessions, locale).items,
    current: normalizeTrainingSessionStoreV2(stored.trainingSessionsV2, locale).items,
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
    (typeof value.currentQuestion === 'string' || value.currentQuestion === undefined) &&
    (typeof value.draft === 'string' || value.draft === undefined) &&
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
    currentQuestion: isUnansweredOpening ? steps[0]?.question || '' : session.currentQuestion || steps[session.currentStep]?.question || '',
    draft: session.draft || '',
    ...(session.threeSentenceDrafts ? { threeSentenceDrafts: normalizeThreeSentenceDrafts(session.threeSentenceDrafts) } : {}),
    ...(typeof session.paragraphCursor === 'number' && Number.isInteger(session.paragraphCursor) && session.paragraphCursor >= 0
      ? { paragraphCursor: session.paragraphCursor }
      : {}),
  }
}
