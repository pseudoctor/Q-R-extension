import type { TrainingSession, TrainingTurn } from '../types'
import { LESSON_STEPS, getLegacyLessonSteps, getLessonSteps } from './lessons'

export function trainingEditPreview(session: TrainingSession, turnIndex: number, locale: import('../types').Locale = 'zh-CN'): TrainingSession {
  const turn = session.turns[turnIndex]
  const step = turn && getLessonSteps(locale)[turn.stepIndex]
  if (!turn || !step) return session
  return { ...session, currentStep: turn.stepIndex, currentStepId: step.id, currentQuestion: step.question,
    draft: turn.answer, structuredDraft: turn.structuredDraft, importantParagraphs: turn.importantParagraphs,
    threeSentenceDrafts: turn.threeSentenceDrafts, paragraphCursor: turn.paragraphCursor, answerVersionId: turn.answerVersionId }
}

export function trainingAverageScore(session: TrainingSession | null | undefined) {
  const scores = effectiveTrainingTurns(session).flatMap((turn) => turn.feedback ? [turn.feedback.total] : [])
  return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null
}
import { readBrowseRows } from './browse'
import { readQuestions } from './questions'

export function initialImportantParagraphs(session: TrainingSession) {
  if (session.importantParagraphs !== undefined) return session.importantParagraphs
  if (session.threeSentenceDrafts?.length) return [...new Set(session.threeSentenceDrafts.map((draft) => draft.paragraph))]
  const browse = effectiveTrainingTurns(session).find((turn) => turn.stepId === 'quick-browse')
  return readBrowseRows(browse?.structuredDraft?.['quickBrowse.paragraphMap']).filter((row) => row.important).map((row) => row.paragraph)
}

export function effectiveTrainingTurns(session: TrainingSession | null | undefined, includeReview = false): TrainingTurn[] {
  if (!session) return []
  const steps = session.flowId === 'legacy-8' ? getLegacyLessonSteps('zh-CN') : LESSON_STEPS
  const latest = new Map<string, TrainingTurn>()
  for (const turn of session.turns) {
    const id = turn.stepId ?? steps[turn.stepIndex]?.id
    if (!id || !steps.some((step) => step.id === id) || !turn.answer.trim()) continue
    const record = session.stepRecords?.[id]
    if (record && (record.status !== 'completed' && !(includeReview && record.status === 'needs-review'))) continue
    if (record?.answerVersionId && turn.answerVersionId !== record.answerVersionId) continue
    latest.set(id, turn)
  }
  return steps.flatMap((step) => latest.has(step.id) ? [latest.get(step.id)!] : [])
}

export function trainingProgress(session: TrainingSession | null | undefined) {
  const total = session?.flowId === 'legacy-8' ? 8 : LESSON_STEPS.length
  const completed = effectiveTrainingTurns(session).length
  const recorded = effectiveTrainingTurns(session, true).length
  return { completed, recorded, pendingReview: recorded - completed, total, isComplete: completed === total }
}

export function canRetryTrainingDraft(local: TrainingSession, remote: TrainingSession) {
  return local.sessionId === remote.sessionId && local.currentStepId === remote.currentStepId &&
    local.articleSnapshotId === remote.articleSnapshotId && !remote.isArchived
}

export function acceptDraftSaveResponse(current: TrainingSession | null, saved: TrainingSession) {
  return current && canRetryTrainingDraft(current, saved) && (current.draftRevision ?? 0) <= (saved.draftRevision ?? 0) ? saved : current
}

export function mergeTrainingFeedback(current: TrainingSession | null, response: TrainingSession): TrainingSession | null {
  if (!current || current.sessionId !== response.sessionId) return current
  return { ...current,
    turns: current.turns.map((turn) => ({ ...turn, feedback: response.turns.find((item) => item.answerVersionId === turn.answerVersionId)?.feedback ?? turn.feedback })),
    answerVersions: current.answerVersions?.map((version) => ({ ...version, feedback: response.answerVersions?.find((item) => item.id === version.id)?.feedback ?? version.feedback })),
  }
}

export function reviewDraftFromResults(session: TrainingSession): import('../types').TrainingStructuredDraft {
  const turns = effectiveTrainingTurns(session)
  const byId = (id: string) => turns.find((turn) => turn.stepId === id)
  const risk = byId('assumptions')?.structuredDraft
  const argument = byId('toulmin-simple')?.structuredDraft
  const full = byId('toulmin-full')?.structuredDraft
  return {
    'review.threePoints': byId('three-points')?.answer ?? '',
    'review.coreArgument': argument?.['applicability.mode'] === 'not-applicable' ? argument['applicability.reason'] ?? '' : argument?.['toulminSimple.claim'] ?? '',
    'review.premise': risk?.['applicability.mode'] === 'not-applicable' ? risk['applicability.reason'] ?? '' : risk?.['assumptions.assumption'] ?? '',
    'review.strongestEvidence': argument?.['applicability.mode'] === 'not-applicable' ? argument['applicability.quote'] ?? '' : '',
    'review.weakestPoint': full?.['toulminFull.weakestPoint'] ?? '',
    'review.uncertainty': risk?.['assumptions.uncertainty'] ?? '',
    'review.revisit': byId('questions')?.structuredDraft?.['questions.relatedParagraphs'] ?? readQuestions(byId('questions')?.structuredDraft?.['questions.items']).filter((row) => row.selected).map((row) => row.relatedParagraphs).join('\n'),
  }
}
