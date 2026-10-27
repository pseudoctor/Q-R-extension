import type { AiDimensionId, ArticleBlock } from '../types'
import type { LessonStep } from './lessons'
import { numberArticleBlocks } from '../articles/format'
import { sourceBlockText } from './evidence'

type StepRule = { criteria: Partial<Record<AiDimensionId, string>>; allowedAbsence: string[] }

const RULES: Record<string, StepRule> = {
  preview: {
    criteria: { fidelity: 'Accurately observe title, metadata, first/last paragraphs and structural clues. Keep found, extraction unavailable and verified absent distinct. Tentative predictions are questions, not established conclusions.', structure: 'Separate observed clues, expected questions and unknowns. Do not require a full-body summary or knowledge of the hidden middle paragraphs.' },
    allowedAbsence: ['Missing author/date/subtitle is acceptable when its availability status is accurate; extraction failure is not proof of absence.'],
  },
  'quick-browse': {
    criteria: { fidelity: 'Paragraph labels and corrected first/last sentence quotes match their source. Do not demand copying entire paragraphs.', structure: 'Describe the whole progression, assign each paragraph a plausible role or explicitly uncertain role, and identify optional candidates for close reading.' },
    allowedAbsence: ['An uncertain paragraph role is acceptable. First and last sentences may coincide in a one-sentence paragraph.'],
  },
  'three-sentence': {
    criteria: { fidelity: 'Grade only selected paragraphs. Paraphrase faithfully, quote accurately and mark inferences separately from explicit content.', claim: 'Distinguish what the paragraph says, its takeaway and its role in the article; do not invent a conclusion for factual material.', cause: 'Identify stated evidence or explanatory relationships. An explanation is not automatically empirical evidence, and correlation is not causation.' },
    allowedAbsence: ['A paragraph may state facts without a reason or conclusion. Accept an explicit not-stated explanation; never demand fabricated reasons.'],
  },
  'three-points': {
    criteria: { fidelity: 'Each of exactly three points is supported by its linked snapshot source and quote. No outside knowledge or example-to-universal generalization.', claim: 'Preserve the main issue and strength of claims; retain important qualifiers.', structure: 'The three concise points cover the whole article without duplicating each other: problem, development/evidence, conclusion or limits. Apply the supplied language length rule.' },
    allowedAbsence: ['Descriptive articles need not have causes, predictions or recommendations. Summarize their actual organization instead.'],
  },
  questions: {
    criteria: { fidelity: 'Questions address the article and accurately distinguish what it answers from what it leaves unanswered.', cause: 'One or two selected questions explain why the evidence, causal mechanism or scope matters. Do not equate an unanswered question with an error.', structure: 'Use appropriate 5W1H categories and prioritize one or two questions with source locations and answer boundaries; all six categories are not required.' },
    allowedAbsence: ['The source may not answer the chosen question. The reader must still supply their own question and significance.'],
  },
  assumptions: {
    criteria: { fidelity: 'Separate explicit claims, source evidence, missing information and reader hypotheses. Preserve probabilistic language.', cause: 'Explain an assumption and what changes if it fails. Check correlation, reverse causality and alternatives without asserting unsupported alternatives as fact.', structure: 'Connect the selected question, claim, evidence, assumption, risks and remaining uncertainty.' },
    allowedAbsence: ['No clear risk or decomposable argument is acceptable with a source-grounded explanation; absence is not automatically a flaw.'],
  },
  'toulmin-simple': {
    criteria: { fidelity: 'Lock one argument and distinguish explicit source material, contextual inference with rationale, and unstated elements.', claim: 'State the precise claim without widening its certainty or scope.', cause: 'Separate empirical data from the warrant connecting data to claim. A mechanism assertion alone is not empirical evidence.', structure: 'Claim, data and warrant concern the same argument ID and are linked coherently.' },
    allowedAbsence: ['An unstated warrant may be marked as an inference with a rationale or as unstated. Non-argumentative material may be justified as not applicable.'],
  },
  'toulmin-full': {
    criteria: { fidelity: 'Use the same argument as step 7. Distinguish the author’s response from reader-proposed objections.', claim: 'Preserve qualifiers that control the strength and applicability of the claim.', cause: 'Backing supports the warrant, not merely repeats data; rebuttals identify meaningful exceptions or alternative explanations.', structure: 'Integrate backing, qualifier and rebuttal with step 7, identify the weakest link and a concrete verification need.' },
    allowedAbsence: ['Backing, qualifiers or rebuttals may be unstated. Accept explicit absence and do not demand invented rebuttals. Grounded not-applicable remains valid.'],
  },
  'feynman-review': {
    criteria: { fidelity: 'Preserve the source meaning and limits. A clearly marked invented analogy need not appear in the source and is not evidence.', claim: 'Explain a specific concept or argument accurately without unexplained jargon.', cause: 'Explain the connecting process clearly; do not turn one possible cause into the only cause.', structure: 'Use accessible language for a twelve-year-old, a mapped concrete example or analogy, and an explicit boundary.' },
    allowedAbsence: ['An invented everyday analogy is permitted when labeled and its limitations are explained; do not require a verbatim source quote for the analogy itself.'],
  },
  'final-review': {
    criteria: { fidelity: 'Review current effective answers against the snapshot, preserve uncertainty and link evidence and rereading locations.', claim: 'The main idea, three points and central argument agree and retain the source’s limits.', cause: 'Evaluate premises, strongest evidence and weakest links with reasons; do not introduce new unsupported certainty.', structure: 'Synthesize prior work rather than require mechanical recopying. Identify unresolved questions and concrete paragraphs to revisit.' },
    allowedAbsence: ['An article without an argument may retain its justified not-applicable record. Remaining uncertainty is a valid outcome.'],
  },
}

