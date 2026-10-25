import type { CaptureRecord, SavedArticle } from '../types'

export function articleToJson(article: CaptureRecord | SavedArticle) {
  return `${JSON.stringify(article, null, 2)}\n`
}

