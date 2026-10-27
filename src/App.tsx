import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trainingAverageScore, trainingEditPreview, canRetryTrainingDraft, acceptDraftSaveResponse, mergeTrainingFeedback } from './training/state'
import type { TrainingTurn } from './types'
import type {
  CaptureRecord,
  AiSettings,
  AiModelOption,
  AiFeedback,
  AiReferenceAnswer,
  ArticleBlock,
  ArticleInline,
  ExtensionError,
  ExtensionMessage,
  ExtensionResponse,
  ErrorCode,
  SavedArticle,
  TrainingSession,
  TrainingFieldAssist,
  TrainingFieldAssistMode,
  TrainingDraftFieldId,
  TrainingStructuredDraft,
} from './types'
import { getArticleBlocks, numberArticleBlocks } from './articles/format'
import {
  AI_PROVIDERS,
  defaultAiSettings,
  isValidCustomEndpoint,
  providerById,
  providerEndpoint,
} from './ai/providers'
import {
  buildObsidianUrl,
  buildReadingExportModel,
  generateReadingJson,
  generateReadingMarkdown,
  generateReadingPdfHtml,
  sanitizeFilename,
} from './export/reading'
import { areThreeSentenceDraftsComplete, formatThreeSentenceAnswer, getLessonSteps, isLessonAnswerFormatValid, isStructuredDraftComplete, LESSON_STEPS, STRUCTURED_ANSWER_MAX_LENGTH, structuredFieldsForStep, STRUCTURED_FIELD_DEFINITIONS, THREE_SENTENCE_ANSWER_MAX_LENGTH, TRAINING_ANSWER_MAX_LENGTH } from './training/lessons'
import { useI18n } from './i18n/context'
import { detectLocale } from './i18n/types'
import { translate } from './i18n/messages'
import './App.css'
import { effectiveTrainingTurns, trainingProgress, reviewDraftFromResults, initialImportantParagraphs } from './training/state'
import { createBrowseRows, readBrowseRows, PARAGRAPH_ROLES } from './training/browse'
import { readQuestions, formatQuestions, QUESTION_CATEGORIES, type ReadingQuestion } from './training/questions'
import { initialMetadataReview, emptySummaryEvidence, formatMetadataReview, readSummaryEvidence } from './training/evidence'
import { MetadataReviewForm, SummaryEvidenceForm } from './training/EvidenceForms'
import { isTrainingDraftNavigable, isTrainingDraftValid, structuredFieldLimit, summaryPointLength, requiredFieldsForDraft } from './training/lessons'
import { FieldAssist } from './training/FieldAssist'

const extensionAvailable =
  typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)

const LOCALE_SHORT_LABELS = {
  'zh-CN': '中',
  en: 'EN',
  ja: '日',
  ko: '한',
} as const

async function sendExtensionMessage<T>(
  message: ExtensionMessage,
): Promise<ExtensionResponse<T>> {
  if (!extensionAvailable) {
    return {
      ok: false,
      error: {
        code: 'PAGE_NOT_ACCESSIBLE',
        message: translate(detectLocale(), 'common.pageAccessible'),
      },
    }
  }

  return chrome.runtime.sendMessage(message) as Promise<ExtensionResponse<T>>
}

function errorMessage(error: ExtensionError) {
  return `${error.message}${error.detail ? ` ${error.detail}` : ''}（${error.code}）`
}

function App() {
  const isTrainingPage = window.location.pathname.endsWith('training.html')
  const isPrintPage = window.location.pathname.endsWith('print.html')
  const isSettingsPage = window.location.pathname.endsWith('settings.html')

  if (isPrintPage) return <PrintPage />
  if (isSettingsPage) return <SettingsPage />
  return isTrainingPage ? <TrainingPage /> : <SidePanel />
}

