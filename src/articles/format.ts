import type { ArticleBlock, ArticleInline } from '../types'

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
    if (item.type === 'paragraph' || item.type === 'heading' || item.type === 'quote' || item.type === 'code') {
      if (typeof item.text !== 'string' || !item.text.trim()) return []
      const text = item.type === 'code' ? item.text.replace(/\r\n?/g, '\n') : item.text.trim()
      if (item.type === 'heading') {
        const level = typeof item.level === 'number' && Number.isInteger(item.level)
          ? Math.min(6, Math.max(1, item.level))
          : 2
        const inlines = normalizeArticleInlines(item.inlines, text)
        return [{ type: 'heading', level, text, ...(inlines ? { inlines } : {}) }]
      }
      if (item.type === 'quote') {
        const inlines = normalizeArticleInlines(item.inlines, text)
        return [{ type: 'quote', text, ...(inlines ? { inlines } : {}) }]
      }
      if (item.type === 'code') {
        const language = typeof item.language === 'string' && /^[A-Za-z0-9_+#.-]{1,32}$/.test(item.language)
          ? item.language
          : undefined
        return [{ type: 'code', ...(language ? { language } : {}), text }]
      }
      const inlines = normalizeArticleInlines(item.inlines, text)
      return [{ type: 'paragraph', text, ...(inlines ? { inlines } : {}) }]
    }
    if (item.type === 'list') {
      if (!Array.isArray(item.items)) return []
      const items = item.items.filter((text): text is string => typeof text === 'string' && Boolean(text.trim())).map((text) => text.trim())
      if (!items.length) return []
      const itemInlines = normalizeArticleItemInlines(item.itemInlines, items)
      return [{ type: 'list', ordered: item.ordered === true, items, ...(itemInlines ? { itemInlines } : {}) }]
    }
    if (item.type === 'image') {
      const src = typeof item.src === 'string' ? item.src.trim() : ''
      if (!isAllowedArticleImageSource(src)) return []
      return [{ type: 'image', src, alt: typeof item.alt === 'string' ? item.alt.trim() : '' }]
    }
    if (item.type === 'chart') {
      const text = typeof item.text === 'string' ? item.text.trim() : ''
      if (!text) return []
      return [{ type: 'chart', text, alt: typeof item.alt === 'string' ? item.alt.trim() : '' }]
    }
    if (item.type === 'divider') return [{ type: 'divider' }]
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
