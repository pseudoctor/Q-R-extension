import { getArticleBlocks, numberArticleBlocks, type NumberedArticleParagraph } from '../articles/format'
import type { AiDimensionId, AiFeedback, ArticleBlock, ArticleMetadata, Locale, TrainingSession } from '../types'
import { getLessonSteps, getNextLessonStepId, LESSON_STEPS } from '../training/lessons'
import { translate } from '../i18n/messages'

const DIMENSION_KEYS = ['fidelity', 'claim', 'cause', 'structure'] as const

type AiResponseFormat = {
  type: 'json_schema'
  json_schema: {
    name: string
    strict: true
    schema: Record<string, unknown>
  }
}

export function buildStartPrompt(
  article: string,
  title: string,
  metadata: ArticleMetadata = emptyMetadata(),
  stepIndex = 0,
  preReadingPrediction = '',
  locale: Locale = 'zh-CN',
  blocks?: ArticleBlock[],
) {
  const step = getLessonSteps(locale)[stepIndex] ?? getLessonSteps(locale)[0]
  const prediction = preReadingPrediction.trim()
  const reflectionInstruction = stepIndex === 0 && prediction
    ? translate(locale, 'ai.startReflection')
    : ''
  return {
    system: `${translate(locale, 'ai.basePrompt')}\n${translate(locale, 'ai.stepPrefix')}“${step.name}”（${step.focus}，stepId: ${step.id}）。${step.instruction}\n${reflectionInstruction}\n${translate(locale, 'ai.startJsonRule')}`,
    user: JSON.stringify({
      stepId: step.id,
      stepIndex,
      title,
      metadata,
      ...(prediction ? { preReadingPrediction: prediction } : {}),
      paragraphs: numberArticleBlocks(getArticleBlocks(article, blocks)).map(({ paragraph, text }) => ({ paragraph, text })),
    }),
    responseFormat: buildJsonResponseFormat('training_question', {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
      additionalProperties: false,
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
  blocks?: ArticleBlock[],
) {
  const answer = session.draft.trim()
  if (!answer) throw new Error('没有可评分的回答。')
  const completed = session.currentStep >= LESSON_STEPS.length
  const steps = getLessonSteps(locale)
  const step = steps[Math.min(steps.length - 1, session.currentStep)]
  const expectedNextStepId = getNextLessonStepId(session.currentStep, locale)
  const next = expectedNextStepId ? steps.find((candidate) => candidate.id === expectedNextStepId) : null
  const prediction = preReadingPrediction.trim()
  const reflectionInstruction = session.currentStep === 0 && prediction
    ? translate(locale, 'ai.gradeReflection')
    : ''
  return {
    system: `${translate(locale, 'ai.basePrompt')}\n${translate(locale, 'ai.stepPrefix')}“${step.name}”（${step.focus}，stepId: ${step.id}）。${translate(locale, 'ai.roundRequirement')}${step.instruction}\n${reflectionInstruction}\n${translate(locale, 'ai.gradeRules')} ${translate(locale, 'ai.stepDimensions', { dimensions: step.dimensions.join(', ') })} ${completed || !next ? translate(locale, 'ai.completedRule') : translate(locale, 'ai.nextRule', { step: next.name })}${translate(locale, 'ai.jsonOnly')} ${translate(locale, 'ai.feedbackShape')}`,
    user: JSON.stringify({
      stepId: step.id,
      stepIndex: session.currentStep,
      nextStepId: expectedNextStepId,
      allowedDimensions: step.dimensions,
      title,
      metadata,
      ...(prediction ? { preReadingPrediction: prediction } : {}),
      paragraphs: numberArticleBlocks(getArticleBlocks(article, blocks)).map(({ paragraph, text }) => ({ paragraph, text })),
      question: session.currentQuestion,
      answer,
      ...(session.currentStep === 2 && session.threeSentenceDrafts
        ? { threeSentenceDrafts: session.threeSentenceDrafts }
        : {}),
      history: session.turns.slice(-10).map(({ question, answer, stepIndex, stepId }) => ({ question, answer, stepIndex, stepId })),
    }),
    responseFormat: buildJsonResponseFormat('training_feedback', buildFeedbackSchema(step.dimensions, expectedNextStepId)),
  }
}

function buildJsonResponseFormat(name: string, schema: Record<string, unknown>): AiResponseFormat {
  return {
    type: 'json_schema',
    json_schema: { name, strict: true, schema },
  }
}

function buildFeedbackSchema(activeDimensions: readonly AiDimensionId[], expectedNextStepId: string | null): Record<string, unknown> {
  const dimensionProperties = Object.fromEntries(DIMENSION_KEYS.map((key) => [
    key,
    {
      type: 'object',
      properties: {
        score: activeDimensions.includes(key) ? { type: 'integer', minimum: 0, maximum: 10 } : { type: 'null' },
        reason: { type: 'string' },
      },
      required: ['score', 'reason'],
      additionalProperties: false,
    },
  ]))

  return {
    type: 'object',
    properties: {
      dimensions: {
        type: 'object',
        properties: dimensionProperties,
        required: [...DIMENSION_KEYS],
        additionalProperties: false,
      },
      strengths: {
        type: 'array',
        items: {
          type: 'object',
          properties: { answerQuote: { type: 'string' }, comment: { type: 'string' } },
          required: ['answerQuote', 'comment'],
          additionalProperties: false,
        },
      },
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          properties: { answerQuote: { type: 'string' }, comment: { type: 'string' } },
          required: ['answerQuote', 'comment'],
          additionalProperties: false,
        },
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            paragraph: { type: 'integer' },
            quote: { type: 'string' },
            comment: { type: 'string' },
          },
          required: ['paragraph', 'quote', 'comment'],
          additionalProperties: false,
        },
      },
      nextQuestion: { type: 'string' },
      nextStepId: expectedNextStepId === null
        ? { type: 'null' }
        : { type: 'string', enum: [expectedNextStepId] },
    },
    required: ['dimensions', 'strengths', 'gaps', 'sources', 'nextQuestion', 'nextStepId'],
    additionalProperties: false,
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

export function validateAiFeedback(
  value: unknown,
  article: string,
  answer: string,
  blocks?: ArticleBlock[],
  stepIndex = LESSON_STEPS.length,
  locale: Locale = 'zh-CN',
): AiFeedback {
  if (!isRecord(value) || !isRecord(value.dimensions)) throw new Error('AI 反馈缺少评分维度。')
  const step = getLessonSteps(locale)[Math.min(LESSON_STEPS.length - 1, stepIndex)]
  const dimensions = {} as AiFeedback['dimensions']
  for (const key of DIMENSION_KEYS) {
    const raw = value.dimensions[key]
    if (!isRecord(raw)) throw new Error('AI 反馈维度格式无效。')
    const score = raw.score
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''
    if (!(score === null || (typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 10)) || !reason || reason.length > 500 || /[？?]/.test(reason)) {
      throw new Error('AI 评分内容未通过校验。')
    }
    if (stepIndex < LESSON_STEPS.length && step.dimensions.includes(key) !== (score !== null)) {
      throw new Error('AI 评分维度与当前训练步骤不匹配。')
    }
    dimensions[key] = { score, reason }
  }
  if (stepIndex < LESSON_STEPS.length && !step.dimensions.includes('fidelity')) {
    throw new Error('训练步骤必须包含原文忠实度评分。')
  }
  if (dimensions.fidelity.score === null) throw new Error('AI 必须评分原文忠实度。')

  const nextStepId = getNextLessonStepId(stepIndex, locale)
  if (value.nextStepId !== nextStepId) throw new Error('AI 返回的下一步骤与当前训练流程不匹配。')

  const strengths = validateObservations(value.strengths, answer)
  const gaps = validateObservations(value.gaps, answer)
  const paragraphs = numberArticleBlocks(getArticleBlocks(article, blocks))
  const sources = validateSources(value.sources, paragraphs)
  const nextQuestion = validateAiQuestion({ question: value.nextQuestion })
  const total = totalScore(dimensions, stepIndex < LESSON_STEPS.length ? step.dimensions : DIMENSION_KEYS)
  return { dimensions, strengths, gaps, sources, nextQuestion, nextStepId, total }
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

function validateSources(value: unknown, paragraphs: NumberedArticleParagraph[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error('AI 没有提供有效的原文依据。')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.paragraph !== 'number' || !Number.isInteger(item.paragraph) || item.paragraph < 1 || item.paragraph > paragraphs.length) {
      throw new Error('AI 原文段落编号无效。')
    }
    const quote = typeof item.quote === 'string' ? item.quote.trim() : ''
    const comment = typeof item.comment === 'string' ? item.comment.trim() : ''
    const paragraph = paragraphs.find((candidate) => candidate.paragraph === item.paragraph)
    if (quote.length < 2 || quote.length > 160 || !paragraph?.text.includes(quote) || !comment || comment.length > 700 || /[？?]/.test(comment)) {
      throw new Error('AI 原文引用未通过校验。')
    }
    return { paragraph: item.paragraph, quote, comment }
  })
}

function emptyMetadata(): ArticleMetadata {
  return { subtitle: '', author: '', source: '' }
}

function totalScore(dimensions: AiFeedback['dimensions'], keys: readonly AiDimensionId[]) {
  const scores = keys.map((key) => dimensions[key].score).filter((score): score is number => score !== null)
  return scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