function SidePanel() {
  const { t, locale, localeOptions, setLocale } = useI18n()
  const [articles, setArticles] = useState<SavedArticle[]>([])
  const [sessions, setSessions] = useState<Record<string, TrainingSession>>({})
  const [status, setStatusValue] = useState(() => ({ text: '', locale }))
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [view, setView] = useState<'library' | 'growth'>('library')
  const [filter, setFilter] = useState<'all' | 'favorite' | 'in-progress' | 'completed'>('all')

  const setStatus = (text: string) => setStatusValue({ text, locale })
  const statusText = status.locale === locale ? status.text : ''

  const loadArticles = useCallback(async () => {
    const response = await sendExtensionMessage<SavedArticle[]>({
      type: 'get-saved-articles',
    })
    if (response.ok) {
      // This is the async result of the storage synchronization effect.
      // oxlint-disable-next-line react(set-state-in-effect)
      setArticles(response.data)
      const entries = await Promise.all(response.data.map(async (article) => {
        const sessionResponse = await sendExtensionMessage<TrainingSession | null>({
          type: 'get-training-session',
          articleId: article.id,
        })
        return sessionResponse.ok && sessionResponse.data ? [article.id, sessionResponse.data] as const : null
      }))
      setSessions(Object.fromEntries(entries.filter((entry): entry is readonly [string, TrainingSession] => entry !== null)))
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadArticles()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadArticles])

  const filteredArticles = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase()
    return articles.filter((article) => {
      const session = sessions[article.id]
      const matchesFilter =
        filter === 'all' ||
        (filter === 'favorite' && article.isFavorite) ||
        (filter === 'in-progress' && Boolean(session && !trainingProgress(session).isComplete)) ||
        (filter === 'completed' && trainingProgress(session).isComplete)
      if (!matchesFilter) return false
      if (!query) return true
      return [article.title, article.author, article.metadata?.subtitle, article.metadata?.author, article.metadata?.source, article.url, article.text]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query))
    })
  }, [articles, filter, searchTerm, sessions])

  const growthStats = useMemo(() => {
    const formalSessions = Object.values(sessions).filter((session) => !session.isTest)
    const allTurns = formalSessions.flatMap((session) => effectiveTrainingTurns(session))
    const scoredTurns = allTurns.filter((turn) => turn.feedback)
    const dimensionTotals = scoredTurns.reduce<Record<string, { total: number; count: number }>>((totals, turn) => {
      if (!turn.feedback) return totals
      for (const [dimension, result] of Object.entries(turn.feedback.dimensions)) {
        if (typeof result.score !== 'number') continue
        const current = totals[dimension] ?? { total: 0, count: 0 }
        totals[dimension] = { total: current.total + result.score, count: current.count + 1 }
      }
      return totals
    }, {})
    return {
      articleCount: articles.length,
      completedCount: formalSessions.filter((session) => session.courseVersion === 'guided-reading-10-v1' && trainingProgress(session).isComplete).length,
      turnCount: allTurns.length,
      average: scoredTurns.length === 0
        ? null
        : scoredTurns.reduce((sum, turn) => sum + (turn.feedback?.total ?? 0), 0) / scoredTurns.length,
      dimensions: ['fidelity', 'claim', 'cause', 'structure'].map((dimension) => {
        const value = dimensionTotals[dimension]
        return { dimension, average: value && value.count > 0 ? value.total / value.count : null }
      }),
    }
  }, [articles.length, sessions])

  const captureCurrentPage = async () => {
    setLoading(true)
    setStatus(t('side.statusReading'))
    const response = await sendExtensionMessage<{ captureId: string }>({
      type: 'capture-current-page',
      source: 'side-panel',
    })
    setLoading(false)
    if (response.ok) {
      setStatus(t('side.statusCaptured'))
      return
    }
    setStatus(errorMessage(response.error))
  }

  const openManualPastePage = async () => {
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({
      type: 'open-manual-paste-page',
    })
    setStatus(response.ok ? t('side.statusManualOpened') : errorMessage(response.error))
  }

  const openSavedArticle = async (articleId: string) => {
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({
      type: 'open-saved-article',
      articleId,
    })
    setStatus(response.ok ? t('side.statusArticleOpened') : errorMessage(response.error))
  }

  const deleteArticle = async (articleId: string) => {
    if (!window.confirm(t('side.confirmDelete'))) return
    const response = await sendExtensionMessage<{ articleId: string }>({
      type: 'delete-article',
      articleId,
    })
    if (response.ok) {
      setStatus(t('side.statusDeleted'))
      await loadArticles()
      return
    }
    setStatus(errorMessage(response.error))
  }

  const toggleFavorite = async (articleId: string) => {
    const response = await sendExtensionMessage<SavedArticle | null>({
      type: 'toggle-favorite',
      articleId,
    })
    if (response.ok) {
      await loadArticles()
      return
    }
    setStatus(errorMessage(response.error))
  }

  const exportArticle = async (article: SavedArticle, format: 'markdown' | 'json' | 'obsidian') => {
    const model = buildReadingExportModel(article, sessions[article.id], locale)
    if (format === 'obsidian') {
      const markdown = generateReadingMarkdown(model)
      const obsidian = buildObsidianUrl(markdown, { title: article.title })
      if (obsidian.useClipboard) {
        if (!navigator.clipboard?.writeText) {
          setStatus(t('side.exportClipboardTooLong'))
          return
        }
        try {
          await navigator.clipboard.writeText(markdown)
        } catch {
          setStatus(t('side.exportClipboardFailed'))
          return
        }
      }
      window.open(obsidian.url, '_blank', 'noopener,noreferrer')
      setStatus(obsidian.useClipboard ? t('side.exportObsidianCopied') : t('side.exportObsidianRequested'))
      return
    }
    const content = format === 'markdown' ? generateReadingMarkdown(model) : generateReadingJson(model)
    const extension = format === 'markdown' ? 'md' : 'json'
    downloadText(content, sanitizeFilename(article.title, extension, locale), format === 'markdown' ? 'text/markdown' : 'application/json')
    setStatus(t('side.exportSuccess', { format: format === 'markdown' ? 'Markdown' : 'JSON' }))
  }

  const printArticle = async (articleId: string) => {
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({
      type: 'open-print-article',
      articleId,
    })
    setStatus(response.ok ? t('side.printOpened') : errorMessage(response.error))
  }

  return (
    <main className="app-shell side-panel-shell">
      <header className="brand-header">
        <div className="brand-identity">
          <img className="brand-logo" src="/icons/icon32.png" alt="" aria-hidden="true" />
          <h1>{t('common.productName')}</h1>
        </div>
        <div className="header-actions">
          <button className="icon-button" type="button" onClick={() => void sendExtensionMessage({ type: 'open-settings' })} aria-label={t('side.settingsAria')} title={t('side.settingsTitle')}>⚙</button>
          <details className="locale-menu">
            <summary className="locale-button" aria-label={t('settings.language')} title={t('settings.language')}>
              {LOCALE_SHORT_LABELS[locale]}
            </summary>
            <div className="locale-menu-list" role="menu">
              {localeOptions.map((option) => (
                <button
                  className={locale === option.value ? 'active' : undefined}
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={locale === option.value}
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open')
                    void setLocale(option.value)
                  }}
                >
                  <span>{option.label}</span>
                  {locale === option.value && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          </details>
        </div>
      </header>

      <details className="quick-start">
        <summary>{t('side.quickStart')}</summary>
        <ol>
          <li>
            <strong>{t('side.quick.configTitle')}</strong>
            <span>{t('side.quick.configBody')}</span>
          </li>
          <li>
            <strong>{t('side.quick.captureTitle')}</strong>
            <span>{t('side.quick.captureBody')}</span>
          </li>
          <li>
            <strong>{t('side.quick.pasteTitle')}</strong>
            <span>{t('side.quick.pasteBody')}</span>
          </li>
          <li>
            <strong>{t('side.quick.previewTitle')}</strong>
            <span>{t('side.quick.previewBody')}</span>
          </li>
          <li>
            <strong>{t('side.quick.saveTitle')}</strong>
            <span>{t('side.quick.saveBody')}</span>
          </li>
          <li>
            <strong>{t('side.quick.trainTitle')}</strong>
            <span>{t('side.quick.trainBody')}</span>
          </li>
          <li>
            <strong>{t('side.quick.exportTitle')}</strong>
            <span>{t('side.quick.exportBody')}</span>
          </li>
        </ol>
      </details>

      <section className="intro-card">
        <span className="section-kicker">{t('side.currentPage')}</span>
        <p className="shortcut-hint">{t('side.shortcutHint')}</p>
        <button className="primary-button full-width" type="button" onClick={captureCurrentPage} disabled={loading}>
          {loading ? t('side.capturing') : t('side.capture')}
        </button>
        <button className="text-button full-width" type="button" onClick={openManualPastePage}>
          {t('side.manualPaste')}
        </button>
        {statusText && <p className="status-message" role="status">{statusText}</p>}
      </section>

      <section className="saved-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">{t('side.localLibrary')}</span>
            <h2>{view === 'library' ? t('side.library') : t('side.growth')}</h2>
          </div>
          <div className="section-heading-actions">
            <button className={view === 'library' ? 'text-button active' : 'text-button'} type="button" onClick={() => setView('library')}>{t('side.library')}</button>
            <button className={view === 'growth' ? 'text-button active' : 'text-button'} type="button" onClick={() => setView('growth')}>{t('side.growth')}</button>
            <button className="icon-button" type="button" onClick={() => void loadArticles()} aria-label={t('side.refreshArticles')}>↻</button>
          </div>
        </div>
        {view === 'library' ? (
          <>
            <input
              className="search-input"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t('side.searchPlaceholder')}
              aria-label={t('side.searchAria')}
            />
            <div className="library-filters" role="group" aria-label={t('side.filterAria')}>
              {([
                ['all', t('side.all')],
                ['favorite', t('side.favorite')],
                ['in-progress', t('side.inProgress')],
                ['completed', t('side.completed')],
              ] as const).map(([value, label]) => (
                <button key={value} className={filter === value ? 'filter-button active' : 'filter-button'} type="button" onClick={() => setFilter(value)}>{label}</button>
              ))}
            </div>
            {articles.length === 0 ? (
              <div className="empty-state">
                <span className="empty-mark">○</span>
                <p>{t('side.savedEmpty')}</p>
              </div>
            ) : filteredArticles.length === 0 ? (
              <div className="empty-state compact-empty">
                <p>{t('side.noMatch')}</p>
              </div>
            ) : (
              <ul className="article-list">
                {filteredArticles.slice(0, 8).map((article) => {
                  const session = sessions[article.id]
                  const totalSteps = session?.flowId === 'legacy-8' ? 8 : LESSON_STEPS.length
                  const progress = session ? `${trainingProgress(session).completed}/${totalSteps}` : t('common.notStarted')
                  const average = trainingAverageScore(session)
                  return (
                    <li key={article.id}>
                      <div className="article-list-item">
                        <button className="article-open-button" type="button" onClick={() => void openSavedArticle(article.id)}>
                          <strong>{article.isFavorite ? '★ ' : ''}{article.title}</strong>
                          <span>{formatDate(article.savedAt, locale)} · {article.text.length.toLocaleString()} {t('common.characters')} · {t('common.training')} {progress}{average === null ? '' : ` · ${average.toFixed(1)} ${t('common.score')}`}</span>
                        </button>
                        <div className="article-actions">
                          <button type="button" onClick={() => void toggleFavorite(article.id)} aria-label={article.isFavorite ? t('side.cancelFavorite') : t('side.addFavorite')}>{article.isFavorite ? '★' : '☆'}</button>
                          <button type="button" onClick={() => void exportArticle(article, 'markdown')} aria-label={t('side.exportMarkdown')}>MD</button>
                          <button type="button" onClick={() => void exportArticle(article, 'json')} aria-label={t('side.exportJson')}>JSON</button>
                          <button type="button" onClick={() => void exportArticle(article, 'obsidian')} aria-label={t('side.exportObsidian')}>OB</button>
                          <button type="button" onClick={() => void printArticle(article.id)} aria-label={t('side.printPdf')}>PDF</button>
                          <button type="button" onClick={() => void deleteArticle(article.id)} aria-label={t('side.deleteArticle')}>×</button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : (
          <div className="growth-panel">
            <div className="growth-stats">
              <div><strong>{growthStats.articleCount}</strong><span>{t('side.savedArticles')}</span></div>
              <div><strong>{growthStats.completedCount}</strong><span>{t('side.completedTraining')}</span></div>
              <div><strong>{growthStats.turnCount}</strong><span>{t('side.scoredRounds')}</span></div>
              <div><strong>{growthStats.average === null ? '—' : growthStats.average.toFixed(1)}</strong><span>{t('side.averageScore')}</span></div>
            </div>
            <div className="growth-dimensions">
              <h3>{t('side.fourSkills')}</h3>
              {growthStats.dimensions.map(({ dimension, average }) => (
                <div className="dimension-row" key={dimension}>
                  <span>{t(`side.dimension.${dimension}`)}</span>
                  <div className="dimension-track"><i style={{ width: `${Math.min(100, ((average ?? 0) / 10) * 100)}%` }} /></div>
                  <strong>{average === null ? '—' : average.toFixed(1)}</strong>
                </div>
              ))}
            </div>
            <p className="muted-copy">{t('side.growthCopy')}</p>
          </div>
        )}
      </section>

      <footer className="panel-footer">{t('side.storageFooter')}</footer>
    </main>
  )
}

function SettingsPage() {
  const { t, locale, localeOptions, setLocale } = useI18n()
  const [settings, setSettings] = useState<AiSettings>(defaultAiSettings())
  const [modelOptions, setModelOptions] = useState<AiModelOption[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelSource, setModelSource] = useState<'provider' | 'fallback' | null>(null)
  const [modelStatus, setModelStatus] = useState('')
  const [status, setStatus] = useState('')
  const [testMode, setTestMode] = useState(false)
  const [testModeBusy, setTestModeBusy] = useState(false)

  const provider = providerById(settings.provider)

  const saveSettings = async () => {
    if (settings.provider === 'custom' && !isValidCustomEndpoint(settings.endpoint)) {
      setStatus(t('settings.invalidEndpoint'))
      return
    }
    setBusy(true)
    setStatus('')
    const savedSettings = { ...settings, apiKey: settings.apiKey.trim() }
    const response = await sendExtensionMessage<AiSettings>({
      type: 'save-ai-settings',
      settings: savedSettings,
    })
    setBusy(false)
    setStatus(response.ok ? t('settings.saved') : errorMessage(response.error))
    if (response.ok) void refreshModels(savedSettings)
  }

  const testConnection = async () => {
    setTesting(true)
    setStatus('')
    const response = await sendExtensionMessage<{ provider: string; model: string }>({
      type: 'test-ai-connection',
      settings,
    })
    setTesting(false)
    if (!response.ok) {
      setStatus(errorMessage(response.error))
      return
    }
    await refreshModels(settings)
    setStatus(t('settings.connected', { provider: response.data.provider, model: response.data.model }))
  }

  const openShortcuts = async () => {
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({ type: 'open-shortcuts' })
    if (!response.ok) setStatus(errorMessage(response.error))
  }

  const saveTestMode = async (enabled: boolean) => {
    setTestModeBusy(true)
    setStatus('')
    const response = await sendExtensionMessage<boolean>({ type: 'save-test-mode', enabled })
    setTestModeBusy(false)
    if (!response.ok) {
      setStatus(errorMessage(response.error))
      return
    }
    setTestMode(response.data)
    setStatus(t('settings.testModeSaved'))
  }

  const selectProvider = (providerId: AiSettings['provider']) => {
    const nextProvider = providerById(providerId)
    const nextSettings = { ...settings, provider: providerId, model: nextProvider.defaultModel }
    setSettings(nextSettings)
    setModelOptions([])
    setModelSource(null)
    setModelStatus('')
    setStatus('')
    if (nextSettings.apiKey.trim()) void refreshModels(nextSettings)
  }

  const refreshModels = useCallback(async (settingsOverride: AiSettings) => {
    setModelsLoading(true)
    setStatus('')
    setModelStatus('')
    const response = await sendExtensionMessage<{ models: AiModelOption[]; source: 'provider' | 'fallback'; warning?: string }>({
      type: 'list-ai-models',
      settings: settingsOverride,
    })
    setModelsLoading(false)
    if (!response.ok) {
      setModelStatus(errorMessage(response.error))
      return
    }
    setModelOptions(response.data.models)
    setModelSource(response.data.source)
    setModelStatus(response.data.warning ?? '')
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([
        sendExtensionMessage<AiSettings>({ type: 'get-ai-settings' }),
        sendExtensionMessage<boolean>({ type: 'get-test-mode' }),
      ]).then(([response, testModeResponse]) => {
        setLoaded(true)
        if (response.ok) {
          setSettings(response.data)
          if (response.data.apiKey.trim()) void refreshModels(response.data)
        } else setStatus(errorMessage(response.error))
        if (testModeResponse.ok) setTestMode(testModeResponse.data)
        else setStatus(errorMessage(testModeResponse.error))
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshModels])

  return (
    <main className="app-shell settings-shell">
      <header className="settings-header">
        <div>
          <span className="eyebrow">{t('settings.eyebrow')}</span>
          <h1>{t('settings.heading')}</h1>
          <p>{t('settings.description')}</p>
        </div>
        <span className="local-pill">{t('common.localOnly')}</span>
      </header>
      {!loaded ? (
        <div className="loading-state">{t('settings.loading')}</div>
      ) : (
        <>
          <section className="settings-card">
          <label>
            {t('settings.language')}
            <select value={locale} onChange={(event) => void setLocale(event.target.value as typeof locale)}>
              {localeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <small>{t('settings.languageHint')}</small>
          </label>
          <div className="settings-shortcut-row">
            <div>
              <strong>{t('settings.shortcutsTitle')}</strong>
              <small>{t('settings.shortcutsHint')}</small>
            </div>
            <button className="secondary-button" type="button" onClick={() => void openShortcuts()}>
              {t('settings.openShortcuts')}
            </button>
          </div>
          <div className="settings-test-mode-row">
            <div>
              <strong>{t('settings.testMode')}</strong>
              <small>{t('settings.testModeHint')}</small>
            </div>
            <label className="settings-checkbox-control">
              <input type="checkbox" checked={testMode} onChange={(event) => void saveTestMode(event.target.checked)} disabled={testModeBusy} />
              <span>{testMode ? t('settings.testModeOn') : t('settings.testModeOff')}</span>
            </label>
          </div>
          <label>
            {t('settings.modelService')}
            <select value={settings.provider} onChange={(event) => selectProvider(event.target.value as AiSettings['provider'])}>
              {AI_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{t(`provider.${item.id}`)}</option>)}
            </select>
          </label>
          <label>
            {t('settings.apiEndpoint')}
            <input
              value={provider.id === 'custom' ? settings.endpoint : providerEndpoint(settings)}
              readOnly={provider.id !== 'custom'}
              onChange={provider.id === 'custom' ? (event) => setSettings((current) => ({ ...current, endpoint: event.target.value })) : undefined}
              placeholder={provider.id === 'custom' ? t('settings.customEndpointPlaceholder') : undefined}
              aria-describedby="endpoint-note"
            />
            <small id="endpoint-note">{provider.id === 'custom' ? t('settings.customEndpointNote') : t('settings.endpointNote')}</small>
          </label>
          <label>
            {t('settings.modelName')}
            <div className="model-input-stack">
              <select className="model-options-select" aria-label={t('settings.modelListAria')} value={modelOptions.some((model) => model.id === settings.model) ? settings.model : ''} onChange={(event) => { if (event.target.value) setSettings((current) => ({ ...current, model: event.target.value })) }}>
                <option value="">{modelOptions.length ? t('settings.selectLoaded', { count: modelOptions.length }) : t('settings.refreshHint')}</option>
                {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label === model.id ? model.id : `${model.label} · ${model.id}`}</option>)}
              </select>
              <div className="model-input-row">
              <input value={settings.model} onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))} placeholder={provider.defaultModel} aria-label={t('settings.manualModelAria')} />
              <button className="secondary-button compact-button" type="button" onClick={() => void refreshModels(settings)} disabled={modelsLoading || !settings.apiKey.trim()}>{modelsLoading ? t('settings.fetchingModels') : t('settings.refreshModels')}</button>
              </div>
            </div>
            <small>{modelSource === 'fallback' ? t('settings.fallbackHint') : modelOptions.length ? t('settings.loadedModels', { count: modelOptions.length }) : t('settings.modelHint')}</small>
            {modelStatus && <small className="model-status" role="status">{modelStatus}</small>}
          </label>
          <label>
            {t('settings.apiKey')}
            <input type="password" autoComplete="off" value={settings.apiKey} onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value }))} placeholder={t('settings.apiKeyPlaceholder')} />
            <small>{t('settings.apiKeyNote')}</small>
          </label>
          <div className="settings-actions-row">
            <button className="secondary-button" type="button" onClick={() => void testConnection()} disabled={busy || testing || !settings.apiKey.trim()}>
              {testing ? t('settings.testing') : t('settings.testConnection')}
            </button>
            <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={busy || testing}>
              {busy ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
          {status && <p className="status-message" role="status">{status}</p>}
          </section>
          <section className="donation-card" aria-labelledby="donation-title">
          <div>
            <span className="section-kicker">{t('settings.supportEyebrow')}</span>
            <h2 id="donation-title">{t('settings.supportHeading')}</h2>
            <p>{t('settings.supportCopy')}</p>
          </div>
          <div className="donation-grid">
            <figure>
              <img src="/assets/donate-alipay.jpg" alt={t('settings.alipayAlt')} />
              <figcaption>Alipay</figcaption>
            </figure>
            <figure>
              <img src="/assets/donate-paypal.jpg" alt={t('settings.paypalAlt')} />
              <figcaption>PayPal</figcaption>
            </figure>
          </div>
          </section>
        </>
      )}
    </main>
  )
}

function TrainingPage() {
  const { t, locale } = useI18n()
  const [capture, setCapture] = useState<CaptureRecord | SavedArticle | null>(null)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [url, setUrl] = useState('')
  const [author, setAuthor] = useState('')
  const [source, setSource] = useState('')
  const [text, setText] = useState('')
  const [sourceEditorOpen, setSourceEditorOpen] = useState(true)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [mobilePane, setMobilePane] = useState<'article' | 'training'>('article')
  const articleColumnRef = useRef<HTMLElement | null>(null)
  const coachColumnRef = useRef<HTMLElement | null>(null)
  const [trainingSnapshot, setTrainingSnapshot] = useState<TrainingSession['articleSnapshot']>()
  const receiveTrainingSnapshot = useCallback((snapshot: TrainingSession['articleSnapshot']) => setTrainingSnapshot(snapshot), [])

  const queryErrorCode = useMemo(
    () => new URLSearchParams(window.location.search).get('errorCode') as ErrorCode | null,
    [],
  )

  useEffect(() => {
    const loadCapture = async () => {
      const response = await sendExtensionMessage<CaptureRecord | null>({ type: 'get-pending-capture' })
      if (!response.ok) {
        setLoadError(errorMessage(response.error))
        setLoading(false)
        return
      }
      if (queryErrorCode) {
        setLoadError(t(`error.${queryErrorCode}`))
        setCapture(null)
        setTitle('')
        setSubtitle('')
        setUrl('')
        setAuthor('')
        setSource('')
        setText('')
        setSourceEditorOpen(true)
        setLoading(false)
        return
      }
      if (!response.data) {
        setLoadError(t('training.noCapture'))
        setLoading(false)
        return
      }
      setCapture(response.data)
      setTitle(response.data.title)
      setSubtitle(response.data.metadata?.subtitle ?? '')
      setUrl(response.data.url)
      setAuthor(response.data.metadata?.author ?? response.data.author ?? '')
      setSource(response.data.metadata?.source ?? '')
      setText(response.data.text)
      setSourceEditorOpen(false)
      setLoading(false)
    }

    void loadCapture()
  }, [queryErrorCode, t])

  useEffect(() => {
    if (!capture?.id || loading) return
    const key = `reading-position:${capture.id}`
    const raw = sessionStorage.getItem(key)
    if (raw) {
      try {
        const position = JSON.parse(raw) as { article?: number; training?: number }
        window.setTimeout(() => {
          if (typeof position.article === 'number' && articleColumnRef.current) articleColumnRef.current.scrollTop = position.article
          if (typeof position.training === 'number' && coachColumnRef.current) coachColumnRef.current.scrollTop = position.training
        }, 0)
      } catch {
        sessionStorage.removeItem(key)
      }
    }
    const savePosition = () => {
      sessionStorage.setItem(key, JSON.stringify({
        article: articleColumnRef.current?.scrollTop ?? 0,
        training: coachColumnRef.current?.scrollTop ?? 0,
      }))
    }
    const articleColumn = articleColumnRef.current
    const coachColumn = coachColumnRef.current
    articleColumn?.addEventListener('scroll', savePosition, { passive: true })
    coachColumn?.addEventListener('scroll', savePosition, { passive: true })
    return () => {
      articleColumn?.removeEventListener('scroll', savePosition)
      coachColumn?.removeEventListener('scroll', savePosition)
    }
  }, [capture?.id, loading])

  const saveCurrentArticle = async () => {
    const trimmedText = text.trim()
    if (trimmedText.length < 120 || trimmedText.length > 36_000) {
      setStatus(t('training.articleLength'))
      return
    }

    setSaving(true)
    const blocks = getArticleBlocks(
      trimmedText,
      capture && capture.text.trim() === trimmedText ? capture.blocks : undefined,
    )
    const article: CaptureRecord = {
      id: capture?.id ?? crypto.randomUUID(),
      title: title.trim() || t('common.untitled'),
      metadata: {
        subtitle: subtitle.trim(),
        author: author.trim(),
        source: source.trim(),
      },
      url: url.trim(),
      ...(author.trim() ? { author: author.trim() } : {}),
      text: trimmedText,
      blocks,
      ...(capture?.preReadingPrediction?.trim() ? { preReadingPrediction: capture.preReadingPrediction.trim() } : {}),
      ...(capture?.selectedText ? { selectedText: capture.selectedText } : {}),
      capturedAt: capture?.capturedAt ?? new Date().toISOString(),
      source: capture?.source ?? 'side-panel',
    }
    const response = await sendExtensionMessage<SavedArticle>({
      type: 'save-article',
      article,
    })
    setSaving(false)
    if (!response.ok) {
      setStatus(errorMessage(response.error))
      return
    }
    await sendExtensionMessage<null>({ type: 'clear-pending-capture' })
    setCapture(response.data)
    setStatus(t('training.saved'))
  }

  const currentArticle = (): CaptureRecord | SavedArticle => {
    const trimmedText = text.trim()
    const fields = {
      title: title.trim() || t('common.untitled'),
      metadata: {
        subtitle: subtitle.trim(),
        author: author.trim(),
        source: source.trim(),
      },
      url: url.trim(),
      ...(author.trim() ? { author: author.trim() } : {}),
      text: trimmedText,
      blocks: getArticleBlocks(
        trimmedText,
        capture && capture.text.trim() === trimmedText ? capture.blocks : undefined,
      ),
    }
    if (capture && 'savedAt' in capture) {
      return { ...capture, ...fields }
    }
    return {
      id: capture?.id ?? crypto.randomUUID(),
      ...fields,
      ...(capture?.selectedText ? { selectedText: capture.selectedText } : {}),
      capturedAt: capture?.capturedAt ?? new Date().toISOString(),
      source: capture?.source ?? 'side-panel',
    }
  }

  const exportCurrentArticle = async (format: 'markdown' | 'json' | 'obsidian') => {
    const article = currentArticle()
    let session: TrainingSession | null = null
    if ('savedAt' in article) {
      const response = await sendExtensionMessage<TrainingSession | null>({
        type: 'get-training-session',
        articleId: article.id,
      })
      if (!response.ok) {
        setStatus(errorMessage(response.error))
        return
      }
      session = response.data
    }
    const model = buildReadingExportModel(article, session, locale)
    if (format === 'markdown') {
      downloadText(generateReadingMarkdown(model), sanitizeFilename(article.title, 'md', locale), 'text/markdown')
      setStatus(t('training.exportedMarkdown'))
      return
    }
    if (format === 'json') {
      downloadText(generateReadingJson(model), sanitizeFilename(article.title, 'json', locale), 'application/json')
      setStatus(t('training.exportedJson'))
      return
    }
    const markdown = generateReadingMarkdown(model)
    const obsidian = buildObsidianUrl(markdown, { title: article.title })
    if (obsidian.useClipboard) {
      if (!navigator.clipboard?.writeText) {
        setStatus(t('side.exportClipboardTooLong'))
        return
      }
      try {
        await navigator.clipboard.writeText(markdown)
      } catch {
        setStatus(t('side.exportClipboardFailed'))
        return
      }
      window.open(obsidian.url, '_blank', 'noopener,noreferrer')
      setStatus(t('side.exportObsidianCopied'))
      return
    }
    window.open(obsidian.url, '_blank', 'noopener,noreferrer')
    setStatus(t('side.exportObsidianRequested'))
  }

  const openPrintPage = async () => {
    if (!capture || !('savedAt' in capture)) {
      setStatus(t('training.saveBeforePrint'))
      return
    }
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({
      type: 'open-print-article',
      articleId: capture.id,
    })
    setStatus(response.ok ? t('side.printOpened') : errorMessage(response.error))
  }

  return (
    <main className="app-shell training-shell">
      <header className="training-header">
        <div>
          <span className="eyebrow">{t('training.eyebrow')}</span>
          <h1>{t('training.heading')}</h1>
          <p>{t('training.description')}</p>
        </div>
        <span className="local-pill">{t('common.localOnly')}</span>
      </header>

      {loading ? (
        <div className="loading-state">{t('training.loading')}</div>
      ) : (
        <>
          {loadError && (
            <div className="notice error-notice" role="alert">
              <strong>{t('training.captureFailed')}</strong>
              <span>{loadError}</span>
            </div>
          )}
          {capture && 'savedAt' in capture && (
            <nav className="mobile-pane-toggle" aria-label={t('training.mobilePaneLabel')}>
              <button className={mobilePane === 'article' ? 'active' : ''} type="button" onClick={() => setMobilePane('article')}>{t('training.originalPane')}</button>
              <button className={mobilePane === 'training' ? 'active' : ''} type="button" onClick={() => setMobilePane('training')}>{t('training.trainingPane')}</button>
            </nav>
          )}
          <div className={`${capture && 'savedAt' in capture ? 'training-workspace has-coach' : 'training-workspace'} mobile-pane-${mobilePane}`}>
            <section className="article-column" ref={articleColumnRef}>
              <section className="editor-card">
                <div className="editor-meta">
                  <span className="section-kicker">{t('training.sourceMeta')}</span>
                  {capture?.selectedText && <span className="selection-pill">{t('training.selectedText')}</span>}
                </div>
                <label>
                  {t('training.title')}
                  <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('training.titlePlaceholder')} />
                </label>
                <label>
                  {t('training.subtitle')}
                  <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder={t('training.subtitlePlaceholder')} maxLength={240} />
                </label>
                <label>
                  {t('training.url')}
                  <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" inputMode="url" />
                </label>
                <label>
                  {t('training.author')}
                  <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder={t('training.authorPlaceholder')} />
                </label>
                <label>
                  {t('training.source')}
                  <input value={source} onChange={(event) => setSource(event.target.value)} placeholder={t('training.sourcePlaceholder')} maxLength={240} />
                </label>
                <details className="source-editor" open={sourceEditorOpen} onToggle={(event) => setSourceEditorOpen(event.currentTarget.open)}>
                  <summary>
                    <span>{t('training.sourceEditor')}</span>
                    <small>{t('training.sourceEditorHint')}</small>
                  </summary>
                  <label>
                    {t('training.articleBody')}
                    <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={t('training.articleBodyPlaceholder')} rows={22} maxLength={36_000} />
                  </label>
                </details>
                {text.trim() && <ArticlePreview blocks={trainingSnapshot?.blocks ?? getArticleBlocks(text, capture && capture.text.trim() === text.trim() ? capture.blocks : undefined)} />}
                <div className="editor-footer">
                  <span className="character-count">{text.length.toLocaleString()} {t('common.characters')}</span>
                  <div className="editor-actions">
                    <button className="secondary-button" type="button" onClick={() => void exportCurrentArticle('markdown')}>Markdown</button>
                    <button className="secondary-button" type="button" onClick={() => void exportCurrentArticle('json')}>JSON</button>
                    <button className="secondary-button" type="button" onClick={() => void exportCurrentArticle('obsidian')}>Obsidian</button>
                    <button className="secondary-button" type="button" onClick={() => void openPrintPage()}>{t('training.printPdf')}</button>
                    <button className="primary-button" type="button" onClick={() => void saveCurrentArticle()} disabled={saving}>
                      {saving ? t('training.saving') : t('training.saveStart')}
                    </button>
                  </div>
                </div>
                {status && <p className="status-message" role="status">{status}</p>}
              </section>
            </section>
            {capture && 'savedAt' in capture && (
              <aside className="coach-column" ref={coachColumnRef}>
                <TrainingCoach key={capture.id} article={capture} onSnapshot={receiveTrainingSnapshot} />
              </aside>
            )}
          </div>
        </>
      )}
    </main>
  )
}

