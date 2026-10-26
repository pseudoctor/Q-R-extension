import type { AiDimensionId, Locale, ThreeSentenceDraft } from '../types'
import { translate } from '../i18n/messages'

export type LessonStep = {
  id: string
  stage: string
  name: string
  focus: string
  instruction: string
  question: string
  hint: string
  dimensions: AiDimensionId[]
}

export const TRAINING_ANSWER_MAX_LENGTH = 4_000
export const THREE_SENTENCE_ANSWER_MAX_LENGTH = 36_000

export const LESSON_STEPS: LessonStep[] = [
  {
    id: 'preview',
    stage: '连续阅读',
    name: '预读',
    focus: '观察而不是评价',
    instruction: '先看标题、来源和首段，只记录观察，不要急着评价。',
    question: '文章的标题、来源和首段透露了哪些信息？',
    hint: '分别记录标题、来源和首段明确提供的信息，不要补充推断。',
    dimensions: ['fidelity', 'structure'],
  },
  {
    id: 'quick-browse',
    stage: '连续阅读',
    name: '第一遍快速浏览',
    focus: '段落结构',
    instruction: '通读全文，关注每段首句、末句和转折。',
    question: '文章如何展开？记录段落结构和代表性句子。',
    hint: '先看每段开头和结尾，再标记转折、递进、举例和总结。',
    dimensions: ['fidelity', 'structure'],
  },
  {
    id: 'three-sentence',
    stage: '连续阅读',
    name: '分层阅读·3句法',
    focus: '主题、理由、作用',
    instruction: '逐段记录：说了什么、为什么、想告诉你什么。',
    question: '逐段回答：说了什么？为什么？想告诉你什么？',
    hint: '找对象和动作，再找原文理由或证据；没有依据就写“原文未提供”。',
    dimensions: ['fidelity', 'claim', 'cause'],
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
  },
  {
    id: 'questions',
    stage: '连续阅读',
    name: '5W1H 提问',
    focus: '最值得追问的问题',
    instruction: '提出一个关键问题，并说明为什么重要。',
    question: '围绕文章关键点，提出一个最值得追问的 5W1H 问题。',
    hint: '优先追问对象、证据、因果或适用范围，不要替作者回答。',
    dimensions: ['fidelity', 'cause', 'structure'],
  },
  {
    id: 'assumptions',
    stage: '连续阅读',
    name: '识别隐藏假设',
    focus: '论证依赖但未明说的前提',
    instruction: '找出一个隐藏假设，区分原文和你的推断。',
    question: '作者没有明说、但论证必须依赖的前提是什么？',
    hint: '分别写原文内容、作者默认的条件，以及前提不成立的影响。',
    dimensions: ['fidelity', 'cause', 'structure'],
  },
  {
    id: 'logic-check',
    stage: '连续阅读',
    name: '检查逻辑漏洞',
    focus: '证据、因果与结论范围',
    instruction: '找一个具体风险，回到原文说明依据。',
    question: '哪一处存在证据不足、因果跳跃或结论过大的风险？',
    hint: '检查证据是否够、因果是否跳跃、是否有其他解释。',
    dimensions: ['fidelity', 'cause', 'structure'],
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
  },
  {
    id: 'feynman-review',
    stage: '连续阅读',
    name: '费曼解释与复盘',
    focus: '通俗解释与适用边界',
    instruction: '用简单语言解释核心观点、理由、例子和边界。',
    question: '请把一个核心概念或论证解释给十二岁的孩子。',
    hint: '换成日常语言，补一个例子，并说明何时不一定适用。',
    dimensions: ['fidelity', 'claim', 'cause', 'structure'],
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
    if (typeof what !== 'string' || typeof why !== 'string' || typeof takeaway !== 'string') return []
    if (what.length > 2_000 || why.length > 2_000 || takeaway.length > 2_000) return []
    return [{
      paragraph: item.paragraph,
      what,
      why,
      takeaway,
    }]
  })
}

export function isThreeSentenceDraftComplete(draft: Pick<ThreeSentenceDraft, 'what' | 'why' | 'takeaway'> | undefined) {
  return Boolean(draft?.what.trim() && draft.why.trim() && draft.takeaway.trim())
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
    ].join('\n'))
    .join('\n\n')
}

export function isLessonAnswerFormatValid(stepIndex: number, answer: string) {
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
    return points.length === 3 && points.every((point) => [...point].length <= 15)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

