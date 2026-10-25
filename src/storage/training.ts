import type {
  AiFeedback,
  Locale,
  StorageState,
  TrainingSession,
  TrainingSessionStore,
} from '../types'
import { getLessonSteps, LESSON_STEPS } from '../training/lessons'
import { createKeyedMutationQueue } from './mutation-queue'

export const TRAINING_SESSIONS_KEY = 'trainingSessions'
const runTrainingMutation = createKeyedMutationQueue()

export function normalizeTrainingSessionStore(value: unknown, locale: Locale = 'zh-CN'): TrainingSessionStore {
  if (Array.isArray(value)) {
    return { version: 1, items: value.filter(isTrainingSession).map((session) => withQuestionDefault(session, locale)) }
  }
  if (isRecord(value) && value.version === 1 && Array.isArray(value.items)) {
    return { version: 1, items: value.items.filter(isTrainingSession).map((session) => withQuestionDefault(session, locale)) }
  }
  return { version: 1, items: [] }
}

export async function readTrainingSessions(locale: Locale = 'zh-CN'): Promise<TrainingSession[]> {
  const stored = await chrome.storage.local.get(TRAINING_SESSIONS_KEY) as StorageState
  return normalizeTrainingSessionStore(stored.trainingSessions, locale).items
}

async function writeTrainingSessions(items: TrainingSession[]) {
  const store: TrainingSessionStore = { version: 1, items }
  await chrome.storage.local.set({ [TRAINING_SESSIONS_KEY]: store })
}

export async function getTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  return (await readTrainingSessions(locale)).find((session) => session.articleId === articleId) ?? null
}

export async function startTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  return runTrainingMutation(articleId, async () => {
    const existing = await getTrainingSession(articleId, locale)
    if (existing) return existing

    const now = new Date().toISOString()
    const session: TrainingSession = {
      articleId,
      currentStep: 0,
      currentQuestion: getLessonSteps(locale)[0].question,
      draft: '',
      turns: [],
      startedAt: now,
      updatedAt: now,
    }
    await writeTrainingSessions([session, ...(await readTrainingSessions(locale))])
    return session
  })
}

export async function saveTrainingDraft(articleId: string, answer: string, locale: Locale = 'zh-CN') {
  return runTrainingMutation(articleId, async () => {
    const session = await getTrainingSession(articleId, locale)
    if (!session) return null
    if (answer.length > 4_000) {
      throw new Error('回答需要不超过 4,000 个字符。')
    }

    const updated = {
      ...session,
      draft: answer,
      updatedAt: new Date().toISOString(),
    }
    const sessions = await readTrainingSessions(locale)
    await writeTrainingSessions(sessions.map((item) => item.articleId === articleId ? updated : item))
    return updated
  })
}

export async function setTrainingQuestion(articleId: string, question: string, locale: Locale = 'zh-CN') {
  return runTrainingMutation(articleId, async () => {
    const session = await getTrainingSession(articleId, locale)
    if (!session) return null
    const updated = {
      ...session,
      currentQuestion: question,
      updatedAt: new Date().toISOString(),
    }
    const sessions = await readTrainingSessions(locale)
    await writeTrainingSessions(sessions.map((item) => item.articleId === articleId ? updated : item))
    return updated
  })
}

export async function commitTrainingFeedback(articleId: string, feedback: AiFeedback, locale: Locale = 'zh-CN') {
  return runTrainingMutation(articleId, async () => {
    const session = await getTrainingSession(articleId, locale)
    if (!session) return null
    const legacyTurn = session.turns.at(-1)
    const hasLegacyPendingTurn = Boolean(legacyTurn && !legacyTurn.feedback && !session.draft.trim())
    if (session.currentStep >= LESSON_STEPS.length && !hasLegacyPendingTurn && !session.draft.trim()) return null

    if (hasLegacyPendingTurn && legacyTurn) {
      const turns = session.turns.map((turn, index) =>
        index === session.turns.length - 1 ? { ...turn, feedback } : turn,
      )
      const updated = {
        ...session,
        turns,
        currentQuestion: feedback.nextQuestion,
        draft: '',
        updatedAt: new Date().toISOString(),
      }
      const sessions = await readTrainingSessions(locale)
      await writeTrainingSessions(sessions.map((item) => item.articleId === articleId ? updated : item))
      return updated
    }

    const answer = session.draft.trim()
    if (answer.length < 5 || answer.length > 4_000) return null
    const now = new Date().toISOString()
    const reinforcement = session.currentStep >= LESSON_STEPS.length
    const turn = {
      stepIndex: reinforcement ? LESSON_STEPS.length - 1 : session.currentStep,
      question: session.currentQuestion,
      answer,
      submittedAt: now,
      feedback,
    }
    const nextStep = reinforcement ? session.currentStep : Math.min(LESSON_STEPS.length, session.currentStep + 1)
    const updated = {
      ...session,
      currentStep: nextStep,
      currentQuestion: feedback.nextQuestion,
      draft: '',
      turns: [...session.turns, turn],
      updatedAt: now,
      ...(nextStep === LESSON_STEPS.length ? { completedAt: now } : { completedAt: undefined }),
    }
    const sessions = await readTrainingSessions(locale)
    await writeTrainingSessions(sessions.map((item) => item.articleId === articleId ? updated : item))
    return updated
  })
}

export async function removeTrainingSession(articleId: string, locale: Locale = 'zh-CN') {
  await runTrainingMutation(articleId, async () => {
    const sessions = await readTrainingSessions(locale)
    await writeTrainingSessions(sessions.filter((session) => session.articleId !== articleId))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTrainingSession(value: unknown): value is TrainingSession {
  if (!isRecord(value)) return false
  const currentStep = value.currentStep
  return (
    typeof value.articleId === 'string' &&
    typeof currentStep === 'number' &&
    Number.isInteger(currentStep) &&
    currentStep >= 0 &&
    currentStep <= 8 &&
    (typeof value.currentQuestion === 'string' || value.currentQuestion === undefined) &&
    (typeof value.draft === 'string' || value.draft === undefined) &&
    Array.isArray(value.turns) &&
    typeof value.startedAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function withQuestionDefault(session: TrainingSession, locale: Locale): TrainingSession {
  return {
    ...session,
    currentQuestion: session.currentQuestion || getLessonSteps(locale)[session.currentStep]?.question || '',
    draft: session.draft || '',
  }
}