function ArticlePreview({ blocks }: { blocks: ArticleBlock[] }) {
  const { t } = useI18n()
  const numberedParagraphs = numberArticleBlocks(blocks)
  const sourceNumberFor = (index: number) => {
    const match = numberedParagraphs.find((item) => item.blockIndex === index)
    return match ? String(match.paragraph).padStart(2, '0') : null
  }

  return (
    <section className="article-preview">
      <div className="article-preview-heading">
        <span className="section-kicker">{t('training.preview')}</span>
        <span>{t('training.previewHint')}</span>
      </div>
      <article className="article-preview-content">
        {blocks.map((block, index) => {
          const sourceNumber = sourceNumberFor(index)
          if (block.type === 'heading') {
            if (block.level === 1) return <h1 key={index}>{renderArticleInline(block.text, block.inlines)}</h1>
            if (block.level === 2) return <h2 key={index}>{renderArticleInline(block.text, block.inlines)}</h2>
            if (block.level === 3) return <h3 key={index}>{renderArticleInline(block.text, block.inlines)}</h3>
            return <h4 key={index}>{renderArticleInline(block.text, block.inlines)}</h4>
          }
          if (block.type === 'paragraph') return <p key={index}>{sourceNumber && <span className="article-source-number">{sourceNumber}</span>}{renderArticleInline(block.text, block.inlines)}</p>
          if (block.type === 'quote') return <blockquote key={index}>{sourceNumber && <span className="article-source-number">{sourceNumber}</span>}{renderArticleInline(block.text, block.inlines)}</blockquote>
          if (block.type === 'list') {
            const List = block.ordered ? 'ol' : 'ul'
            return <List key={index}>{block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderArticleInline(item, block.itemInlines?.[itemIndex])}</li>)}</List>
          }
          if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>
          if (block.type === 'image') return <figure key={index}><img src={block.src} alt={block.alt} loading="lazy" referrerPolicy="no-referrer" />{block.alt && <figcaption>{block.alt}</figcaption>}</figure>
          if (block.type === 'chart') return <figure className="article-chart" key={index}><div className="article-chart-visual" role="img" aria-label={block.alt || block.text}>{t('training.chartLabel')}</div><figcaption>{block.text}</figcaption></figure>
          return <hr key={index} />
        })}
      </article>
    </section>
  )
}

function renderArticleInline(text: string, inlines?: ArticleInline[]) {
  if (!inlines?.length) return text
  return inlines.map((inline, index) => {
    if (inline.emphasis === 'strong-emphasis') return <strong key={`${inline.text}-${index}`}><em>{inline.text}</em></strong>
    if (inline.emphasis === 'strong') return <strong key={`${inline.text}-${index}`}>{inline.text}</strong>
    if (inline.emphasis === 'emphasis') return <em key={`${inline.text}-${index}`}>{inline.text}</em>
    return <span key={`${inline.text}-${index}`}>{inline.text}</span>
  })
}

