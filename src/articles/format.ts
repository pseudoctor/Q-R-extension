import type { ArticleBlock } from '../types'

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
        return [{ type: 'heading', level, text }]
      }
      if (item.type === 'quote') return [{ type: 'quote', text }]
      if (item.type === 'code') {
        const language = typeof item.language === 'string' && /^[A-Za-z0-9_+#.-]{1,32}$/.test(item.language)
          ? item.language
          : undefined
        return [{ type: 'code', ...(language ? { language } : {}), text }]
      }
      return [{ type: 'paragraph', text }]
    }
    if (item.type === 'list') {
      if (!Array.isArray(item.items)) return []
      const items = item.items.filter((text): text is string => typeof text === 'string' && Boolean(text.trim())).map((text) => text.trim())
      if (!items.length) return []
      return [{ type: 'list', ordered: item.ordered === true, items }]
    }
    if (item.type === 'image') {
      const src = typeof item.src === 'string' ? item.src.trim() : ''
      if (!/^https?:\/\//i.test(src)) return []
      return [{ type: 'image', src, alt: typeof item.alt === 'string' ? item.alt.trim() : '' }]
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
