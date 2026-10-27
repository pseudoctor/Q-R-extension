import type { AiDimensionId, Locale, ThreeSentenceDraft, TrainingDraftFieldId, TrainingStructuredDraft } from '../types'
import { translate } from '../i18n/messages'
import { areBrowseRowsComplete, areBrowseRowsValid } from './browse'
import { areQuestionsComplete } from './questions'
import { isMetadataReviewComplete, isSummaryEvidenceComplete, isSummaryEvidenceValid } from './evidence'
export { gradingRubric, assessmentScope } from './rubrics'

export type LessonStep = {
  id: string
  stage: string
  name: string
  focus: string
  instruction: string
  question: string
  hint: string
  dimensions: AiDimensionId[]
  dependsOn: string[]
}

export const TRAINING_ANSWER_MAX_LENGTH = 4_000
export const THREE_SENTENCE_ANSWER_MAX_LENGTH = 36_000
export const STRUCTURED_ANSWER_MAX_LENGTH = 36_000

export const LESSON_STEPS: LessonStep[] = [
  {
    id: 'preview',
    stage: '连续阅读',
    name: '预读',
    focus: '观察而不是评价',
    instruction: '先看文章外围信息和首尾段，只记录观察，不要急着评价。',
    question: '文章的外部线索透露了哪些信息？你预计它要回答什么问题？',
    hint: '先核对标题、副标题、作者、来源和日期的状态。提取未获得不等于原文未提供；再记录首末段和小标题、图表、强调信息显示了什么，最后提出预计问题。',
    dimensions: ['fidelity', 'structure'],
    dependsOn: [],
  },
  {
    id: 'quick-browse',
    stage: '连续阅读',
    name: '第一遍快速浏览',
    focus: '段落结构',
    instruction: '快速浏览全文，先看清文章如何分段、转折和收束。',
    question: '请为每段标记功能，并选出下一步要重点阅读的段落。',
    hint: '只建立文章结构地图；核对首末句和转折，发现系统识别不准确时再修改。第3步再用三句法分析候选段落。',
    dimensions: ['fidelity', 'structure'],
    dependsOn: ['preview'],
  },
  {
    id: 'three-sentence',
    stage: '连续阅读',
    name: '分层阅读·3句法',
    focus: '主题、理由、作用',
    instruction: '选出重要段落，逐段记录：说了什么、为什么、想告诉你什么。',
    question: '对选出的重要段落分别回答：说了什么？为什么？想告诉你什么？',
    hint: '先选出重要段落，再找对象和动作、原文理由或证据；没有依据就写“原文未提供”。',
    dimensions: ['fidelity', 'claim', 'cause'],
    dependsOn: ['quick-browse'],
  },
  {
    id: 'three-points',
    stage: '连续阅读',
    name: '全文三点总结',
    focus: '三个不超过十五字的要点',
    instruction: '只写原文明确表达的内容。',
    question: '用三个不超过十五字的要点概括全文。',
    hint: '三个要点覆盖文章谈什么、如何展开、最后说明什么。',
    dimensions: ['fidelity', 'claim', 'structure'],
    dependsOn: ['three-sentence'],
  },
  {
    id: 'questions',
    stage: '连续阅读',
    name: '5W1H 提问',
    focus: '最值得追问的问题',
    instruction: '列出问题，选择一至两个重点说明重要性和原文回答边界。',
    question: '围绕文章关键点，哪些 5W1H 问题最值得追问？请选择一至两个。',
    hint: '优先追问对象、证据、因果或适用范围，不要替作者回答。',
    dimensions: ['fidelity', 'cause', 'structure'],
    dependsOn: ['three-points'],
  },
  {
    id: 'assumptions',
    stage: '连续阅读',
    name: '隐藏假设与风险',
    focus: '主张、证据、前提与其他解释',
    instruction: '先区分原文明确说的内容，再检查论证依赖的前提和证据风险。',
    question: '原文主张、证据、默认前提和可能的论证风险分别是什么？',
    hint: '分别记录原文主张、原文证据、作者默认的条件、其他解释、证据不足之处和仍不确定的问题。',
    dimensions: ['fidelity', 'cause', 'structure'],
    dependsOn: ['questions'],
  },
  {
    id: 'toulmin-simple',
    stage: '连续阅读',
    name: '简化图尔敏',
    focus: '主张、证据、保证',
    instruction: '拆出 Claim、Data/Grounds 和 Warrant。',
    question: '核心论证的主张、证据和保证分别是什么？',
    hint: '先写主张，再找原文材料，最后说明两者如何连接。',
    dimensions: ['fidelity', 'claim', 'cause', 'structure'],
    dependsOn: ['assumptions'],
  },
  {
    id: 'toulmin-full',
    stage: '连续阅读',
    name: '完整图尔敏',
    focus: '支援、限定、反驳',
    instruction: '继续检查 Backing、Qualifier、Rebuttal。',
    question: '有哪些支援和限定？作者是否回应反驳或例外？',
    hint: '寻找“通常、可能、除非、但是”等词；未回应就写“未交代”。',
    dimensions: ['fidelity', 'claim', 'cause', 'structure'],
    dependsOn: ['toulmin-simple'],
  },
  {
    id: 'feynman-review',
    stage: '连续阅读',
    name: '费曼解释',
    focus: '通俗解释与适用边界',
    instruction: '用简单语言解释核心观点、理由、例子和边界。',
    question: '请把一个核心概念或论证解释给十二岁的孩子。',
    hint: '换成日常语言，补一个例子，并说明何时不一定适用。',
    dimensions: ['fidelity', 'claim', 'cause', 'structure'],
    dependsOn: ['toulmin-full'],
  },
  {
    id: 'final-review',
    stage: '连续阅读',
    name: '全文复盘',
    focus: '回看结构、证据与不确定性',
    instruction: '把前面的阅读记录放在一起，复盘文章结构和自己的判断边界。',
    question: '回看整篇文章：它主要讲了什么，最重要的论证是什么，哪里最需要继续核实？',
    hint: '记录文章主旨、三个要点、核心论证、依赖前提、最有说服力的证据、最薄弱的地方、仍不确定之处和需要重读的段落。',
    dimensions: ['fidelity', 'claim', 'cause', 'structure'],
    dependsOn: ['feynman-review'],
  },
]