function TrainingCoach({ article, onSnapshot }: { article: SavedArticle; onSnapshot: (snapshot: TrainingSession['articleSnapshot']) => void }) {
  const { t, locale } = useI18n()
  const articleId = article.id
  const [session, setSession] = useState<TrainingSession | null>(null)
  const sourceBlocksJson = JSON.stringify(session?.articleSnapshot?.blocks ?? getArticleBlocks(article.text, article.blocks))
  const paragraphs = useMemo(() => numberArticleBlocks(JSON.parse(sourceBlocksJson) as ArticleBlock[]), [sourceBlocksJson])
  useEffect(() => { onSnapshot(session?.articleSnapshot) }, [onSnapshot, session?.articleSnapshot])
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [testMode, setTestMode] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [aiLoaded, setAiLoaded] = useState(false)
  const [reinforcing, setReinforcing] = useState(false)
  const [practiceId, setPracticeId] = useState('')
  const [answer, setAnswer] = useState('')
  const [structuredDraft, setStructuredDraft] = useState<TrainingStructuredDraft>({})
  const [importantParagraphs, setImportantParagraphs] = useState<number[]>([])
  const [threeSentenceDrafts, setThreeSentenceDrafts] = useState<TrainingSession['threeSentenceDrafts']>([])
  const [paragraphCursor, setParagraphCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hintVisible, setHintVisible] = useState(false)
  const [referenceAnswerBusy, setReferenceAnswerBusy] = useState(false)
  const [fieldAssistBusy, setFieldAssistBusy] = useState<string | null>(null)
  const [fieldAssists, setFieldAssists] = useState<Record<string, TrainingFieldAssist>>({})
  const fieldAssistRequestToken = useRef(0)
  const [preReadConfirmed, setPreReadConfirmed] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [reviewing, setReviewing] = useState(false)
  const [reviewTurnIndex, setReviewTurnIndex] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ base: TrainingSession; turnIndex: number } | null>(null)
  const [revisionReason, setRevisionReason] = useState('')
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [saveConflict, setSaveConflict] = useState<TrainingSession | null>(null)
  const pendingSave = useRef<Promise<TrainingSession | null> | null>(null)
  const [historySessions, setHistorySessions] = useState<TrainingSession[]>([])
  const [historyView, setHistoryView] = useState<TrainingSession | null>(null)
  const lastAutoSavedFingerprint = useRef<string | null>(null)
  const snapshotMetadataJson = JSON.stringify(session?.articleSnapshot ? { title: session.articleSnapshot.title, metadata: session.articleSnapshot.metadata } : { title: article.title, metadata: article.metadata })

  const previewDefaults = useMemo<TrainingStructuredDraft>(() => {
    const snapshotMetadata = JSON.parse(snapshotMetadataJson) as { title: string; metadata?: SavedArticle['metadata'] }
    const metadata = snapshotMetadata.metadata ?? { subtitle: '', author: article.author ?? '', source: '' }
    return {
      'preview.metadata': JSON.stringify(initialMetadataReview({ title: snapshotMetadata.title, metadata })),
    }
  }, [article.author, snapshotMetadataJson])

  const applySession = useCallback((next: TrainingSession) => {
    const restoredDrafts = next.currentStep === 2
      ? next.threeSentenceDrafts?.length
        ? next.threeSentenceDrafts
        : next.draft.trim() && paragraphs[0]
          ? [{ paragraph: paragraphs[0].paragraph, what: next.draft, why: '', takeaway: '', role: '', evidence: '' }]
          : []
      : []
    const nextCursor = next.currentStep === 2
      ? Math.min(next.paragraphCursor ?? 0, Math.max(0, paragraphs.length - 1))
      : 0
    const nextImportantParagraphs = next.currentStep === 2
      ? initialImportantParagraphs(next)
      : []
    const nextStep = getLessonSteps(locale)[Math.min(next.currentStep, LESSON_STEPS.length - 1)]
    const defaultStructuredDraft: TrainingStructuredDraft = next.currentStep === 0 && next.turns.length === 0 ? previewDefaults
      : next.currentStep === 3 && !next.draft.trim() && next.articleSnapshot ? { 'threePoints.evidence': JSON.stringify(emptySummaryEvidence(next.articleSnapshot.id)) }
      : next.currentStep === 9 && !next.draft.trim() ? reviewDraftFromResults(next) : {}
    const nextStructuredDraft = next.structuredDraft ?? defaultStructuredDraft
    const nextAnswer = nextStep?.id === 'three-points'
      ? next.draft
      : structuredFieldsForStep(nextStep?.id ?? '').length > 0
      ? formatStructuredAnswer(nextStep.id, nextStructuredDraft, t) || next.draft
      : next.draft
    setSession(next)
    setStructuredDraft(nextStructuredDraft)
    setImportantParagraphs(nextImportantParagraphs)
    setThreeSentenceDrafts(restoredDrafts)
    setParagraphCursor(nextCursor)
    setAnswer(next.currentStep === 2
      ? formatThreeSentenceAnswer(restoredDrafts.filter((draft) => nextImportantParagraphs.includes(draft.paragraph))) || next.draft
      : nextAnswer)
    setHintVisible(false)
    setFieldAssistBusy(null)
    setFieldAssists({})
    fieldAssistRequestToken.current += 1
    setSaveStatus('idle')
    setReviewing(false)
    setReviewTurnIndex(null)
    setSaveConflict(null)
  }, [locale, paragraphs, previewDefaults, t])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([
        sendExtensionMessage<TrainingSession | null>({
          type: 'get-training-session',
          articleId,
        }),
        sendExtensionMessage<TrainingSession[]>({
          type: 'get-training-history',
          articleId,
        }),
        sendExtensionMessage<AiSettings>({ type: 'get-ai-settings' }),
        sendExtensionMessage<boolean>({ type: 'get-test-mode' }),
      ]).then(([sessionResponse, historyResponse, settingsResponse, testModeResponse]) => {
        setLoaded(true)
        setAiLoaded(true)
        if (sessionResponse.ok) {
          if (sessionResponse.data) applySession(sessionResponse.data)
        }
        else setError(errorMessage(sessionResponse.error))
        if (historyResponse.ok) setHistorySessions(historyResponse.data)
        if (settingsResponse.ok) setAiSettings(settingsResponse.data)
        if (testModeResponse.ok) setTestMode(testModeResponse.data)
        else setError(errorMessage(testModeResponse.error))
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [applySession, articleId])

  useEffect(() => {
    if (!loaded || !session || session.courseVersion !== 'guided-reading-10-v1' || busy || editing || saveConflict || reviewing || historyView || reinforcing || session.currentStep >= LESSON_STEPS.length) return
    const currentStep = getLessonSteps(locale)[Math.min(session.currentStep, LESSON_STEPS.length - 1)]
    const currentAnswer = session.currentStep === 2
      ? formatThreeSentenceAnswer((threeSentenceDrafts ?? []).filter((draft) => importantParagraphs.includes(draft.paragraph)))
      : currentStep?.id !== 'three-points' && structuredFieldsForStep(currentStep?.id ?? '').length > 0
        ? formatStructuredAnswer(currentStep.id, structuredDraft, t) || answer
        : answer
    const fingerprint = JSON.stringify([session.sessionId, session.currentStepId, currentAnswer, structuredDraft, importantParagraphs, threeSentenceDrafts, paragraphCursor])
    if (fingerprint === lastAutoSavedFingerprint.current) return
    const timer = window.setTimeout(() => {
      if (pendingSave.current) return
      setSaveStatus('saving')
      lastAutoSavedFingerprint.current = fingerprint
      const request = sendExtensionMessage<TrainingSession>({
        type: 'save-training-draft',
        articleId,
        sessionId: session.sessionId,
        stepId: session.currentStepId,
        draftRevision: session.draftRevision,
        draft: currentAnswer,
        ...(structuredFieldsForStep(currentStep?.id ?? '').length > 0 ? { structuredDraft } : {}),
        ...(session.currentStep === 2 ? { importantParagraphs, threeSentenceDrafts, paragraphCursor } : {}),
      }).then(async (response) => {
        if (response.ok) {
          setSession((current) => acceptDraftSaveResponse(current, response.data))
          setSaveStatus('saved')
          return response.data
        } else {
          lastAutoSavedFingerprint.current = null
          setSaveStatus('error')
          if (response.error.code === 'TRAINING_CONFLICT') {
            const latest = await sendExtensionMessage<TrainingSession | null>({ type: 'get-training-session', articleId })
            if (latest.ok && latest.data) setSaveConflict(latest.data)
          }
          return null
        }
      }).catch(() => {
        lastAutoSavedFingerprint.current = null
        setSaveStatus('error')
        return null
      })
      pendingSave.current = request
      void request.finally(() => { if (pendingSave.current === request) pendingSave.current = null })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [answer, articleId, importantParagraphs, loaded, locale, paragraphCursor, session, structuredDraft, t, threeSentenceDrafts, busy, reviewing, historyView, reinforcing, editing, saveConflict])

  useEffect(() => {
    let active = true
    void sendExtensionMessage<TrainingSession[]>({ type: 'get-training-history', articleId }).then((response) => {
      if (active && response.ok) setHistorySessions(response.data)
    })
    return () => { active = false }
  }, [articleId, session?.sessionId, historyView])

  const aiConfigured = aiLoaded && Boolean(aiSettings?.apiKey.trim())
  const canGoBack = Boolean(session?.turns.length && !reviewing)

  const start = async () => {
    setBusy(true)
    setError('')
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'start-training-session',
      articleId,
    })
    if (!response.ok) {
      setBusy(false)
      setError(errorMessage(response.error))
      return
    }
    applySession(response.data)
    setBusy(false)
  }

  const jumpToTestStep = async (stepIndex: number) => {
    const targetStepId = getLessonSteps(locale)[stepIndex]?.id
    const canOpenSavedDraft = Boolean(targetStepId && session?.stepRecords?.[targetStepId]?.status === 'draft' && stepIndex < (session?.currentStep ?? 0))
    if ((!testMode && !canOpenSavedDraft) || !session || busy || stepIndex === session.currentStep) return
    setBusy(true)
    setError('')
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'set-training-step',
      articleId,
      stepIndex,
      sessionId: session.sessionId,
      draftRevision: session.draftRevision,
    })
    setBusy(false)
    if (!response.ok) {
      setError(errorMessage(response.error))
      return
    }
    applySession(response.data)
    setReinforcing(false)
    setReviewing(false)
  }

  const requestFieldAssist = async (fieldId: string, mode: TrainingFieldAssistMode) => {
    if (!session?.sessionId || !session.currentStepId || !aiConfigured || fieldAssistBusy) return
    const key = `${fieldId}:${mode}`
    const requestToken = fieldAssistRequestToken.current
    setFieldAssistBusy(key)
    setError('')
    const response = await sendExtensionMessage<TrainingFieldAssist>({
      type: 'ai-field-assist',
      articleId,
      sessionId: session.sessionId,
      stepId: session.currentStepId,
      draftRevision: session.draftRevision ?? 0,
      fieldId,
      mode,
      draft: answer,
      ...(isStructuredStep ? { structuredDraft } : {}),
      ...(isThreeSentenceStep ? { importantParagraphs, threeSentenceDrafts, paragraphCursor } : {}),
    })
    setFieldAssistBusy(null)
    if (requestToken !== fieldAssistRequestToken.current) return
    if (!response.ok) {
      setError(errorMessage(response.error))
      return
    }
    setFieldAssists((current) => ({ ...current, [fieldId]: response.data }))
  }

  const currentParagraph = paragraphs[paragraphCursor]
  const currentParagraphDraft = threeSentenceDrafts?.find((draft) => draft.paragraph === currentParagraph?.paragraph)
  const isThreeSentenceStep = session?.currentStep === 2 && !reinforcing
  const isThreePointsStep = session?.currentStep === 3 && !reinforcing
  const currentParagraphSelected = Boolean(currentParagraph && importantParagraphs.includes(currentParagraph.paragraph))
  const threeSentenceComplete = isThreeSentenceStep && importantParagraphs.length > 0 && areThreeSentenceDraftsComplete(threeSentenceDrafts ?? [], importantParagraphs)
  const threePointsComplete = !isThreePointsStep || isLessonAnswerFormatValid(3, answer, locale)
  const answerMaxLength = isThreeSentenceStep
    ? THREE_SENTENCE_ANSWER_MAX_LENGTH
    : session && structuredFieldsForStep(getLessonSteps(locale)[Math.min(session.currentStep, LESSON_STEPS.length - 1)]?.id ?? '').length > 0
      ? STRUCTURED_ANSWER_MAX_LENGTH
      : TRAINING_ANSWER_MAX_LENGTH

  const updateThreeSentenceField = (field: 'what' | 'why' | 'takeaway' | 'role' | 'evidence', value: string) => {
    if (!currentParagraph || !currentParagraphSelected) return
    const current = threeSentenceDrafts ?? []
    const existing = current.find((draft) => draft.paragraph === currentParagraph.paragraph)
    const next = [
      ...current.filter((draft) => draft.paragraph !== currentParagraph.paragraph),
      {
        paragraph: currentParagraph.paragraph,
        what: existing?.what ?? '',
        why: existing?.why ?? '',
        takeaway: existing?.takeaway ?? '',
        role: existing?.role ?? '',
        evidence: existing?.evidence ?? '',
        [field]: value,
      },
    ].sort((left, right) => left.paragraph - right.paragraph)
    setThreeSentenceDrafts(next)
    setAnswer(formatThreeSentenceAnswer(next.filter((draft) => importantParagraphs.includes(draft.paragraph))))
    setFieldAssists({})
    fieldAssistRequestToken.current += 1
    setError('')
  }

  const updateStructuredField = (field: TrainingDraftFieldId, value: string) => {
    const next = { ...structuredDraft, [field]: value }
    if (field === 'applicability.mode' && value === 'not-applicable' && step?.id === 'toulmin-simple' && !next['toulminSimple.argumentId']) next['toulminSimple.argumentId'] = session?.argumentId ?? crypto.randomUUID()
    setStructuredDraft(next)
    if (step?.id !== 'three-points') setAnswer(formatStructuredAnswer(step?.id ?? '', next, t))
    setFieldAssists({})
    fieldAssistRequestToken.current += 1
    setError('')
  }

  const moveToParagraph = (nextCursor: number) => {
    setParagraphCursor(Math.max(0, Math.min(nextCursor, Math.max(0, paragraphs.length - 1))))
    setFieldAssists({})
    fieldAssistRequestToken.current += 1
    setError('')
  }

  const toggleImportantParagraph = (paragraph: number) => {
    const next = importantParagraphs.includes(paragraph)
      ? importantParagraphs.filter((item) => item !== paragraph)
      : [...importantParagraphs, paragraph].sort((left, right) => left - right)
    setImportantParagraphs(next)
    setAnswer(formatThreeSentenceAnswer((threeSentenceDrafts ?? []).filter((draft) => next.includes(draft.paragraph))))
    setFieldAssists({})
    fieldAssistRequestToken.current += 1
    setError('')
  }

  const persistCurrentDraft = async (identity = session) => {
    const pending = await pendingSave.current
    if (pending && identity && canRetryTrainingDraft(identity, pending)) identity = pending
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'save-training-draft',
      articleId,
      sessionId: identity?.sessionId,
      stepId: identity?.currentStepId,
      draftRevision: identity?.draftRevision,
      draft: answer,
      ...(isStructuredStep ? { structuredDraft } : {}),
      ...(isThreeSentenceStep ? { importantParagraphs, threeSentenceDrafts, paragraphCursor } : {}),
    })
    if (!response.ok) {
      setError(errorMessage(response.error))
      if (response.error.code === 'TRAINING_CONFLICT') {
        const latest = await sendExtensionMessage<TrainingSession | null>({ type: 'get-training-session', articleId })
        if (latest.ok && latest.data) setSaveConflict(latest.data)
      }
      return null
    }
    applySession(response.data)
    lastAutoSavedFingerprint.current = JSON.stringify([response.data.sessionId, response.data.currentStepId, answer, structuredDraft, importantParagraphs, threeSentenceDrafts, paragraphCursor])
    return response.data
  }

  const retrySave = async () => {
    if (saveConflict) return
    setBusy(true)
    setSaveStatus('saving')
    const saved = await persistCurrentDraft()
    setSaveStatus(saved ? 'saved' : 'error')
    setBusy(false)
  }

  const freezeCurrentAnswer = async (saved: TrainingSession) => {
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'freeze-training-answer',
      articleId,
      sessionId: saved.sessionId,
      stepId: saved.currentStepId,
      draftRevision: saved.draftRevision,
    })
    if (!response.ok) {
      setError(errorMessage(response.error))
      return null
    }
    applySession(response.data)
    return response.data
  }

  const validateCurrentDraft = () => {
    if (session && !isTrainingDraftValid({ ...session, draft: answer, structuredDraft, importantParagraphs, threeSentenceDrafts }, locale)) {
      setError(t('coach.structuredIncomplete'))
      return false
    }
    if (isThreeSentenceStep && importantParagraphs.length === 0) {
      setError(t('coach.selectImportantParagraph'))
      return false
    }
    if (isThreeSentenceStep && !threeSentenceComplete) {
      setError(t('coach.paragraphIncomplete'))
      return false
    }
    if (isThreePointsStep && !threePointsComplete) {
      setError(t('coach.threePointsIncomplete'))
      return false
    }
    if (isStructuredStep && !structuredComplete) {
      setError(t('coach.structuredIncomplete'))
      return false
    }
    if (answer.trim().length < 5) {
      setError(t('coach.answerTooShort'))
      return false
    }
    return true
  }

  const validateNavigableDraft = () => {
    if (!session || !isTrainingDraftNavigable({ ...session, draft: answer, structuredDraft, importantParagraphs, threeSentenceDrafts }, locale)) {
      setError(t('coach.partialIncomplete'))
      return false
    }
    return true
  }

  const submit = async () => {
    if (!validateCurrentDraft()) return
    if (!aiConfigured) {
      setError(t('error.AI_NOT_CONFIGURED'))
      return
    }
    setBusy(true)
    setError('')
    const draftResponse = await persistCurrentDraft()
    if (!draftResponse) {
      setBusy(false)
      return
    }
    const frozen = await freezeCurrentAnswer(draftResponse)
    if (!frozen) {
      setBusy(false)
      return
    }

    const aiResponse = await sendExtensionMessage<TrainingSession>({
      type: 'ai-grade',
      articleId,
    })
    setBusy(false)
    if (aiResponse.ok) {
      applySession(aiResponse.data)
      setReinforcing(false)
    } else setError(errorMessage(aiResponse.error))
  }

  const saveDraftOnly = async () => {
    if (!validateNavigableDraft()) return
    setBusy(true)
    setError('')
    const saved = await persistCurrentDraft()
    setBusy(false)
    setSaveStatus(saved ? 'saved' : 'error')
  }

  const saveAndContinuePartial = async () => {
    if (!session || session.currentStep >= LESSON_STEPS.length - 1 || !validateNavigableDraft()) return
    setBusy(true)
    setError('')
    const saved = await persistCurrentDraft()
    if (!saved) {
      setBusy(false)
      return
    }
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'continue-training-partial',
      articleId,
      sessionId: saved.sessionId,
      stepId: saved.currentStepId,
      draftRevision: saved.draftRevision,
    })
    setBusy(false)
    if (!response.ok) {
      setError(errorMessage(response.error))
      return
    }
    applySession(response.data)
    setSaveStatus('saved')
  }

  const saveReinforcement = async () => {
    if (!session?.sessionId || busy) return
    setBusy(true)
    try {
      const response = await sendExtensionMessage<TrainingSession>({ type: 'save-training-reinforcement', articleId, sessionId: session.sessionId, id: practiceId, answer })
      if (!response.ok) { setError(errorMessage(response.error)); return }
      applySession(response.data)
      setReinforcing(false)
    } finally { setBusy(false) }
  }

  const requestReferenceAnswer = async (turn: TrainingSession['turns'][number]) => {
    if (!turn.feedback || !aiConfigured || referenceAnswerBusy) return
    setReferenceAnswerBusy(true)
    setError('')
    try {
      const response = await sendExtensionMessage<TrainingSession>({
        type: 'ai-reference-answer',
        articleId,
        submittedAt: turn.submittedAt,
      })
      if (!response.ok) {
        setError(errorMessage(response.error))
        return
      }
      setSession((current) => current && current.sessionId === response.data.sessionId ? { ...current, turns: response.data.turns, answerVersions: response.data.answerVersions, aiRequests: response.data.aiRequests } : current)
    } catch {
      setError(t('feedback.referenceAnswerFailed'))
    } finally {
      setReferenceAnswerBusy(false)
    }
  }

  const exportHistorySession = (historicalSession: TrainingSession, format: 'markdown' | 'json') => {
    const model = buildReadingExportModel(article, historicalSession, locale)
    if (format === 'markdown') {
      downloadText(generateReadingMarkdown(model), sanitizeFilename(`${article.title}-${historicalSession.sessionId ?? 'history'}`, 'md', locale), 'text/markdown')
      return
    }
    downloadText(generateReadingJson(model), sanitizeFilename(`${article.title}-${historicalSession.sessionId ?? 'history'}`, 'json', locale), 'application/json')
  }

  const rewind = () => {
    if (!canGoBack || !window.confirm(t('coach.confirmBack'))) return
    setReinforcing(false)
    setReviewing(true)
    setReviewTurnIndex((session?.turns.length ?? 1) - 1)
  }

  const editReviewedTurn = async () => {
    if (reviewTurnIndex === null || !session) return
    setBusy(true)
    const pending = await pendingSave.current
    const base = pending && canRetryTrainingDraft(session, pending) ? pending : session
    setEditing({ base: { ...base, draft: answer, structuredDraft, importantParagraphs, threeSentenceDrafts, paragraphCursor }, turnIndex: reviewTurnIndex })
    setRevisionReason('')
    applySession(trainingEditPreview(base, reviewTurnIndex, locale))
    setBusy(false)
  }

  const saveRevision = async () => {
    if (!editing?.base.sessionId || !validateCurrentDraft()) return
    setBusy(true)
    setError('')
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'revise-training-turn', articleId, turnIndex: editing.turnIndex,
      sessionId: editing.base.sessionId, draftRevision: editing.base.draftRevision ?? 0,
      revision: { answer, structuredDraft: isStructuredStep ? structuredDraft : undefined,
        ...(isThreeSentenceStep ? { importantParagraphs, threeSentenceDrafts, paragraphCursor } : {}), reason: revisionReason },
    })
    setBusy(false)
    if (!response.ok) {
      setError(errorMessage(response.error))
      if (response.error.code === 'TRAINING_CONFLICT') {
        const latest = await sendExtensionMessage<TrainingSession | null>({ type: 'get-training-session', articleId })
        if (latest.ok && latest.data) setSaveConflict(latest.data)
      }
      return
    }
    const base = editing.base
    applySession(base.currentStep === response.data.currentStep ? { ...response.data, draft: base.draft, structuredDraft: base.structuredDraft, importantParagraphs: base.importantParagraphs, threeSentenceDrafts: base.threeSentenceDrafts, paragraphCursor: base.paragraphCursor } : response.data)
    setEditing(null)
  }

  const gradeSavedAnswer = async (turn: TrainingTurn) => {
    if (!session?.sessionId || !turn.answerVersionId || feedbackBusy) return
    if (!aiConfigured) {
      setError(t('error.AI_NOT_CONFIGURED'))
      return
    }
    setFeedbackBusy(true)
    setError('')
    const response = await sendExtensionMessage<TrainingSession>({ type: 'ai-grade', articleId, sessionId: session.sessionId, answerVersionId: turn.answerVersionId })
    setFeedbackBusy(false)
    if (!response.ok) { setError(errorMessage(response.error)); return }
    setSession((current) => mergeTrainingFeedback(current, response.data))
  }

  const confirmReviewedStep = async (targetStepId: string) => {
    if (!session || busy) return
    if (targetStepId === session.currentStepId) { await confirmStillApplies(); return }
    setBusy(true)
    const pending = await pendingSave.current
    const identity = pending && canRetryTrainingDraft(session, pending) ? pending : session
    const response = await sendExtensionMessage<TrainingSession>({ type: 'confirm-training-step', articleId, sessionId: identity.sessionId, draftRevision: identity.draftRevision, targetStepId })
    setBusy(false)
    if (!response.ok) { setError(errorMessage(response.error)); return }
    setSession(response.data)
  }

  const confirmStillApplies = async () => {
    if (!session || !step || busy || session.stepRecords?.[step.id]?.status !== 'needs-review') return
    setBusy(true)
    setError('')
    const saved = await persistCurrentDraft()
    if (!saved || saved.stepRecords?.[step.id]?.status !== 'needs-review') {
      setBusy(false)
      return
    }
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'confirm-training-step',
      articleId,
      sessionId: session.sessionId,
      stepId: session.currentStepId,
      draftRevision: saved.draftRevision,
    })
    setBusy(false)
    if (!response.ok) {
      setError(errorMessage(response.error))
      return
    }
    applySession(response.data)
    setReinforcing(false)
  }

  const reset = async () => {
    if (!window.confirm(t('coach.confirmReset'))) return
    const response = await sendExtensionMessage<null>({
      type: 'reset-training-session',
      articleId,
    })
    if (!response.ok) {
      setError(errorMessage(response.error))
      return
    }
    setSession(null)
    setStructuredDraft({})
    setImportantParagraphs([])
    setReinforcing(false)
    setReviewing(false)
    setAnswer('')
    setThreeSentenceDrafts([])
    setParagraphCursor(0)
    setHintVisible(false)
    setError('')
  }

  const localizedSteps = getLessonSteps(locale)
  const legacyReadOnly = session?.flowId === 'legacy-8'
  const historicalReadOnly = session?.flowId === 'reading-10' && session.courseVersion === 'guided-reading-10-v0'
  const readOnly = legacyReadOnly || historicalReadOnly
  const step = session && !readOnly ? localizedSteps[Math.min(session.currentStep, localizedSteps.length - 1)] : null
  const isStructuredStep = Boolean(step && !reinforcing && structuredFieldsForStep(step.id).length > 0)
  const argumentReady = step?.id !== 'toulmin-full' || Boolean(session?.argumentId?.trim())
  const structuredComplete = Boolean(step && isStructuredStep && isStructuredDraftComplete(step.id, structuredDraft) && argumentReady)
  const currentStepComplete = isThreeSentenceStep ? threeSentenceComplete : isThreePointsStep ? threePointsComplete : isStructuredStep ? structuredComplete : answer.trim().length >= 5
  const draftNavigable = Boolean(session && isTrainingDraftNavigable({ ...session, draft: answer, structuredDraft, importantParagraphs, threeSentenceDrafts }, locale))
  const pendingStepIndexes = session
    ? localizedSteps.map((candidate, index) => ({ candidate, index })).filter(({ candidate, index }) => index < session.currentStep && session.stepRecords?.[candidate.id]?.status === 'draft')
    : []
  const progressTotal = legacyReadOnly ? 8 : LESSON_STEPS.length
  const progressValue = trainingProgress(session).completed
  const displayedQuestion = session && step
    ? reinforcing ? session.currentQuestion : step.question
    : ''
  const latestTurn = session?.turns.at(-1)
  const simpleArgumentTurn = effectiveTrainingTurns(session).find((turn) => turn.stepId === 'toulmin-simple')
  const priorContextTurn = step?.id === 'toulmin-full' ? simpleArgumentTurn : latestTurn
  const priorContextStep = priorContextTurn?.stepId ? localizedSteps.find((candidate) => candidate.id === priorContextTurn.stepId) : undefined
  const completed = !editing && session?.flowId === 'reading-10' && trainingProgress(session).isComplete
  const needsReview = Boolean(!reinforcing && step && session?.stepRecords?.[step.id]?.status === 'needs-review')
  const currentVersion = session?.answerVersionId ? session.answerVersions?.find((version) => version.id === session.answerVersionId) : undefined
  const awaitingAiFeedback = Boolean(!reinforcing && currentVersion && currentVersion.stepId === session?.currentStepId && !currentVersion.feedback)
  const reviewTurn = reviewTurnIndex === null ? null : session?.turns[reviewTurnIndex] ?? null
  const transition = latestTurn?.feedback && latestTurn.stepId === 'preview'
    ? t('coach.transitionAfterPreview')
    : latestTurn?.feedback && latestTurn.stepId === 'quick-browse'
      ? t('coach.transitionAfterBrowse')
      : ''

  return (
    <section className={session ? 'coach-card coach-card-active' : 'coach-card'} aria-label={t('coach.aria')}>
      <div className="coach-heading">
        <div className="coach-title">
          <img className="coach-logo" src="/icons/icon32.png" alt="" aria-hidden="true" />
          <div>
            <span className="section-kicker">{aiConfigured ? t('coach.aiLabel') : t('coach.localLabel')}</span>
            <h2>{t('coach.heading')}</h2>
            <p>{aiConfigured ? t('coach.aiDescription') : t('coach.localDescription')}</p>
          </div>
        </div>
        {session && (
          <div className="coach-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progressTotal} aria-valuenow={progressValue} aria-label={`${progressValue} / ${progressTotal}`}>
            <strong>{progressValue} / {progressTotal}</strong>
            <span className="progress-track"><span style={{ width: `${(progressValue / progressTotal) * 100}%` }} /></span>
            {trainingProgress(session).pendingReview > 0 && <small>{t('coach.pendingReviewCount', { count: trainingProgress(session).pendingReview })}</small>}
          </div>
        )}
      </div>

      {!loaded ? (
        <p className="loading-state compact-loading">{t('coach.loading')}</p>
      ) : !session ? (
        <div className="coach-start">
          <ol className="pre-read-list">
            <li>{t('coach.preRead1')}</li>
            <li>{t('coach.preRead2')}</li>
            <li>{t('coach.preRead3')}</li>
          </ol>
          <label className="read-confirmation">
            <input type="checkbox" checked={preReadConfirmed} onChange={(event) => setPreReadConfirmed(event.target.checked)} disabled={busy} />
            <span>{t('coach.readConfirm')}</span>
          </label>
          <button className="primary-button" type="button" onClick={() => void start()} disabled={busy || !preReadConfirmed}>
            {busy ? t('coach.starting') : aiConfigured ? t('coach.startAi') : t('coach.start')}
          </button>
          {!aiConfigured && <button className="text-button" type="button" onClick={() => void sendExtensionMessage({ type: 'open-settings' })}>{t('coach.goSettings')}</button>}
        </div>
      ) : readOnly ? (
        <div className="coach-start">
          <p className="round-instruction">{historicalReadOnly ? t('coach.historicalReadOnly') : t('coach.legacyReadOnly')}</p>
          <button className="primary-button" type="button" onClick={() => void start()} disabled={busy}>
            {busy ? t('coach.starting') : t('coach.startTenStep')}
          </button>
        </div>
      ) : reviewing && reviewTurn ? (
        <div className="coach-review">
          <div className="round-meta">
            <span>{t('coach.reviewOnly')}</span>
            <strong>{reviewTurn.stepId ?? t('coach.heading')}</strong>
          </div>
          <h3>{reviewTurn.question}</h3>
          <div className="review-answer">
            <strong>{t('coach.myAnswer')}</strong>
            <p>{reviewTurn.answer}</p>
          </div>
          {reviewTurn.feedback && <FeedbackCard feedback={reviewTurn.feedback} referenceAnswer={reviewTurn.referenceAnswer} referenceAnswerBusy={referenceAnswerBusy} canGenerateReferenceAnswer={aiConfigured} onGenerateReferenceAnswer={() => void requestReferenceAnswer(reviewTurn)} />}
          {reviewTurn.revisionReason && <p>{t('coach.revisionReason')}: {reviewTurn.revisionReason}</p>}
          {!reviewTurn.feedback && <button className="secondary-button" type="button" disabled={feedbackBusy} onClick={() => void gradeSavedAnswer(reviewTurn)}>{feedbackBusy ? t('coach.grading') : t('coach.getFeedback')}</button>}
          <div className="round-actions">
            <button className="secondary-button" type="button" onClick={() => { setReviewing(false); setReviewTurnIndex(null) }} disabled={busy}>{t('coach.closeReview')}</button>
            <button className="primary-button" type="button" onClick={() => void editReviewedTurn()} disabled={busy || session.stepRecords?.[reviewTurn.stepId ?? '']?.answerVersionId !== reviewTurn.answerVersionId}>{t('coach.editReviewed')}</button>
          </div>
        </div>
      ) : reinforcing ? (
        <div className="coach-round">
          <h3>{t('coach.reinforceLabel')}</h3>
          <textarea aria-label={t('coach.reinforceLabel')} value={answer} maxLength={4000} onChange={(event) => setAnswer(event.target.value)} disabled={busy} />
          <div className="round-actions">
            <button type="button" className="primary-button" onClick={() => void saveReinforcement()} disabled={busy || answer.trim().length < 5}>{t('coach.saveContinue')}</button>
            <button type="button" className="secondary-button" onClick={() => setReinforcing(false)} disabled={busy}>{t('coach.closeReview')}</button>
          </div>
        </div>
      ) : completed ? (
        <>
          {testMode && <TestStepNavigator steps={localizedSteps} currentStep={session.currentStep} busy={busy} onJump={(stepIndex) => void jumpToTestStep(stepIndex)} />}
          {pendingStepIndexes.length > 0 && (
            <div className="pending-step-panel" role="status">
              <span>{t('coach.pendingSteps')}</span>
              <div className="pending-step-list">
                {pendingStepIndexes.map(({ candidate, index }) => (
                  <button className="text-button" type="button" key={candidate.id} onClick={() => void jumpToTestStep(index)} disabled={busy}>
                    {t('coach.pendingStep', { number: index + 1, name: candidate.name })}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="coach-complete">
            <span className="complete-mark">✓</span>
            <div>
              <h3>{t('coach.completedHeading')}</h3>
              <p>{t('coach.completedCopy')}</p>
            </div>
            {canGoBack && <button className="secondary-button" type="button" onClick={() => void rewind()} disabled={busy}>{t('coach.back')}</button>}
            <button className="secondary-button" type="button" onClick={() => void reset()}>{t('coach.restart')}</button>
            <button className="secondary-button" type="button" onClick={() => { setPracticeId(crypto.randomUUID()); setReinforcing(true); setAnswer(''); setHintVisible(false); setError('') }}>{t('coach.reinforce')}</button>
          </div>
          {latestTurn?.feedback && <FeedbackCard feedback={latestTurn.feedback} referenceAnswer={latestTurn.referenceAnswer} referenceAnswerBusy={referenceAnswerBusy} canGenerateReferenceAnswer={aiConfigured} onGenerateReferenceAnswer={() => void requestReferenceAnswer(latestTurn)} />}
        </>
      ) : step ? (
        <div className="coach-round">
          <div className="round-meta">
            <span>{reinforcing ? t('coach.reinforceLabel') : step.name}</span>
            <strong>{step.focus}</strong>
          </div>
          {testMode && <TestStepNavigator steps={localizedSteps} currentStep={session.currentStep} busy={busy} onJump={(stepIndex) => void jumpToTestStep(stepIndex)} />}
          {latestTurn?.feedback && <FeedbackCard feedback={latestTurn.feedback} referenceAnswer={latestTurn.referenceAnswer} referenceAnswerBusy={referenceAnswerBusy} canGenerateReferenceAnswer={aiConfigured} onGenerateReferenceAnswer={() => void requestReferenceAnswer(latestTurn)} />}
          {transition && <p className="round-transition">{transition}</p>}
          {needsReview && (
            <div className="review-required" role="status">
              <p>{t('coach.needsReview')}</p>
              <button className="secondary-button" type="button" onClick={() => void confirmStillApplies()} disabled={busy}>{t('coach.confirmStillApplies')}</button>
            </div>
          )}
          {awaitingAiFeedback && <p className="round-transition">{t('coach.awaitingAiFeedback')}</p>}
          {priorContextTurn && priorContextTurn.answer && priorContextTurn.stepId !== step.id && (
            <details className="prior-context" open={step.id === 'toulmin-full'}>
              <summary>{step.id === 'toulmin-full' ? t('coach.argumentContext') : t('coach.previousWork')}</summary>
              <strong>{priorContextStep?.name ?? t('coach.heading')}</strong>
              <p>{priorContextTurn.answer}</p>
              {step.id === 'toulmin-full' && session?.argumentId && <small>{t('coach.argumentIdLabel', { id: session.argumentId })}</small>}
            </details>
          )}
          <h3>{displayedQuestion}</h3>
          <p className="round-instruction">{step.instruction}</p>
          <button className="text-button hint-toggle" type="button" onClick={() => setHintVisible((visible) => !visible)}>{hintVisible ? t('coach.hideHint') : t('coach.showHint')}</button>
          {hintVisible && <p className="round-hint">{step.hint}</p>}
          {isThreeSentenceStep ? (
            <div className="three-sentence-workbench">
              {currentParagraph ? (
                <>
                  <div className="paragraph-progress">
                    <span>{t('coach.paragraphProgress', { current: paragraphCursor + 1, total: paragraphs.length })}</span>
                    <strong>{t('coach.selectedParagraphs', { count: importantParagraphs.length })}</strong>
                  </div>
                  <div className="source-paragraph-card">
                    <p>{currentParagraph.text}</p>
                    {currentParagraph.text.split(/[。！？.!?]+/).filter((sentence) => sentence.trim()).length <= 1 && (
                      <small>{t('coach.singleSentenceHint')}</small>
                    )}
                  </div>
                  <label className="paragraph-selection">
                    <input type="checkbox" checked={currentParagraphSelected} onChange={() => toggleImportantParagraph(currentParagraph.paragraph)} disabled={busy} />
                    <span>{t('coach.markImportant')}</span>
                  </label>
                  <div className="three-sentence-field">
                    <label>
                      <span>{t('coach.threeSentence.what')}</span>
                      <textarea value={currentParagraphDraft?.what ?? ''} onChange={(event) => updateThreeSentenceField('what', event.target.value)} placeholder={t('coach.answerPlaceholder')} rows={3} maxLength={2000} disabled={busy || !currentParagraphSelected} />
                    </label>
                    <FieldAssist fieldId="what" assist={fieldAssists.what} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={busy || !currentParagraphSelected} showFieldAssist={testMode} onRequest={requestFieldAssist} />
                  </div>
                  <div className="three-sentence-field">
                    <label>
                      <span>{t('coach.threeSentence.why')}</span>
                      <small>{t('coach.threeSentence.whyHint')}</small>
                      <textarea value={currentParagraphDraft?.why ?? ''} onChange={(event) => updateThreeSentenceField('why', event.target.value)} placeholder={t('coach.answerPlaceholder')} rows={3} maxLength={2000} disabled={busy || !currentParagraphSelected} />
                    </label>
                    <FieldAssist fieldId="why" assist={fieldAssists.why} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={busy || !currentParagraphSelected} showFieldAssist={testMode} onRequest={requestFieldAssist} />
                  </div>
                  <div className="three-sentence-field">
                    <label>
                      <span>{t('coach.threeSentence.takeaway')}</span>
                      <textarea value={currentParagraphDraft?.takeaway ?? ''} onChange={(event) => updateThreeSentenceField('takeaway', event.target.value)} placeholder={t('coach.answerPlaceholder')} rows={3} maxLength={2000} disabled={busy || !currentParagraphSelected} />
                    </label>
                    <FieldAssist fieldId="takeaway" assist={fieldAssists.takeaway} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={busy || !currentParagraphSelected} showFieldAssist={testMode} onRequest={requestFieldAssist} />
                  </div>
                  <div className="three-sentence-field">
                    <label>
                      <span>{t('coach.threeSentence.role')}</span>
                      <textarea value={currentParagraphDraft?.role ?? ''} onChange={(event) => updateThreeSentenceField('role', event.target.value)} placeholder={t('coach.answerPlaceholder')} rows={2} maxLength={2000} disabled={busy || !currentParagraphSelected} />
                    </label>
                    <FieldAssist fieldId="role" assist={fieldAssists.role} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={busy || !currentParagraphSelected} showFieldAssist={testMode} onRequest={requestFieldAssist} />
                  </div>
                  <div className="three-sentence-field">
                    <label>
                      <span>{t('coach.threeSentence.evidence')}</span>
                      <small>{t('coach.threeSentence.whyHint')}</small>
                      <textarea value={currentParagraphDraft?.evidence ?? ''} onChange={(event) => updateThreeSentenceField('evidence', event.target.value)} placeholder={t('coach.answerPlaceholder')} rows={2} maxLength={2000} disabled={busy || !currentParagraphSelected} />
                    </label>
                    <FieldAssist fieldId="evidence" assist={fieldAssists.evidence} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={busy || !currentParagraphSelected} showFieldAssist={testMode} onRequest={requestFieldAssist} />
                  </div>
                  <div className="paragraph-navigation">
                    <button className="secondary-button" type="button" onClick={() => moveToParagraph(paragraphCursor - 1)} disabled={busy || paragraphCursor === 0}>{t('coach.previousParagraph')}</button>
                    <button className="secondary-button" type="button" onClick={() => moveToParagraph(paragraphCursor + 1)} disabled={busy || paragraphCursor >= paragraphs.length - 1}>{t('coach.nextParagraph')}</button>
                  </div>
                </>
              ) : <p className="round-instruction">{t('coach.paragraphIncomplete')}</p>}
            </div>
          ) : step.id === 'quick-browse' && (structuredDraft['quickBrowse.paragraphMap'] !== undefined || (!structuredDraft['quickBrowse.paragraphLabels'] && !structuredDraft['quickBrowse.representativeSentences'])) ? (
            <BrowseTrainingForm blocks={JSON.parse(sourceBlocksJson)} draft={structuredDraft} disabled={busy} onChange={updateStructuredField} previewQuestion={effectiveTrainingTurns(session).find((turn) => turn.stepId === 'preview')?.structuredDraft?.['preview.expectedQuestion'] ?? ''} aiConfigured={aiConfigured} fieldAssists={fieldAssists} fieldAssistBusy={fieldAssistBusy} showFieldAssist={testMode} onRequestFieldAssist={requestFieldAssist} />
          ) : step.id === 'questions' && (structuredDraft['questions.items'] !== undefined || !structuredDraft['questions.question']) ? (
            <QuestionsTrainingForm draft={structuredDraft} disabled={busy} onChange={updateStructuredField} aiConfigured={aiConfigured} fieldAssists={fieldAssists} fieldAssistBusy={fieldAssistBusy} showFieldAssist={testMode} onRequestFieldAssist={requestFieldAssist} />
          ) : isThreePointsStep ? (
            <>
              <ThreePointsTrainingForm answer={answer} locale={locale} disabled={busy} onChange={(value) => {
                setAnswer(value)
                const evidence = readSummaryEvidence(structuredDraft['threePoints.evidence'])
                if (evidence?.checked) updateStructuredField('threePoints.evidence', JSON.stringify({ ...evidence, checked: false }))
              }} aiConfigured={aiConfigured} fieldAssists={fieldAssists} fieldAssistBusy={fieldAssistBusy} showFieldAssist={testMode} onRequestFieldAssist={requestFieldAssist} />
              {structuredDraft['threePoints.evidence'] !== undefined && session.articleSnapshot ? <SummaryEvidenceForm value={structuredDraft['threePoints.evidence']} snapshot={session.articleSnapshot} disabled={busy} onChange={(value) => updateStructuredField('threePoints.evidence', value)} aiConfigured={aiConfigured} fieldAssists={fieldAssists} fieldAssistBusy={fieldAssistBusy} showFieldAssist={testMode} onRequestFieldAssist={requestFieldAssist} /> : <StructuredTrainingForm draft={structuredDraft} stepId={step.id} disabled={busy} onChange={updateStructuredField} aiConfigured={aiConfigured} fieldAssists={fieldAssists} fieldAssistBusy={fieldAssistBusy} showFieldAssist={testMode} onRequestFieldAssist={requestFieldAssist} />}
            </>
          ) : isStructuredStep ? (
            <>
              {step.id === 'preview' && structuredDraft['preview.metadata'] !== undefined && <MetadataReviewForm value={structuredDraft['preview.metadata']} disabled={busy} onChange={(value) => updateStructuredField('preview.metadata', value)} aiConfigured={aiConfigured} fieldAssists={fieldAssists} fieldAssistBusy={fieldAssistBusy} showFieldAssist={testMode} onRequestFieldAssist={requestFieldAssist} />}
              {step.id === 'assumptions' && readQuestions(effectiveTrainingTurns(session).find((turn) => turn.stepId === 'questions')?.structuredDraft?.['questions.items']).filter((row) => row.selected).map((row) => <details key={row.id}><summary>{t('coach.questions.key')}: {row.question}</summary><p>{row.whyImportant}</p><p>{t('coach.field.answered')}: {row.answered}</p><p>{t('coach.field.unanswered')}: {row.unanswered}</p></details>)}
              {['assumptions', 'toulmin-simple', 'toulmin-full'].includes(step.id) && <ApplicabilityForm blocks={JSON.parse(sourceBlocksJson)} draft={structuredDraft} disabled={busy} onChange={updateStructuredField} aiConfigured={aiConfigured} fieldAssists={fieldAssists} fieldAssistBusy={fieldAssistBusy} showFieldAssist={testMode} onRequestFieldAssist={requestFieldAssist} />}
              {structuredDraft['applicability.mode'] !== 'not-applicable' && <StructuredTrainingForm draft={structuredDraft} stepId={step.id} disabled={busy} onChange={updateStructuredField} aiConfigured={aiConfigured} fieldAssists={fieldAssists} fieldAssistBusy={fieldAssistBusy} showFieldAssist={testMode} onRequestFieldAssist={requestFieldAssist} />}
            </>
          ) : (
            <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={t('coach.answerPlaceholder')} rows={8} maxLength={4000} disabled={busy} />
          )}
          {editing && <label className="structured-field">{t('coach.revisionReason')}<textarea value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} maxLength={1000} rows={2} disabled={busy} /></label>}
          <div className="round-footer">
            <span>{answer.length.toLocaleString()} / {answerMaxLength.toLocaleString()} {t('common.characters')}</span>
            <div className="round-actions">
              {editing ? <>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => { applySession(editing.base); setEditing(null); setError('') }}>{t('coach.cancelEdit')}</button>
                <button className="primary-button" type="button" disabled={busy || !revisionReason.trim()} onClick={() => void saveRevision()}>{t('coach.saveRevision')}</button>
              </> : <>
              {canGoBack && <button className="secondary-button" type="button" onClick={() => void rewind()} disabled={busy}>{t('coach.back')}</button>}
              <button className="secondary-button" type="button" onClick={() => void saveDraftOnly()} disabled={busy || !draftNavigable}>{t('coach.saveAnswer')}</button>
              {!currentStepComplete && session.currentStep < LESSON_STEPS.length - 1 && (
                <button className="secondary-button" type="button" onClick={() => void saveAndContinuePartial()} disabled={busy || !draftNavigable}>{t('coach.saveAndContinuePartial')}</button>
              )}
              <button className="secondary-button" type="button" onClick={() => void submit()} disabled={busy || answer.trim().length < 5 || (isThreeSentenceStep && !threeSentenceComplete) || (isThreePointsStep && !threePointsComplete) || (isStructuredStep && !structuredComplete)}>
                {busy ? t('coach.grading') : aiConfigured ? t('coach.gradeAndContinue') : t('coach.configureAiToContinue')}
              </button>
              </>}
            </div>
          </div>
          {saveStatus !== 'idle' && (
            <div className="save-status-row">
              <p className="save-status" role="status">{t(`coach.saveStatus.${saveStatus}`)}</p>
              {saveStatus === 'error' && !saveConflict && <button className="text-button" type="button" onClick={() => void retrySave()} disabled={busy}>{t('coach.retrySave')}</button>}
            </div>
          )}
        </div>
      ) : null}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!editing && !readOnly && session && session.turns.length > 0 && <details className="training-history">
        <summary>{t('coach.history', { count: effectiveTrainingTurns(session, true).length })}</summary>
        {effectiveTrainingTurns(session, true).map((turn) => <div key={turn.answerVersionId ?? turn.stepId}>
          <strong>{t('coach.round', { number: turn.stepIndex + 1 })}{turn.feedback ? ` · ${turn.feedback.total} / 100` : ''}</strong>
          <button type="button" className="text-button" disabled={busy} onClick={() => { setReviewing(true); setReviewTurnIndex(session.turns.indexOf(turn)) }}>{t('coach.reviewOnly')}</button>
        </div>)}
      </details>}
      {saveConflict && session && <div className="review-required" role="alert">
        <p>{t('coach.saveConflict')}</p>
        <details open><summary>{t('coach.remoteDraft')}</summary><pre>{editing ? saveConflict.turns.find((turn) => turn.answerVersionId === saveConflict.stepRecords?.[session.currentStepId ?? '']?.answerVersionId)?.answer ?? saveConflict.draft : saveConflict.draft}</pre></details>
        <details open><summary>{t('coach.localDraft')}</summary><pre>{answer}</pre></details>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => { applySession(saveConflict); setEditing(null); setError('') }}>{t('coach.useRemote')}</button>
        {!editing && canRetryTrainingDraft(session, saveConflict) && <button className="primary-button" type="button" disabled={busy} onClick={async () => { setBusy(true); const saved = await persistCurrentDraft(saveConflict); setSaveStatus(saved ? 'saved' : 'error'); setBusy(false) }}>{t('coach.keepLocal')}</button>}
        {editing && editing.base.sessionId === saveConflict.sessionId && editing.base.articleSnapshotId === saveConflict.articleSnapshotId && <button className="primary-button" type="button" disabled={busy} onClick={() => {
          const target = saveConflict.turns.findLastIndex((turn) => turn.stepId === session.currentStepId && turn.answerVersionId === saveConflict.stepRecords?.[session.currentStepId ?? '']?.answerVersionId)
          if (target < 0) return
          setEditing({ base: saveConflict, turnIndex: target }); setSaveConflict(null); setError('')
        }}>{t('coach.keepLocal')}</button>}
        <button className="text-button" type="button" onClick={() => downloadText(JSON.stringify({ sessionId: session.sessionId, stepId: session.currentStepId, answer, structuredDraft, importantParagraphs, threeSentenceDrafts, revisionReason }, null, 2), 'reading-unsaved-draft.json', 'application/json')}>{t('coach.downloadDraft')}</button>
      </div>}
      {!editing && session && Object.values(session.stepRecords ?? {}).some((record) => record.status === 'needs-review') && <details className="training-history">
        <summary>{t('coach.reviewChanges')}</summary>
        {Object.values(session.stepRecords ?? {}).filter((record) => record.status === 'needs-review').map((record) => <div key={record.stepId}>
          <strong>{localizedSteps.find((item) => item.id === record.stepId)?.name}</strong><p>{record.draft}</p>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void confirmReviewedStep(record.stepId)}>{t('coach.confirmStillApplies')}</button>
        </div>)}
      </details>}
      {session && <button type="button" className="text-button" onClick={() => setHistoryView(session)}>{t('coach.historyView')}</button>}
      {historySessions.length > 1 && (
        <details className="training-history session-history-list">
          <summary>{t('coach.historySessions', { count: historySessions.length })}</summary>
          {historySessions.map((item) => (
            <div className="history-session-row" key={item.sessionId ?? `${item.articleId}-${item.startedAt}`}>
              <span>{item.courseVersion ?? item.flowId} · {item.turns.length} {t('coach.rounds')}</span>
              <small>{item.isArchived ? t('coach.historyArchived') : t('coach.historyCurrent')}</small>
              <button className="text-button" type="button" onClick={() => setHistoryView(item)}>{t('coach.historyView')}</button>
            </div>
          ))}
        </details>
      )}
      {historyView && <TrainingHistoryView session={historyView} onClose={() => setHistoryView(null)} onExport={(format) => exportHistorySession(historyView, format)} />}
    </section>
  )
}

