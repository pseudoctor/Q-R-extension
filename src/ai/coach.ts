import { getArticleBlocks, numberArticleBlocks } from '../articles/format'
import type { AiDimensionId, AiFeedback, AiReferenceAnswer, ArticleBlock, ArticleMetadata, Locale, TrainingFieldAssistMode, TrainingSession, TrainingTurn } from '../types'
import { getLessonSteps, getNextLessonStepId, LESSON_STEPS, requiredFieldsForDraft, activeTrainingDraft, gradingRubric, assessmentScope, STRUCTURED_FIELD_DEFINITIONS, structuredFieldLimit } from '../training/lessons'
import { translate } from '../i18n/messages'
import { effectiveTrainingTurns } from '../training/state'
import { initialMetadataReview } from '../training/evidence'

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
  locale: Locale = 'zh-CN',
  blocks?: ArticleBlock[],
) {
  const step = getLessonSteps(locale)[stepIndex] ?? getLessonSteps(locale)[0]
  const sourceBlocks = getArticleBlocks(article, blocks)
  const scope = assessmentScope(sourceBlocks, step.id)
  return {
    system: `${translate(locale, 'ai.basePrompt')}\n${translate(locale, 'ai.stepPrefix')}“${step.name}”（${step.focus}，stepId: ${step.id}）。${step.instruction}\n${translate(locale, 'ai.startJsonRule')}`,
    user: JSON.stringify({
      stepId: step.id,
      stepIndex,
      locale,
      title,
      metadata,
      requiredFields: requiredFieldsForDraft(step.id, undefined),
      rubric: gradingRubric(step),
      assessmentScope: scope,
      fieldDefinitions: fieldDefinitions(step.id, undefined, locale),
      articleMetadataState: initialMetadataReview({ title, metadata }),
      applicabilityRule: translate(locale, 'coach.applicability.hint'),
      dependsOn: step.dependsOn,
      paragraphs: promptParagraphs(sourceBlocks, scope),
      sourceBlocks: promptSourceBlocks(sourceBlocks, scope),
      sourceCitationRule: '正文段落使用 paragraph>=1；标题、列表、图表等非正文块使用 paragraph:0 并填写对应 blockId。quote 必须是该来源块中的连续文字。',
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
  const sourceBlocks = getArticleBlocks(article, blocks)
  const question = session.currentStep < LESSON_STEPS.length ? step.question : session.currentQuestion
  const scope = assessmentScope(sourceBlocks, step.id, session.importantParagraphs)
  return {
    system: `${translate(locale, 'ai.basePrompt')}\n${translate(locale, 'ai.stepPrefix')}“${step.name}”（${step.focus}，stepId: ${step.id}）。${translate(locale, 'ai.roundRequirement')}${step.instruction}\n${translate(locale, 'ai.gradeRules')} ${translate(locale, 'ai.stepDimensions', { dimensions: step.dimensions.join(', ') })} ${completed || !next ? translate(locale, 'ai.completedRule') : translate(locale, 'ai.nextRule', { step: next.name })}${translate(locale, 'ai.jsonOnly')} ${translate(locale, 'ai.feedbackShape')}`,
    user: JSON.stringify({
      stepId: step.id,
      stepIndex: session.currentStep,
      sessionId: session.sessionId ?? null,
      draftRevision: session.draftRevision ?? 0,
      answerVersionId: session.answerVersionId ?? null,
      argumentId: session.argumentId ?? null,
      nextStepId: expectedNextStepId,
      allowedDimensions: step.dimensions,
      requiredFields: requiredFieldsForDraft(step.id, session.structuredDraft),
      rubric: gradingRubric(step),
      assessmentScope: scope,
      fieldDefinitions: fieldDefinitions(step.id, session.structuredDraft, locale),
      articleMetadataState: session.articleSnapshot?.metadataReview ?? initialMetadataReview({ title, metadata }),
      locale,
      summaryLengthRule: locale === 'en' ? 'At most 15 whitespace-separated words per point, excluding numbering.' : 'At most 15 non-whitespace visible characters per point; punctuation counts, numbering does not.',
      applicabilityRule: translate(locale, 'coach.applicability.hint'),
      dependsOn: step.dependsOn,
      title,
      metadata,
      paragraphs: promptParagraphs(sourceBlocks, scope),
      sourceBlocks: promptSourceBlocks(sourceBlocks, scope),
      sourceCitationRule: '正文段落使用 paragraph>=1；标题、列表、图表等非正文块使用 paragraph:0 并填写对应 blockId。quote 必须是该来源块中的连续文字。',
      question,
      answer,
      ...(session.structuredDraft ? { structuredDraft: activeTrainingDraft(step.id, session.structuredDraft) } : {}),
      ...(session.importantParagraphs ? { importantParagraphs: session.importantParagraphs } : {}),
      ...(session.currentStep === 2 && session.threeSentenceDrafts
        ? { threeSentenceDrafts: session.threeSentenceDrafts.filter((draft) => !session.importantParagraphs || session.importantParagraphs.includes(draft.paragraph)) }
        : {}),
      history: effectiveTrainingTurns(session).filter((turn) => turn.stepIndex < session.currentStep).map(({ question, answer, stepIndex, stepId }) => ({ question, answer, stepIndex, stepId })),
      precedingResults: effectiveTrainingTurns(session).filter((turn) => turn.stepIndex < session.currentStep).map(({ answer, stepId, answerVersionId, structuredDraft }) => ({ answer, stepId, answerVersionId: answerVersionId ?? null, structuredDraft: activeTrainingDraft(stepId ?? '', structuredDraft) })),
    }),
    responseFormat: buildJsonResponseFormat('training_feedback', buildFeedbackSchema(step.dimensions, expectedNextStepId)),
  }
}

export function buildReferenceAnswerPrompt(
  article: string,
  title: string,
  metadata: ArticleMetadata = emptyMetadata(),
  turn: TrainingTurn,
  locale: Locale = 'zh-CN',
  blocks?: ArticleBlock[],
) {
  const steps = getLessonSteps(locale)
  const step = (turn.stepId ? steps.find((candidate) => candidate.id === turn.stepId) : undefined)
    ?? steps[Math.min(steps.length - 1, Math.max(0, turn.stepIndex))]
  const sourceBlocks = getArticleBlocks(article, blocks)
  const question = step.id === 'three-sentence' ? step.question : turn.question
  const scope = assessmentScope(sourceBlocks, step.id, turn.importantParagraphs)
  return {
    system: `${translate(locale, 'ai.referenceBasePrompt')}
${translate(locale, 'ai.stepPrefix')}“${step.name}”（${step.focus}，stepId: ${step.id}）。${translate(locale, 'ai.referenceAnswerInstruction')}
${translate(locale, 'ai.referenceAnswerFormat')}
${translate(locale, 'ai.jsonOnly')}`,
    user: JSON.stringify({
      stepId: step.id,
      stepIndex: turn.stepIndex,
      answerVersionId: turn.answerVersionId ?? null,
      locale,
      title,
      metadata,
      requiredFields: requiredFieldsForDraft(step.id, turn.structuredDraft),
      rubric: gradingRubric(step),
      assessmentScope: scope,
      fieldDefinitions: fieldDefinitions(step.id, turn.structuredDraft, locale),
      articleMetadataState: initialMetadataReview({ title, metadata }),
      applicabilityRule: translate(locale, 'coach.applicability.hint'),
      structuredDraft: activeTrainingDraft(step.id, turn.structuredDraft),
      dependsOn: step.dependsOn,
      paragraphs: promptParagraphs(sourceBlocks, scope),
      sourceBlocks: promptSourceBlocks(sourceBlocks, scope),
      sourceCitationRule: '正文段落使用 paragraph>=1；标题、列表、图表等非正文块使用 paragraph:0 并填写对应 blockId。quote 必须是该来源块中的连续文字。',
      question,
      studentAnswer: turn.answer,
      ...(turn.importantParagraphs ? { importantParagraphs: turn.importantParagraphs } : {}),
      ...(turn.threeSentenceDrafts ? { threeSentenceDrafts: turn.threeSentenceDrafts.filter((draft) => !turn.importantParagraphs || turn.importantParagraphs.includes(draft.paragraph)) } : {}),
    }),
    responseFormat: buildJsonResponseFormat('training_reference_answer', {
      type: 'object',
      properties: {
        answer: { type: 'string', minLength: 20, maxLength: 4_000 },
        sources: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              paragraph: { type: 'integer', minimum: 0 },
              blockId: { type: 'string', minLength: 1, maxLength: 80 },
              quote: { type: 'string', minLength: 2, maxLength: 320 },
              comment: { type: 'string' },
            },
            required: ['paragraph', 'quote', 'comment'],
            additionalProperties: false,
          },
        },
      },
      required: ['answer', 'sources'],
      additionalProperties: false,
    }),
  }
}

