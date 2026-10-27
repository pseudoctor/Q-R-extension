import type { ArticleBlock, ArticleInline, CaptureRecord, TrainingArticleSnapshot } from '../types'
import { initialMetadataReview } from '../training/evidence.ts'

export function articleBlocksFromText(value: string): ArticleBlock[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((text) => text.split('\n').map((line) => line.trim()).filter(Boolean).join('\n').trim())
    .filter(Boolean)
    .map((text) => ({ type: 'paragraph', text }))
}

export function normalizeArticleBlocks(value: unknown, fallbackText = ''): ArticleBlock[] {
  if (!Array.isArray(value)) return articleBlocksFromText(fallbackText)

  const blocks = value.flatMap((item): ArticleBlock[] => {
    if (!isRecord(item) || typeof item.type !== 'string') return []
    const id = normalizeBlockId(item.id)
    if (item.type === 'paragraph' || item.type === 'heading' || item.type === 'quote' || item.type === 'code') {
      if (typeof item.text !== 'string' || !item.text.trim()) return []
      const text = item.type === 'code' ? item.text.replace(/\r\n?/g, '\n') : item.text.trim()
      if (item.type === 'heading') {
        const level = typeof item.level === 'number' && Number.isInteger(item.level)
          ? Math.min(6, Math.max(1, item.level))
          : 2
        const inlines = normalizeArticleInlines(item.inlines, text)
        return [{ type: 'heading', level, text, ...(inlines ? { inlines } : {}), ...id }]
      }
      if (item.type === 'quote') {
        const inlines = normalizeArticleInlines(item.inlines, text)
        return [{ type: 'quote', text, ...(inlines ? { inlines } : {}), ...id }]
      }
      if (item.type === 'code') {
        const language = typeof item.language === 'string' && /^[A-Za-z0-9_+#.-]{1,32}$/.test(item.language)
          ? item.language
          : undefined
        return [{ type: 'code', ...(language ? { language } : {}), text, ...id }]
      }
      const inlines = normalizeArticleInlines(item.inlines, text)
      return [{ type: 'paragraph', text, ...(inlines ? { inlines } : {}), ...id }]
    }
    if (item.type === 'list') {
      if (!Array.isArray(item.items)) return []
      const items = item.items.filter((text): text is string => typeof text === 'string' && Boolean(text.trim())).map((text) => text.trim())
      if (!items.length) return []
      const itemInlines = normalizeArticleItemInlines(item.itemInlines, items)
      return [{ type: 'list', ordered: item.ordered === true, items, ...(itemInlines ? { itemInlines } : {}), ...id }]
    }
    if (item.type === 'image') {
      const src = typeof item.src === 'string' ? item.src.trim() : ''
      if (!isAllowedArticleImageSource(src)) return []
      return [{ type: 'image', src, alt: typeof item.alt === 'string' ? item.alt.trim() : '', ...id }]
    }
    if (item.type === 'chart') {
      const text = typeof item.text === 'string' ? item.text.trim() : ''
      if (!text) return []
      return [{ type: 'chart', text, alt: typeof item.alt === 'string' ? item.alt.trim() : '', ...id }]
    }
    if (item.type === 'divider') return [{ type: 'divider', ...id }]
    return []
  })

  return blocks.length ? blocks : articleBlocksFromText(fallbackText)
}

export function articleBlocksToText(blocks: ArticleBlock[]): string {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case 'list':
        return [block.items.join('\n')]
      case 'image':
        return block.alt ? [block.alt] : []
      case 'chart':
        return [block.text]
      case 'divider':
        return []
      default:
        return [block.text]
    }
  }).join('\n\n')
}

export function getArticleBlocks(text: string, blocks?: unknown): ArticleBlock[] {
  return normalizeArticleBlocks(blocks, text)
}

export function createTrainingArticleSnapshot(article: Pick<CaptureRecord, 'id' | 'title' | 'metadata' | 'author' | 'text' | 'blocks' | 'capturedAt'>): TrainingArticleSnapshot {
  const sourceBlocks = getArticleBlocks(article.text, article.blocks)
  const snapshotId = `snapshot-${stableHash(JSON.stringify([article.id, article.title, article.metadata, article.author, article.text, sourceBlocks]))}`
  const usedIds = new Set<string>()
  const blocks = sourceBlocks.map((block, index) => {
    const baseId = block.id?.trim() || `source-${stableHash(`${snapshotId}:${index}:${JSON.stringify(block)}`)}`
    let id = baseId
    let suffix = 2
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`
    usedIds.add(id)
    return { ...block, id }
  })
  return {
    id: snapshotId,
    title: article.title,
    metadataReview: initialMetadataReview(article),
    metadata: article.metadata ?? { subtitle: '', author: article.author ?? '', source: '' },
    text: article.text,
    blocks,
    capturedAt: article.capturedAt,
  }
}

export function articleInlineText(inlines: ArticleInline[] | undefined, fallback: string) {
  return inlines?.length ? inlines.map((inline) => inline.text).join('') : fallback
}

export type NumberedArticleParagraph = {
  paragraph: number
  text: string
  blockIndex: number
  itemIndex?: number
}

export function numberArticleBlocks(blocks: ArticleBlock[]): NumberedArticleParagraph[] {
  let paragraph = 0
  return blocks.flatMap((block, blockIndex) => {
    if (block.type === 'paragraph' || block.type === 'quote') {
      paragraph += 1
      return [{ paragraph, text: block.text, blockIndex }]
    }
    return []
  })
}

export function isAllowedArticleImageSource(source: string) {
  try {
    const url = new URL(source.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeArticleInlines(value: unknown, expectedText: string): ArticleInline[] | undefined {
  if (!Array.isArray(value)) return undefined
  const inlines = value.flatMap((item): ArticleInline[] => {
    if (!isRecord(item) || typeof item.text !== 'string' || !item.text) return []
    const emphasis = item.emphasis
    if (emphasis !== undefined && emphasis !== 'strong' && emphasis !== 'emphasis' && emphasis !== 'strong-emphasis') return []
    return [{ text: item.text, ...(emphasis ? { emphasis } : {}) }]
  })
  return inlines.length && articleInlineText(inlines, '') === expectedText ? inlines : undefined
}

function normalizeArticleItemInlines(value: unknown, expectedItems: string[]) {
  if (!Array.isArray(value) || value.length !== expectedItems.length) return undefined
  const itemInlines = value.map((item, index) => normalizeArticleInlines(item, expectedItems[index]))
  return itemInlines.every((inlines): inlines is ArticleInline[] => Boolean(inlines)) ? itemInlines : undefined
}

function normalizeBlockId(value: unknown): { id: string } | Record<string, never> {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,96}$/.test(value.trim())
    ? { id: value.trim() }
    : {}
}

function stableHash(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
