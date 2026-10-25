import type {
  AiModelOption,
  AiSettings,
  ArticleBlock,
  ArticleInline,
  CaptureRecord,
  ErrorCode,
  ExtensionError,
  ExtensionMessage,
  ExtensionResponse,
  Locale,
  PreReadingPredictionDraft,
  SavedArticle,
  StorageState,
  TrainingSession,
} from './types'
import { getArticleBlocks, normalizeArticleBlocks, numberArticleBlocks } from './articles/format'
import {
  buildGradePrompt,
  buildStartPrompt,
  parseAiJson,
  validateAiFeedback,
  validateAiQuestion,
} from './ai/coach'
import {
  normalizeAiSettings,
  providerById,
  providerEndpoint,
} from './ai/providers'
import { withTimeout } from './ai/http'
import {
  readSavedArticles,
  removeSavedArticle,
  toggleSavedArticleFavorite,
  upsertSavedArticle,
} from './storage/articles'
import {
  commitTrainingFeedback,
  getTrainingSession,
  isLegacyTrainingSession,
  removeTrainingSession,
  resetTrainingSession,
  rewindTrainingSession,
  saveTrainingDraft,
  setTrainingQuestion,
  startTrainingSession,
} from './storage/training'
import { readAiSettings, writeAiSettings } from './storage/ai'
import { readLocale, writeLocale } from './storage/preferences'
import { translate } from './i18n/messages'
import { areThreeSentenceDraftsComplete, isLessonAnswerFormatValid, LESSON_STEPS, THREE_SENTENCE_ANSWER_MAX_LENGTH, TRAINING_ANSWER_MAX_LENGTH } from './training/lessons'

const TRAINING_PAGE = 'training.html'
const PRE_READING_PREDICTION_DRAFT_KEY = 'preReadingPredictionDraft'

type PageExtraction = {
  title: string
  url: string
  author?: string
  text: string
  blocks?: ArticleBlock[]
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

function localizeResponse(response: ExtensionResponse<unknown>, locale: Locale): ExtensionResponse<unknown> {
  if (response.ok) return response
  return {
    ok: false,
    error: {
      ...response.error,
      message: translate(locale, `error.${response.error.code}`),
    },
  }
}

async function getStoredState(): Promise<StorageState> {
  return chrome.storage.local.get([
    'pendingCapture',
    'savedArticles',
    'trainingSessions',
    'aiSettings',
    'lastTrainingTabId',
    'lastPrintTabId',
  ]) as Promise<StorageState>
}

async function getPreReadingPredictionDraft(): Promise<PreReadingPredictionDraft | null> {
  const stored = await chrome.storage.local.get(PRE_READING_PREDICTION_DRAFT_KEY) as StorageState
  const draft = stored.preReadingPredictionDraft
  if (!draft || typeof draft.value !== 'string' || typeof draft.updatedAt !== 'string') return null
  return {
    articleId: typeof draft.articleId === 'string' ? draft.articleId : null,
    value: draft.value.slice(0, 2_000),
    updatedAt: draft.updatedAt,
  }
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
  } catch (error) {
    if (isRestrictedPageError(error)) {
      const isWebPage = /^https?:\/\//i.test(tab.url ?? '')
      return createError(
        'PAGE_NOT_ACCESSIBLE',
        isWebPage
          ? '插件当前没有获得该网站的读取权限，请在扩展菜单中允许访问此网站后重试。'
          : '当前页面不允许插件读取（浏览器内部页、扩展页、商店页和部分 PDF 不支持）。请切换到普通网页，或手动粘贴文章。',
      )
    }
    return createError('EXTRACTION_FAILED', '读取当前网页失败，请重新加载扩展后重试。')
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
    ...(extraction.blocks ? { blocks: extraction.blocks } : {}),
    ...(extraction.selectedText ? { selectedText: extraction.selectedText } : {}),
    capturedAt: new Date().toISOString(),
    source,
  }

  try {
    await chrome.storage.local.set({ pendingCapture: capture })
    await chrome.storage.local.remove(PRE_READING_PREDICTION_DRAFT_KEY)
  } catch {
    return createError('STORAGE_FAILED', '文章暂时无法保存到插件本地存储。')
  }

  return success({ captureId: capture.id })
}

function isRestrictedPageError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('cannot access contents of the page') ||
    message.includes('extensions gallery') ||
    message.includes('chrome://') ||
    message.includes('chrome-extension://') ||
    message.includes('edge://') ||
    message.includes('file://') ||
    message.includes('pdf')
}

async function getActiveWindowId(): Promise<number | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab?.windowId
  } catch {
    return undefined
  }
}

async function closeSidePanel(windowId: number | undefined): Promise<void> {
  if (windowId === undefined || typeof chrome.sidePanel?.close !== 'function') return
  try {
    await chrome.sidePanel.close({ windowId })
  } catch {
    // Older browsers or an already-closed panel should not block training.
  }
}

async function openTrainingPage(
  error?: TrainingPageError,
): Promise<ExtensionResponse<{ tabId: number | undefined }>> {
  const state = await getStoredState()
  const sourceWindowId = await getActiveWindowId()
  const trainingUrl = chrome.runtime.getURL(TRAINING_PAGE)
  const url = error
    ? `${trainingUrl}?errorCode=${encodeURIComponent(error.code)}`
    : trainingUrl

  if (state.lastTrainingTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(state.lastTrainingTabId)
      await chrome.tabs.update(tab.id, { active: true, url })
      await closeSidePanel(sourceWindowId ?? tab.windowId)
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
    await closeSidePanel(sourceWindowId ?? tab.windowId)
    return success({ tabId: tab.id })
  } catch {
    return createError('EXTRACTION_FAILED', '无法打开插件训练页面。')
  }
}