export function buildFieldAssistPrompt(
  article: string,
  title: string,
  metadata: ArticleMetadata = emptyMetadata(),
  session: TrainingSession,
  fieldId: string,
  mode: TrainingFieldAssistMode,
  locale: Locale = 'zh-CN',
  blocks?: ArticleBlock[],
) {
  const steps = getLessonSteps(locale)
  const step = steps[Math.min(steps.length - 1, Math.max(0, session.currentStep))]
  const sourceBlocks = getArticleBlocks(article, blocks)
  const scope = assessmentScope(sourceBlocks, step.id, session.importantParagraphs)
  const meaning = fieldMeaning(step.id, fieldId, locale)
  if (!meaning) throw new Error('找不到当前训练字段。')
  const instruction = translate(locale, mode === 'hint' ? 'ai.fieldAssistHint' : 'ai.fieldAssistReference')
  const baseFieldId = fieldId.split(':')[0]
  return {
    system: `${translate(locale, 'ai.basePrompt')}
${translate(locale, 'ai.stepPrefix')}“${step.name}”（${step.focus}，stepId: ${step.id}）。${instruction}
${translate(locale, 'ai.referenceAnswerFormat')}
${translate(locale, 'ai.jsonOnly')}`,
    user: JSON.stringify({
      stepId: step.id,
      stepIndex: session.currentStep,
      sessionId: session.sessionId ?? null,
      draftRevision: session.draftRevision ?? 0,
      fieldId,
      fieldMeaning: meaning,
      mode,
      title,
      metadata,
      articleMetadataState: session.articleSnapshot?.metadataReview ?? initialMetadataReview({ title, metadata }),
      assessmentScope: scope,
      structuredDraft: activeTrainingDraft(step.id, session.structuredDraft),
      currentFieldValue: session.structuredDraft?.[baseFieldId as keyof NonNullable<TrainingSession['structuredDraft']>] ?? '',
      studentAnswer: session.draft,
      importantParagraphs: session.importantParagraphs ?? [],
      paragraphs: promptParagraphs(sourceBlocks, scope),
      sourceBlocks: promptSourceBlocks(sourceBlocks, scope),
      sourceCitationRule: '引用必须来自当前步骤允许使用的来源块，quote 必须是来源块中的连续文字。',
    }),
    responseFormat: buildJsonResponseFormat('training_field_assist', {
      type: 'object',
      properties: {
        answer: { type: 'string', minLength: 20, maxLength: 2_000 },
        sources: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              paragraph: { type: 'integer', minimum: 0 },
              blockId: { type: 'string', minLength: 1, maxLength: 80 },
              quote: { type: 'string', minLength: 2, maxLength: 320 },
              comment: { type: 'string' },
            },
            required: ['paragraph', 'quote', 'comment'],
            additionalProperties: false,
          },
        },
      },
      required: ['answer', 'sources'],
      additionalProperties: false,
    }),
  }
}