const LEGACY_LESSON_LABELS = [
  ['preview', '基础理解'],
  ['three-sentence', '基础理解'],
  ['three-points', '批判性提问'],
  ['questions', '批判性提问'],
  ['assumptions', '简化图尔敏'],
  ['toulmin-simple', '简化图尔敏'],
  ['toulmin-full', '完整论证'],
  ['feynman-review', '完整论证'],
] as const

export function getLegacyLessonSteps(locale: Locale): LessonStep[] {
  return LEGACY_LESSON_LABELS.map(([id, stage]) => ({
    id,
    stage: translate(locale, `lesson.legacy.${id}.stage`) || stage,
    name: translate(locale, `lesson.legacy.${id}.name`),
    focus: '',
    instruction: '',
    question: '',
    hint: '',
    dimensions: [],
    dependsOn: [],
  }))
}

export function getLessonSteps(locale: Locale): LessonStep[] {
  return LESSON_STEPS.map((step) => ({
    ...step,
    stage: translate(locale, `lesson.${step.id}.stage`),
    name: translate(locale, `lesson.${step.id}.name`),
    focus: translate(locale, `lesson.${step.id}.focus`),
    instruction: translate(locale, `lesson.${step.id}.instruction`),
    question: translate(locale, `lesson.${step.id}.question`),
    hint: translate(locale, `lesson.${step.id}.hint`) || step.hint,
  }))
}

export function getNextLessonStepId(currentStep: number, locale: Locale = 'zh-CN') {
  const steps = getLessonSteps(locale)
  if (currentStep >= steps.length) return steps.at(-1)?.id ?? null
  return steps[currentStep + 1]?.id ?? null
}

