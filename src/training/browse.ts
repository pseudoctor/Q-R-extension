import type { ArticleBlock } from '../types'
import { numberArticleBlocks } from '../articles/format'

export const PARAGRAPH_ROLES = ['background', 'phenomenon', 'data', 'cause', 'example', 'comparison', 'transition', 'explanation', 'conclusion', 'recommendation', 'limitation', 'uncertain'] as const
export type BrowseRow = { sourceId: string; paragraph: number; role: string; first: string; last: string; important: boolean }

export function createBrowseRows(blocks: ArticleBlock[]): BrowseRow[] {
  return numberArticleBlocks(blocks).map(({ paragraph, text, blockIndex }) => {
    const sentences = text.match(/[^。！？.!?]+[。！？.!?]*(?:[”’"']*)/gu)?.map((item) => item.trim()).filter(Boolean) ?? [text]
    return { sourceId: blocks[blockIndex].id ?? '', paragraph, role: '', first: sentences[0] ?? text, last: sentences.at(-1) ?? text, important: false }
  })
}

export function readBrowseRows(value: string | undefined): BrowseRow[] {
  if (!value) return []
  try {
    const rows: unknown = JSON.parse(value)
    if (!Array.isArray(rows) || !rows.every((row) => row && typeof row === 'object' && typeof row.sourceId === 'string' && Number.isInteger(row.paragraph) && row.paragraph > 0 && typeof row.role === 'string' && typeof row.first === 'string' && typeof row.last === 'string' && typeof row.important === 'boolean')) return []
    return rows
  } catch { return [] }
}

export function areBrowseRowsComplete(value: string | undefined) {
  const rows = readBrowseRows(value)
  return rows.length > 0 && new Set(rows.map((row) => row.sourceId)).size === rows.length && new Set(rows.map((row) => row.paragraph)).size === rows.length && rows.every((row) => row.sourceId && PARAGRAPH_ROLES.some((role) => role === row.role) && row.first.trim() && row.last.trim())
}

export function areBrowseRowsValid(value: string | undefined, blocks: ArticleBlock[]) {
  if (!areBrowseRowsComplete(value)) return false
  const rows = readBrowseRows(value)
  const paragraphs = numberArticleBlocks(blocks)
  return rows.length === paragraphs.length && rows.every((row) => {
    const source = paragraphs.find((item) => item.paragraph === row.paragraph)
    return source && blocks[source.blockIndex].id === row.sourceId && source.text.includes(row.first.trim()) && source.text.includes(row.last.trim())
  })
}