function fieldMeaning(stepId: string, fieldId: string, locale: Locale) {
  const baseFieldId = fieldId.split(':')[0]
  if (stepId === 'three-sentence') {
    const key: Record<string, string> = {
      what: 'coach.threeSentence.what',
      why: 'coach.threeSentence.why',
      takeaway: 'coach.threeSentence.takeaway',
      role: 'coach.threeSentence.role',
      evidence: 'coach.threeSentence.evidence',
    }
    return key[baseFieldId] ? translate(locale, key[baseFieldId]) : null
  }
  if (stepId === 'quick-browse') {
    const key: Record<string, string> = {
      'quickBrowse.paragraphLabels': 'coach.field.paragraphLabels',
      'quickBrowse.first': 'coach.browse.first',
      'quickBrowse.last': 'coach.browse.last',
    }
    if (key[baseFieldId]) return translate(locale, key[baseFieldId])
  }
  if (stepId === 'three-points') {
    if (/^threePoints\.point[1-3]$/.test(baseFieldId)) return translate(locale, 'coach.field.threePoints')
    if (baseFieldId === 'threePoints.evidence.source') return translate(locale, 'coach.applicability.source')
    if (baseFieldId === 'threePoints.evidence.quote') return translate(locale, 'coach.applicability.quote')
  }
  if (stepId === 'preview' && (baseFieldId === 'preview.metadata.status' || baseFieldId === 'preview.metadata.value')) {
    return translate(locale, 'coach.metadata.heading')
  }
  const field = (STRUCTURED_FIELD_DEFINITIONS[stepId] ?? []).find((candidate) => candidate.id === baseFieldId)
  return field ? translate(locale, field.labelKey) : null
}