export function normalizeThreeSentenceDrafts(value: unknown): ThreeSentenceDraft[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ThreeSentenceDraft[] => {
    if (!isRecord(item) || typeof item.paragraph !== 'number' || !Number.isInteger(item.paragraph) || item.paragraph < 1) return []
    const what = item.what
    const why = item.why
    const takeaway = item.takeaway
    const role = typeof item.role === 'string' ? item.role : ''
    const evidence = typeof item.evidence === 'string' ? item.evidence : ''
    const evidenceType = item.evidenceType === 'explicit' || item.evidenceType === 'inferred' || item.evidenceType === 'not-stated' ? item.evidenceType : undefined
    if (typeof what !== 'string' || typeof why !== 'string' || typeof takeaway !== 'string') return []
    return [{
      paragraph: item.paragraph,
      what,
      why,
      takeaway,
      role,
      evidence,
      ...(evidenceType ? { evidenceType } : {}),
    }]
  })
}

export function isThreeSentenceDraftComplete(draft: Pick<ThreeSentenceDraft, 'what' | 'why' | 'takeaway' | 'role' | 'evidence'> | undefined) {
  return Boolean(draft?.what.trim() && draft.why.trim() && draft.takeaway.trim() && draft.role.trim() && draft.evidence.trim())
}

export function areThreeSentenceDraftsComplete(drafts: readonly ThreeSentenceDraft[], paragraphNumbers: readonly number[]) {
  if (!paragraphNumbers.length) return false
  const byParagraph = new Map(drafts.map((draft) => [draft.paragraph, draft]))
  return paragraphNumbers.every((paragraph) => isThreeSentenceDraftComplete(byParagraph.get(paragraph)))
}

export function formatThreeSentenceAnswer(drafts: readonly ThreeSentenceDraft[]) {
  return drafts
    .filter((draft) => draft.what.trim() || draft.why.trim() || draft.takeaway.trim())
    .sort((left, right) => left.paragraph - right.paragraph)
    .map((draft) => [
      `第${draft.paragraph}段`,
      `这段说了什么：${draft.what.trim()}`,
      `为什么这么说：${draft.why.trim()}`,
      `这段想告诉我什么：${draft.takeaway.trim()}`,
      `这段在全文中的作用：${draft.role.trim()}`,
      `原文依据：${draft.evidence.trim()}`,
    ].join('\n'))
    .join('\n\n')
}

export type TrainingFieldDefinition = {
  id: TrainingDraftFieldId
  labelKey: string
  multiline?: boolean
  rows?: number
}

export const APPLICABILITY_FIELDS: TrainingFieldDefinition[] = [
  { id: 'applicability.mode', labelKey: 'coach.applicability.mode' },
  { id: 'applicability.reason', labelKey: 'coach.applicability.reason', multiline: true },
  { id: 'applicability.sourceId', labelKey: 'coach.applicability.source' },
  { id: 'applicability.quote', labelKey: 'coach.applicability.quote', multiline: true },
]

