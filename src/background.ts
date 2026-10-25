import type {
  CaptureRecord,
  ErrorCode,
  ExtensionError,
  ExtensionMessage,
  ExtensionResponse,
  SavedArticle,
  StorageState,
} from './types'
import {
  readSavedArticles,
  removeSavedArticle,
  toggleSavedArticleFavorite,
  upsertSavedArticle,
} from './storage/articles'

const TRAINING_PAGE = 'training.html'

type PageExtraction = {
  title: string
  url: string
  author?: string
  text: string
  selectedText?: string
  error?: {
    code: ErrorCode
    message: string
  }
}

type TrainingPageError = ExtensionError | undefined

function createError(
  code: ErrorCode,
  message: string,
): ExtensionResponse<never> {
  return { ok: false, error: { code, message } }
}

function success<T>(data: T): ExtensionResponse<T> {
  return { ok: true, data }
}

async function getStoredState(): Promise<StorageState> {
  return chrome.storage.local.get([
    'pendingCapture',
    'savedArticles',
    'lastTrainingTabId',
    'lastPrintTabId',
  ]) as Promise<StorageState>
}

async function captureCurrentPage(
  source: CaptureRecord['source'],
): Promise<ExtensionResponse<{ captureId: string }>> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined) {
    return createError('NO_ACTIVE_TAB', '没有找到当前活动标签页。')
  }

  let extraction: PageExtraction | undefined
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractArticleFromPage,
    })
    extraction = results[0]?.result as PageExtraction | undefined
  } catch {
    return createError(
      'PAGE_NOT_ACCESSIBLE',
      '当前页面不允许插件读取，请切换到普通网页后重试。',
    )
  }

  if (!extraction) {
    return createError('EXTRACTION_FAILED', '没有得到网页正文。')
  }
  if (extraction.error) {
    return createError(extraction.error.code, extraction.error.message)
  }

  const capture: CaptureRecord = {
    id: crypto.randomUUID(),
    title: extraction.title,
    url: extraction.url,
    ...(extraction.author ? { author: extraction.author } : {}),
    text: extraction.text,
    ...(extraction.selectedText ? { selectedText: extraction.selectedText } : {}),
    capturedAt: new Date().toISOString(),
    source,
  }

  try {
    await chrome.storage.local.set({ pendingCapture: capture })
  } catch {
    return createError('STORAGE_FAILED', '文章暂时无法保存到插件本地存储。')
  }

  return success({ captureId: capture.id })
}

async function openTrainingPage(
  error?: TrainingPageError,
): Promise<ExtensionResponse<{ tabId: number | undefined }>> {
  const state = await getStoredState()
  const trainingUrl = chrome.runtime.getURL(TRAINING_PAGE)
  const url = error
    ? `${trainingUrl}?error=${encodeURIComponent(error.message)}`
    : trainingUrl

  if (state.lastTrainingTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(state.lastTrainingTabId)
      await chrome.tabs.update(tab.id, { active: true, url })
      return success({ tabId: tab.id })
    } catch {
      await chrome.storage.local.remove('lastTrainingTabId')
    }
  }

  try {
    const tab = await chrome.tabs.create({ url })
    if (tab.id !== undefined) {
      await chrome.storage.local.set({ lastTrainingTabId: tab.id })
    }
    return success({ tabId: tab.id })
  } catch {
    return createError('EXTRACTION_FAILED', '无法打开插件训练页面。')
  }
}

async function captureAndOpen(
  source: CaptureRecord['source'],
): Promise<ExtensionResponse<{ captureId: string }>> {
  const result = await captureCurrentPage(source)
  if (!result.ok) {
    await openTrainingPage(result.error)
    return result
  }

  const openResult = await openTrainingPage()
  if (!openResult.ok) {
    return createError('EXTRACTION_FAILED', openResult.error.message)
  }
  return result
}

async function saveArticle(
  article: CaptureRecord,
): Promise<ExtensionResponse<SavedArticle>> {
  const text = article.text.trim()
  if (text.length < 20) {
    return createError('ARTICLE_TOO_SHORT', '正文至少需要 20 个字符。')
  }

  try {
    const previous = await readSavedArticles()
    const existing = previous.find((item) => item.id === article.id)
    const savedArticle: SavedArticle = {
      ...article,
      title: article.title.trim() || '未命名文章',
      text,
      isFavorite: existing?.isFavorite ?? false,
      savedAt: new Date().toISOString(),
    }
    await upsertSavedArticle(savedArticle)
    return success(savedArticle)
  } catch {
    return createError('STORAGE_FAILED', '文章保存失败，请稍后重试。')
  }
}

