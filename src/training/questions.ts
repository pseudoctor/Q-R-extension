export const QUESTION_CATEGORIES = ['who', 'what', 'why', 'how', 'when', 'where'] as const
export type ReadingQuestion = {
  id: string
  category: string
  question: string
  selected: boolean
  whyImportant: string
  relatedParagraphs: string
  answered: string
  unanswered: string
}

export function readQuestions(value: string | undefined): ReadingQuestion[] {
  try {
    const rows: unknown = JSON.parse(value ?? '[]')
    if (!Array.isArray(rows) || !rows.every((row) => row && typeof row === 'object' && ['id', 'category', 'question', 'whyImportant', 'relatedParagraphs', 'answered', 'unanswered'].every((field) => typeof row[field] === 'string') && typeof row.selected === 'boolean')) return []
    return rows
  } catch { return [] }
}

export function areQuestionsComplete(value: string | undefined) {
  const rows = readQuestions(value)
  const selected = rows.filter((row) => row.selected)
  const personal = (text: string) => text.trim() && !/^(原文未提供|原文没有提供|未提供|not provided|not available|原文に記載なし|記載なし|원문에 없음|제공되지 않음)[。.!！]?$/i.test(text.trim())
  return rows.length > 0 && rows.length <= 20 && new Set(rows.map((row) => row.id)).size === rows.length &&
    selected.length >= 1 && selected.length <= 2 &&
    rows.every((row) => row.id && QUESTION_CATEGORIES.some((category) => category === row.category) && personal(row.question) && [row.question, row.whyImportant, row.relatedParagraphs, row.answered, row.unanswered].every((text) => text.length <= 800)) &&
    selected.every((row) => personal(row.whyImportant) && row.relatedParagraphs.trim() && row.answered.trim() && row.unanswered.trim())
}

export function formatQuestions(value: string | undefined, t: (key: string) => string) {
  return readQuestions(value).map((row) => [
    `${row.category.toUpperCase()}: ${row.question}${row.selected ? ` · ${t('coach.questions.key')}` : ''}`,
    ...(row.selected ? (['whyImportant', 'relatedParagraphs', 'answered', 'unanswered'] as const).map((field) => `${t(`coach.field.${field}`)}: ${row[field]}`) : []),
  ].join('\n')).join('\n\n')
}