function fieldDefinitions(stepId: string, draft: TrainingSession['structuredDraft'], locale: Locale) {
  if (stepId === 'three-sentence') return ['what', 'why', 'takeaway', 'role', 'evidence'].map((id) => ({ id, meaning: translate(locale, `coach.threeSentence.${id}`), maxLength: 2000, rule: 'Only selected paragraphs are graded. Distinguish explicit source content, labeled inference with rationale, and not stated.' }))
  const fields = requiredFieldsForDraft(stepId, draft)
  const formats: Record<string, string> = {
    'preview.metadata': 'JSON: reviewed boolean; fields title/subtitle/author/source/date each have value and status found | not-extracted | verified-absent. Only found values assert a fact.',
    'threePoints.evidence': 'JSON: snapshotId, checked boolean, exactly three points with blockId and consecutive source quote, corresponding in order to the three answer lines.',
    'quickBrowse.paragraphMap': 'JSON list: sourceId, paragraph, role, first/last source sentences, important boolean. One row for every paragraph.',
    'questions.items': 'JSON list: stable id, who/what/why/how/when/where category, question, selected boolean, whyImportant, relatedParagraphs, answered, unanswered. Develop one or two selected questions.',
  }
  return (STRUCTURED_FIELD_DEFINITIONS[stepId] ?? []).filter((field) => fields.includes(field.id)).map((field) => ({ id: field.id, meaning: translate(locale, field.labelKey), maxLength: structuredFieldLimit(field), ...(formats[field.id] ? { encoding: formats[field.id] } : {}) }))
}

function promptSourceBlocks(blocks: ArticleBlock[], scope: ReturnType<typeof assessmentScope>) {
  if (scope.kind !== 'preview-clues-only') return serializeSourceBlocks(blocks)
  return scope.sources.map((source) => ({ id: source.blockId, paragraph: source.paragraph, text: source.text, type: blocks.find((block, index) => (block.id ?? `block-${index + 1}`) === source.blockId)?.type }))
}

function promptParagraphs(blocks: ArticleBlock[], scope: ReturnType<typeof assessmentScope>) {
  return scope.kind === 'preview-clues-only' ? scope.sources.filter((source) => source.paragraph > 0).map(({ paragraph, text }) => ({ paragraph, text })) : numberArticleBlocks(blocks).map(({ paragraph, text }) => ({ paragraph, text }))
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
            paragraph: { type: 'integer', minimum: 0 },
            blockId: { type: 'string', minLength: 1, maxLength: 80 },
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
  importantParagraphs?: number[],
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
  const sourceBlocks = getArticleBlocks(article, blocks)
  const sources = validateSources(value.sources, sourceBlocks)
  if (stepIndex < LESSON_STEPS.length) assertAssessmentSources(sources, sourceBlocks, step.id, importantParagraphs)
  const nextQuestion = validateAiQuestion({ question: value.nextQuestion })
  const total = totalScore(dimensions, stepIndex < LESSON_STEPS.length ? step.dimensions : DIMENSION_KEYS)
  return { dimensions, strengths, gaps, sources, nextQuestion, nextStepId, total }
}

export function validateAiReferenceAnswer(
  value: unknown,
  article: string,
  blocks?: ArticleBlock[],
  assessment?: { stepIndex: number; importantParagraphs?: number[] },
): AiReferenceAnswer {
  if (!isRecord(value)) throw new Error('AI 参考答案格式无效。')
  const answer = typeof value.answer === 'string' ? value.answer.trim() : ''
  if (answer.length < 20 || answer.length > 4_000) {
    throw new Error('AI 参考答案未通过校验。')
  }
  const sources = validateSources(value.sources, getArticleBlocks(article, blocks), true, 320)
  if (assessment) assertAssessmentSources(sources, getArticleBlocks(article, blocks), LESSON_STEPS[assessment.stepIndex]?.id ?? '', assessment.importantParagraphs)
  return { answer, sources }
}