export function gradingRubric(step: LessonStep) {
  const rule = RULES[step.id]
  if (!rule || step.dimensions.some((dimension) => !rule.criteria[dimension])) throw new Error(`Missing grading rubric: ${step.id}`)
  return {
    version: 'guided-reading-rubric-1',
    criteria: Object.fromEntries(step.dimensions.map((dimension) => [dimension, rule.criteria[dimension]])),
    scoreBands: [
      { range: [0, 2], meaning: 'Fundamental misunderstanding, fabricated support, or no usable response to this dimension.' },
      { range: [3, 4], meaning: 'Partial understanding with major unsupported claims, missing links or scope errors.' },
      { range: [5, 6], meaning: 'Mostly relevant and grounded, but important omissions or imprecision remain.' },
      { range: [7, 8], meaning: 'Accurate and well-supported with minor gaps or clarity issues.' },
      { range: [9, 10], meaning: 'Accurate, precise, complete for this step, with explicit support and appropriate limits.' },
    ],
    allowedAbsence: rule.allowedAbsence,
    policies: ['Score each active dimension independently on integer 0–10; inactive dimensions must be null. Total is the mean of active scores times 10.', 'Judge the student answer, not a reference wording. Accept equivalent paraphrases and defensible labeled inferences.', 'Never penalize a permitted absence or a labeled analogy merely for not being a source quotation.', 'For justified not-applicable answers, assess fidelity of the quoted basis, precision of the applicability judgment (claim), reasoning for that judgment (cause), and coherence of the record (structure); never demand invented argument components.', 'Every explanation must name a concrete feature of this answer. Do not ask questions in dimension reasons, strengths or gaps; put follow-up questions only in nextQuestion.', 'All feedback prose must use the requested interface locale. Source quotations must preserve the source language.'],
  }
}

export function assessmentScope(blocks: ArticleBlock[], stepId: string, selected?: number[]) {
  const paragraphs = numberArticleBlocks(blocks)
  const selectedSet = new Set(selected ?? paragraphs.map((item) => item.paragraph))
  const sources = blocks.flatMap((block, index) => {
    const paragraph = paragraphs.find((item) => item.blockIndex === index)?.paragraph ?? 0
    let text = sourceBlockText(block)
    if (stepId === 'preview' && paragraph && paragraph !== 1 && paragraph !== paragraphs.length) text = 'inlines' in block ? (block.inlines ?? []).filter((inline) => inline.emphasis).map((inline) => inline.text).join('\n') : ''
    if (stepId === 'three-sentence' && (!paragraph || !selectedSet.has(paragraph))) return []
    return text ? [{ blockId: block.id ?? `block-${index + 1}`, paragraph, text }] : []
  })
  return { kind: stepId === 'preview' ? 'preview-clues-only' : stepId === 'three-sentence' ? 'selected-paragraphs-only' : 'whole-article', paragraphs: sources.filter((source) => source.paragraph > 0).map((source) => source.paragraph), sources }
}
