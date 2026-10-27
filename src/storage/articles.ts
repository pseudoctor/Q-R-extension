import type { SavedArticle, SavedArticleStore, StorageState } from '../types'
import { normalizeArticleBlocks } from '../articles/format'
import { createKeyedMutationQueue } from './mutation-queue'

export const SAVED_ARTICLES_KEY = 'savedArticles'
export const SAVED_ARTICLE_STORAGE_LIMITS = {
  items: 100,
  maxArticleBytes: 512_000,
  blocks: 256,
  maxBytes: 3_000_000,
  id: 200,
  title: 1_000,
  url: 4_000,
  text: 36_000,
  metadata: 1_000,
  author: 1_000,
  selection: 36_000,
  timestamp: 100,
} as const
const runArticleMutation = createKeyedMutationQueue()

export function normalizeSavedArticleStore(value: unknown): SavedArticleStore {
  if (Array.isArray(value)) {
    return {
      version: 2,
      items: limitSavedArticlesForStorage(value.filter(isSavedArticle).map(withFavoriteDefault)),
    }
  }

  if (isRecord(value) && (value.version === 1 || value.version === 2) && Array.isArray(value.items)) {
    return {
      version: 2,
      items: limitSavedArticlesForStorage(value.items.filter(isSavedArticle).map(withFavoriteDefault)),
    }
  }

  return { version: 2, items: [] }
}

export async function readSavedArticles(): Promise<SavedArticle[]> {
  const stored = await chrome.storage.local.get(SAVED_ARTICLES_KEY) as StorageState
  return normalizeSavedArticleStore(stored.savedArticles).items
}

export async function writeSavedArticles(items: SavedArticle[]) {
  const store: SavedArticleStore = { version: 2, items: limitSavedArticlesForStorage(items) }
  await chrome.storage.local.set({ [SAVED_ARTICLES_KEY]: store })
}

export function limitSavedArticlesForStorage(items: SavedArticle[]) {
  const normalized = items
    .slice(0, SAVED_ARTICLE_STORAGE_LIMITS.items)
    .map(trimSavedArticleForStorage)
  const kept = [...normalized]
  while (kept.length > 1 && estimateBytes({ version: 2, items: kept }) > SAVED_ARTICLE_STORAGE_LIMITS.maxBytes) {
    const index = kept.findLastIndex((item) => !item.isFavorite)
    kept.splice(index >= 0 ? index : kept.length - 1, 1)
  }
  return kept
}

export async function upsertSavedArticle(article: SavedArticle) {
  return runArticleMutation(SAVED_ARTICLES_KEY, async () => {
    const previous = await readSavedArticles()
    const existing = previous.find((item) => item.id === article.id)
    const savedArticle = existing ? { ...article, isFavorite: existing.isFavorite } : article
    const withoutDuplicate = previous.filter((item) => item.id !== article.id)
    await writeSavedArticles([savedArticle, ...withoutDuplicate])
    return savedArticle
  })
}

export async function removeSavedArticle(articleId: string) {
  await runArticleMutation(SAVED_ARTICLES_KEY, async () => {
    const previous = await readSavedArticles()
    await writeSavedArticles(previous.filter((item) => item.id !== articleId))
  })
}

export async function toggleSavedArticleFavorite(articleId: string) {
  return runArticleMutation(SAVED_ARTICLES_KEY, async () => {
    const previous = await readSavedArticles()
    const updated = previous.map((item) =>
      item.id === articleId ? { ...item, isFavorite: !item.isFavorite } : item,
    )
    await writeSavedArticles(updated)
    return updated.find((item) => item.id === articleId) ?? null
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSavedArticle(value: unknown): value is SavedArticle {
  if (!isRecord(value)) return false
  const metadata = value.metadata
  return (
    isBoundedString(value.id, SAVED_ARTICLE_STORAGE_LIMITS.id) &&
    typeof value.title === 'string' &&
    value.title.length <= SAVED_ARTICLE_STORAGE_LIMITS.title &&
    typeof value.url === 'string' &&
    value.url.length <= SAVED_ARTICLE_STORAGE_LIMITS.url &&
    typeof value.text === 'string' &&
    value.text.length <= SAVED_ARTICLE_STORAGE_LIMITS.text &&
    isBoundedString(value.capturedAt, SAVED_ARTICLE_STORAGE_LIMITS.timestamp) &&
    isBoundedString(value.source, 100) &&
    isBoundedString(value.savedAt, SAVED_ARTICLE_STORAGE_LIMITS.timestamp) &&
    (value.author === undefined || isBoundedString(value.author, SAVED_ARTICLE_STORAGE_LIMITS.author)) &&
    (value.preReadingPrediction === undefined || isBoundedString(value.preReadingPrediction, SAVED_ARTICLE_STORAGE_LIMITS.selection)) &&
    (value.selectedText === undefined || isBoundedString(value.selectedText, SAVED_ARTICLE_STORAGE_LIMITS.selection)) &&
    (metadata === undefined || isArticleMetadata(metadata)) &&
    (value.blocks === undefined || (Array.isArray(value.blocks) && value.blocks.length <= SAVED_ARTICLE_STORAGE_LIMITS.blocks))
  )
}

function withFavoriteDefault(article: SavedArticle): SavedArticle {
  return {
    ...article,
    blocks: normalizeArticleBlocks(article.blocks, article.text),
    isFavorite: article.isFavorite === true,
  }
}

function trimSavedArticleForStorage(article: SavedArticle): SavedArticle {
  const metadata = article.metadata
    ? {
      subtitle: article.metadata.subtitle.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.metadata),
      author: article.metadata.author.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.metadata),
      source: article.metadata.source.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.metadata),
      ...(article.metadata.date ? { date: article.metadata.date.slice(0, 100) } : {}),
    }
    : undefined
  const blocks = normalizeArticleBlocks(article.blocks, article.text).slice(0, SAVED_ARTICLE_STORAGE_LIMITS.blocks)
  const trimmed: SavedArticle = {
    ...article,
    id: article.id.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.id),
    title: article.title.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.title),
    url: article.url.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.url),
    text: article.text.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.text),
    capturedAt: article.capturedAt.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.timestamp),
    savedAt: article.savedAt.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.timestamp),
    ...(article.author ? { author: article.author.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.author) } : {}),
    ...(article.preReadingPrediction ? { preReadingPrediction: article.preReadingPrediction.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.selection) } : {}),
    ...(article.selectedText ? { selectedText: article.selectedText.slice(0, SAVED_ARTICLE_STORAGE_LIMITS.selection) } : {}),
    ...(metadata ? { metadata } : {}),
    blocks,
  }
  while (blocks.length > 0 && estimateBytes({ ...trimmed, blocks }) > SAVED_ARTICLE_STORAGE_LIMITS.maxArticleBytes) {
    blocks.pop()
  }
  return trimmed
}

function estimateBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function isArticleMetadata(value: unknown): value is NonNullable<SavedArticle['metadata']> {
  if (!isRecord(value)) return false
  return isBoundedString(value.subtitle, SAVED_ARTICLE_STORAGE_LIMITS.metadata) &&
    isBoundedString(value.author, SAVED_ARTICLE_STORAGE_LIMITS.metadata) &&
    isBoundedString(value.source, SAVED_ARTICLE_STORAGE_LIMITS.metadata) &&
    (value.date === undefined || isBoundedString(value.date, 100))
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

