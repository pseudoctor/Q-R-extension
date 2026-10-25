import type { SavedArticle, SavedArticleStore, StorageState } from '../types'
import { normalizeArticleBlocks } from '../articles/format'
import { createKeyedMutationQueue } from './mutation-queue'

export const SAVED_ARTICLES_KEY = 'savedArticles'
const runArticleMutation = createKeyedMutationQueue()

export function normalizeSavedArticleStore(value: unknown): SavedArticleStore {
  if (Array.isArray(value)) {
    return {
      version: 2,
      items: value.filter(isSavedArticle).map(withFavoriteDefault),
    }
  }

  if (isRecord(value) && (value.version === 1 || value.version === 2) && Array.isArray(value.items)) {
    return {
      version: 2,
      items: value.items.filter(isSavedArticle).map(withFavoriteDefault),
    }
  }

  return { version: 2, items: [] }
}

export async function readSavedArticles(): Promise<SavedArticle[]> {
  const stored = await chrome.storage.local.get(SAVED_ARTICLES_KEY) as StorageState
  return normalizeSavedArticleStore(stored.savedArticles).items
}

export async function writeSavedArticles(items: SavedArticle[]) {
  const store: SavedArticleStore = { version: 2, items }
  await chrome.storage.local.set({ [SAVED_ARTICLES_KEY]: store })
}

export async function upsertSavedArticle(article: SavedArticle) {
  return runArticleMutation(SAVED_ARTICLES_KEY, async () => {
    const previous = await readSavedArticles()
    const existing = previous.find((item) => item.id === article.id)
    const savedArticle = existing ? { ...article, isFavorite: existing.isFavorite } : article
    const withoutDuplicate = previous.filter((item) => item.id !== article.id)
    await writeSavedArticles([savedArticle, ...withoutDuplicate].slice(0, 100))
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
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.url === 'string' &&
    typeof value.text === 'string' &&
    typeof value.capturedAt === 'string' &&
    typeof value.source === 'string' &&
    typeof value.savedAt === 'string'
  )
}

function withFavoriteDefault(article: SavedArticle): SavedArticle {
  return {
    ...article,
    blocks: normalizeArticleBlocks(article.blocks, article.text),
    isFavorite: article.isFavorite === true,
  }
}