async function openSettingsPage(): Promise<ExtensionResponse<{ tabId: number | undefined }>> {
  try {
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') })
    return success({ tabId: tab.id })
  } catch {
    return createError('EXTRACTION_FAILED', '无法打开插件设置页面。')
  }
}

async function openShortcutsPage(): Promise<ExtensionResponse<{ tabId: number | undefined }>> {
  const userAgent = globalThis.navigator?.userAgent ?? ''
  const url = userAgent.includes('Edg/')
    ? 'edge://extensions/shortcuts'
    : 'chrome://extensions/shortcuts'
  try {
    const tab = await chrome.tabs.create({ url })
    return success({ tabId: tab.id })
  } catch {
    return createError('SHORTCUTS_PAGE_FAILED', '无法打开快捷键设置页面。')
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
  if (text.length < 120 || text.length > 36_000) {
    return createError('ARTICLE_TOO_SHORT', '正文需要 120–36,000 个字符。')
  }

  try {
    const metadata = {
      subtitle: article.metadata?.subtitle?.trim() ?? '',
      author: article.metadata?.author?.trim() || article.author?.trim() || '',
      source: article.metadata?.source?.trim() ?? '',
    }
    const savedArticle: SavedArticle = {
      ...article,
      title: article.title.trim() || '未命名文章',
      text,
      metadata,
      ...(metadata.author ? { author: metadata.author } : {}),
      blocks: normalizeArticleBlocks(article.blocks, text),
      isFavorite: false,
      savedAt: new Date().toISOString(),
    }
    return success(await upsertSavedArticle(savedArticle))
  } catch {
    return createError('STORAGE_FAILED', '文章保存失败，请稍后重试。')
  }
}

async function testAiConnection(settings: AiSettings): Promise<ExtensionResponse<{ provider: string; model: string }>> {
  const locale = await readLocale()
  const normalized = normalizeAiSettings(settings)
  if (!normalized.apiKey) {
    return createError('AI_NOT_CONFIGURED', '请先填写 API key。')
  }
  const provider = providerById(normalized.provider)
  const endpoint = providerEndpoint(normalized)
  if (!endpoint) return createError('AI_INVALID_ENDPOINT', '请填写有效的 HTTPS Chat Completions endpoint。')
  try {
    const response = await withTimeout(TEST_CONNECTION_TIMEOUT_MS, (signal) => fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalized.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: normalized.model,
        messages: [{ role: 'user', content: '只回复 OK。' }],
        temperature: 0,
        max_tokens: 1,
      }),
      signal,
    }))
    if (!response.ok) {
      const detail = await providerResponseDetail(response)
      return createError('AI_CONNECTION_FAILED', `连接失败（HTTP ${response.status}）${detail ? `：${detail}` : '。请检查 API key 和模型名称。'}`)
    }
    return success({ provider: translate(locale, `provider.${provider.id}`), model: normalized.model })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return createError('AI_CONNECTION_FAILED', '测试连接超时，请检查服务地址和网络后重试。')
    }
    return createError('AI_CONNECTION_FAILED', '无法连接模型服务，请检查网络后重试。')
  }
}

type AiPrompt = {
  system: string
  user: string
  responseFormat?: Record<string, unknown>
}

const TEST_CONNECTION_TIMEOUT_MS = 15_000
const AI_REQUEST_TIMEOUT_MS = 90_000
const MODEL_REQUEST_TIMEOUT_MS = 10_000

async function requestAiJson(
  settings: AiSettings,
  prompt: AiPrompt,
): Promise<ExtensionResponse<unknown>> {
  const normalized = normalizeAiSettings(settings)
  if (!normalized.apiKey) {
    return createError('AI_NOT_CONFIGURED', '请先在插件设置中填写 API key。')
  }

  const endpoint = providerEndpoint(normalized)
  if (!endpoint) return createError('AI_INVALID_ENDPOINT', '请填写有效的 HTTPS Chat Completions endpoint。')

  try {
    const response = await withTimeout(AI_REQUEST_TIMEOUT_MS, (signal) => fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalized.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: normalized.model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: 0,
        max_tokens: 4_000,
        ...(normalized.provider === 'gemini' && prompt.responseFormat
          ? { reasoning_effort: 'low', response_format: prompt.responseFormat }
          : {}),
      }),
      signal,
    }))
    if (!response.ok) {
      return createError('AI_REQUEST_FAILED', `模型服务返回 HTTP ${response.status}，请检查模型名称和 API key。`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return createError('AI_RESPONSE_INVALID_JSON', '模型服务返回的内容不是有效 JSON。')
    }
    try {
      return success(parseAiJson(payload))
    } catch {
      return createError('AI_RESPONSE_INVALID_JSON', '模型服务没有返回符合要求的 JSON。')
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return createError('AI_REQUEST_FAILED', 'AI 请求超时，请稍后重试。')
    }
    return createError('AI_REQUEST_FAILED', '无法连接模型服务，请检查网络后重试。')
  }
}