function TrainingHistoryView({ session, onClose, onExport }: { session: TrainingSession; onClose: () => void; onExport: (format: 'markdown' | 'json') => void }) {
  const { t } = useI18n()
  return (
    <section className="history-view" aria-label={t('coach.historyView')}>
      <div className="round-meta">
        <span>{session.isArchived ? t('coach.historyArchived') : t('coach.historyCurrent')}</span>
        <strong>{session.courseVersion ?? session.flowId}</strong>
      </div>
      {session.turns.length === 0 ? <p>{t('coach.historyEmpty')}</p> : session.turns.map((turn, index) => (
        <article className="history-view-turn" key={`${turn.answerVersionId ?? index}-${turn.submittedAt}`}>
          <h4>{t('coach.round', { number: turn.stepIndex + 1 })} · {turn.stepId ?? turn.stepIndex + 1}</h4>
          <p><strong>{t('coach.question')}</strong> {turn.question}</p>
          <p><strong>{t('coach.myAnswer')}</strong> {turn.answer}</p>
          {turn.feedback && <p><strong>{t('coach.score')}</strong> {turn.feedback.total} / 100</p>}
        </article>
      ))}
      {session.answerVersions?.filter((version) => !session.turns.some((turn) => turn.answerVersionId === version.id)).map((version) => (
        <article className="history-view-turn" key={version.id}>
          <h4>{t('coach.round', { number: version.stepIndex + 1 })} · {version.id}</h4>
          <p>{version.answer}</p>
          {version.feedback && <FeedbackCard feedback={version.feedback} />}
        </article>
      ))}
      {session.reinforcements?.map((item) => <article className="history-view-turn" key={item.id}><h4>{t('coach.reinforceLabel')}</h4><p>{item.answer}</p></article>)}
      <div className="round-actions">
        <button className="secondary-button" type="button" onClick={() => onExport('markdown')}>{t('training.markdown')}</button>
        <button className="secondary-button" type="button" onClick={() => onExport('json')}>{t('training.json')}</button>
        <button className="secondary-button" type="button" onClick={onClose}>{t('coach.closeReview')}</button>
      </div>
    </section>
  )
}

