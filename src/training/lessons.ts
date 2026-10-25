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
    focus: '首段、末段、小标题、图表与强调内容',
    instruction: '先阅读页面已展示的标题、副标题、作者和来源，再读取第一段和最后一段，浏览小标题、图表以及加粗或斜体内容。只记录第一段、最后一段和这些版式内容带来的观察，不要急着评价。标题、副标题、作者和来源无需重复记录；原文没有提供的信息请明确写“原文未提供”。',
    question: '请记录第一段、最后一段、小标题、图表以及强调内容带来的观察。标题、副标题、作者和来源已由系统填写，无需重复记录。只写观察，不要急着评价；原文没有提供的信息请明确写“原文未提供”。',
    hint: '先按页面位置记录看到的内容：首段、末段、小标题、图表和强调内容分别出现了什么。',
    dimensions: ['fidelity', 'structure'],
  },
  {
    id: 'quick-browse',
    stage: '连续阅读',
    name: '第一遍快速浏览',
    focus: '段落首句、末句与全文结构',
    instruction: '通读全文，记录或标记每段的第一句和最后一句，并留意转折、递进、举例和总结关系。此时先建立结构感，不急着完成详细分析。',
    question: '请快速浏览全文，记录文章的段落结构，并写下若干最能代表段意的首句或末句。重点是看文章如何展开，不要急着做详细分析。',
    hint: '先看每段的开头和结尾，再标记“转折、递进、举例、总结”等连接关系。',
    dimensions: ['fidelity', 'structure'],
  },
  {
    id: 'three-sentence',
    stage: '连续阅读',
    name: '分层阅读·3句法',
    focus: '主题、理由/证据、段落判断',
    instruction: '再次精读全文，按原文段落逐段记录三项观察：这段说了什么、为什么这么说、想告诉你什么。段落只有一句话时，不要补写原文没有提供的理由，可明确写“原文未提供”。',
    question: '请再读一遍全文，按段落逐段回答：这段说了什么？为什么这么说？它想告诉你什么？段落只有一句话时，理由栏可写“原文未提供”，不要补写原文没有的信息。',
    hint: '先找段落中的对象和动作；再找原文给出的理由、证据或连接词；最后区分原文内容和你的推断。',
    dimensions: ['fidelity', 'claim', 'cause'],
  },
  {
    id: 'three-points',
    stage: '连续阅读',
    name: '全文三点总结',
    focus: '三个不超过十五字的要点',
    instruction: '只写原文明确表达的内容，不添加外部知识或评价。',
    question: '用三个不超过十五字的要点概括全文。先写原文明确说出的内容，不补充外部信息。',
    hint: '三个要点可以分别覆盖文章谈什么、如何展开、最后说明了什么；只保留原文明确表达的内容。',
    dimensions: ['fidelity', 'claim', 'structure'],
  },
  {
    id: 'questions',
    stage: '连续阅读',
    name: '5W1H 提问',
    focus: '提出最值得追问的问题',
    instruction: '提出一个关键问题，并说明它为什么值得优先追问，不替作者回答。',
    question: '围绕文章最关键的一处，提出一个最值得追问的 5W1H 问题，并说明它为什么比其他问题更关键。',
    hint: '优先追问会影响全文判断的对象、证据、因果或适用范围，不要把问题写成自己的答案。',
    dimensions: ['fidelity', 'cause', 'structure'],
  },
  {
    id: 'assumptions',
    stage: '连续阅读',
    name: '识别隐藏假设',
    focus: '作者没有明说但论证依赖的前提',
    instruction: '指出一个作者没有直接说出、但论证成立必须默认接受的前提，区分原文明确说了什么、作者默认了什么，以及前提不成立会怎样。',
    question: '请指出一个作者没有明说、但论证必须依赖的隐藏假设，并说明原文明确说了什么、作者默认了什么，以及这个前提不成立会有什么影响。',
    hint: '把“原文明确说的事实”与“要让结论成立还必须相信的条件”分开写。',
    dimensions: ['fidelity', 'cause', 'structure'],
  },
  {
    id: 'logic-check',
    stage: '连续阅读',
    name: '检查逻辑漏洞',
    focus: '证据、因果、其他解释与结论范围',
    instruction: '检查证据是否充分、因果关系是否成立、是否存在其他解释，以及结论范围是否超过证据支持的范围。指出一个具体风险并回到原文说明依据。',
    question: '请指出一个具体的逻辑风险，并说明它属于证据不足、因果跳跃、以偏概全、忽略其他解释或结论范围过大中的哪一种。请回到原文说明依据。',
    hint: '先选一个具体句子，再问：证据够不够、因果是否跳跃、有没有别的解释、结论是否说得太满。',
    dimensions: ['fidelity', 'cause', 'structure'],
  },
  {
    id: 'toulmin-simple',
    stage: '连续阅读',
    name: '简化图尔敏',
    focus: '主张、证据、保证',
    instruction: '拆出 Claim、Data/Grounds 和 Warrant，区分原文明说与自己的推断。',
    question: '选择一条核心论证，分别写出主张、证据/根据和保证：为什么这些证据能够支持这个主张？',
    hint: '先写作者要你接受的主张，再找支撑它的原文材料，最后说明两者之间已有或缺少的连接规则。',
    dimensions: ['fidelity', 'claim', 'cause', 'structure'],
  },
  {
    id: 'toulmin-full',
    stage: '连续阅读',
    name: '完整图尔敏',
    focus: '支援、限定、反驳',
    instruction: '继续分析 Backing、Qualifier、Rebuttal；原文没有的部分写“未交代”。',
    question: '在上一轮论证上继续分析：有哪些支援？作者用了哪些限定词？是否回应了反驳或例外？',
    hint: '专门寻找“通常、可能、除非、但是”等限定或转折词；原文没有回应的反驳写“未交代”。',
    dimensions: ['fidelity', 'claim', 'cause', 'structure'],
  },
  {
    id: 'feynman-review',
    stage: '连续阅读',
    name: '费曼解释与复盘',
    focus: '通俗解释、具体例子与适用边界',
    instruction: '面向一个十二岁的孩子解释核心观点、原因、一个具体例子或类比、适用边界，以及原文仍未提供的信息。',
    question: '请把文章中的一个核心概念或论证解释给一个十二岁的孩子听，包含核心观点、原因、一个具体例子或类比、适用边界，以及原文仍未提供的信息。',
    hint: '把术语换成日常语言，再补一个帮助理解的例子；最后说明这个解释在哪些情况下不一定适用。',
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

