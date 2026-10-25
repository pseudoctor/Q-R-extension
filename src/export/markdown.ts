import type { ArticleBlock, CaptureRecord, SavedArticle } from '../types'
import { getArticleBlocks } from '../articles/format'

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

export function articleToMarkdown(article: CaptureRecord | SavedArticle) {
  const title = article.title.trim() || '未命名文章'
  const metadata = article.metadata ?? {
    subtitle: '',
    author: article.author?.trim() ?? '',
    source: '',
  }
  const frontmatter = [
    '---',
    `title: ${quoteYaml(title)}`,
    `subtitle: ${quoteYaml(metadata.subtitle)}`,
    `author: ${quoteYaml(metadata.author)}`,
    `source: ${quoteYaml(metadata.source)}`,
    `url: ${quoteYaml(article.url)}`,
    `capturedAt: ${quoteYaml(article.capturedAt)}`,
    ...(isSavedArticle(article)
      ? [`savedAt: ${quoteYaml(article.savedAt)}`, `favorite: ${article.isFavorite}`]
      : []),
    '---',
  ].join('\n')

  return `${frontmatter}\n\n# ${title}\n\n${articleBlocksToMarkdown(getArticleBlocks(article.text, article.blocks))}\n`
}

function escapeMarkdownBlock(value: string) {
  return value.trim().replace(/^([#>*+\-`])/gm, '\\$1')
}

function quoteYaml(value: string) {
  return JSON.stringify(value)
}

function isSavedArticle(article: CaptureRecord | SavedArticle): article is SavedArticle {
  return 'savedAt' in article
}