function TestStepNavigator({
  steps,
  currentStep,
  busy,
  onJump,
}: {
  steps: ReturnType<typeof getLessonSteps>
  currentStep: number
  busy: boolean
  onJump: (stepIndex: number) => void
}) {
  const { t } = useI18n()

  return (
    <section className="test-mode-panel" aria-label={t('coach.testModeStepsAria')}>
      <div className="test-mode-heading">
        <strong>{t('coach.testModeLabel')}</strong>
        <small>{t('coach.testModeHint')}</small>
      </div>
      <nav className="test-step-grid" aria-label={t('coach.testModeStepsAria')}>
        {steps.map((step, index) => (
          <button
            className={index === currentStep ? 'test-step-button active' : 'test-step-button'}
            type="button"
            key={step.id}
            onClick={() => onJump(index)}
            disabled={busy}
            aria-current={index === currentStep ? 'step' : undefined}
          >
            <span>{index + 1}</span>
            <small>{step.name}</small>
          </button>
        ))}
      </nav>
    </section>
  )
}

function ThreePointsTrainingForm({
  answer,
  locale,
  disabled,
  onChange,
  aiConfigured,
  fieldAssists,
  fieldAssistBusy,
  showFieldAssist,
  onRequestFieldAssist,
}: {
  answer: string
  locale: string
  disabled: boolean
  onChange: (value: string) => void
  aiConfigured: boolean
  fieldAssists: Record<string, TrainingFieldAssist>
  fieldAssistBusy: string | null
  showFieldAssist: boolean
  onRequestFieldAssist: (fieldId: string, mode: TrainingFieldAssistMode) => void
}) {
  const { t } = useI18n()
  const points = parseThreePointsAnswer(answer)
  return (
    <div className="three-points-form">
      <p className="structured-training-hint">{t('coach.threePointsHint')}</p>
      {points.map((point, index) => (
        <div className="three-points-field" key={index}>
          <label>
            <span>{t('coach.threePointLabel', { number: index + 1 })}</span>
            <input
              value={point}
              onChange={(event) => {
                const next = [...points]
                next[index] = event.target.value
                onChange(next.join('\n'))
              }}
              maxLength={4000}
              disabled={disabled}
            />
          </label>
          <small>{summaryPointLength(point, locale)} / 15 {locale === 'en' ? 'words' : ''}</small>
          <FieldAssist fieldId={`threePoints.point${index + 1}`} assist={fieldAssists[`threePoints.point${index + 1}`]} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
        </div>
      ))}
    </div>
  )
}