export const STRUCTURED_FIELD_DEFINITIONS: Partial<Record<string, TrainingFieldDefinition[]>> = {
  preview: [
    { id: 'preview.metadata', labelKey: 'coach.metadata.heading', multiline: true },
    { id: 'preview.title', labelKey: 'coach.field.title' },
    { id: 'preview.subtitle', labelKey: 'coach.field.subtitle' },
    { id: 'preview.author', labelKey: 'coach.field.author' },
    { id: 'preview.source', labelKey: 'coach.field.source' },
    { id: 'preview.date', labelKey: 'coach.field.date' },
    { id: 'preview.firstParagraph', labelKey: 'coach.field.firstParagraph', multiline: true },
    { id: 'preview.lastParagraph', labelKey: 'coach.field.lastParagraph', multiline: true },
    { id: 'preview.structure', labelKey: 'coach.field.externalClues', multiline: true },
    { id: 'preview.expectedQuestion', labelKey: 'coach.field.expectedQuestion', multiline: true },
    { id: 'preview.unknown', labelKey: 'coach.field.unknown', multiline: true },
  ],
  'quick-browse': [
    { id: 'quickBrowse.paragraphMap', labelKey: 'coach.browse.map', multiline: true },
    { id: 'quickBrowse.structure', labelKey: 'coach.field.structureOverview', multiline: true },
  ],
  'three-points': [
    { id: 'threePoints.evidence', labelKey: 'coach.field.threePointSources', multiline: true },
    { id: 'threePoints.sources', labelKey: 'coach.field.threePointSources', multiline: true },
  ],
  questions: [
    { id: 'questions.items', labelKey: 'coach.questions.list', multiline: true },
    { id: 'questions.category', labelKey: 'coach.field.questionCategory' },
    { id: 'questions.question', labelKey: 'coach.field.question', multiline: true, rows: 2 },
    { id: 'questions.relatedParagraphs', labelKey: 'coach.field.relatedParagraphs' },
    { id: 'questions.whyImportant', labelKey: 'coach.field.whyImportant', multiline: true },
    { id: 'questions.answered', labelKey: 'coach.field.answered', multiline: true },
    { id: 'questions.unanswered', labelKey: 'coach.field.unanswered', multiline: true },
  ],
  assumptions: [
    ...APPLICABILITY_FIELDS,
    { id: 'assumptions.claim', labelKey: 'coach.field.claim', multiline: true },
    { id: 'assumptions.claimStatus', labelKey: 'coach.field.claimStatus' },
    { id: 'assumptions.evidence', labelKey: 'coach.field.evidence', multiline: true },
    { id: 'assumptions.evidenceStatus', labelKey: 'coach.field.evidenceStatus' },
    { id: 'assumptions.assumption', labelKey: 'coach.field.assumption', multiline: true },
    { id: 'assumptions.assumptionImpact', labelKey: 'coach.field.assumptionImpact', multiline: true },
    { id: 'assumptions.otherExplanations', labelKey: 'coach.field.otherExplanations', multiline: true },
    { id: 'assumptions.evidenceGap', labelKey: 'coach.field.evidenceGap', multiline: true },
    { id: 'assumptions.uncertainty', labelKey: 'coach.field.uncertainty', multiline: true },
  ],
  'toulmin-simple': [
    ...APPLICABILITY_FIELDS,
    { id: 'toulminSimple.argumentId', labelKey: 'coach.field.argumentId' },
    { id: 'toulminSimple.claim', labelKey: 'coach.field.claim', multiline: true },
    { id: 'toulminSimple.claimStatus', labelKey: 'coach.field.claimStatus' },
    { id: 'toulminSimple.evidence', labelKey: 'coach.field.evidence', multiline: true },
    { id: 'toulminSimple.evidenceStatus', labelKey: 'coach.field.evidenceStatus' },
    { id: 'toulminSimple.warrant', labelKey: 'coach.field.warrant', multiline: true },
    { id: 'toulminSimple.warrantStatus', labelKey: 'coach.field.warrantStatus' },
  ],
  'toulmin-full': [
    ...APPLICABILITY_FIELDS,
    { id: 'toulminFull.backing', labelKey: 'coach.field.backing', multiline: true },
    { id: 'toulminFull.qualifier', labelKey: 'coach.field.qualifier', multiline: true },
    { id: 'toulminFull.rebuttal', labelKey: 'coach.field.rebuttal', multiline: true },
    { id: 'toulminFull.weakestPoint', labelKey: 'coach.field.weakestPoint', multiline: true },
    { id: 'toulminFull.verification', labelKey: 'coach.field.verification', multiline: true },
  ],
  'feynman-review': [
    { id: 'feynman.explanation', labelKey: 'coach.field.explanation', multiline: true, rows: 4 },
    { id: 'feynman.example', labelKey: 'coach.field.example', multiline: true },
    { id: 'feynman.exampleType', labelKey: 'coach.field.exampleType' },
    { id: 'feynman.boundary', labelKey: 'coach.field.boundary', multiline: true },
  ],
  'final-review': [
    { id: 'review.articleMainIdea', labelKey: 'coach.field.articleMainIdea', multiline: true },
    { id: 'review.threePoints', labelKey: 'coach.field.threePoints', multiline: true },
    { id: 'review.coreArgument', labelKey: 'coach.field.coreArgument', multiline: true },
    { id: 'review.premise', labelKey: 'coach.field.premise', multiline: true },
    { id: 'review.strongestEvidence', labelKey: 'coach.field.strongestEvidence', multiline: true },
    { id: 'review.weakestPoint', labelKey: 'coach.field.weakestPoint', multiline: true },
    { id: 'review.uncertainty', labelKey: 'coach.field.uncertainty', multiline: true },
    { id: 'review.revisit', labelKey: 'coach.field.revisit', multiline: true },
  ],
}