function assertAssessmentSources(sources: AiFeedback['sources'], blocks: ArticleBlock[], stepId: string, selected?: number[]) {
  const scope = assessmentScope(blocks, stepId, selected)
  if (scope.kind === 'whole-article') return
  const paragraphs = numberArticleBlocks(blocks)
  for (const source of sources) {
    const blockIndex = paragraphs.find((item) => item.paragraph === source.paragraph)?.blockIndex
    const id = source.blockId || (blockIndex === undefined ? '' : blocks[blockIndex].id ?? `block-${blockIndex + 1}`)
    if (!scope.sources.some((allowed) => allowed.blockId === id && normalizeSourceText(allowed.text).includes(normalizeSourceText(source.quote)))) throw new Error('AI 引用超出了当前步骤允许评分的原文范围。')
  }
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

function validateSources(value: unknown, blocks: ArticleBlock[], allowQuestions = false, maxQuoteLength = 160) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error('AI 没有提供有效的原文依据。')
  const paragraphs = numberArticleBlocks(blocks)
  return value.map((item) => {
    if (!isRecord(item) || typeof item.paragraph !== 'number' || !Number.isInteger(item.paragraph) || item.paragraph < 0 || item.paragraph > paragraphs.length) {
      throw new Error('AI 原文段落编号无效。')
    }
    const blockId = typeof item.blockId === 'string' ? item.blockId.trim() : ''
    const blockIndex = blockId
      ? blocks.findIndex((block) => block.id === blockId) >= 0
        ? blocks.findIndex((block) => block.id === blockId)
        : blocks.every((block) => !block.id) ? parseBlockId(blockId) : null
      : null
    if (blockId && (blockIndex === null || blockIndex < 0 || blockIndex >= blocks.length)) throw new Error('AI 原文来源块编号无效。')
    if (item.paragraph === 0 && (blockIndex === null || blockIndex < 0 || blockIndex >= blocks.length)) {
      throw new Error('AI 原文来源块编号无效。')
    }
    if (item.paragraph > 0 && blockIndex !== null) {
      const paragraphSource = paragraphs.find((candidate) => candidate.paragraph === item.paragraph)
      if (!paragraphSource || paragraphSource.blockIndex !== blockIndex) throw new Error('AI 原文来源块与段落不匹配。')
    }
    const quote = typeof item.quote === 'string' ? item.quote.trim() : ''
    const comment = typeof item.comment === 'string' ? item.comment.trim() : ''
    const paragraph = paragraphs.find((candidate) => candidate.paragraph === item.paragraph)
    const sourceText = item.paragraph === 0 && blockIndex !== null ? sourceBlockText(blocks[blockIndex]) : paragraph?.text ?? ''
    const normalizedQuote = normalizeSourceText(quote)
    const normalizedSourceText = normalizeSourceText(sourceText)
    if (normalizedQuote.length < 2 || normalizedQuote.length > maxQuoteLength || !normalizedSourceText.includes(normalizedQuote) || !comment || comment.length > 700 || (!allowQuestions && /[？?]/.test(comment))) {
      throw new Error('AI 原文引用未通过校验。')
    }
    return { paragraph: item.paragraph, ...(blockId ? { blockId } : {}), quote, comment }
  })
}

function normalizeSourceText(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function serializeSourceBlocks(blocks: ArticleBlock[]) {
  return blocks.map((block, index) => {
    const id = block.id ?? `block-${index + 1}`
    if (block.type === 'list') {
      return { id, block: index + 1, type: block.type, ordered: block.ordered, items: block.items, ...(block.itemInlines ? { itemInlines: block.itemInlines } : {}) }
    }
    if (block.type === 'image') {
      return { id, block: index + 1, type: block.type, alt: block.alt }
    }
    if (block.type === 'chart') {
      return { id, block: index + 1, type: block.type, text: block.text, alt: block.alt }
    }
    if (block.type === 'divider') return { id, block: index + 1, type: block.type }
    return { id, block: index + 1, type: block.type, text: block.text, ...('inlines' in block && block.inlines ? { inlines: block.inlines } : {}) }
  })
}

function parseBlockId(value: string) {
  const match = /^block-(\d+)$/.exec(value)
  return match ? Number(match[1]) - 1 : null
}

function sourceBlockText(block: ArticleBlock) {
  if (block.type === 'list') return block.items.join('\n')
  if (block.type === 'image') return block.alt
  if (block.type === 'chart') return [block.text, block.alt].filter(Boolean).join('\n')
  if (block.type === 'divider') return ''
  return block.text
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

