import type { ArticleBlock, ArticleInline } from '../types'

export function articleBlocksToMarkdown(blocks: ArticleBlock[]) {
  return blocks.map((block) => {
    if (block.type === 'heading') return `${'#'.repeat(block.level)} ${markdownInline(block.text, block.inlines)}`
    if (block.type === 'paragraph') return markdownInline(block.text, block.inlines)
    if (block.type === 'quote') return block.text.split(/\n+/).map((line) => `> ${markdownInline(line, block.inlines)}`).join('\n')
    if (block.type === 'list') return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${markdownInline(item, block.itemInlines?.[index])}`).join('\n')
    if (block.type === 'code') {
      const fence = block.text.includes('```') ? '~~~' : '```'
      return `${fence}${block.language ?? ''}\n${block.text}\n${fence}`
    }
    if (block.type === 'image') return `![${block.alt.replace(/\]/g, '\\]')}](${block.src})`
    if (block.type === 'chart') return `> 图表：${escapeMarkdownBlock(block.text || block.alt || '原文提供图表')}`
    return '---'
  }).filter(Boolean).join('\n\n')
}

function markdownInline(text: string, inlines?: ArticleInline[]) {
  if (!inlines?.length) return escapeMarkdownBlock(text)
  return inlines.map((inline) => {
    const value = escapeMarkdownBlock(inline.text)
    if (inline.emphasis === 'strong-emphasis') return `***${value}***`
    if (inline.emphasis === 'strong') return `**${value}**`
    if (inline.emphasis === 'emphasis') return `*${value}*`
    return value
  }).join('')
}

function escapeMarkdownBlock(value: string) {
  return value.trim().replace(/^([#>*+\-`])/gm, '\\$1')
}

