import type { CaptureRecord, SavedArticle } from '../types'

export function articleToMarkdown(article: CaptureRecord | SavedArticle) {
  const title = article.title.trim() || '未命名文章'
  const author = article.author?.trim()
  const frontmatter = [
    '---',
    `title: ${quoteYaml(title)}`,
    `source: ${quoteYaml(article.url)}`,
    ...(author ? [`author: ${quoteYaml(author)}`] : []),
    `capturedAt: ${quoteYaml(article.capturedAt)}`,
    ...(isSavedArticle(article)
      ? [`savedAt: ${quoteYaml(article.savedAt)}`, `favorite: ${article.isFavorite}`]
      : []),
    '---',
  ].join('\n')

  return `${frontmatter}\n\n# ${title}\n\n${article.text.trim()}\n`
}

function quoteYaml(value: string) {
  return JSON.stringify(value)
}

function isSavedArticle(article: CaptureRecord | SavedArticle): article is SavedArticle {
  return 'savedAt' in article
}