function parseThreePointsAnswer(answer: string) {
  const points = answer
    .split(/\r?\n/)
    .map((point) => point.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim())
    .slice(0, 3)
  return [points[0] ?? '', points[1] ?? '', points[2] ?? '']
}

function formatStructuredAnswer(
  stepId: string,
  draft: TrainingStructuredDraft,
  translateText: (key: string) => string,
) {
  return (STRUCTURED_FIELD_DEFINITIONS[stepId] ?? [])
    .filter(({ id }) => requiredFieldsForDraft(stepId, draft).includes(id))
    .filter(({ id }) => Boolean(draft[id]?.trim()))
    .map(({ id, labelKey }) => id === 'quickBrowse.paragraphMap'
      ? readBrowseRows(draft[id]).map((row) => `${row.paragraph} [${row.sourceId}] ${row.role ? translateText(`coach.browse.role.${row.role}`) : ''}${row.important ? ` · ${translateText('coach.browse.candidate')}` : ''}\n${translateText('coach.browse.first')}: ${row.first}\n${translateText('coach.browse.last')}: ${row.last}`).join('\n')
      : id === 'questions.items' ? formatQuestions(draft[id], translateText) : id === 'preview.metadata' ? formatMetadataReview(draft[id], translateText) : `${translateText(labelKey)}：${draft[id]?.trim() ?? ''}`)
    .join('\n')
}

function BrowseTrainingForm({ blocks, draft, disabled, onChange, previewQuestion, aiConfigured, fieldAssists, fieldAssistBusy, showFieldAssist, onRequestFieldAssist }: {
  blocks: import('./types').ArticleBlock[]
  draft: TrainingStructuredDraft
  disabled: boolean
  onChange: (field: TrainingDraftFieldId, value: string) => void
  previewQuestion: string
  aiConfigured: boolean
  fieldAssists: Record<string, TrainingFieldAssist>
  fieldAssistBusy: string | null
  showFieldAssist: boolean
  onRequestFieldAssist: (fieldId: string, mode: TrainingFieldAssistMode) => void
}) {
  const { t } = useI18n()
  const rows = draft['quickBrowse.paragraphMap'] === undefined ? createBrowseRows(blocks) : readBrowseRows(draft['quickBrowse.paragraphMap'])
  const candidateCount = rows.filter((row) => row.important).length
  const updateRow = (index: number, change: Partial<(typeof rows)[number]>) => onChange('quickBrowse.paragraphMap', JSON.stringify(rows.map((row, i) => i === index ? { ...row, ...change } : row)))
  return <div className="structured-training-form">
    {previewQuestion && <p className="browse-preview-question">{t('coach.field.expectedQuestion')}: {previewQuestion}</p>}
    <div className="structured-field-block">
      <label className="structured-field"><span>{t('coach.field.structureOverview')}</span><textarea value={draft['quickBrowse.structure'] ?? ''} maxLength={800} disabled={disabled} onChange={(event) => onChange('quickBrowse.structure', event.target.value)} /></label>
      <FieldAssist fieldId="quickBrowse.structure" assist={fieldAssists['quickBrowse.structure']} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
    </div>
    <p className="browse-training-hint">{t('coach.browse.hint')}</p>
    <section className="browse-paragraph-section" aria-labelledby="browse-paragraph-heading">
      <div className="browse-paragraph-heading">
        <strong id="browse-paragraph-heading">{t('coach.browse.paragraphHeading')}</strong>
        <span>{t('coach.browse.stats', { count: rows.length, candidates: candidateCount })}</span>
      </div>
      <div className="browse-paragraph-list">
      {rows.map((row, index) => <details className="browse-paragraph-card" key={row.sourceId}>
      <summary>{t('feedback.paragraph', { number: row.paragraph })} {row.role ? t(`coach.browse.role.${row.role}`) : '—'}{row.important ? ' ★' : ''}</summary>
      <fieldset disabled={disabled}>
      <legend className="browse-paragraph-legend">{t('feedback.paragraph', { number: row.paragraph })}</legend>
      <details><summary>{t('export.sourceText')}</summary><p>{numberArticleBlocks(blocks).find((item) => item.paragraph === row.paragraph)?.text}</p></details>
      <div className="structured-field-block">
        <label className="structured-field"><span>{t('coach.field.paragraphLabels')}</span><select value={row.role} onChange={(event) => updateRow(index, { role: event.target.value })}><option value="">—</option>{PARAGRAPH_ROLES.map((role) => <option value={role} key={role}>{t(`coach.browse.role.${role}`)}</option>)}</select></label>
        <FieldAssist fieldId={`quickBrowse.paragraphLabels:${row.paragraph}`} assist={fieldAssists[`quickBrowse.paragraphLabels:${row.paragraph}`]} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
      </div>
      <div className="structured-field-block">
        <label className="structured-field"><span>{t('coach.browse.first')}</span><textarea value={row.first} onChange={(event) => updateRow(index, { first: event.target.value })} /></label>
        <FieldAssist fieldId={`quickBrowse.first:${row.paragraph}`} assist={fieldAssists[`quickBrowse.first:${row.paragraph}`]} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
      </div>
      <div className="structured-field-block">
        <label className="structured-field"><span>{t('coach.browse.last')}</span><textarea value={row.last} onChange={(event) => updateRow(index, { last: event.target.value })} /></label>
        <FieldAssist fieldId={`quickBrowse.last:${row.paragraph}`} assist={fieldAssists[`quickBrowse.last:${row.paragraph}`]} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
      </div>
      <label><input type="checkbox" checked={row.important} onChange={(event) => updateRow(index, { important: event.target.checked })} />{t('coach.browse.candidate')}</label>
    </fieldset></details>)}
      </div>
    </section>
  </div>
}