export function structuredFieldsForStep(stepId: string) {
  return (STRUCTURED_FIELD_DEFINITIONS[stepId] ?? []).map(({ id }) => id)
}

const LEGACY_STRUCTURED_FIELDS: TrainingDraftFieldId[] = [
  'quickBrowse.paragraphLabels',
  'quickBrowse.representativeSentences',
]

export function requiredFieldsForDraft(stepId: string, draft: TrainingStructuredDraft | undefined): TrainingDraftFieldId[] {
  if (stepId === 'preview' && draft?.['preview.metadata'] !== undefined) return ['preview.metadata', 'preview.firstParagraph', 'preview.lastParagraph', 'preview.structure', 'preview.expectedQuestion', 'preview.unknown']
  if (stepId === 'three-points' && draft?.['threePoints.evidence'] !== undefined) return ['threePoints.evidence']
  if (['assumptions', 'toulmin-simple', 'toulmin-full'].includes(stepId) && draft?.['applicability.mode'] === 'not-applicable') return [...APPLICABILITY_FIELDS.map((field) => field.id), ...(stepId === 'toulmin-simple' ? ['toulminSimple.argumentId' as const] : [])]
  if (stepId === 'quick-browse' && draft?.['quickBrowse.paragraphMap'] !== undefined) return ['quickBrowse.structure', 'quickBrowse.paragraphMap']
  if (stepId === 'questions' && draft?.['questions.items'] !== undefined) return ['questions.items']
  return structuredFieldsForStep(stepId).filter((field) => !field.startsWith('applicability.') && !['quickBrowse.paragraphMap', 'questions.items', 'preview.metadata', 'threePoints.evidence'].includes(field))
}

export function activeTrainingDraft(stepId: string, draft: TrainingStructuredDraft | undefined): TrainingStructuredDraft {
  return Object.fromEntries(requiredFieldsForDraft(stepId, draft).filter((field) => draft?.[field] !== undefined).map((field) => [field, draft![field]]))
}

export function normalizeTrainingStructuredDraft(value: unknown): TrainingStructuredDraft | undefined {
  if (!isRecord(value)) return undefined
  const allowedFields = new Set([
    ...Object.values(STRUCTURED_FIELD_DEFINITIONS).flatMap((fields) => fields?.map(({ id }) => id) ?? []),
    ...LEGACY_STRUCTURED_FIELDS,
  ])
  const normalized: TrainingStructuredDraft = {}
  for (const field of allowedFields) {
    const raw = value[field]
    if (typeof raw === 'string') normalized[field] = raw
  }
  return Object.keys(normalized).length ? normalized : undefined
}

export function isStructuredDraftComplete(stepId: string, draft: TrainingStructuredDraft | undefined) {
  if (stepId === 'preview' && draft?.['preview.metadata'] !== undefined && !isMetadataReviewComplete(draft['preview.metadata'])) return false
  if (stepId === 'three-points' && draft?.['threePoints.evidence'] !== undefined) return isSummaryEvidenceComplete(draft['threePoints.evidence'])
  if (stepId === 'questions' && draft?.['questions.items'] !== undefined) return areQuestionsComplete(draft['questions.items'])
  if (stepId === 'quick-browse' && draft?.['quickBrowse.paragraphMap'] !== undefined) return Boolean(draft['quickBrowse.structure']?.trim()) && areBrowseRowsComplete(draft['quickBrowse.paragraphMap'])
  const fields = requiredFieldsForDraft(stepId, draft)
  if (stepId === 'feynman-review') {
    const exampleType = draft?.['feynman.exampleType']?.trim().toLocaleLowerCase() ?? ''
    if (isNotProvidedPlaceholder(exampleType) || !/原文|案例|自创|类比|source|case|original|analogy|原文の事例|自作|比喩|원문|사례|직접 만든|비유/.test(exampleType)) return false
  }
  return fields.length > 0 && fields.every((field) => {
    const value = draft?.[field]?.trim() ?? ''
    if (!value) return false
    return !SELF_GENERATED_FIELDS.has(field) || !isNotProvidedPlaceholder(value)
  })
}

