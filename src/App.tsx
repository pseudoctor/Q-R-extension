import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CaptureRecord,
  AiSettings,
  AiModelOption,
  AiFeedback,
  ArticleBlock,
  ExtensionError,
  ExtensionMessage,
  ExtensionResponse,
  ErrorCode,
  PreReadingPredictionDraft,
  SavedArticle,
  TrainingSession,
} from './types'
import { getArticleBlocks } from './articles/format'
import {
  AI_PROVIDERS,
  defaultAiSettings,
  isValidCustomEndpoint,
  providerById,
  providerEndpoint,
  providerOriginPattern,
} from './ai/providers'
import {
  buildObsidianUrl,
  buildReadingExportModel,
  generateReadingJson,
  generateReadingMarkdown,
  generateReadingPdfHtml,
  sanitizeFilename,
} from './export/reading'
import { getLessonSteps, LESSON_STEPS } from './training/lessons'
import { useI18n } from './i18n/context'
import { detectLocale } from './i18n/types'
import { translate } from './i18n/messages'
import './App.css'

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
  return `${error.message}（${error.code}）`
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
        (filter === 'in-progress' && Boolean(session && !session.completedAt)) ||
        (filter === 'completed' && Boolean(session?.completedAt))
      if (!matchesFilter) return false
      if (!query) return true
      return [article.title, article.author, article.metadata?.subtitle, article.metadata?.author, article.metadata?.source, article.url, article.text]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query))
    })
  }, [articles, filter, searchTerm, sessions])

  const growthStats = useMemo(() => {
    const allTurns = Object.values(sessions).flatMap((session) => session.turns)
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
      completedCount: Object.values(sessions).filter((session) => Boolean(session.completedAt)).length,
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
            <strong>{t('side.quick.predictTitle')}</strong>
            <span>{t('side.quick.predictBody')}</span>
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
                  const progress = session ? `${Math.min(session.currentStep, LESSON_STEPS.length)}/${LESSON_STEPS.length}` : t('common.notStarted')
                  const average = session?.turns.length
                    ? session.turns.reduce((sum, turn) => sum + (turn.feedback?.total ?? 0), 0) / session.turns.length
                    : null
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
  const [permissionStatus, setPermissionStatus] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void sendExtensionMessage<AiSettings>({ type: 'get-ai-settings' }).then((response) => {
        setLoaded(true)
        if (response.ok) {
          setSettings(response.data)
          if (response.data.apiKey.trim()) void refreshModels(response.data, false)
        } else setStatus(errorMessage(response.error))
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const provider = providerById(settings.provider)

  async function ensurePermission(settingsOverride: AiSettings = settings) {
    if (!extensionAvailable || !chrome.permissions) return false
    const origin = providerOriginPattern(settingsOverride)
    if (!origin) {
      setPermissionStatus(t('settings.invalidEndpoint'))
      return false
    }
    const origins = [origin]
    const alreadyGranted = await chrome.permissions.contains({ origins })
    if (alreadyGranted) return true
    setPermissionStatus(t('settings.permissionRequired', { url: providerEndpoint(settingsOverride) }))
    const granted = await chrome.permissions.request({ origins })
    if (!granted) {
      setPermissionStatus(t('settings.permissionDenied'))
    } else {
      setPermissionStatus(t('settings.permissionGranted'))
    }
    return granted
  }

  const saveSettings = async () => {
    if (settings.provider === 'custom' && !isValidCustomEndpoint(settings.endpoint)) {
      setStatus(t('settings.invalidEndpoint'))
      return
    }
    setBusy(true)
    setStatus('')
    if (settings.apiKey.trim()) await ensurePermission()
    const savedSettings = { ...settings, apiKey: settings.apiKey.trim() }
    const response = await sendExtensionMessage<AiSettings>({
      type: 'save-ai-settings',
      settings: savedSettings,
    })
    setBusy(false)
    setStatus(response.ok ? t('settings.saved') : errorMessage(response.error))
    if (response.ok) void refreshModels(savedSettings, false)
  }

  const testConnection = async () => {
    setTesting(true)
    setStatus('')
    const granted = await ensurePermission(settings)
    if (!granted) {
      setTesting(false)
      return
    }
    const response = await sendExtensionMessage<{ provider: string; model: string }>({
      type: 'test-ai-connection',
      settings,
    })
    setTesting(false)
    if (!response.ok) {
      setStatus(errorMessage(response.error))
      return
    }
    await refreshModels(settings, false)
    setStatus(t('settings.connected', { provider: response.data.provider, model: response.data.model }))
  }

  const openShortcuts = async () => {
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({ type: 'open-shortcuts' })
    if (!response.ok) setStatus(errorMessage(response.error))
  }

  const selectProvider = (providerId: AiSettings['provider']) => {
    const nextProvider = providerById(providerId)
    const nextSettings = { ...settings, provider: providerId, model: nextProvider.defaultModel }
    setSettings(nextSettings)
    setModelOptions([])
    setModelSource(null)
    setModelStatus('')
    setPermissionStatus('')
    setStatus('')
    if (nextSettings.apiKey.trim()) void refreshModels(nextSettings, true)
  }

  async function refreshModels(settingsOverride: AiSettings = settings, requestPermission = true) {
    setModelsLoading(true)
    setStatus('')
    setModelStatus('')
    let granted = false
    if (requestPermission) {
      granted = await ensurePermission(settingsOverride)
    } else {
      try {
        const origin = providerOriginPattern(settingsOverride)
        granted = Boolean(origin) && await chrome.permissions.contains({ origins: [origin] })
      } catch {
        granted = false
      }
    }
    if (!granted) {
      setModelsLoading(false)
      return
    }
    const response = await sendExtensionMessage<{ models: AiModelOption[]; source: 'provider' | 'fallback'; warning?: string }>({
      type: 'list-ai-models',
      settings: settingsOverride,
      force: true,
    })
    setModelsLoading(false)
    if (!response.ok) {
      setModelStatus(errorMessage(response.error))
      return
    }
    setModelOptions(response.data.models)
    setModelSource(response.data.source)
    setModelStatus(response.data.warning ?? '')
  }

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
              <button className="secondary-button compact-button" type="button" onClick={() => void refreshModels()} disabled={modelsLoading || !settings.apiKey.trim()}>{modelsLoading ? t('settings.fetchingModels') : t('settings.refreshModels')}</button>
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
          {permissionStatus && <p className="status-message" role="status">{permissionStatus}</p>}
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
  const [preReadingPrediction, setPreReadingPrediction] = useState('')
  const [text, setText] = useState('')
  const [sourceEditorOpen, setSourceEditorOpen] = useState(true)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  const queryErrorCode = useMemo(
    () => new URLSearchParams(window.location.search).get('errorCode') as ErrorCode | null,
    [],
  )

  useEffect(() => {
    const loadCapture = async () => {
      const [response, draftResponse] = await Promise.all([
        sendExtensionMessage<CaptureRecord | null>({ type: 'get-pending-capture' }),
        sendExtensionMessage<PreReadingPredictionDraft | null>({ type: 'get-pre-reading-prediction-draft' }),
      ])
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
        setPreReadingPrediction('')
        setText('')
        setSourceEditorOpen(true)
        setLoading(false)
        return
      }
      if (!response.data) {
      setLoadError(t('training.noCapture'))
        if (draftResponse.ok && draftResponse.data?.articleId === null) setPreReadingPrediction(draftResponse.data.value)
        setLoading(false)
        return
      }
      setCapture(response.data)
      setTitle(response.data.title)
      setSubtitle(response.data.metadata?.subtitle ?? '')
      setUrl(response.data.url)
      setAuthor(response.data.metadata?.author ?? response.data.author ?? '')
      setSource(response.data.metadata?.source ?? '')
      const predictionDraft = draftResponse.ok && draftResponse.data?.articleId === response.data.id
        ? draftResponse.data.value
        : null
      setPreReadingPrediction(predictionDraft ?? response.data.preReadingPrediction ?? '')
      setText(response.data.text)
      setSourceEditorOpen(false)
      setLoading(false)
    }

    void loadCapture()
  }, [queryErrorCode, t])

  useEffect(() => {
    if (loading || queryErrorCode) return
    const timer = window.setTimeout(() => {
      void sendExtensionMessage<null>({
        type: 'save-pre-reading-prediction-draft',
        ...(capture?.id ? { articleId: capture.id } : {}),
        value: preReadingPrediction,
      })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [capture?.id, loading, preReadingPrediction, queryErrorCode])

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
      preReadingPrediction: preReadingPrediction.trim(),
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
      preReadingPrediction: preReadingPrediction.trim(),
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
          <div className={capture && 'savedAt' in capture ? 'training-workspace has-coach' : 'training-workspace'}>
            <section className="article-column">
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
                <label className="prediction-field">
                  <span>{t('training.prediction')}</span>
                  <small>{t('training.predictionHint')}</small>
                  <textarea value={preReadingPrediction} onChange={(event) => setPreReadingPrediction(event.target.value)} placeholder={t('training.predictionPlaceholder')} rows={4} maxLength={2000} />
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
                {text.trim() && <ArticlePreview blocks={getArticleBlocks(text, capture && capture.text.trim() === text.trim() ? capture.blocks : undefined)} />}
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
              <aside className="coach-column">
                <TrainingCoach articleId={capture.id} />
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
  const sourceNumberFor = (index: number, itemIndex = 0) => {
    const previous = blocks.slice(0, index).reduce((total, block) => {
      if (block.type === 'list') return total + block.items.length
      return total + (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' ? 1 : 0)
    }, 0)
    const current = blocks[index]
    const offset = current?.type === 'list' ? itemIndex : 0
    return String(previous + offset + 1).padStart(2, '0')
  }

  return (
    <section className="article-preview">
      <div className="article-preview-heading">
        <span className="section-kicker">{t('training.preview')}</span>
        <span>{t('training.previewHint')}</span>
      </div>
      <article className="article-preview-content">
        {blocks.map((block, index) => {
          if (block.type === 'heading') {
            const number = sourceNumberFor(index)
            if (block.level === 1) return <h1 key={index}><span className="article-source-number">{number}</span>{block.text}</h1>
            if (block.level === 2) return <h2 key={index}><span className="article-source-number">{number}</span>{block.text}</h2>
            if (block.level === 3) return <h3 key={index}><span className="article-source-number">{number}</span>{block.text}</h3>
            return <h4 key={index}><span className="article-source-number">{number}</span>{block.text}</h4>
          }
          if (block.type === 'paragraph') return <p key={index}><span className="article-source-number">{sourceNumberFor(index)}</span>{block.text}</p>
          if (block.type === 'quote') return <blockquote key={index}><span className="article-source-number">{sourceNumberFor(index)}</span>{block.text}</blockquote>
          if (block.type === 'list') {
            const List = block.ordered ? 'ol' : 'ul'
            return <List key={index}>{block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}><span className="article-source-number">{sourceNumberFor(index, itemIndex)}</span>{item}</li>)}</List>
          }
          if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>
          if (block.type === 'image') return <figure key={index}><img src={block.src} alt={block.alt} loading="lazy" referrerPolicy="no-referrer" />{block.alt && <figcaption>{block.alt}</figcaption>}</figure>
          return <hr key={index} />
        })}
      </article>
    </section>
  )
}

function TrainingCoach({ articleId }: { articleId: string }) {
  const { t, locale } = useI18n()
  const [session, setSession] = useState<TrainingSession | null>(null)
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [aiLoaded, setAiLoaded] = useState(false)
  const [readConfirmed, setReadConfirmed] = useState(false)
  const [reinforcing, setReinforcing] = useState(false)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [bridge, setBridge] = useState<{ requestId: string; prompt: string } | null>(null)
  const [bridgeReply, setBridgeReply] = useState('')
  const [bridgeError, setBridgeError] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([
        sendExtensionMessage<TrainingSession | null>({
          type: 'get-training-session',
          articleId,
        }),
        sendExtensionMessage<AiSettings>({ type: 'get-ai-settings' }),
      ]).then(([sessionResponse, settingsResponse]) => {
        setLoaded(true)
        setAiLoaded(true)
        if (sessionResponse.ok) {
          setSession(sessionResponse.data)
          setAnswer(sessionResponse.data?.draft ?? '')
        }
        else setError(errorMessage(sessionResponse.error))
        if (settingsResponse.ok) setAiSettings(settingsResponse.data)
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [articleId])

  useEffect(() => {
    if (!loaded || !session) return
    const timer = window.setTimeout(() => {
      void sendExtensionMessage<TrainingSession>({
        type: 'save-training-draft',
        articleId,
        draft: answer,
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [answer, articleId, loaded, session])

  const aiConfigured = aiLoaded && Boolean(aiSettings?.apiKey.trim())

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
    setSession(response.data)

    if (!aiConfigured) {
      setBusy(false)
      return
    }
    const aiResponse = await sendExtensionMessage<TrainingSession>({
      type: 'ai-start',
      articleId,
    })
    setBusy(false)
    if (aiResponse.ok) setSession(aiResponse.data)
    else setError(errorMessage(aiResponse.error))
  }

  const retryAiStart = async () => {
    setBusy(true)
    setError('')
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'ai-start',
      articleId,
    })
    setBusy(false)
    if (response.ok) setSession(response.data)
    else setError(errorMessage(response.error))
  }

  const submit = async () => {
    if (answer.trim().length < 5) {
      setError(t('coach.answerTooShort'))
      return
    }
    setBusy(true)
    setError('')
    const draftResponse = await sendExtensionMessage<TrainingSession>({
      type: 'save-training-draft',
      articleId,
      draft: answer,
    })
    if (!draftResponse.ok) {
      setBusy(false)
      setError(errorMessage(draftResponse.error))
      return
    }
    setSession(draftResponse.data)

    if (!aiConfigured) {
      const bridgeResponse = await sendExtensionMessage<{ requestId: string; prompt: string }>({
        type: 'prepare-ai-bridge',
        articleId,
      })
      setBusy(false)
      if (bridgeResponse.ok) {
        setBridge(bridgeResponse.data)
        setBridgeReply('')
        setBridgeError('')
      } else {
        setError(errorMessage(bridgeResponse.error))
      }
      return
    }
    const aiResponse = await sendExtensionMessage<TrainingSession>({
      type: 'ai-grade',
      articleId,
    })
    setBusy(false)
    if (aiResponse.ok) {
      setSession(aiResponse.data)
      setAnswer(aiResponse.data.draft)
      setReinforcing(false)
    } else setError(errorMessage(aiResponse.error))
  }

  const copyBridgePrompt = async () => {
    if (!bridge) return
    try {
      await navigator.clipboard.writeText(bridge.prompt)
      setBridgeError(t('bridge.copied'))
    } catch {
      setBridgeError(t('bridge.copyFailed'))
    }
  }

  const importBridgeFeedback = async () => {
    if (!bridge || !bridgeReply.trim()) return
    setBusy(true)
    setBridgeError('')
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'import-ai-feedback',
      articleId,
      requestId: bridge.requestId,
      raw: bridgeReply,
    })
    setBusy(false)
    if (!response.ok) {
      setBridgeError(errorMessage(response.error))
      return
    }
    setSession(response.data)
    setAnswer(response.data.draft)
    setReinforcing(false)
    setBridge(null)
    setBridgeReply('')
    setBridgeError('')
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
    setReadConfirmed(false)
    setReinforcing(false)
    setAnswer('')
    setBridge(null)
    setBridgeReply('')
    setBridgeError('')
    setError('')
  }

  const localizedSteps = getLessonSteps(locale)
  const step = session ? localizedSteps[Math.min(session.currentStep, localizedSteps.length - 1)] : null
  const latestTurn = session?.turns.at(-1)
  const completed = session?.currentStep === LESSON_STEPS.length

  return (
    <section className="coach-card" aria-label={t('coach.aria')}>
      <div className="coach-heading">
        <div>
          <span className="section-kicker">{aiConfigured ? t('coach.aiLabel') : t('coach.localLabel')}</span>
          <h2>{t('coach.heading')}</h2>
          <p>{aiConfigured ? t('coach.aiDescription') : t('coach.localDescription')}</p>
        </div>
        {session && <span className="progress-pill">{Math.min(session.currentStep, LESSON_STEPS.length)} / {LESSON_STEPS.length}</span>}
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
            <input type="checkbox" checked={readConfirmed} onChange={(event) => setReadConfirmed(event.target.checked)} />
            {t('coach.readConfirm')}
          </label>
          <button className="primary-button" type="button" onClick={() => void start()} disabled={!readConfirmed || busy}>
            {busy ? t('coach.starting') : aiConfigured ? t('coach.startAi') : t('coach.start')}
          </button>
          {!aiConfigured && <button className="text-button" type="button" onClick={() => void sendExtensionMessage({ type: 'open-settings' })}>{t('coach.goSettings')}</button>}
        </div>
      ) : completed && !reinforcing ? (
        <>
          <div className="coach-complete">
            <span className="complete-mark">✓</span>
            <div>
              <h3>{t('coach.completedHeading')}</h3>
              <p>{t('coach.completedCopy')}</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => void reset()}>{t('coach.restart')}</button>
            <button className="secondary-button" type="button" onClick={() => { setReinforcing(true); setAnswer(''); setError(''); setBridge(null); setBridgeReply(''); setBridgeError('') }}>{t('coach.reinforce')}</button>
          </div>
          {latestTurn?.feedback && <FeedbackCard feedback={latestTurn.feedback} />}
        </>
      ) : step ? (
        <div className="coach-round">
          <div className="round-meta">
            <span>{reinforcing ? t('coach.reinforceLabel') : `${step.stage} · ${step.name}`}</span>
            <strong>{step.focus}</strong>
          </div>
          {latestTurn?.feedback && <FeedbackCard feedback={latestTurn.feedback} />}
          <h3>{session.currentQuestion || step.question}</h3>
          <p className="round-instruction">{step.instruction}</p>
          {aiConfigured && session.turns.length === 0 && session.currentStep === 0 && session.currentQuestion === localizedSteps[0].question && (
            <button className="text-button retry-button" type="button" onClick={() => void retryAiStart()} disabled={busy}>{t('coach.retryAi')}</button>
          )}
          <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={t('coach.answerPlaceholder')} rows={8} maxLength={4000} disabled={busy || Boolean(bridge)} />
          <div className="round-footer">
            <span>{answer.length.toLocaleString()} / 4,000 {t('common.characters')}</span>
            <button className="primary-button" type="button" onClick={() => void submit()} disabled={busy || Boolean(bridge) || answer.trim().length < 5}>
              {busy ? aiConfigured ? t('coach.grading') : t('coach.saving') : aiConfigured ? t('coach.submit') : t('coach.generateBridge')}
            </button>
          </div>
          {bridge && <BridgeCard bridge={bridge} reply={bridgeReply} error={bridgeError} busy={busy} onCopy={() => void copyBridgePrompt()} onOpenChat={() => window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer')} onReply={setBridgeReply} onImport={() => void importBridgeFeedback()} />}
          {session.turns.length > 0 && (
            <details className="training-history">
              <summary>{t('coach.history', { count: session.turns.length })}</summary>
              {session.turns.map((turn) => (
                <div key={`${turn.stepIndex}-${turn.submittedAt}`}>
                  <strong>{t('coach.round', { number: turn.stepIndex + 1 })}{turn.feedback ? ` · ${turn.feedback.total} / 100` : ''}</strong>
                  <p>{turn.answer}</p>
                </div>
              ))}
            </details>
          )}
        </div>
      ) : null}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  )
}

function FeedbackCard({ feedback }: { feedback: AiFeedback }) {
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
        {feedback.sources.map((source) => <p key={`${source.paragraph}-${source.quote}`}><strong>{t('feedback.paragraph', { number: source.paragraph })}</strong>“{source.quote}”<br />{source.comment}</p>)}
      </details>
    </div>
  )
}

type BridgeCardProps = {
  bridge: { requestId: string; prompt: string }
  reply: string
  error: string
  busy: boolean
  onCopy: () => void
  onOpenChat: () => void
  onReply: (value: string) => void
  onImport: () => void
}

function BridgeCard({ bridge, reply, error, busy, onCopy, onOpenChat, onReply, onImport }: BridgeCardProps) {
  const { t } = useI18n()
  return (
    <div className="bridge-card">
      <span className="section-kicker">{t('bridge.eyebrow')}</span>
      <h4>{t('bridge.heading')}</h4>
      <p>{t('bridge.description')}</p>
      <div className="bridge-actions">
        <button className="secondary-button" type="button" onClick={onCopy}>{t('bridge.copy')}</button>
        <button className="text-button" type="button" onClick={onOpenChat}>{t('bridge.openChat')}</button>
      </div>
      <details className="bridge-prompt">
        <summary>{t('bridge.viewPrompt')}</summary>
        <textarea aria-label={t('bridge.promptAria')} readOnly value={bridge.prompt} rows={8} />
      </details>
      <textarea aria-label={t('bridge.feedbackAria')} value={reply} onChange={(event) => onReply(event.target.value)} placeholder={t('bridge.feedbackPlaceholder')} rows={6} maxLength={30_000} disabled={busy} />
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="primary-button" type="button" onClick={onImport} disabled={busy || !reply.trim()}>
        {busy ? t('bridge.validating') : t('bridge.import')}
      </button>
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
