import type { AiFeedback, ArticleMetadata, Locale, TrainingSession } from '../types'
import { getLessonSteps, LESSON_STEPS } from '../training/lessons'
import { translate } from '../i18n/messages'

const DIMENSION_KEYS = ['fidelity', 'claim', 'cause', 'structure'] as const

export function buildStartPrompt(
  article: string,
  title: string,
  metadata: ArticleMetadata = emptyMetadata(),
  stepIndex = 0,
  preReadingPrediction = '',
  locale: Locale = 'zh-CN',
) {
  const step = getLessonSteps(locale)[stepIndex] ?? getLessonSteps(locale)[0]
  const prediction = preReadingPrediction.trim()
  const reflectionInstruction = stepIndex === 0 && prediction
    ? translate(locale, 'ai.startReflection')
    : ''
  return {
    system: `${translate(locale, 'ai.basePrompt')}\n${translate(locale, 'ai.stepPrefix')}“${step.name}”（${step.focus}）。${step.instruction}\n${reflectionInstruction}\n${translate(locale, 'ai.startJsonRule')}`,
    user: JSON.stringify({
      title,
      metadata,
      ...(prediction ? { preReadingPrediction: prediction } : {}),
      paragraphs: splitParagraphs(article),
    }),
  }
}

export function buildGradePrompt(
  article: string,
  title: string,
  metadata: ArticleMetadata = emptyMetadata(),
  session: TrainingSession,
  preReadingPrediction = '',
  locale: Locale = 'zh-CN',
) {
  const answer = session.draft.trim()
  if (!answer) throw new Error('没有可评分的回答。')
  const completed = session.currentStep >= LESSON_STEPS.length
  const steps = getLessonSteps(locale)
  const step = steps[Math.min(steps.length - 1, session.currentStep)]
  const next = completed ? step : steps[Math.min(steps.length - 1, session.currentStep + 1)]
  const prediction = preReadingPrediction.trim()
  const reflectionInstruction = session.currentStep === 0 && prediction
    ? translate(locale, 'ai.gradeReflection')
    : ''
  return {
    system: `${translate(locale, 'ai.basePrompt')}\n${translate(locale, 'ai.stepPrefix')}“${step.name}”（${step.focus}）。${translate(locale, 'ai.roundRequirement')}${step.instruction}\n${reflectionInstruction}\n${translate(locale, 'ai.gradeRules')} ${completed ? translate(locale, 'ai.completedRule') : translate(locale, 'ai.nextRule', { step: next.name })}${translate(locale, 'ai.jsonOnly')} ${translate(locale, 'ai.feedbackShape')}`,
    user: JSON.stringify({
      title,
      metadata,
      ...(prediction ? { preReadingPrediction: prediction } : {}),
      paragraphs: splitParagraphs(article).map((text, index) => ({ paragraph: index + 1, text })),
      question: session.currentQuestion,
      answer,
      history: session.turns.slice(-10).map(({ question, answer, stepIndex }) => ({ question, answer, stepIndex })),
    }),
  }
}

export function parseAiJson(payload: unknown): unknown {
  const content = extractContent(payload)
  const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(clean) as unknown
  } catch {
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1)) as unknown
    throw new Error('AI 返回的不是有效 JSON。')
  }
}

export function validateAiQuestion(value: unknown) {
  const question = isRecord(value) && typeof value.question === 'string' ? value.question.trim() : ''
  if (question.length < 8 || question.length > 240 || (question.match(/[？?]/g) ?? []).length !== 1 || !/[？?]$/.test(question)) {
    throw new Error('AI 返回的问题格式无效。')
  }
  return question
}

export function validateAiFeedback(value: unknown, article: string, answer: string): AiFeedback {
  if (!isRecord(value) || !isRecord(value.dimensions)) throw new Error('AI 反馈缺少评分维度。')
  const dimensions = {} as AiFeedback['dimensions']
  for (const key of DIMENSION_KEYS) {
    const raw = value.dimensions[key]
    if (!isRecord(raw)) throw new Error('AI 反馈维度格式无效。')
    const score = raw.score
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''
    if (!(score === null || (typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 10)) || !reason || reason.length > 500 || /[？?]/.test(reason)) {
      throw new Error('AI 评分内容未通过校验。')
    }
    dimensions[key] = { score, reason }
  }
  if (dimensions.fidelity.score === null) throw new Error('AI 必须评分原文忠实度。')

  const strengths = validateObservations(value.strengths, answer)
  const gaps = validateObservations(value.gaps, answer)
  const paragraphs = splitParagraphs(article)
  const sources = validateSources(value.sources, paragraphs)
  const nextQuestion = validateAiQuestion({ question: value.nextQuestion })
  const total = totalScore(dimensions)
  return { dimensions, strengths, gaps, sources, nextQuestion, total }
}

function extractContent(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) throw new Error('AI 响应缺少 choices。')
  const message = payload.choices[0].message
  if (!isRecord(message)) throw new Error('AI 响应缺少 message。')
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    const text = message.content.map((part) => isRecord(part) && typeof part.text === 'string' ? part.text : '').join('')
    if (text) return text
  }
  throw new Error('AI 响应缺少文本内容。')
}

function validateObservations(value: unknown, answer: string) {
  if (!Array.isArray(value) || value.length > 3) throw new Error('AI 优缺点格式无效。')
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('AI 优缺点格式无效。')
    const answerQuote = typeof item.answerQuote === 'string' ? item.answerQuote : ''
    const comment = typeof item.comment === 'string' ? item.comment.trim() : ''
    if (answerQuote && !answer.includes(answerQuote)) throw new Error('AI 引用的回答原文不存在。')
    if (answerQuote.length > 160 || !comment || comment.length > 700 || /[？?]/.test(comment)) throw new Error('AI 优缺点评语未通过校验。')
    return { answerQuote, comment }
  })
}

function validateSources(value: unknown, paragraphs: string[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error('AI 没有提供有效的原文依据。')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.paragraph !== 'number' || !Number.isInteger(item.paragraph) || item.paragraph < 1 || item.paragraph > paragraphs.length) {
      throw new Error('AI 原文段落编号无效。')
    }
    const quote = typeof item.quote === 'string' ? item.quote.trim() : ''
    const comment = typeof item.comment === 'string' ? item.comment.trim() : ''
    if (quote.length < 2 || quote.length > 160 || !paragraphs[item.paragraph - 1].includes(quote) || !comment || comment.length > 700 || /[？?]/.test(comment)) {
      throw new Error('AI 原文引用未通过校验。')
    }
    return { paragraph: item.paragraph, quote, comment }
  })
}

function splitParagraphs(article: string) {
  return article.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean)
}

function emptyMetadata(): ArticleMetadata {
  return { subtitle: '', author: '', source: '' }
}

function totalScore(dimensions: AiFeedback['dimensions']) {
  const scores = DIMENSION_KEYS.map((key) => dimensions[key].score).filter((score): score is number => score !== null)
  return scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

