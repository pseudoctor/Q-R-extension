import type {
  AiFeedback,
  StorageState,
  TrainingSession,
  TrainingSessionStore,
} from '../types'
import { LESSON_STEPS } from '../training/lessons'

export const TRAINING_SESSIONS_KEY = 'trainingSessions'

export function normalizeTrainingSessionStore(value: unknown): TrainingSessionStore {
  if (Array.isArray(value)) {
    return { version: 1, items: value.filter(isTrainingSession).map(withQuestionDefault) }
  }
  if (isRecord(value) && value.version === 1 && Array.isArray(value.items)) {
    return { version: 1, items: value.items.filter(isTrainingSession).map(withQuestionDefault) }
  }
  return { version: 1, items: [] }
}

export async function readTrainingSessions(): Promise<TrainingSession[]> {
  const stored = await chrome.storage.local.get(TRAINING_SESSIONS_KEY) as StorageState
  return normalizeTrainingSessionStore(stored.trainingSessions).items
}

async function writeTrainingSessions(items: TrainingSession[]) {
  const store: TrainingSessionStore = { version: 1, items }
  await chrome.storage.local.set({ [TRAINING_SESSIONS_KEY]: store })
}

export async function getTrainingSession(articleId: string) {
  return (await readTrainingSessions()).find((session) => session.articleId === articleId) ?? null
}

export async function startTrainingSession(articleId: string) {
  const existing = await getTrainingSession(articleId)
  if (existing) return existing

  const now = new Date().toISOString()
  const session: TrainingSession = {
    articleId,
    currentStep: 0,
    currentQuestion: LESSON_STEPS[0].question,
    turns: [],
    startedAt: now,
    updatedAt: now,
  }
  await writeTrainingSessions([session, ...(await readTrainingSessions())])
  return session
}

export async function submitTrainingAnswer(articleId: string, answer: string) {
  const session = await getTrainingSession(articleId)
  if (!session) return null
  const trimmedAnswer = answer.trim()
  if (trimmedAnswer.length < 5 || trimmedAnswer.length > 4_000) {
    throw new Error('回答需要 5–4,000 个字符。')
  }

  const now = new Date().toISOString()
  const turn = {
    stepIndex: session.currentStep,
    question: session.currentQuestion,
    answer: trimmedAnswer,
    submittedAt: now,
  }
  const nextStep = Math.min(8, session.currentStep + 1)
  const updated: TrainingSession = {
    ...session,
    currentStep: nextStep,
    currentQuestion: LESSON_STEPS[nextStep]?.question ?? '',
    turns: [...session.turns, turn],
    updatedAt: now,
    ...(nextStep === 8 ? { completedAt: now } : {}),
  }
  const sessions = await readTrainingSessions()
  await writeTrainingSessions(sessions.map((item) => item.articleId === articleId ? updated : item))
  return updated
}

export async function setTrainingQuestion(articleId: string, question: string) {
  const session = await getTrainingSession(articleId)
  if (!session) return null
  const updated = {
    ...session,
    currentQuestion: question,
    updatedAt: new Date().toISOString(),
  }
  const sessions = await readTrainingSessions()
  await writeTrainingSessions(sessions.map((item) => item.articleId === articleId ? updated : item))
  return updated
}

export async function attachTrainingFeedback(articleId: string, feedback: AiFeedback) {
  const session = await getTrainingSession(articleId)
  if (!session || !session.turns.length) return null
  const turns = session.turns.map((turn, index) =>
    index === session.turns.length - 1 ? { ...turn, feedback } : turn,
  )
  const updated = {
    ...session,
    turns,
    currentQuestion: feedback.nextQuestion,
    updatedAt: new Date().toISOString(),
  }
  const sessions = await readTrainingSessions()
  await writeTrainingSessions(sessions.map((item) => item.articleId === articleId ? updated : item))
  return updated
}

export async function removeTrainingSession(articleId: string) {
  const sessions = await readTrainingSessions()
  await writeTrainingSessions(sessions.filter((session) => session.articleId !== articleId))
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
    Array.isArray(value.turns) &&
    typeof value.startedAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function withQuestionDefault(session: TrainingSession): TrainingSession {
  return {
    ...session,
    currentQuestion: session.currentQuestion || LESSON_STEPS[session.currentStep]?.question || '',
  }
}

