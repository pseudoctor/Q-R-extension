import type {
  AiModelOption,
  AiSettings,
  CaptureRecord,
  ErrorCode,
  ExtensionError,
  ExtensionMessage,
  ExtensionResponse,
  Locale,
  SavedArticle,
  StorageState,
  TrainingFieldAssist,
  TrainingSession,
} from './types'
import { createTrainingArticleSnapshot, getArticleBlocks, normalizeArticleBlocks, numberArticleBlocks } from './articles/format'
import {
  buildFieldAssistPrompt,
  buildGradePrompt,
  buildReferenceAnswerPrompt,
  buildStartPrompt,
  parseAiJson,
  validateAiFeedback,
  validateAiReferenceAnswer,
  validateAiQuestion,
} from './ai/coach'
import {
  isValidCustomEndpoint,
  normalizeAiSettings,
  providerById,
  providerEndpoint,
} from './ai/providers'
import { withResponseTimeout, withTimeout } from './ai/http'
import {
  readSavedArticles,
  removeSavedArticle,
  toggleSavedArticleFavorite,
  upsertSavedArticle,
} from './storage/articles'
import {
  commitTrainingFeedback,
  advanceTrainingSession,
  advanceTrainingSessionPartial,
  beginTrainingRequest,
  confirmTrainingStep,
  createTrainingRequestId,
  editTrainingTurn,
  reviseTrainingTurn,
  finishTrainingRequest,
  freezeTrainingAnswer,
  getTrainingHistory,
  getTrainingSession,
  isHistoricalTrainingSession,
  isLegacyTrainingSession,
  removeTrainingSession,
  resetTrainingSession,
  rewindTrainingSession,
  saveTrainingDraft,
  saveTrainingReinforcement,
  saveTrainingReferenceAnswer,
  setTrainingStep,
  setTrainingQuestion,
  startTrainingSession,
} from './storage/training'
import { readAiSettings, readAiSettingsView, writeAiSettings } from './storage/ai'
import { readLocale, readTestMode, writeLocale, writeTestMode } from './storage/preferences'
import { translate } from './i18n/messages'
import { isTrainingDraftNavigable, isTrainingDraftValid } from './training/lessons'
import { getLessonSteps, LESSON_STEPS, STRUCTURED_FIELD_DEFINITIONS } from './training/lessons'
import { hasAiHostPermission } from './permissions'
import { extractArticleFromPage, type PageExtraction } from './articles/extract'
import { isExtensionMessage } from './extension-message-validation'

const TRAINING_PAGE = 'training.html'
const AI_RATE_WINDOW_MS = 60_000
const AI_RATE_LIMIT = 20
const aiRequestTimestamps: number[] = []

type TrainingPageError = ExtensionError | undefined

function createError(
  code: ErrorCode,
  message: string,
  detail?: string,
): ExtensionResponse<never> {
  return { ok: false, error: { code, message, ...(detail ? { detail } : {}) } }
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
          ? '插件当前没有获得该页的一次性读取权限，请先点击扩展工具栏按钮或使用快捷键激活当前页后重试。'
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
  } catch (error) {
    return createError(isStorageQuotaError(error) ? 'STORAGE_QUOTA' : 'STORAGE_FAILED', '文章保存失败，请稍后重试。')
  }
}