async function handleMessage(
  message: ExtensionMessage,
): Promise<ExtensionResponse<unknown>> {
  switch (message.type) {
    case 'capture-current-page':
      return captureAndOpen(message.source)
    case 'open-training-page':
      return openTrainingPage()
    case 'get-pending-capture': {
      const state = await getStoredState()
      return success(state.pendingCapture ?? null)
    }
    case 'clear-pending-capture':
      await chrome.storage.local.set({ pendingCapture: null })
      return success(null)
    case 'get-saved-articles': {
      return success(await readSavedArticles())
    }
    case 'open-saved-article': {
      const article = (await readSavedArticles()).find((item) => item.id === message.articleId)
      if (!article) {
        return createError('INVALID_REQUEST', '没有找到这篇本地文章。')
      }
      await chrome.storage.local.set({ pendingCapture: article })
      return openTrainingPage()
    }
    case 'open-print-article': {
      const article = (await readSavedArticles()).find((item) => item.id === message.articleId)
      if (!article) {
        return createError('INVALID_REQUEST', '没有找到这篇本地文章。')
      }
      await chrome.storage.local.set({ pendingCapture: article })
      return openPrintPage()
    }
    case 'delete-article':
      await removeSavedArticle(message.articleId)
      return success({ articleId: message.articleId })
    case 'toggle-favorite':
      return success(await toggleSavedArticleFavorite(message.articleId))
    case 'save-article':
      return saveArticle(message.article)
    default:
      return createError('INVALID_REQUEST', '无法识别插件请求。')
  }
}

async function openPrintPage(): Promise<ExtensionResponse<{ tabId: number | undefined }>> {
  const state = await getStoredState()
  const printUrl = chrome.runtime.getURL('print.html')

  if (state.lastPrintTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(state.lastPrintTabId)
      await chrome.tabs.update(tab.id, { active: true, url: printUrl })
      return success({ tabId: tab.id })
    } catch {
      await chrome.storage.local.remove('lastPrintTabId')
    }
  }

  try {
    const tab = await chrome.tabs.create({ url: printUrl })
    if (tab.id !== undefined) {
      await chrome.storage.local.set({ lastPrintTabId: tab.id })
    }
    return success({ tabId: tab.id })
  } catch {
    return createError('EXTRACTION_FAILED', '无法打开打印页面。')
  }
}

function extractArticleFromPage(): PageExtraction {
  const minSelectedTextLength = 40
  const minArticleTextLength = 120
  const maxArticleTextLength = 36_000
  const normalize = (value: string) =>
    value
      .replace(/\u00a0/g, ' ')
      .split(/\n+/)
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, maxArticleTextLength)

  const title = document.title.trim() || '未命名文章'
  const url = window.location.href
  const author = document
    .querySelector('meta[name="author"], meta[property="article:author"]')
    ?.getAttribute('content')
    ?.trim()
  const selectedText = normalize(window.getSelection()?.toString() ?? '')

  if (selectedText.length >= minSelectedTextLength) {
    return {
      title,
      url,
      ...(author ? { author } : {}),
      text: selectedText,
      selectedText,
    }
  }

  const selectors = ['article', 'main', '[role="main"]', 'body']
  let candidate: HTMLElement | null = null
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) {
      candidate = element
      break
    }
  }

  if (!candidate) {
    return {
      title,
      url,
      text: '',
      error: { code: 'EXTRACTION_FAILED', message: '没有找到可读取的正文区域。' },
    }
  }

  const clone = candidate.cloneNode(true) as HTMLElement
  clone
    .querySelectorAll('script, style, noscript, nav, aside, footer, form, header, svg')
    .forEach((element) => element.remove())
  const text = normalize(clone.innerText)

  if (text.length < minArticleTextLength) {
    return {
      title,
      url,
      ...(author ? { author } : {}),
      text,
      error: {
        code: 'ARTICLE_TOO_SHORT',
        message: '自动提取到的正文过短，请在训练页手动粘贴文章。',
      },
    }
  }

  return {
    title,
    url,
    ...(author ? { author } : {}),
    text,
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-and-open') {
    void captureAndOpen('shortcut').catch(() => undefined)
  }
})

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  void handleMessage(message)
    .then(sendResponse)
    .catch(() => sendResponse(createError('INVALID_REQUEST', '插件请求处理失败。')))
  return true
})