type AiModelList = {
  models: AiModelOption[]
  source: 'provider' | 'fallback'
  warning?: string
}

async function listAiModels(settings: AiSettings): Promise<ExtensionResponse<AiModelList>> {
  const locale = await readLocale()
  const normalized = normalizeAiSettings(settings)
  const provider = providerById(normalized.provider)
  const endpoint = providerEndpoint(normalized)
  if (!endpoint) return createError('AI_INVALID_ENDPOINT', '请填写有效的 HTTPS Chat Completions endpoint。')
  const fallbackModels = normalized.model || provider.defaultModel
    ? [{ id: normalized.model || provider.defaultModel, label: normalized.model || provider.defaultModel }]
    : []
  const fallback: AiModelList = {
    models: fallbackModels,
    source: 'fallback',
  }
  if (!normalized.apiKey) {
    return success({ ...fallback, warning: translate(locale, 'ai.providerUnavailable', { provider: translate(locale, `provider.${provider.id}`) }) })
  }

  try {
    const payload = await withTimeout(
      MODEL_REQUEST_TIMEOUT_MS,
      (signal) => fetchModelPayload(provider.id, provider.id === 'custom' ? endpoint : provider.baseUrl, normalized.apiKey, signal),
    )
    const models = normalizeModelList(provider.id, payload)
    if (!models.length) return success({ ...fallback, warning: translate(locale, 'ai.modelsEmpty') })
    return success({ models, source: 'provider' })
  } catch (error) {
    const detail = error instanceof Error ? error.message : ''
    return success({
      ...fallback,
      warning: translate(locale, 'ai.modelsFetchFailed', { detail: detail ? ` (${detail})` : '' }),
    })
  }
}

async function fetchModelPayload(
  providerId: AiSettings['provider'],
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<unknown> {
  const headers: Record<string, string> = providerId === 'gemini'
    ? { 'x-goog-api-key': apiKey, Accept: 'application/json' }
    : { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  if (providerId !== 'qwen') {
    return readModelJson(await fetch(modelsUrl(providerId, baseUrl), { method: 'GET', headers, signal }))
  }

  const all: unknown[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY
  while (page <= 20 && all.length < total) {
    const url = modelsUrl(providerId, baseUrl)
    url.searchParams.set('page_no', String(page))
    const payload = await readModelJson(await fetch(url, { method: 'GET', headers, signal }))
    const items = rawModelItems(providerId, payload)
    all.push(...items)
    const output = isRecord(payload) && isRecord(payload.output) ? payload.output : null
    const reportedTotal = output ? Number(output.total) : Number.NaN
    total = Number.isFinite(reportedTotal) ? reportedTotal : all.length
    if (!items.length) break
    page += 1
  }
  return { output: { models: all } }
}

function modelsUrl(providerId: AiSettings['provider'], baseUrl: string) {
  if (providerId === 'custom') {
    const url = new URL(baseUrl)
    if (!/\/chat\/completions\/?$/i.test(url.pathname)) throw new Error('custom endpoint must end with /chat/completions')
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/i, '/models')
    return url
  }
  if (providerId === 'gemini') {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
    url.searchParams.set('pageSize', '100')
    return url
  }
  if (providerId === 'qwen') {
    const url = new URL(baseUrl)
    url.pathname = '/api/v1/models'
    url.search = ''
    url.searchParams.set('page_size', '100')
    return url
  }
  return new URL(`${baseUrl.replace(/\/+$/, '')}/models`)
}

async function readModelJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!response.ok) {
    const detail = extractProviderError(text)
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  if (text.length > 1_000_000) throw new Error('model list response too large')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('服务商模型列表不是有效 JSON')
  }
}

async function providerResponseDetail(response: Response) {
  try {
    return extractProviderError(await response.text())
  } catch {
    return ''
  }
}

function extractProviderError(text: string) {
  try {
    const payload: unknown = JSON.parse(text)
    if (!isRecord(payload)) return ''
    const error = isRecord(payload.error) ? payload.error : payload
    const message = error.message
    return typeof message === 'string' ? message.replace(/[\r\n]+/g, ' ').slice(0, 240) : ''
  } catch {
    return ''
  }
}

function rawModelItems(providerId: AiSettings['provider'], payload: unknown): unknown[] {
  if (!isRecord(payload)) return []
  if (providerId === 'qwen') return isRecord(payload.output) && Array.isArray(payload.output.models) ? payload.output.models : []
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.models)) return payload.models
  return []
}