async function testAiConnection(settings: AiSettings): Promise<ExtensionResponse<{ provider: string; model: string }>> {
  const locale = await readLocale()
  const normalized = await resolveAiSettings(settings)
  if (!normalized.apiKey) {
    return createError('AI_NOT_CONFIGURED', '请先填写 API key。')
  }
  if (!allowAiRequest()) return createError('AI_RATE_LIMITED', 'AI 请求过于频繁，请稍后再试。')
  const provider = providerById(normalized.provider)
  if (provider.id === 'custom' && !isValidCustomEndpoint(normalized.endpoint)) return createError('AI_INVALID_ENDPOINT', '请填写有效的 HTTPS Chat Completions endpoint。')
  const endpoint = providerEndpoint(normalized)
  if (!endpoint) return createError('AI_INVALID_ENDPOINT', '请填写有效的 HTTPS Chat Completions endpoint。')
  if (!(await hasAiHostPermission(endpoint))) return createError('AI_PERMISSION_REQUIRED', '请先允许模型服务的网络权限。')
  try {
    const response = await withTimeout(TEST_CONNECTION_TIMEOUT_MS, (signal) => fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalized.apiKey}`,
        'Content-Type': 'application/json',
      },
      redirect: 'error',
      body: JSON.stringify({
        model: normalized.model,
        messages: [{ role: 'user', content: '只回复 OK。' }],
        temperature: 0,
        max_tokens: 1,
      }),
      signal,
    }))
    if (!response.ok) {
      return createError('AI_CONNECTION_FAILED', `连接失败（HTTP ${response.status}）。请检查 API key 和模型名称。`)
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
  const normalized = await resolveAiSettings(settings)
  if (!normalized.apiKey) {
    return createError('AI_NOT_CONFIGURED', '请先在插件设置中填写 API key。')
  }
  if (!allowAiRequest()) return createError('AI_RATE_LIMITED', 'AI 请求过于频繁，请稍后再试。')

  if (normalized.provider === 'custom' && !isValidCustomEndpoint(normalized.endpoint)) return createError('AI_INVALID_ENDPOINT', '请填写有效的 HTTPS Chat Completions endpoint。')
  const endpoint = providerEndpoint(normalized)
  if (!endpoint) return createError('AI_INVALID_ENDPOINT', '请填写有效的 HTTPS Chat Completions endpoint。')
  if (!(await hasAiHostPermission(endpoint))) return createError('AI_PERMISSION_REQUIRED', '请先允许模型服务的网络权限。')

  try {
    return await withResponseTimeout(AI_REQUEST_TIMEOUT_MS, (signal) => fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalized.apiKey}`,
        'Content-Type': 'application/json',
      },
      redirect: 'error',
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
    }), async (response) => {
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
    })
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
  const normalized = await resolveAiSettings(settings)
  const provider = providerById(normalized.provider)
  if (provider.id === 'custom' && !isValidCustomEndpoint(normalized.endpoint)) return createError('AI_INVALID_ENDPOINT', '请填写有效的 HTTPS Chat Completions endpoint。')
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
  if (!allowAiRequest()) return createError('AI_RATE_LIMITED', 'AI 请求过于频繁，请稍后再试。')
  if (!(await hasAiHostPermission(endpoint))) return createError('AI_PERMISSION_REQUIRED', '请先允许模型服务的网络权限。')

  try {
    const payload = await withTimeout(
      MODEL_REQUEST_TIMEOUT_MS,
      (signal) => fetchModelPayload(provider.id, provider.id === 'custom' ? endpoint : provider.baseUrl, normalized.apiKey, signal),
    )
    const models = normalizeModelList(provider.id, payload)
    if (!models.length) return success({ ...fallback, warning: translate(locale, 'ai.modelsEmpty') })
    return success({ models, source: 'provider' })
  } catch {
    return success({
      ...fallback,
      warning: translate(locale, 'ai.modelsFetchFailed', { detail: '' }),
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
    return readModelJson(await fetch(modelsUrl(providerId, baseUrl), { method: 'GET', headers, signal, redirect: 'error' }))
  }

  const all: unknown[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY
  while (page <= 20 && all.length < total) {
    const url = modelsUrl(providerId, baseUrl)
    url.searchParams.set('page_no', String(page))
    const payload = await readModelJson(await fetch(url, { method: 'GET', headers, signal, redirect: 'error' }))
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

async function resolveAiSettings(settings: AiSettings) {
  const normalized = normalizeAiSettings(settings)
  if (normalized.apiKey) return normalized
  const stored = await readAiSettings()
  return { ...normalized, apiKey: stored.apiKey }
}

function allowAiRequest() {
  const now = Date.now()
  while (aiRequestTimestamps[0] !== undefined && now - aiRequestTimestamps[0] >= AI_RATE_WINDOW_MS) {
    aiRequestTimestamps.shift()
  }
  if (aiRequestTimestamps.length >= AI_RATE_LIMIT) return false
  aiRequestTimestamps.push(now)
  return true
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
    throw new Error(`HTTP ${response.status}`)
  }
  if (text.length > 1_000_000) throw new Error('model list response too large')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('服务商模型列表不是有效 JSON')
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

  const articleSnapshot = createTrainingArticleSnapshot(article)
  const session = await startTrainingSession(articleId, locale, articleSnapshot)
  if (session.currentStep >= LESSON_STEPS.length) return success(session)
  if (isLegacyTrainingSession(session) || isHistoricalTrainingSession(session)) return trainingReadOnlyError(locale)
  const prompt = buildStartPrompt(session.articleSnapshot?.text ?? article.text, session.articleSnapshot?.title ?? article.title, session.articleSnapshot?.metadata ?? article.metadata, session.currentStep, locale, trainingSourceBlocks(article, session))
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

async function gradeAiTraining(articleId: string, answerVersionId?: string, sessionId?: string): Promise<ExtensionResponse<TrainingSession>> {
  const locale = await readLocale()
  const article = await getArticle(articleId)
  if (!article) return createError('INVALID_REQUEST', '没有找到这篇本地文章。')

  const session = await getTrainingSession(articleId, locale)
  if (!session) return createError('INVALID_REQUEST', '还没有可评分的回答。')
  if (sessionId && sessionId !== session.sessionId) return createError('TRAINING_CONFLICT', '训练会话已变化。')
  if (isLegacyTrainingSession(session) || isHistoricalTrainingSession(session)) return trainingReadOnlyError(locale)
  const targetVersionId = answerVersionId ?? session.answerVersionId
  if (!targetVersionId) return createError('TRAINING_CONFLICT', '评分前需要先保存并冻结当前答案版本。')
  const frozen = session.answerVersions?.find((version) => version.id === targetVersionId)
  if (!frozen) return createError('TRAINING_CONFLICT', '没有找到冻结的答案版本。')
  if (frozen.feedback) return success(session)

  const promptSession: TrainingSession = {
    ...session,
    answerVersionId: targetVersionId,
    draft: frozen.answer,
    structuredDraft: frozen.structuredDraft,
    importantParagraphs: frozen.importantParagraphs,
    threeSentenceDrafts: frozen.threeSentenceDrafts,
    currentStep: frozen.stepIndex,
    currentStepId: frozen.stepId,
    currentQuestion: LESSON_STEPS[frozen.stepIndex]?.question ?? '',
  }
  const expectedAnswer = {
    sessionId: session.sessionId,
    draftRevision: session.draftRevision,
    draft: frozen.answer,
    answerVersionId: targetVersionId,
  }
  const requestId = createTrainingRequestId('grade', session.sessionId, promptSession.currentStepId, targetVersionId)
  const request = await beginTrainingRequest(articleId, {
    id: requestId,
    kind: 'grade',
    sessionId: session.sessionId ?? '',
    stepId: promptSession.currentStepId ?? '',
    answerVersionId: targetVersionId,
  }, locale)
  if (!request) return createError('TRAINING_CONFLICT', '评分请求对应的答案版本已不存在，请重新保存后再试。')
  if (!request.shouldRun) {
    if (request.request.status === 'succeeded') return success(request.session)
    if (request.request.status === 'stale') return createError('TRAINING_CONFLICT', '这次评分已过期，请使用当前答案重新提交。')
    return createError('TRAINING_CONFLICT', '这次评分请求正在处理中，请稍后查看结果。')
  }
  if (!isTrainingAnswerValid(article, promptSession, locale)) {
    await finishTrainingRequest(articleId, requestId, 'failed', locale, { code: 'TRAINING_ANSWER_FORMAT_INVALID', message: '回答没有满足当前训练步骤要求。' })
    return createError('TRAINING_ANSWER_FORMAT_INVALID', '回答没有满足当前训练步骤要求。')
  }
  const sourceBlocks = trainingSourceBlocks(article, promptSession)
  const prompt = buildGradePrompt(promptSession.articleSnapshot?.text ?? article.text, promptSession.articleSnapshot?.title ?? article.title, promptSession.articleSnapshot?.metadata ?? article.metadata, promptSession, locale, sourceBlocks)
  const completion = await requestAiJson(await readAiSettings(), prompt)
  if (!completion.ok) {
    await finishTrainingRequest(articleId, requestId, 'failed', locale, { code: completion.error.code, message: completion.error.message })
    return createError(completion.error.code, completion.error.message)
  }

  let feedback
  try {
    feedback = validateAiFeedback(completion.data, promptSession.articleSnapshot?.text ?? article.text, frozen.answer, sourceBlocks, promptSession.currentStep, locale, frozen.importantParagraphs)
  } catch {
    await finishTrainingRequest(articleId, requestId, 'failed', locale, { code: 'AI_FEEDBACK_INVALID', message: '模型服务返回的评分没有通过安全校验，请重试。' })
    return createError('AI_FEEDBACK_INVALID', '模型服务返回的评分没有通过安全校验，请重试。')
  }
  const updated = await commitTrainingFeedback(articleId, feedback, locale, expectedAnswer)
  if (!updated) {
    await finishTrainingRequest(articleId, requestId, 'stale', locale)
    return createError('TRAINING_CONFLICT', '回答在评分期间发生了变化，请重新保存后再评分。')
  }
  const completed = await finishTrainingRequest(articleId, requestId, 'succeeded', locale)
  return success(await getTrainingSession(articleId, locale) ?? completed ?? updated)
}

async function generateAiReferenceAnswer(articleId: string, submittedAt: string): Promise<ExtensionResponse<TrainingSession>> {
  const locale = await readLocale()
  const article = await getArticle(articleId)
  const session = await getTrainingSession(articleId, locale)
  if (!article || !session) return createError('INVALID_REQUEST', '没有找到这次训练。')
  if (isLegacyTrainingSession(session) || isHistoricalTrainingSession(session)) return trainingReadOnlyError(locale)

  const turn = session.turns.find((candidate) => candidate.submittedAt === submittedAt && candidate.feedback)
  if (!turn?.feedback) return createError('INVALID_REQUEST', '请先完成本轮评分，再生成参考答案。')
  if (turn.referenceAnswer) return success(session)

  const requestId = createTrainingRequestId('reference', session.sessionId, turn.stepId, turn.answerVersionId ?? submittedAt)
  const request = await beginTrainingRequest(articleId, {
    id: requestId,
    kind: 'reference',
    sessionId: session.sessionId ?? '',
    stepId: turn.stepId ?? `step-${turn.stepIndex}`,
    ...(turn.answerVersionId ? { answerVersionId: turn.answerVersionId } : {}),
  }, locale)
  if (!request) return createError('TRAINING_CONFLICT', '参考答案对应的答案版本已不存在，请重新评分。')
  if (!request.shouldRun) {
    if (request.request.status === 'succeeded') return success(request.session)
    if (request.request.status === 'stale') return createError('TRAINING_CONFLICT', '参考答案请求已过期，请重新评分。')
    return createError('TRAINING_CONFLICT', '参考答案请求正在处理中，请稍后查看结果。')
  }

  const completion = await requestAiJson(
    await readAiSettings(),
    buildReferenceAnswerPrompt(session.articleSnapshot?.text ?? article.text, session.articleSnapshot?.title ?? article.title, session.articleSnapshot?.metadata ?? article.metadata, turn, locale, trainingSourceBlocks(article, session)),
  )
  if (!completion.ok) {
    await finishTrainingRequest(articleId, requestId, 'failed', locale, { code: completion.error.code, message: completion.error.message })
    return createError(completion.error.code, completion.error.message)
  }

  let referenceAnswer
  try {
    referenceAnswer = validateAiReferenceAnswer(completion.data, session.articleSnapshot?.text ?? article.text, trainingSourceBlocks(article, session), { stepIndex: turn.stepIndex, importantParagraphs: turn.importantParagraphs })
  } catch (error) {
    await finishTrainingRequest(articleId, requestId, 'failed', locale, { code: 'AI_ANSWER_INVALID', message: '模型服务返回的参考答案没有通过原文依据校验，请重试。' })
    return createError(
      'AI_ANSWER_INVALID',
      '模型服务返回的参考答案没有通过原文依据校验，请重试。',
      error instanceof Error ? error.message : undefined,
    )
  }
  const updated = await saveTrainingReferenceAnswer(articleId, submittedAt, referenceAnswer, locale, { sessionId: session.sessionId, answerVersionId: turn.answerVersionId })
  if (!updated) {
    await finishTrainingRequest(articleId, requestId, 'stale', locale)
    return createError('TRAINING_CONFLICT', '参考答案保存时版本已变化，请重新打开该回合。')
  }
  const completed = await finishTrainingRequest(articleId, requestId, 'succeeded', locale)
  return success(await getTrainingSession(articleId, locale) ?? completed ?? updated)
}

async function generateAiFieldAssist(
  articleId: string,
  message: Extract<ExtensionMessage, { type: 'ai-field-assist' }>,
): Promise<ExtensionResponse<TrainingFieldAssist>> {
  const locale = await readLocale()
  const article = await getArticle(articleId)
  const session = await getTrainingSession(articleId, locale)
  if (!article || !session) return createError('INVALID_REQUEST', '没有找到这次训练。')
  if (isLegacyTrainingSession(session) || isHistoricalTrainingSession(session)) return trainingReadOnlyError(locale)
  if (session.sessionId !== message.sessionId || session.currentStepId !== message.stepId || (session.draftRevision ?? 0) !== message.draftRevision) {
    return createError('TRAINING_CONFLICT', '当前答案已经变化，请刷新后重新生成提示。')
  }
  const step = getLessonSteps(locale)[session.currentStep]
  const [baseFieldId, instanceId] = message.fieldId.split(':')
  const allowedField = step?.id === 'three-sentence'
    ? ['what', 'why', 'takeaway', 'role', 'evidence'].includes(baseFieldId) && !instanceId
    : step?.id === 'quick-browse'
      ? ['quickBrowse.structure'].includes(message.fieldId) || ['quickBrowse.paragraphLabels', 'quickBrowse.first', 'quickBrowse.last'].includes(baseFieldId) && Boolean(instanceId)
      : step?.id === 'three-points'
        ? /^threePoints\.point[1-3]$/.test(message.fieldId) || /^threePoints\.evidence\.(source|quote):[1-3]$/.test(message.fieldId) || (STRUCTURED_FIELD_DEFINITIONS[step.id] ?? []).some((field) => field.id === message.fieldId)
        : step?.id === 'questions'
          ? ['questions.category', 'questions.question', 'questions.relatedParagraphs', 'questions.whyImportant', 'questions.answered', 'questions.unanswered'].includes(baseFieldId) && Boolean(instanceId)
          : step?.id === 'preview'
            ? ['preview.metadata.status', 'preview.metadata.value'].includes(baseFieldId) && Boolean(instanceId) || (STRUCTURED_FIELD_DEFINITIONS[step.id] ?? []).some((field) => field.id === message.fieldId)
            : (STRUCTURED_FIELD_DEFINITIONS[step?.id ?? ''] ?? []).some((field) => field.id === message.fieldId)
  if (!step || !allowedField) return createError('INVALID_REQUEST', '找不到当前训练字段。')

  const sourceBlocks = trainingSourceBlocks(article, session)
  const prompt = buildFieldAssistPrompt(
    session.articleSnapshot?.text ?? article.text,
    session.articleSnapshot?.title ?? article.title,
    session.articleSnapshot?.metadata ?? article.metadata,
    { ...session, draft: message.draft, structuredDraft: message.structuredDraft, importantParagraphs: message.importantParagraphs, threeSentenceDrafts: message.threeSentenceDrafts, paragraphCursor: message.paragraphCursor },
    message.fieldId,
    message.mode,
    locale,
    sourceBlocks,
  )
  const completion = await requestAiJson(await readAiSettings(), prompt)
  if (!completion.ok) return createError(completion.error.code, completion.error.message)
  try {
    const answer = validateAiReferenceAnswer(completion.data, session.articleSnapshot?.text ?? article.text, sourceBlocks, { stepIndex: session.currentStep, importantParagraphs: session.importantParagraphs })
    return success({ fieldId: message.fieldId, mode: message.mode, answer: answer.answer, sources: answer.sources })
  } catch (error) {
    return createError('AI_ANSWER_INVALID', '模型服务返回的字段提示没有通过原文依据校验，请重试。', error instanceof Error ? error.message : undefined)
  }
}

function isTrainingAnswerValid(article: SavedArticle, session: TrainingSession, locale: Locale = 'zh-CN') {
  if (!isTrainingDraftValid(session, locale)) return false
  if (session.currentStep === 2) {
    const paragraphNumbers = numberArticleBlocks(trainingSourceBlocks(article, session)).map(({ paragraph }) => paragraph)
    return (session.importantParagraphs ?? []).every((paragraph) => paragraphNumbers.includes(paragraph))
  }
  return true
}

function trainingSourceBlocks(article: SavedArticle, session: TrainingSession) {
  return session.articleSnapshot?.blocks ?? getArticleBlocks(article.text, article.blocks)
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
      return openTrainingPage()
    case 'open-settings':
      return openSettingsPage()
    case 'open-shortcuts':
      return openShortcutsPage()
    case 'get-locale':
      return success(await readLocale())
    case 'save-locale':
      return success(await writeLocale(message.locale))
    case 'get-test-mode':
      return success(await readTestMode())
    case 'save-test-mode':
      return success(await writeTestMode(message.enabled === true))
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
      await removeTrainingSession(message.articleId, await readLocale())
      return success({ articleId: message.articleId })
    case 'toggle-favorite':
      return success(await toggleSavedArticleFavorite(message.articleId))
    case 'get-training-session':
      return success(await getTrainingSession(message.articleId, await readLocale()))
    case 'get-training-history':
      return success(await getTrainingHistory(message.articleId, await readLocale()))
    case 'start-training-session': {
      const locale = await readLocale()
      const article = await getArticle(message.articleId)
      return success(await startTrainingSession(
        message.articleId,
        locale,
        article ? createTrainingArticleSnapshot(article) : undefined,
      ))
    }
    case 'set-training-step': {
      const locale = await readLocale()
      const existing = await getTrainingSession(message.articleId, locale)
      if (isLegacyTrainingSession(existing) || isHistoricalTrainingSession(existing)) return trainingReadOnlyError(locale)
      if (!(await readTestMode())) {
        const targetStep = getLessonSteps(locale)[message.stepIndex]
        const targetIndex = Number.isFinite(message.stepIndex) ? Math.trunc(message.stepIndex) : -1
        if (!existing || targetIndex >= existing.currentStep || !targetStep || existing.stepRecords?.[targetStep.id]?.status !== 'draft') {
          return createError('INVALID_REQUEST', '只能打开已经保存但尚未完成的步骤。')
        }
      }
      const session = await setTrainingStep(message.articleId, message.stepIndex, locale, {
        sessionId: message.sessionId,
        draftRevision: message.draftRevision,
      })
      return session ? success(session) : createError('INVALID_REQUEST', '没有找到这次训练。')
    }
    case 'save-training-reinforcement': {
      const session = await saveTrainingReinforcement(message.articleId, message.id, message.answer, await readLocale(), message.sessionId)
      return session ? success(session) : createError('TRAINING_CONFLICT', '巩固记录保存失败，输入已保留，请检查会话和字数后重试。')
    }
    case 'save-training-draft':
      try {
        const existing = await getTrainingSession(message.articleId, await readLocale())
        if (isLegacyTrainingSession(existing) || isHistoricalTrainingSession(existing)) return trainingReadOnlyError(await readLocale())
        const session = await saveTrainingDraft(
          message.articleId,
          message.draft,
          await readLocale(),
          message.structuredDraft,
          message.importantParagraphs,
          message.threeSentenceDrafts,
          message.paragraphCursor,
          {
            sessionId: message.sessionId,
            stepId: message.stepId,
            draftRevision: message.draftRevision,
          },
        )
        return session ? success(session) : createError('TRAINING_CONFLICT', '训练记录已在其他标签页更新，请刷新后重试。')
      } catch (error) {
        return createError(
          'INVALID_REQUEST',
          error instanceof Error ? error.message : '草稿保存失败。',
        )
      }
    case 'freeze-training-answer': {
      const locale = await readLocale()
      const existing = await getTrainingSession(message.articleId, locale)
      if (isLegacyTrainingSession(existing) || isHistoricalTrainingSession(existing)) return trainingReadOnlyError(locale)
      const session = await freezeTrainingAnswer(message.articleId, locale, {
        sessionId: message.sessionId,
        stepId: message.stepId,
        draftRevision: message.draftRevision,
      })
      return session ? success(session) : createError('TRAINING_CONFLICT', '训练记录已在其他标签页更新，请刷新后重试。')
    }
    case 'confirm-training-step': {
      const locale = await readLocale()
      const existing = await getTrainingSession(message.articleId, locale)
      if (isLegacyTrainingSession(existing) || isHistoricalTrainingSession(existing)) return trainingReadOnlyError(locale)
      const session = await confirmTrainingStep(message.articleId, locale, {
        sessionId: message.sessionId,
        stepId: message.stepId,
        draftRevision: message.draftRevision,
      }, message.targetStepId)
      return session ? success(session) : createError('TRAINING_CONFLICT', '这一步的原答案已变化，请刷新后重新确认。')
    }
    case 'continue-training': {
      const locale = await readLocale()
      const existing = await getTrainingSession(message.articleId, locale)
      if (isLegacyTrainingSession(existing) || isHistoricalTrainingSession(existing)) return trainingReadOnlyError(locale)
      const article = await getArticle(message.articleId)
      if (!existing || !article || !isTrainingAnswerValid(article, existing, locale)) {
        return createError('TRAINING_ANSWER_FORMAT_INVALID', '回答没有满足当前训练步骤要求。')
      }
      if (!await readTestMode()) {
        const currentVersion = existing.answerVersionId
          ? existing.answerVersions?.find((version) => version.id === existing.answerVersionId)
          : undefined
        if (!currentVersion || currentVersion.stepId !== existing.currentStepId || !currentVersion.feedback) {
          return createError('TRAINING_AI_REQUIRED', '这一步需要先完成 AI 评分，评分失败不会丢失当前答案。')
        }
      }
      const session = await advanceTrainingSession(message.articleId, locale, {
        sessionId: message.sessionId,
        stepId: message.stepId,
        draftRevision: message.draftRevision,
        answerVersionId: message.answerVersionId,
      })
      return session ? success(session) : createError('TRAINING_CONFLICT', '训练记录已在其他标签页更新，请刷新后重试。')
    }
    case 'continue-training-partial': {
      const locale = await readLocale()
      const existing = await getTrainingSession(message.articleId, locale)
      if (isLegacyTrainingSession(existing) || isHistoricalTrainingSession(existing)) return trainingReadOnlyError(locale)
      if (!existing || !isTrainingDraftNavigable(existing, locale)) {
        return createError('TRAINING_ANSWER_FORMAT_INVALID', '请先填写至少一项有效内容后再继续，未完成字段可以稍后补充。')
      }
      const session = await advanceTrainingSessionPartial(message.articleId, locale, {
        sessionId: message.sessionId,
        stepId: message.stepId,
        draftRevision: message.draftRevision,
      })
      return session ? success(session) : createError('TRAINING_CONFLICT', '训练记录已在其他标签页更新，请刷新后重试。')
    }
    case 'rewind-training-session': {
      const existing = await getTrainingSession(message.articleId, await readLocale())
      if (isLegacyTrainingSession(existing) || isHistoricalTrainingSession(existing)) return trainingReadOnlyError(await readLocale())
      const session = await rewindTrainingSession(message.articleId, await readLocale())
      return session ? success(session) : createError('INVALID_REQUEST', '没有可以回退的训练回合。')
    }
    case 'revise-training-turn': {
      const locale = await readLocale()
      const existing = await getTrainingSession(message.articleId, locale)
      if (isLegacyTrainingSession(existing) || isHistoricalTrainingSession(existing)) return trainingReadOnlyError(locale)
      const article = await getArticle(message.articleId)
      const turn = existing?.turns[message.turnIndex]
      if (!existing || !turn || !article || !message.revision.reason.trim() || message.revision.reason.length > 1000 || !isTrainingAnswerValid(article, { ...existing, ...message.revision, draft: message.revision.answer, currentStep: turn.stepIndex, currentStepId: turn.stepId }, locale)) return createError('TRAINING_ANSWER_FORMAT_INVALID', '回答没有满足当前训练步骤要求。')
      const session = await reviseTrainingTurn(message.articleId, message.turnIndex, message.revision, locale, {
        sessionId: message.sessionId, draftRevision: message.draftRevision,
      })
      return session ? success(session) : createError('TRAINING_CONFLICT', '训练记录已在其他标签页更新，本地修改已保留。')
    }
    case 'edit-training-turn': {
      const locale = await readLocale()
      const existing = await getTrainingSession(message.articleId, locale)
      if (isLegacyTrainingSession(existing) || isHistoricalTrainingSession(existing)) return trainingReadOnlyError(locale)
      const session = await editTrainingTurn(message.articleId, message.turnIndex, locale, {
        sessionId: message.sessionId,
        draftRevision: message.draftRevision,
      })
      return session ? success(session) : createError('TRAINING_CONFLICT', '训练记录已在其他标签页更新，请刷新后重试。')
    }
    case 'reset-training-session': {
      const locale = await readLocale()
      const article = await getArticle(message.articleId)
      await resetTrainingSession(message.articleId, locale, article ? createTrainingArticleSnapshot(article) : undefined)
      return success(null)
    }
    case 'get-ai-settings':
      return success(await readAiSettingsView())
    case 'save-ai-settings': {
      const settings = normalizeAiSettings(message.settings)
      await writeAiSettings(settings, {
        preserveApiKey: message.preserveApiKey,
        clearApiKey: message.clearApiKey,
      })
      return success(await readAiSettingsView())
    }
    case 'list-ai-models':
      return listAiModels(message.settings)
    case 'test-ai-connection':
      return testAiConnection(message.settings)
    case 'ai-start':
      return startAiTraining(message.articleId)
    case 'ai-grade':
      return gradeAiTraining(message.articleId, message.answerVersionId, message.sessionId)
    case 'ai-reference-answer':
      return generateAiReferenceAnswer(message.articleId, message.submittedAt)
    case 'ai-field-assist':
      return generateAiFieldAssist(message.articleId, message)
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

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-and-open') {
    void captureAndOpen('shortcut').catch(() => undefined)
  }
})

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isTrustedExtensionSender(sender) || !isExtensionMessage(message)) {
    void readLocale().then((locale) => sendResponse(localizeResponse(createError('INVALID_REQUEST', '无法识别插件请求。'), locale)))
    return true
  }
  void handleMessage(message)
    .then(async (response) => sendResponse(localizeResponse(response, await readLocale())))
    .catch(async (error) => sendResponse(localizeResponse(createError(
      isStorageQuotaError(error) ? 'STORAGE_QUOTA' : 'INVALID_REQUEST',
      '插件请求处理失败。',
    ), await readLocale())))
  return true
})

function isTrustedExtensionSender(sender: chrome.runtime.MessageSender) {
  const extensionId = chrome.runtime.id
  const extensionUrl = typeof chrome.runtime.getURL === 'function' ? chrome.runtime.getURL('') : ''
  return Boolean(extensionId && sender.id === extensionId && (!extensionUrl || !sender.url || sender.url.startsWith(extensionUrl)))
}

function isStorageQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('quota') || message.includes('storage') && message.includes('size')
}