const SELF_GENERATED_FIELDS = new Set<TrainingDraftFieldId>([
  'applicability.reason',
  'questions.question',
  'questions.whyImportant',
  'feynman.explanation',
  'feynman.example',
  'feynman.boundary',
  'review.articleMainIdea',
  'review.coreArgument',
  'review.premise',
  'review.weakestPoint',
  'review.uncertainty',
  'review.revisit',
])

function isNotProvidedPlaceholder(value: string) {
  return /^(?:原文未提供|原文没有提供|未提供|not provided|not available|原文に記載なし|記載なし|원문에 없음|제공되지 않음)[。.!！]?$/.test(value.trim().toLocaleLowerCase())
}

export function isLessonAnswerFormatValid(stepIndex: number, answer: string, locale: Locale = 'zh-CN') {
  const step = LESSON_STEPS[Math.min(LESSON_STEPS.length - 1, Math.max(0, stepIndex))]
  const value = answer.trim()
  if (!value) return false

  if (step.id === 'three-sentence') {
    return value.split(/[。！？.!?]+/).filter((sentence) => sentence.trim()).length >= 3
  }

  if (step.id === 'three-points') {
    const points = value
      .split(/\n+/)
      .map((point) => point.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim())
      .filter(Boolean)
    return points.length === 3 && points.every((point) => summaryPointLength(point, locale) <= 15)
  }

  if (step.id === 'questions') {
    return (value.match(/[？?]/g) ?? []).length === 1
  }

  if (step.id === 'feynman-review') {
    const hasExample = /例如|比如|举例|想象|example|for example|たとえば|例えば|예를 들어|예시/i.test(value)
    const hasBoundary = /边界|适用|限制|不适用|除非|范围|boundary|limit|applicab|when|ただし|適用|限界|제한|적용/i.test(value)
    return hasExample && hasBoundary
  }

  return true
}