function QuestionsTrainingForm({ draft, disabled, onChange, aiConfigured, fieldAssists, fieldAssistBusy, showFieldAssist, onRequestFieldAssist }: {
  draft: TrainingStructuredDraft
  disabled: boolean
  onChange: (field: TrainingDraftFieldId, value: string) => void
  aiConfigured: boolean
  fieldAssists: Record<string, TrainingFieldAssist>
  fieldAssistBusy: string | null
  showFieldAssist: boolean
  onRequestFieldAssist: (fieldId: string, mode: TrainingFieldAssistMode) => void
}) {
  const { t } = useI18n()
  const rows = readQuestions(draft['questions.items'])
  const save = (next: ReadingQuestion[]) => onChange('questions.items', JSON.stringify(next))
  const update = (id: string, patch: Partial<ReadingQuestion>) => save(rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  return <div className="structured-training-form">
    <p>{t('coach.questions.hint')}</p>
    {rows.map((row) => <fieldset key={row.id} disabled={disabled}>
      <legend>{t('coach.field.question')}</legend>
      <div className="structured-field-block">
        <label className="structured-field"><span>{t('coach.field.questionCategory')}</span><select value={row.category} onChange={(event) => update(row.id, { category: event.target.value })}>{QUESTION_CATEGORIES.map((category) => <option value={category} key={category}>{category.toUpperCase()}</option>)}</select></label>
        <FieldAssist fieldId={`questions.category:${row.id}`} assist={fieldAssists[`questions.category:${row.id}`]} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
      </div>
      <div className="structured-field-block">
        <label className="structured-field"><span>{t('coach.field.question')}</span><textarea value={row.question} maxLength={800} onChange={(event) => update(row.id, { question: event.target.value })} /></label>
        <FieldAssist fieldId={`questions.question:${row.id}`} assist={fieldAssists[`questions.question:${row.id}`]} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
      </div>
      <label><input type="checkbox" checked={row.selected} disabled={!row.selected && rows.filter((item) => item.selected).length >= 2} onChange={(event) => update(row.id, { selected: event.target.checked })} />{t('coach.questions.key')}</label>
      {row.selected && (['whyImportant', 'relatedParagraphs', 'answered', 'unanswered'] as const).map((field) => <div className="structured-field-block" key={field}><label className="structured-field"><span>{t(`coach.field.${field}`)}</span><textarea value={row[field]} maxLength={800} onChange={(event) => update(row.id, { [field]: event.target.value })} /></label><FieldAssist fieldId={`questions.${field}:${row.id}`} assist={fieldAssists[`questions.${field}:${row.id}`]} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} /></div>)}
      <button className="text-button" type="button" onClick={() => save(rows.filter((item) => item.id !== row.id))}>{t('coach.questions.remove')}</button>
    </fieldset>)}
    <button className="secondary-button" type="button" disabled={disabled || rows.length >= 20} onClick={() => save([...rows, { id: crypto.randomUUID(), category: 'what', question: '', selected: false, whyImportant: '', relatedParagraphs: '', answered: '', unanswered: '' }])}>{t('coach.questions.add')}</button>
  </div>
}

function ApplicabilityForm({ blocks, draft, disabled, onChange, aiConfigured, fieldAssists, fieldAssistBusy, showFieldAssist, onRequestFieldAssist }: {
  blocks: import('./types').ArticleBlock[]
  draft: TrainingStructuredDraft
  disabled: boolean
  onChange: (field: TrainingDraftFieldId, value: string) => void
  aiConfigured: boolean
  fieldAssists: Record<string, TrainingFieldAssist>
  fieldAssistBusy: string | null
  showFieldAssist: boolean
  onRequestFieldAssist: (fieldId: string, mode: TrainingFieldAssistMode) => void
}) {
  const { t } = useI18n()
  const selected = draft['applicability.mode'] === 'not-applicable'
  return <fieldset disabled={disabled}>
    <legend>{t('coach.applicability.mode')}</legend>
    <label><input type="checkbox" checked={selected} onChange={(event) => onChange('applicability.mode', event.target.checked ? 'not-applicable' : 'applicable')} />{t('coach.applicability.none')}</label>
    {selected && <>
      <p>{t('coach.applicability.hint')}</p>
      <div className="structured-field-block">
        <label className="structured-field"><span>{t('coach.applicability.reason')}</span><textarea maxLength={800} value={draft['applicability.reason'] ?? ''} onChange={(event) => onChange('applicability.reason', event.target.value)} /></label>
        <FieldAssist fieldId="applicability.reason" assist={fieldAssists['applicability.reason']} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
      </div>
      <div className="structured-field-block">
        <label className="structured-field"><span>{t('coach.applicability.source')}</span><select value={draft['applicability.sourceId'] ?? ''} onChange={(event) => onChange('applicability.sourceId', event.target.value)}><option value="">—</option>{blocks.flatMap((block) => { const text = 'text' in block ? block.text : block.type === 'list' ? block.items.join('\n') : block.type === 'image' ? block.alt : ''; return block.id && text ? [<option key={block.id} value={block.id}>{text.slice(0, 80)}</option>] : [] })}</select></label>
        <FieldAssist fieldId="applicability.sourceId" assist={fieldAssists['applicability.sourceId']} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
      </div>
      <div className="structured-field-block">
        <label className="structured-field"><span>{t('coach.applicability.quote')}</span><textarea maxLength={800} value={draft['applicability.quote'] ?? ''} onChange={(event) => onChange('applicability.quote', event.target.value)} /></label>
        <FieldAssist fieldId="applicability.quote" assist={fieldAssists['applicability.quote']} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
      </div>
    </>}
  </fieldset>
}

function StructuredTrainingForm({
  stepId,
  draft,
  disabled,
  onChange,
  aiConfigured,
  fieldAssists,
  fieldAssistBusy,
  showFieldAssist,
  onRequestFieldAssist,
}: {
  stepId: string
  draft: TrainingStructuredDraft
  disabled: boolean
  onChange: (field: TrainingDraftFieldId, value: string) => void
  aiConfigured: boolean
  fieldAssists: Record<string, TrainingFieldAssist>
  fieldAssistBusy: string | null
  showFieldAssist: boolean
  onRequestFieldAssist: (fieldId: string, mode: TrainingFieldAssistMode) => void
}) {
  const { t } = useI18n()
  const fields = (STRUCTURED_FIELD_DEFINITIONS[stepId] ?? []).filter((field) => requiredFieldsForDraft(stepId, draft).includes(field.id) && !field.id.startsWith('applicability.') && !['quickBrowse.paragraphMap', 'questions.items', 'preview.metadata', 'threePoints.evidence'].includes(field.id))

  return (
    <div className="structured-training-form">
      <p className="structured-training-hint">{t('coach.structuredHint')}</p>
      <div className="structured-field-list">
        {fields.map((field) => (
          <div className="structured-field-block" key={field.id}>
            <label className="structured-field">
              <span>{t(field.labelKey)}</span>
              {field.multiline ? (
                <textarea value={draft[field.id] ?? ''} onChange={(event) => onChange(field.id, event.target.value)} rows={field.rows ?? 3} maxLength={structuredFieldLimit(field)} disabled={disabled} />
              ) : (
                <input value={draft[field.id] ?? ''} onChange={(event) => onChange(field.id, event.target.value)} maxLength={structuredFieldLimit(field)} disabled={disabled} />
              )}
            </label>
            <FieldAssist fieldId={field.id} assist={fieldAssists[field.id]} aiConfigured={aiConfigured} busyKey={fieldAssistBusy} disabled={disabled} showFieldAssist={showFieldAssist} onRequest={onRequestFieldAssist} />
          </div>
        ))}
      </div>
    </div>
  )
}

function FeedbackCard({
  feedback,
  referenceAnswer,
  referenceAnswerBusy = false,
  canGenerateReferenceAnswer = false,
  onGenerateReferenceAnswer,
}: {
  feedback: AiFeedback
  referenceAnswer?: AiReferenceAnswer
  referenceAnswerBusy?: boolean
  canGenerateReferenceAnswer?: boolean
  onGenerateReferenceAnswer?: () => void
}) {
  const { t } = useI18n()
  const dimensions = [
    [t('feedback.fidelity'), feedback.dimensions.fidelity],
    [t('feedback.claim'), feedback.dimensions.claim],
    [t('feedback.cause'), feedback.dimensions.cause],
    [t('feedback.structure'), feedback.dimensions.structure],
  ] as const

  return (
    <div className="feedback-card">
      <div className="feedback-header">
        <div>
          <span className="section-kicker">{t('feedback.label')}</span>
          <h4>{t('feedback.score', { score: feedback.total })}</h4>
        </div>
      </div>
      <div className="feedback-dimensions">
        {dimensions.map(([label, dimension]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{dimension.score === null ? t('common.unscored') : `${dimension.score} / 10`}</strong>
            <small>{dimension.reason}</small>
          </div>
        ))}
      </div>
      {(feedback.strengths.length > 0 || feedback.gaps.length > 0) && (
        <div className="feedback-notes">
          {feedback.strengths.map((item, index) => <p className="feedback-strength" key={`strength-${index}`}><strong>{t('feedback.good')}</strong>{item.comment}{item.answerQuote && `「${item.answerQuote}」`}</p>)}
          {feedback.gaps.map((item, index) => <p className="feedback-gap" key={`gap-${index}`}><strong>{t('feedback.improve')}</strong>{item.comment}{item.answerQuote && `「${item.answerQuote}」`}</p>)}
        </div>
      )}
      <details className="feedback-sources">
        <summary>{t('feedback.sources')}</summary>
        {feedback.sources.map((source) => <p key={`${source.blockId ?? source.paragraph}-${source.quote}`}><strong>{source.blockId ? t('feedback.sourceBlock', { id: source.blockId }) : t('feedback.paragraph', { number: source.paragraph })}</strong>“{source.quote}”<br />{source.comment}</p>)}
      </details>
      <div className="reference-answer">
        <div className="reference-answer-heading">
          <strong>{t('feedback.referenceAnswer')}</strong>
          {!referenceAnswer && canGenerateReferenceAnswer && onGenerateReferenceAnswer && (
            <button className="secondary-button" type="button" onClick={onGenerateReferenceAnswer} disabled={referenceAnswerBusy}>
              {referenceAnswerBusy ? t('feedback.referenceAnswerLoading') : t('feedback.generateReferenceAnswer')}
            </button>
          )}
        </div>
        {referenceAnswer ? (
          <>
            <p className="reference-answer-copy">{referenceAnswer.answer}</p>
            <details className="feedback-sources">
              <summary>{t('feedback.referenceSources')}</summary>
              {referenceAnswer.sources.map((source) => <p key={`${source.blockId ?? source.paragraph}-${source.quote}`}><strong>{source.blockId ? t('feedback.sourceBlock', { id: source.blockId }) : t('feedback.paragraph', { number: source.paragraph })}</strong>“{source.quote}”<br />{source.comment}</p>)}
            </details>
          </>
        ) : !canGenerateReferenceAnswer ? <p className="reference-answer-note">{t('feedback.referenceAnswerUnavailable')}</p> : null}
      </div>
    </div>
  )
}

function PrintPage() {
  const { t, locale } = useI18n()
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const loadArticle = async () => {
      const response = await sendExtensionMessage<CaptureRecord | SavedArticle | null>({
        type: 'get-pending-capture',
      })
      if (!response.ok) {
        setError(errorMessage(response.error))
        return
      }
      if (!response.data) {
        setError(t('print.noArticle'))
        return
      }
      let session: TrainingSession | null = null
      if ('savedAt' in response.data) {
        const sessionResponse = await sendExtensionMessage<TrainingSession | null>({
          type: 'get-training-session',
          articleId: response.data.id,
        })
        if (!sessionResponse.ok) {
          setError(errorMessage(sessionResponse.error))
          return
        }
        session = sessionResponse.data
      }
      setHtml(generateReadingPdfHtml(buildReadingExportModel(response.data, session, locale)))
    }
    void loadArticle()
  }, [locale, t])

  if (error) {
    return <main className="print-shell"><div className="notice error-notice">{error}</div></main>
  }
  if (!html) {
    return <main className="print-shell"><div className="loading-state">{t('print.loading')}</div></main>
  }

  return <main className="print-shell"><iframe className="print-frame" title={t('print.title')} srcDoc={html} /></main>
}

function formatDate(value: string, locale: import('./types').Locale = detectLocale()) {
  const dateLocale = locale === 'zh-CN' ? 'zh-CN' : locale
  return new Intl.DateTimeFormat(dateLocale, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function downloadText(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

export default App