function normalizeModelList(providerId: AiSettings['provider'], payload: unknown): AiModelOption[] {
  const seen = new Set<string>()
  const models: AiModelOption[] = []
  for (const item of rawModelItems(providerId, payload)) {
    if (!isRecord(item)) continue
    const rawId = item.id ?? item.model ?? item.baseModelId ?? item.name
    if (typeof rawId !== 'string' || !rawId.trim()) continue
    const id = rawId.trim().replace(/^models\//, '')
    if (!id || seen.has(id)) continue
    const supported = Array.isArray(item.supportedGenerationMethods)
      ? item.supportedGenerationMethods.filter((value): value is string => typeof value === 'string')
      : []
    if (providerId === 'gemini' && supported.length > 0 && !supported.includes('generateContent')) continue
    if ((providerId === 'gemini' || providerId === 'custom') && /(?:embedding|embed|image|imagen|banana|tts|transcrib|audio|live|veo|lyria|robotics|computer-use|deep-research|antigravity|\bagent\b|\baqa\b|whisper)/i.test(id)) continue
    seen.add(id)
    const created = Number(item.created)
    const publishedAt = typeof item.published_time === 'string' ? item.published_time : undefined
    models.push({
      id,
      label: String(item.displayName ?? item.name ?? id).slice(0, 160),
      ...(Number.isFinite(created) ? { created } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    })
  }
  return models.sort((left, right) => {
    const leftTime = left.created ?? (left.publishedAt ? Date.parse(left.publishedAt) : 0)
    const rightTime = right.created ?? (right.publishedAt ? Date.parse(right.publishedAt) : 0)
    return rightTime - leftTime
  })
}

async function getArticle(articleId: string): Promise<SavedArticle | null> {
  return (await readSavedArticles()).find((article) => article.id === articleId) ?? null
}

async function startAiTraining(articleId: string): Promise<ExtensionResponse<TrainingSession>> {
  const locale = await readLocale()
  const article = await getArticle(articleId)
  if (!article) return createError('INVALID_REQUEST', '没有找到这篇本地文章。')

  const session = await startTrainingSession(articleId, locale)
  if (session.currentStep === 0 || session.currentStep >= LESSON_STEPS.length) return success(session)
  if (isLegacyTrainingSession(session)) return trainingReadOnlyError(locale)
  const prompt = buildStartPrompt(article.text, article.title, article.metadata, session.currentStep, article.preReadingPrediction, locale, article.blocks)
  const completion = await requestAiJson(await readAiSettings(), prompt)
  if (!completion.ok) return createError(completion.error.code, completion.error.message)

  let question: string
  try {
    question = validateAiQuestion(completion.data)
  } catch {
    return createError('AI_QUESTION_INVALID', '模型服务返回的问题不符合训练格式。')
  }
  const updated = await setTrainingQuestion(articleId, question, locale)
  return updated ? success(updated) : createError('INVALID_REQUEST', '训练进度已不存在，请重新开始。')
}

async function gradeAiTraining(articleId: string): Promise<ExtensionResponse<TrainingSession>> {
  const locale = await readLocale()
  const article = await getArticle(articleId)
  if (!article) return createError('INVALID_REQUEST', '没有找到这篇本地文章。')

  const session = await getTrainingSession(articleId, locale)
  const legacyTurn = session?.turns.at(-1)
  const draft = session?.draft.trim() || (!legacyTurn?.feedback ? legacyTurn?.answer.trim() : '')
  if (!session || !draft) return createError('INVALID_REQUEST', '还没有可评分的回答。')
  if (isLegacyTrainingSession(session)) return trainingReadOnlyError(locale)

  const promptSession: TrainingSession = {
    ...session,
    draft,
    currentStep: session.draft.trim() ? session.currentStep : legacyTurn?.stepIndex ?? session.currentStep,
    currentQuestion: session.draft.trim() ? session.currentQuestion : legacyTurn?.question ?? session.currentQuestion,
  }
  if (!isTrainingAnswerValid(article, promptSession)) {
    return createError('TRAINING_ANSWER_FORMAT_INVALID', '回答没有满足当前训练步骤要求。')
  }
  const prompt = buildGradePrompt(article.text, article.title, article.metadata, promptSession, article.preReadingPrediction, locale, article.blocks)
  const completion = await requestAiJson(await readAiSettings(), prompt)
  if (!completion.ok) return createError(completion.error.code, completion.error.message)

  let feedback
  try {
    feedback = validateAiFeedback(completion.data, article.text, draft, article.blocks, promptSession.currentStep, locale)
  } catch {
    return createError('AI_FEEDBACK_INVALID', '模型服务返回的评分没有通过安全校验，请重试。')
  }
  const updated = await commitTrainingFeedback(articleId, feedback, locale)
  return updated ? success(updated) : createError('INVALID_REQUEST', '训练进度已不存在，请重新开始。')
}

async function prepareAiBridge(articleId: string): Promise<ExtensionResponse<{ requestId: string; prompt: string }>> {
  const locale = await readLocale()
  const article = await getArticle(articleId)
  const session = await getTrainingSession(articleId, locale)
  if (!article || !session || session.draft.trim().length < 5) {
    return createError('INVALID_REQUEST', '请先写下至少 5 个字符的独立回答。')
  }
  if (isLegacyTrainingSession(session)) return trainingReadOnlyError(locale)
  if (!isTrainingAnswerValid(article, session)) {
    return createError('TRAINING_ANSWER_FORMAT_INVALID', '回答没有满足当前训练步骤要求。')
  }

  const requestId = createBridgeRequestId(articleId, session)
  const prompt = buildGradePrompt(article.text, article.title, article.metadata, session, article.preReadingPrediction, locale, article.blocks)
  return success({
    requestId,
    prompt: `${prompt.system}\n\n${translate(locale, 'ai.bridgeInstruction', { requestId })}\n\n${translate(locale, 'ai.materialInstruction')}\n${prompt.user}`,
  })
}

async function importAiFeedback(
  articleId: string,
  requestId: string,
  raw: string,
): Promise<ExtensionResponse<TrainingSession>> {
  const locale = await readLocale()
  if (raw.length > 30_000) return createError('INVALID_REQUEST', '反馈为空或过长，请粘贴完整 JSON。')
  const article = await getArticle(articleId)
  const session = await getTrainingSession(articleId, locale)
  if (!article || !session) return createError('INVALID_REQUEST', '没有找到这次训练。')
  if (isLegacyTrainingSession(session)) return trainingReadOnlyError(locale)
  if (createBridgeRequestId(articleId, session) !== requestId) {
    return createError('INVALID_REQUEST', '这份反馈不属于当前回答，请重新复制本轮评分请求。')
  }
  if (!isTrainingAnswerValid(article, session)) {
    return createError('TRAINING_ANSWER_FORMAT_INVALID', '回答没有满足当前训练步骤要求。')
  }

  let payload: unknown
  try {
    const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    payload = JSON.parse(clean) as unknown
  } catch {
    return createError('AI_RESPONSE_INVALID_JSON', '无法读取 JSON，请只粘贴完整的评分反馈。')
  }
  if (!isRecord(payload) || payload.requestId !== requestId || !isRecord(payload.feedback)) {
    return createError('INVALID_REQUEST', '反馈 requestId 不匹配，或缺少 feedback 对象。')
  }

  let feedback
  try {
    feedback = validateAiFeedback(payload.feedback, article.text, session.draft.trim(), article.blocks, session.currentStep, locale)
  } catch {
    return createError('AI_FEEDBACK_INVALID', '反馈没有通过原文、回答和评分格式校验。')
  }
  const updated = await commitTrainingFeedback(articleId, feedback, locale)
  return updated ? success(updated) : createError('INVALID_REQUEST', '训练进度已不存在，请重新开始。')
}

function isTrainingAnswerValid(article: SavedArticle, session: TrainingSession) {
  const maxLength = session.currentStep === 2 ? THREE_SENTENCE_ANSWER_MAX_LENGTH : TRAINING_ANSWER_MAX_LENGTH
  if (session.draft.trim().length < 5 || session.draft.length > maxLength) return false
  if (session.currentStep === 2) {
    const paragraphNumbers = numberArticleBlocks(getArticleBlocks(article.text, article.blocks)).map(({ paragraph }) => paragraph)
    return areThreeSentenceDraftsComplete(session.threeSentenceDrafts ?? [], paragraphNumbers)
  }
  return isLessonAnswerFormatValid(session.currentStep, session.draft)
}

function createBridgeRequestId(articleId: string, session: TrainingSession) {
  const identity = JSON.stringify([articleId, session.flowId, session.currentStep, session.currentQuestion, session.draft.trim()])
  let hash = 14695981039346656037n
  for (const byte of new TextEncoder().encode(identity)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n)
  }
  return hash.toString(16).padStart(16, '0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function trainingReadOnlyError(locale: Locale): ExtensionResponse<never> {
  return createError('TRAINING_READ_ONLY', translate(locale, 'error.TRAINING_READ_ONLY'))
}

async function handleMessage(
  message: ExtensionMessage,
): Promise<ExtensionResponse<unknown>> {
  switch (message.type) {
    case 'capture-current-page':
      return captureAndOpen(message.source)
    case 'open-manual-paste-page':
      await chrome.storage.local.set({ pendingCapture: null })
      await chrome.storage.local.remove(PRE_READING_PREDICTION_DRAFT_KEY)
      return openTrainingPage()
    case 'open-settings':
      return openSettingsPage()
    case 'open-shortcuts':
      return openShortcutsPage()
    case 'get-locale':
      return success(await readLocale())
    case 'save-locale':
      return success(await writeLocale(message.locale))
    case 'get-pending-capture': {
      const state = await getStoredState()
      return success(state.pendingCapture ?? null)
    }
    case 'get-pre-reading-prediction-draft':
      return success(await getPreReadingPredictionDraft())
    case 'save-pre-reading-prediction-draft': {
      const draft: PreReadingPredictionDraft = {
        articleId: message.articleId ?? null,
        value: message.value.slice(0, 2_000),
        updatedAt: new Date().toISOString(),
      }
      await chrome.storage.local.set({ [PRE_READING_PREDICTION_DRAFT_KEY]: draft })
      return success(null)
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
      await removeTrainingSession(message.articleId, await readLocale())
      return success({ articleId: message.articleId })
    case 'toggle-favorite':
      return success(await toggleSavedArticleFavorite(message.articleId))
    case 'get-training-session':
      return success(await getTrainingSession(message.articleId, await readLocale()))
    case 'start-training-session':
      return success(await startTrainingSession(message.articleId, await readLocale()))
    case 'save-training-draft':
      try {
        const existing = await getTrainingSession(message.articleId, await readLocale())
        if (isLegacyTrainingSession(existing)) return trainingReadOnlyError(await readLocale())
        const session = await saveTrainingDraft(
          message.articleId,
          message.draft,
          await readLocale(),
          message.threeSentenceDrafts,
          message.paragraphCursor,
        )
        return session ? success(session) : createError('INVALID_REQUEST', '没有找到这次训练。')
      } catch (error) {
        return createError(
          'INVALID_REQUEST',
          error instanceof Error ? error.message : '草稿保存失败。',
        )
      }
    case 'rewind-training-session': {
      const existing = await getTrainingSession(message.articleId, await readLocale())
      if (isLegacyTrainingSession(existing)) return trainingReadOnlyError(await readLocale())
      const session = await rewindTrainingSession(message.articleId, await readLocale())
      return session ? success(session) : createError('INVALID_REQUEST', '没有可以回退的训练回合。')
    }
    case 'reset-training-session':
      await resetTrainingSession(message.articleId, await readLocale())
      return success(null)
    case 'get-ai-settings':
      return success(await readAiSettings())
    case 'save-ai-settings': {
      const settings = normalizeAiSettings(message.settings)
      await writeAiSettings(settings)
      return success(settings)
    }
    case 'list-ai-models':
      return listAiModels(message.settings)
    case 'test-ai-connection':
      return testAiConnection(message.settings)
    case 'ai-start':
      return startAiTraining(message.articleId)
    case 'ai-grade':
      return gradeAiTraining(message.articleId)
    case 'prepare-ai-bridge':
      return prepareAiBridge(message.articleId)
    case 'import-ai-feedback':
      return importAiFeedback(message.articleId, message.requestId, message.raw)
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
  const structured = readStructuredData()
  const normalize = (value: string) =>
    value
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, maxArticleTextLength)

  const metaContent = (selector: string) => document.querySelector(selector)?.getAttribute('content')?.trim() ?? ''
  const title = document.title.trim() || metaContent('meta[property="og:title"]') || structured.title || '未命名文章'
  const url = window.location.href
  const author = metaContent('meta[name="author"], meta[property="article:author"]') || structured.author
  const selectedText = normalize(window.getSelection()?.toString() ?? '')

  if (selectedText.length >= minSelectedTextLength) {
    const blocks = limitBlocks(textToBlocks(selectedText))
    return {
      title,
      url,
      ...(author ? { author } : {}),
      text: blocksToText(blocks),
      blocks,
      selectedText,
    }
  }

  const selectors: Array<[string, number]> = [
    ['#rm_txt_zw', 14_000],
    ['[itemprop="articleBody"]', 12_000],
    ['article', 10_000],
    ['.article-content, .article-body, .post-content, .entry-content, .article__content, .story-body', 7_000],
    ['main, [role="main"]', 5_000],
    ['#article, #content, #main-content, .content', 3_000],
    ['body', 0],
  ]
  const candidates = new Map<HTMLElement, number>()
  for (const [selector, weight] of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      candidates.set(element, Math.max(weight, candidates.get(element) ?? 0))
    })
  }
  document.querySelectorAll<HTMLElement>('div, section').forEach((element) => {
    const longParagraphCount = Array.from(element.querySelectorAll('p'))
      .filter((paragraph) => normalize(paragraph.innerText).length >= 40)
      .length
    if (longParagraphCount >= 2) candidates.set(element, Math.max(900, candidates.get(element) ?? 0))
  })

  let bestText = ''
  let bestBlocks: ArticleBlock[] = []
  let bestScore = Number.NEGATIVE_INFINITY
  for (const [candidate, weight] of candidates) {
    const clone = cleanClone(candidate)
    const blocks = extractBlocks(clone)
    const text = blocksToText(blocks) || normalize(clone.innerText)
    if (!text) continue
    const paragraphs = Array.from(clone.querySelectorAll('p'))
    const paragraphTextLength = paragraphs.reduce((total, paragraph) => total + normalize(paragraph.innerText).length, 0)
    const paragraphCount = paragraphs.filter((paragraph) => normalize(paragraph.innerText).length >= 40).length
    const sentenceCount = (text.match(/[。！？.!?]/g) ?? []).length
    const linkTextLength = Array.from(clone.querySelectorAll('a'))
      .reduce((total, link) => total + normalize(link.textContent ?? '').length, 0)
    const linkPenalty = Math.min(text.length, linkTextLength) * 1.4
    const nonParagraphTextLength = paragraphTextLength > 0 ? Math.max(0, text.length - paragraphTextLength) : 0
    const nonParagraphPenalty = nonParagraphTextLength * 1.2
    const paragraphDensity = paragraphTextLength / Math.max(text.length, 1)
    const score = weight + Math.min(paragraphTextLength || text.length, 24_000) + paragraphCount * 160 + sentenceCount * 8
      + paragraphDensity * 1_500 - linkPenalty - nonParagraphPenalty
    if (score > bestScore) {
      bestScore = score
      bestText = text
      bestBlocks = blocks
    }
  }

  const structuredText = normalize(structured.articleBody)
  const useStructuredText = structuredText.length >= minArticleTextLength && structuredText.length > bestText.length
  const text = useStructuredText ? structuredText : bestText
  const blocks = limitBlocks(useStructuredText
    ? preserveVisuals(textToBlocks(structuredText), bestBlocks)
    : bestBlocks)
  const normalizedText = blocksToText(blocks) || text.slice(0, maxArticleTextLength)

  if (normalizedText.length < minArticleTextLength) {
    return {
      title,
      url,
      ...(author ? { author } : {}),
      text: normalizedText,
      blocks,
      error: {
        code: 'ARTICLE_TOO_SHORT',
        message: '没有识别到足够长的正文，请先选择正文后重试，或在训练页手动粘贴文章。',
      },
    }
  }

  return {
    title,
    url,
    ...(author ? { author } : {}),
    text: normalizedText,
    blocks,
  }

  function textToBlocks(value: string): ArticleBlock[] {
    return value
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/)
      .map((text) => text.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').trim())
      .filter(Boolean)
      .map((text) => ({ type: 'paragraph', text }))
  }

  function blocksToText(blocks: ArticleBlock[]) {
    return blocks.flatMap((block) => {
      if (block.type === 'list') return [block.items.join('\n')]
      if (block.type === 'image') return block.alt ? [block.alt] : []
      if (block.type === 'chart') return [block.text]
      if (block.type === 'divider') return []
      return [block.text]
    }).join('\n\n').trim().slice(0, maxArticleTextLength)
  }

  function limitBlocks(blocks: ArticleBlock[]): ArticleBlock[] {
    let remaining = maxArticleTextLength
    const limited: ArticleBlock[] = []
    for (const block of blocks) {
      if (remaining <= 0) break
      if (block.type === 'image' || block.type === 'chart' || block.type === 'divider') {
        limited.push(block)
        continue
      }
      if (block.type === 'list') {
        const items: string[] = []
        for (const item of block.items) {
          if (remaining <= 0) break
          const value = item.slice(0, remaining)
          if (value) {
            items.push(value)
            remaining -= value.length
          }
        }
        if (items.length) limited.push({ ...block, items })
        continue
      }
      const text = block.text.slice(0, remaining)
      if (!text) break
      limited.push({ ...block, text })
      remaining -= text.length
    }
    return limited
  }

  function preserveVisuals(blocks: ArticleBlock[], fallbackBlocks: ArticleBlock[]) {
    const visuals = fallbackBlocks.filter((block) => block.type === 'image' || block.type === 'chart')
    if (!visuals.length) return blocks
    const preserved = [...blocks]
    for (const visual of visuals) {
      const visualText = visual.type === 'image' ? visual.alt : visual.text
      const captionIndex = visualText
        ? preserved.findIndex((block) => 'text' in block && block.text.includes(visualText))
        : -1
      if (captionIndex >= 0) preserved.splice(captionIndex, 0, visual)
      else preserved.push(visual)
    }
    return preserved
  }

  function extractBlocks(root: HTMLElement): ArticleBlock[] {
    const blocks: ArticleBlock[] = []
    const addText = (type: 'paragraph' | 'heading' | 'quote', value: string, level?: number) => {
      const text = value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').split(/\n+/).map((line) => line.trim()).filter(Boolean).join(type === 'quote' ? '\n' : ' ').trim()
      if (!text) return
      if (type === 'heading') blocks.push({ type, level: level ?? 2, text })
      else blocks.push({ type, text })
    }
    const addInlineText = (type: 'paragraph' | 'heading' | 'quote', element: Element, level?: number) => {
      const inlines = readInlineSegments(element, type === 'quote')
      const text = inlines.map((inline) => inline.text).join('').trim()
      if (!text) return
      if (type === 'heading') blocks.push({ type, level: level ?? 2, text, inlines })
      else blocks.push({ type, text, inlines })
    }
    const addChart = (chart: Element, figure?: Element) => {
      const descriptions = [
        chart.getAttribute('aria-label'),
        chart.getAttribute('title'),
        chart.querySelector('title')?.textContent,
        figure?.querySelector('figcaption')?.textContent,
        chart.tagName.toLowerCase() === 'svg' ? chart.textContent : '',
      ]
        .map((value) => (value ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
      const text = (descriptions.join('；') || '原文提供图表，但未提供可读取的图表说明。').slice(0, 600)
      blocks.push({ type: 'chart', text, alt: descriptions[0] ?? '原文图表' })
    }
    const visit = (element: Element) => {
      const tag = element.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        addInlineText('heading', element, Number(tag.slice(1)))
        return
      }
      if (tag === 'p') {
        addInlineText('paragraph', element)
        return
      }
      if (tag === 'blockquote') {
        addInlineText('quote', element)
        return
      }
      if (tag === 'svg' || tag === 'canvas') {
        addChart(element)
        return
      }
      if (tag === 'pre') {
        const text = (element.textContent ?? '').replace(/\r\n?/g, '\n').trim()
        if (text) {
          const code = element.querySelector('code')
          const language = Array.from(code?.classList ?? []).find((name) => name.startsWith('language-'))?.slice(9)
          blocks.push({ type: 'code', ...(language ? { language } : {}), text })
        }
        return
      }
      if (tag === 'ul' || tag === 'ol') {
        const itemElements = Array.from(element.children)
          .filter((child) => child.tagName.toLowerCase() === 'li')
        const listItems = itemElements.map((item) => {
            const clone = item.cloneNode(true) as HTMLElement
            clone.querySelectorAll('ul, ol').forEach((nested) => nested.remove())
            return {
              text: (clone.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim(),
              inlines: readInlineSegments(clone, false),
            }
          })
        const items = listItems.filter((item) => item.text)
        const itemInlines = items.map((item) => item.inlines)
        if (items.length) blocks.push({ type: 'list', ordered: tag === 'ol', items: items.map((item) => item.text), itemInlines })
        return
      }
      if (tag === 'figure') {
        const chart = element.querySelector('svg, canvas')
        if (chart) {
          addChart(chart, element)
          return
        }
        const image = element.querySelector('img')
        if (image) visit(image)
        const caption = element.querySelector('figcaption')
        if (caption) addText('paragraph', caption.textContent ?? '')
        return
      }
      if (tag === 'img') {
        const rawSrc = (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src
        try {
          const url = new URL(rawSrc, window.location.href)
          if (isAllowedImageSource(url)) {
            blocks.push({ type: 'image', src: url.href, alt: (element.getAttribute('alt') ?? '').trim() })
          }
        } catch {
          return
        }
        return
      }
      if (tag === 'hr') {
        blocks.push({ type: 'divider' })
        return
      }
      const children = Array.from(element.children)
      const hasBlockChildren = children.some((child) => /^(article|blockquote|div|figure|h[1-6]|li|main|ol|p|pre|section|ul|hr)$/i.test(child.tagName))
      if (!children.length || !hasBlockChildren) {
        addInlineText('paragraph', element)
        return
      }
      children.forEach(visit)
    }
    visit(root)
    return blocks

    function readInlineSegments(element: Element, preserveNewlines: boolean): ArticleInline[] {
      const segments: ArticleInline[] = []
      const visitNode = (node: Node, emphasis?: ArticleInline['emphasis']) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = (node.textContent ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(preserveNewlines ? /[ \t]+/g : /\s+/g, ' ')
          if (!text) return
          const previous = segments.at(-1)
          if (previous && previous.emphasis === emphasis) previous.text += text
          else segments.push({ text, ...(emphasis ? { emphasis } : {}) })
          return
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return
        const child = node as Element
        const tag = child.tagName.toLowerCase()
        if (tag === 'br') {
          const previous = segments.at(-1)
          if (previous && previous.emphasis === emphasis) previous.text += '\n'
          else segments.push({ text: '\n', ...(emphasis ? { emphasis } : {}) })
          return
        }
        const isStrong = tag === 'strong' || tag === 'b'
        const isEmphasis = tag === 'em' || tag === 'i'
        const nextEmphasis = isStrong && isEmphasis
          ? 'strong-emphasis'
          : isStrong
            ? emphasis === 'emphasis' ? 'strong-emphasis' : 'strong'
            : isEmphasis
              ? emphasis === 'strong' ? 'strong-emphasis' : 'emphasis'
              : emphasis
        child.childNodes.forEach((childNode) => visitNode(childNode, nextEmphasis))
      }
      element.childNodes.forEach((child) => visitNode(child))
      const normalized = segments
        .map((segment) => ({ ...segment, text: segment.text.replace(preserveNewlines ? /[ \t]+/g : /\s+/g, ' ') }))
        .filter((segment) => segment.text)
      const joined = normalized.map((segment) => segment.text).join('').trim()
      if (!joined) return []
      let remaining = joined
      return normalized.flatMap((segment) => {
        const text = segment.text.slice(Math.max(0, segment.text.length - remaining.length))
        remaining = remaining.slice(text.length)
        return text ? [{ ...segment, text }] : []
      })
    }

    function isAllowedImageSource(url: URL) {
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
    }
  }

  function cleanClone(element: HTMLElement) {
    const clone = element.cloneNode(true) as HTMLElement
    clone.querySelectorAll([
      'script', 'style', 'noscript', 'nav', 'aside', 'footer', 'form', 'header', 'button',
      'iframe', 'video', 'audio', '[aria-hidden="true"]', '[role="navigation"]',
      '[role="complementary"]', '[role="contentinfo"]',
      '[id*="nav" i]', '[class*="nav" i]', '[id*="header" i]', '[class*="header" i]',
      '[id*="footer" i]', '[class*="footer" i]', '[id*="breadcrumb" i]', '[class*="breadcrumb" i]',
      '.ad', '.ads', '.advertisement', '.advert', '.sidebar', '.comments', '.comment',
      '.related', '.share', '.social', '.newsletter', '.cookie', 'ins',
      '[data-testid*="ad" i]', '[aria-label*="advertisement" i]', '[class*="audio" i]', '[class*="listen" i]',
    ].join(',')).forEach((element) => element.remove())
    clone.querySelectorAll<HTMLElement>('div, section').forEach((element) => {
      if (element === clone) return
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
      const isAdvertisement = /^advertisement$/i.test(text)
      const isAudioPlayer = text.length < 320 && /narrated by/i.test(text) && /\d{1,2}:\d{2}/.test(text)
      if (isAdvertisement || isAudioPlayer) element.remove()
    })
    return clone
  }

  function readStructuredData() {
    let result = { title: '', author: '', articleBody: '' }
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed: unknown = JSON.parse(script.textContent ?? '')
        const entries = Array.isArray(parsed) ? parsed : [parsed]
        for (const entry of entries) {
          if (!isObject(entry)) continue
          const graph = Array.isArray(entry['@graph']) ? entry['@graph'] : [entry]
          for (const item of graph) {
            if (!isObject(item)) continue
            const articleBody = typeof item.articleBody === 'string' ? item.articleBody : ''
            const headline = typeof item.headline === 'string' ? item.headline : ''
            const rawAuthor = item.author
            const structuredAuthor = typeof rawAuthor === 'string'
              ? rawAuthor
              : isObject(rawAuthor) && typeof rawAuthor.name === 'string' ? rawAuthor.name : ''
            if (articleBody.length > result.articleBody.length) result = { ...result, articleBody }
            if (!result.title && headline) result = { ...result, title: headline }
            if (!result.author && structuredAuthor) result = { ...result, author: structuredAuthor }
          }
        }
      } catch {
        continue
      }
    }
    return result
  }

  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
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
    .then(async (response) => sendResponse(localizeResponse(response, await readLocale())))
    .catch(async () => sendResponse(localizeResponse(createError('INVALID_REQUEST', '插件请求处理失败。'), await readLocale())))
  return true
})

