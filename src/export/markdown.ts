import type { ArticleBlock } from '../types'

export function articleBlocksToMarkdown(blocks: ArticleBlock[]) {
  return blocks.map((block) => {
    if (block.type === 'heading') return `${'#'.repeat(block.level)} ${block.text}`
    if (block.type === 'paragraph') return escapeMarkdownBlock(block.text)
    if (block.type === 'quote') return block.text.split(/\n+/).map((line) => `> ${escapeMarkdownBlock(line)}`).join('\n')
    if (block.type === 'list') return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${escapeMarkdownBlock(item)}`).join('\n')
    if (block.type === 'code') {
      const fence = block.text.includes('```') ? '~~~' : '```'
      return `${fence}${block.language ?? ''}\n${block.text}\n${fence}`
    }
    if (block.type === 'image') return `![${block.alt.replace(/\]/g, '\\]')}](${block.src})`
    return '---'
  }).filter(Boolean).join('\n\n')
}

function escapeMarkdownBlock(value: string) {
  return value.trim().replace(/^([#>*+\-`])/gm, '\\$1')
}

