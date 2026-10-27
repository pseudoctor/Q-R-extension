import type { ArticleBlock, ArticleMetadata, MetadataField, MetadataReview, TrainingArticleSnapshot } from '../types'

export const METADATA_FIELDS: MetadataField[] = ['title', 'subtitle', 'author', 'source', 'date']
export const METADATA_STATUSES = ['found', 'not-extracted', 'verified-absent'] as const

export function initialMetadataReview(article: { title: string; metadata?: ArticleMetadata; author?: string }): MetadataReview {
  const values = { title: article.title, subtitle: article.metadata?.subtitle ?? '', author: article.metadata?.author || article.author || '', source: article.metadata?.source ?? '', date: article.metadata?.date ?? '' }
  return { reviewed: false, fields: Object.fromEntries(METADATA_FIELDS.map((field) => [field, { value: values[field], status: values[field].trim() ? 'found' : 'not-extracted' }])) as MetadataReview['fields'] }
}

export function readMetadataReview(value: string | undefined): MetadataReview | null {
  try {
    const record = JSON.parse(value ?? 'null')
    if (!record || typeof record.reviewed !== 'boolean' || !record.fields || !METADATA_FIELDS.every((field) => typeof record.fields[field]?.value === 'string' && METADATA_STATUSES.includes(record.fields[field]?.status))) return null
    return record
  } catch { return null }
}

export function isMetadataReviewComplete(value: string | undefined) {
  const review = readMetadataReview(value)
  return Boolean(review?.reviewed && METADATA_FIELDS.every((field) => review.fields[field].value.length <= 240 && (review.fields[field].status !== 'found' || review.fields[field].value.trim())))
}

export function formatMetadataReview(value: string | undefined, t: (key: string) => string) {
  const review = readMetadataReview(value)
  return review ? METADATA_FIELDS.map((field) => `${t(`coach.field.${field}`)}: ${t(`coach.metadata.${review.fields[field].status}`)}${review.fields[field].status === 'found' ? ` · ${review.fields[field].value}` : ''}`).join('\n') : ''
}

export type SummaryEvidence = { snapshotId: string; checked: boolean; points: { blockId: string; quote: string }[] }

export function emptySummaryEvidence(snapshotId: string): SummaryEvidence {
  return { snapshotId, checked: false, points: Array.from({ length: 3 }, () => ({ blockId: '', quote: '' })) }
}

export function readSummaryEvidence(value: string | undefined): SummaryEvidence | null {
  try {
    const record = JSON.parse(value ?? 'null')
    return record && typeof record.snapshotId === 'string' && typeof record.checked === 'boolean' && Array.isArray(record.points) && record.points.length === 3 && record.points.every((point: { blockId?: unknown; quote?: unknown } | null) => point && typeof point.blockId === 'string' && typeof point.quote === 'string') ? record : null
  } catch { return null }
}

export function sourceBlockText(block: ArticleBlock) {
  return 'text' in block ? block.text : block.type === 'list' ? block.items.join('\n') : block.type === 'image' ? block.alt : ''
}

export function isSummaryEvidenceComplete(value: string | undefined) {
  const record = readSummaryEvidence(value)
  return Boolean(record?.checked && record.snapshotId && record.points.every((point) => point.blockId && point.quote.trim().length >= 2 && point.quote.length <= 320))
}

export function isSummaryEvidenceValid(value: string | undefined, snapshot: Pick<TrainingArticleSnapshot, 'id' | 'blocks'> | undefined) {
  const record = readSummaryEvidence(value)
  return Boolean(snapshot && record && isSummaryEvidenceComplete(value) && record.snapshotId === snapshot.id && record.points.every((point) => {
    const block = snapshot.blocks.find((item) => item.id === point.blockId)
    return block && sourceBlockText(block).includes(point.quote.trim())
  }))
}

export function formatSummaryEvidence(value: string | undefined, blocks: ArticleBlock[] = [], t?: (key: string, variables?: Record<string, string | number>) => string) {
  const record = readSummaryEvidence(value)
  return record ? record.points.map((point, index) => {
    const blockIndex = blocks.findIndex((block) => block.id === point.blockId)
    const block = blocks[blockIndex]
    const paragraph = blocks.slice(0, blockIndex + 1).filter((item) => item.type === 'paragraph' || item.type === 'quote').length
    const label = block && (block.type === 'paragraph' || block.type === 'quote') ? t?.('feedback.paragraph', { number: paragraph }) ?? `Paragraph ${paragraph}` : block ? `${block.type}: ${sourceBlockText(block).slice(0, 60)}` : point.blockId
    return `${index + 1}. ${label} [${record.snapshotId} / ${point.blockId}] “${point.quote}”`
  }).join('\n') : ''
}