function isLessonAnswerFormatNavigable(answer: string, locale: Locale) {
  const points = answer
    .split(/\n+/)
    .map((point) => point.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim())
    .filter(Boolean)
  return points.length > 0 && points.every((point) => summaryPointLength(point, locale) <= 15)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function summaryPointLength(value: string, locale: string) {
  return locale === 'en' ? value.trim().split(/\s+/).filter(Boolean).length : [...value.replace(/\s/gu, '')].length
}

export function structuredFieldLimit(field: TrainingFieldDefinition) {
  if (field.id === 'preview.metadata' || field.id === 'threePoints.evidence') return 4000
  if (field.id === 'quickBrowse.paragraphMap' || field.id === 'questions.items') return STRUCTURED_ANSWER_MAX_LENGTH
  return field.multiline ? 800 : 240
}

export function isTrainingDraftValid(session: import('../types').TrainingSession, locale: Locale = 'zh-CN') {
  const step = LESSON_STEPS[session.currentStep]
  if (!step || session.draft.trim().length < 5 || session.draft.length > STRUCTURED_ANSWER_MAX_LENGTH) return false
  if (step.id === 'three-sentence') {
    const selected = session.importantParagraphs ?? []
    return areThreeSentenceDraftsComplete(session.threeSentenceDrafts ?? [], selected) &&
      (session.threeSentenceDrafts ?? []).filter((item) => selected.includes(item.paragraph)).every((item) =>
        [item.what, item.why, item.takeaway, item.role, item.evidence].every((text) => text.length <= 2000))
  }
  const fields = STRUCTURED_FIELD_DEFINITIONS[step.id] ?? []
  if (step.id === 'three-points' && session.structuredDraft?.['threePoints.evidence'] !== undefined && !isSummaryEvidenceValid(session.structuredDraft['threePoints.evidence'], session.articleSnapshot)) return false
  if (session.structuredDraft?.['applicability.mode'] === 'not-applicable') {
    if (!['assumptions', 'toulmin-simple', 'toulmin-full'].includes(step.id)) return false
    const source = session.articleSnapshot?.blocks.find((block) => block.id === session.structuredDraft?.['applicability.sourceId'])
    const quote = session.structuredDraft['applicability.quote']?.trim() ?? ''
    const sourceText = source && ('text' in source ? source.text : source.type === 'list' ? source.items.join('\n') : source.type === 'image' ? source.alt : '')
    if (quote.length < 2 || !sourceText?.includes(quote)) return false
  }
  if (step.id === 'quick-browse' && session.structuredDraft?.['quickBrowse.paragraphMap'] !== undefined && !areBrowseRowsValid(session.structuredDraft['quickBrowse.paragraphMap'], session.articleSnapshot?.blocks ?? [])) return false
  if (fields.length && (!isStructuredDraftComplete(step.id, session.structuredDraft) || fields.some((field) => (session.structuredDraft?.[field.id]?.length ?? 0) > structuredFieldLimit(field)))) return false
  if (step.id === 'toulmin-full' && !session.argumentId?.trim()) return false
  return step.id === 'three-points' ? isLessonAnswerFormatValid(session.currentStep, session.draft, locale) : fields.length > 0 || isLessonAnswerFormatValid(session.currentStep, session.draft, locale)
}

export function isTrainingDraftNavigable(session: import('../types').TrainingSession, locale: Locale = 'zh-CN') {
  const step = LESSON_STEPS[session.currentStep]
  if (!step || session.draft.trim().length < 5 || session.draft.length > STRUCTURED_ANSWER_MAX_LENGTH) return false
  if (step.id === 'three-sentence') {
    const selectedDrafts = (session.threeSentenceDrafts ?? []).filter((item) => (session.importantParagraphs ?? []).includes(item.paragraph))
    return (session.importantParagraphs ?? []).length > 0 && selectedDrafts.some((item) =>
      [item.what, item.why, item.takeaway, item.role, item.evidence].some((text) => text.trim())) && selectedDrafts.every((item) =>
        [item.what, item.why, item.takeaway, item.role, item.evidence].every((text) => text.length <= 2000))
  }
  const fields = STRUCTURED_FIELD_DEFINITIONS[step.id] ?? []
  if (step.id === 'quick-browse' && session.structuredDraft?.['quickBrowse.paragraphMap'] !== undefined && !areBrowseRowsValid(session.structuredDraft['quickBrowse.paragraphMap'], session.articleSnapshot?.blocks ?? [])) return false
  if (fields.some((field) => (session.structuredDraft?.[field.id]?.length ?? 0) > structuredFieldLimit(field))) return false
  if (step.id === 'three-points') return isLessonAnswerFormatNavigable(session.draft, locale)
  if (!fields.length) return isLessonAnswerFormatNavigable(session.draft, locale)
  const activeFields = requiredFieldsForDraft(step.id, session.structuredDraft)
  return activeFields.some((fieldId) => hasMeaningfulStructuredValue(fieldId, session.structuredDraft?.[fieldId]))
}

function hasMeaningfulStructuredValue(fieldId: import('../types').TrainingDraftFieldId, value: string | undefined) {
  if (!value?.trim() || fieldId === 'applicability.mode') return false
  if (!['preview.metadata', 'quickBrowse.paragraphMap', 'questions.items', 'threePoints.evidence'].includes(fieldId)) return true
  try {
    const parsed = JSON.parse(value) as Record<string, unknown> | unknown[]
    if (fieldId === 'questions.items' && Array.isArray(parsed)) {
      return parsed.some((item) => isRecord(item) && ['question', 'whyImportant', 'relatedParagraphs', 'answered', 'unanswered'].some((key) => typeof item[key] === 'string' && item[key].trim()))
    }
    if (fieldId === 'quickBrowse.paragraphMap' && Array.isArray(parsed)) {
      return parsed.some((item) => isRecord(item) && ['role', 'first', 'last'].some((key) => typeof item[key] === 'string' && item[key].trim()))
    }
    if (fieldId === 'preview.metadata' && isRecord(parsed)) {
      const fields = parsed.fields
      return Boolean(parsed.reviewed) || (isRecord(fields) && Object.values(fields).some((item) => isRecord(item) && typeof item.value === 'string' && item.value.trim()))
    }
    if (fieldId === 'threePoints.evidence' && isRecord(parsed) && Array.isArray(parsed.points)) {
      return parsed.points.some((item) => isRecord(item) && (typeof item.blockId === 'string' && item.blockId.trim() || typeof item.quote === 'string' && item.quote.trim()))
    }
  } catch {
    return false
  }
  return false
}

