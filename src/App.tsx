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
  SavedArticle,
  TrainingSession,
} from './types'
import { getArticleBlocks } from './articles/format'
import { AI_PROVIDERS, defaultAiSettings, providerById } from './ai/providers'
import {
  buildObsidianUrl,
  buildReadingExportModel,
  generateReadingJson,
  generateReadingMarkdown,
  generateReadingPdfHtml,
  sanitizeFilename,
} from './export/reading'
import { LESSON_STEPS } from './training/lessons'
import './App.css'

const extensionAvailable =
  typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)

async function sendExtensionMessage<T>(
  message: ExtensionMessage,
): Promise<ExtensionResponse<T>> {
  if (!extensionAvailable) {
    return {
      ok: false,
      error: {
        code: 'PAGE_NOT_ACCESSIBLE',
        message: '请从 Chrome 或 Edge 的已加载扩展中打开此页面。',
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
  const [articles, setArticles] = useState<SavedArticle[]>([])
  const [sessions, setSessions] = useState<Record<string, TrainingSession>>({})
  const [status, setStatus] = useState('准备从当前网页捕获文章。')
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [view, setView] = useState<'library' | 'growth'>('library')
  const [filter, setFilter] = useState<'all' | 'favorite' | 'in-progress' | 'completed'>('all')

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
    setStatus('正在读取当前网页…')
    const response = await sendExtensionMessage<{ captureId: string }>({
      type: 'capture-current-page',
      source: 'side-panel',
    })
    setLoading(false)
    if (response.ok) {
      setStatus('文章已填入训练页，可以先检查正文再保存。')
      return
    }
    setStatus(errorMessage(response.error))
  }

  const openTrainingPage = async () => {
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({
      type: 'open-training-page',
    })
    setStatus(response.ok ? '已打开训练页。' : errorMessage(response.error))
  }

  const openSavedArticle = async (articleId: string) => {
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({
      type: 'open-saved-article',
      articleId,
    })
    setStatus(response.ok ? '已打开本地文章。' : errorMessage(response.error))
  }

  const deleteArticle = async (articleId: string) => {
    if (!window.confirm('删除这篇本地文章？此操作无法撤销。')) return
    const response = await sendExtensionMessage<{ articleId: string }>({
      type: 'delete-article',
      articleId,
    })
    if (response.ok) {
      setStatus('文章已删除。')
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
    const model = buildReadingExportModel(article, sessions[article.id])
    if (format === 'obsidian') {
      const markdown = generateReadingMarkdown(model)
      const obsidian = buildObsidianUrl(markdown, { title: article.title })
      if (obsidian.useClipboard) {
        if (!navigator.clipboard?.writeText) {
          setStatus('内容较长且浏览器不支持剪贴板，请改用 Markdown 导出。')
          return
        }
        try {
          await navigator.clipboard.writeText(markdown)
        } catch {
          setStatus('无法写入剪贴板，请改用 Markdown 导出。')
          return
        }
      }
      window.open(obsidian.url, '_blank', 'noopener,noreferrer')
      setStatus(obsidian.useClipboard ? '内容已复制，Obsidian 将从剪贴板创建笔记。' : '已请求 Obsidian 创建完整训练记录。')
      return
    }
    const content = format === 'markdown' ? generateReadingMarkdown(model) : generateReadingJson(model)
    const extension = format === 'markdown' ? 'md' : 'json'
    downloadText(content, sanitizeFilename(article.title, extension), format === 'markdown' ? 'text/markdown' : 'application/json')
    setStatus(`已导出完整 ${format === 'markdown' ? 'Markdown' : 'JSON'} 记录。`)
  }

  const printArticle = async (articleId: string) => {
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({
      type: 'open-print-article',
      articleId,
    })
    setStatus(response.ok ? '已打开打印页，可选择“保存为 PDF”。' : errorMessage(response.error))
  }

  return (
    <main className="app-shell side-panel-shell">
      <header className="brand-header">
        <div>
          <span className="eyebrow">TOULMIN READER</span>
          <h1>问读</h1>
        </div>
        <div className="header-actions">
          <button className="icon-button" type="button" onClick={() => void sendExtensionMessage({ type: 'open-settings' })} aria-label="打开 AI 设置" title="AI 设置">⚙</button>
          <span className="status-dot" aria-label="本地模式" />
        </div>
      </header>

      <section className="intro-card">
        <span className="section-kicker">CURRENT PAGE</span>
        <h2>把正在读的文章带进训练页</h2>
        <p>快捷键：Ctrl/⌘ + Shift + 8。也可以直接点击下面的按钮。</p>
        <button className="primary-button full-width" type="button" onClick={captureCurrentPage} disabled={loading}>
          {loading ? '正在读取…' : '获取当前文章'}
        </button>
        <button className="text-button full-width" type="button" onClick={openTrainingPage}>
          打开空白训练页
        </button>
        <p className="status-message" role="status">{status}</p>
      </section>

      <section className="saved-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">LOCAL LIBRARY</span>
            <h2>{view === 'library' ? '文章架' : '成长记录'}</h2>
          </div>
          <div className="section-heading-actions">
            <button className={view === 'library' ? 'text-button active' : 'text-button'} type="button" onClick={() => setView('library')}>文章架</button>
            <button className={view === 'growth' ? 'text-button active' : 'text-button'} type="button" onClick={() => setView('growth')}>成长记录</button>
            <button className="icon-button" type="button" onClick={() => void loadArticles()} aria-label="刷新文章列表">↻</button>
          </div>
        </div>
        {view === 'library' ? (
          <>
            <input
              className="search-input"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="搜索标题、作者或正文…"
              aria-label="搜索本地文章"
            />
            <div className="library-filters" role="group" aria-label="文章筛选">
              {([
                ['all', '全部'],
                ['favorite', '收藏'],
                ['in-progress', '进行中'],
                ['completed', '已完成'],
              ] as const).map(([value, label]) => (
                <button key={value} className={filter === value ? 'filter-button active' : 'filter-button'} type="button" onClick={() => setFilter(value)}>{label}</button>
              ))}
            </div>
            {articles.length === 0 ? (
              <div className="empty-state">
                <span className="empty-mark">○</span>
                <p>保存后的文章会出现在这里。</p>
              </div>
            ) : filteredArticles.length === 0 ? (
              <div className="empty-state compact-empty">
                <p>没有匹配的文章。</p>
              </div>
            ) : (
              <ul className="article-list">
                {filteredArticles.slice(0, 8).map((article) => {
                  const session = sessions[article.id]
                  const progress = session ? `${Math.min(session.currentStep, LESSON_STEPS.length)}/${LESSON_STEPS.length}` : '未开始'
                  const average = session?.turns.length
                    ? session.turns.reduce((sum, turn) => sum + (turn.feedback?.total ?? 0), 0) / session.turns.length
                    : null
                  return (
                    <li key={article.id}>
                      <div className="article-list-item">
                        <button className="article-open-button" type="button" onClick={() => void openSavedArticle(article.id)}>
                          <strong>{article.isFavorite ? '★ ' : ''}{article.title}</strong>
                          <span>{formatDate(article.savedAt)} · {article.text.length.toLocaleString()} 字符 · 训练 {progress}{average === null ? '' : ` · ${average.toFixed(1)} 分`}</span>
                        </button>
                        <div className="article-actions">
                          <button type="button" onClick={() => void toggleFavorite(article.id)} aria-label={article.isFavorite ? '取消收藏' : '收藏'}>{article.isFavorite ? '★' : '☆'}</button>
                          <button type="button" onClick={() => void exportArticle(article, 'markdown')} aria-label="导出完整 Markdown">MD</button>
                          <button type="button" onClick={() => void exportArticle(article, 'json')} aria-label="导出完整 JSON">JSON</button>
                          <button type="button" onClick={() => void exportArticle(article, 'obsidian')} aria-label="导出到 Obsidian">OB</button>
                          <button type="button" onClick={() => void printArticle(article.id)} aria-label="打印或保存为 PDF">PDF</button>
                          <button type="button" onClick={() => void deleteArticle(article.id)} aria-label="删除文章">×</button>
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
              <div><strong>{growthStats.articleCount}</strong><span>保存文章</span></div>
              <div><strong>{growthStats.completedCount}</strong><span>完成训练</span></div>
              <div><strong>{growthStats.turnCount}</strong><span>评分回合</span></div>
              <div><strong>{growthStats.average === null ? '—' : growthStats.average.toFixed(1)}</strong><span>平均得分</span></div>
            </div>
            <div className="growth-dimensions">
              <h3>四项能力</h3>
              {growthStats.dimensions.map(({ dimension, average }) => (
                <div className="dimension-row" key={dimension}>
                  <span>{dimension === 'fidelity' ? '忠实度' : dimension === 'claim' ? '主张' : dimension === 'cause' ? '因果' : '结构'}</span>
                  <div className="dimension-track"><i style={{ width: `${Math.min(100, ((average ?? 0) / 10) * 100)}%` }} /></div>
                  <strong>{average === null ? '—' : average.toFixed(1)}</strong>
                </div>
              ))}
            </div>
            <p className="muted-copy">每次 AI 评分都会沉淀到本地成长记录，文章和训练答案不会上传到插件之外的存储。</p>
          </div>
        )}
      </section>

      <footer className="panel-footer">正文只保存在此浏览器的插件存储中。</footer>
    </main>
  )
}

function SettingsPage() {
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

  async function ensurePermission(providerId: AiSettings['provider'] = settings.provider) {
    if (!extensionAvailable || !chrome.permissions) return false
    const selectedProvider = providerById(providerId)
    const origins = [selectedProvider.hostPattern]
    const alreadyGranted = await chrome.permissions.contains({ origins })
    if (alreadyGranted) return true
    setPermissionStatus(`需要允许访问 ${selectedProvider.baseUrl} 才能测试或调用该模型。`)
    const granted = await chrome.permissions.request({ origins })
    if (!granted) {
      setPermissionStatus('未获得模型服务网络权限，配置仍会保存，但 AI 请求不会发送。')
    } else {
      setPermissionStatus('模型服务网络权限已允许。')
    }
    return granted
  }

  const saveSettings = async () => {
    setBusy(true)
    setStatus('')
    if (settings.apiKey.trim()) await ensurePermission()
    const savedSettings = { ...settings, apiKey: settings.apiKey.trim() }
    const response = await sendExtensionMessage<AiSettings>({
      type: 'save-ai-settings',
      settings: savedSettings,
    })
    setBusy(false)
    setStatus(response.ok ? '已保存到插件本地存储。API key 不会写入文章或日志。' : errorMessage(response.error))
    if (response.ok) void refreshModels(savedSettings, false)
  }

  const testConnection = async () => {
    setTesting(true)
    setStatus('')
    const granted = await ensurePermission()
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
    setStatus(`连接成功：${response.data.provider} · ${response.data.model}`)
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
    const selectedProvider = providerById(settingsOverride.provider)
    let granted = false
    if (requestPermission) {
      granted = await ensurePermission(settingsOverride.provider)
    } else {
      try {
        granted = await chrome.permissions.contains({ origins: [selectedProvider.hostPattern] })
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
    setModelStatus(response.data.warning ?? `已获取 ${response.data.models.length} 个可用模型。`)
  }

  return (
    <main className="app-shell settings-shell">
      <header className="settings-header">
        <div>
          <span className="eyebrow">PLUGIN SETTINGS</span>
          <h1>连接你的 AI 模型</h1>
          <p>配置只保存在当前浏览器的插件存储中，不需要 Worker 才能使用本地阅读训练。</p>
        </div>
        <span className="local-pill">LOCAL ONLY</span>
      </header>
      {!loaded ? (
        <div className="loading-state">正在加载设置…</div>
      ) : (
        <>
          <section className="settings-card">
          <label>
            模型服务
            <select value={settings.provider} onChange={(event) => selectProvider(event.target.value as AiSettings['provider'])}>
              {AI_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>
            API endpoint
            <input value={`${provider.baseUrl}/chat/completions`} readOnly aria-describedby="endpoint-note" />
            <small id="endpoint-note">当前版本使用服务商的 OpenAI-compatible Chat Completions 接口。</small>
          </label>
          <label>
            模型名称
            <div className="model-input-stack">
              <select className="model-options-select" aria-label="服务商模型列表" value={modelOptions.some((model) => model.id === settings.model) ? settings.model : ''} onChange={(event) => { if (event.target.value) setSettings((current) => ({ ...current, model: event.target.value })) }}>
                <option value="">{modelOptions.length ? `从已加载的 ${modelOptions.length} 个模型中选择` : '点击刷新获取服务商模型'}</option>
                {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label === model.id ? model.id : `${model.label} · ${model.id}`}</option>)}
              </select>
              <div className="model-input-row">
              <input value={settings.model} onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))} placeholder={provider.defaultModel} aria-label="手动输入模型名称" />
              <button className="secondary-button compact-button" type="button" onClick={() => void refreshModels()} disabled={modelsLoading || !settings.apiKey.trim()}>{modelsLoading ? '获取中…' : '刷新模型'}</button>
              </div>
            </div>
            <small>{modelSource === 'fallback' ? '服务商列表获取失败，当前仅显示默认模型；请根据下方提示修正后重新刷新。' : modelOptions.length ? `已加载 ${modelOptions.length} 个服务商模型；上方列表显示全部结果，也可以手动输入兼容模型名。` : '可刷新服务商模型列表，也可以手动输入兼容模型名。'}</small>
            {modelStatus && <small className="model-status" role="status">{modelStatus}</small>}
          </label>
          <label>
            API key
            <input type="password" autoComplete="off" value={settings.apiKey} onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value }))} placeholder="粘贴你的 API key" />
            <small>只保存在本地插件存储；浏览器扩展存储不是加密保险箱，请不要在共享电脑上保存高权限密钥。</small>
          </label>
          <div className="settings-actions-row">
            <button className="secondary-button" type="button" onClick={() => void testConnection()} disabled={busy || testing || !settings.apiKey.trim()}>
              {testing ? '测试中…' : '测试连接'}
            </button>
            <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={busy || testing}>
              {busy ? '保存中…' : '保存设置'}
            </button>
          </div>
          {permissionStatus && <p className="status-message" role="status">{permissionStatus}</p>}
          {status && <p className="status-message" role="status">{status}</p>}
          </section>
          <section className="donation-card" aria-labelledby="donation-title">
          <div>
            <span className="section-kicker">SUPPORT THE PROJECT</span>
            <h2 id="donation-title">如果问读对你有帮助</h2>
            <p>可以请作者喝杯咖啡，感谢你的支持。</p>
          </div>
          <div className="donation-grid">
            <figure>
              <img src="/assets/donate-alipay.jpg" alt="支付宝打赏二维码" />
              <figcaption>支付宝</figcaption>
            </figure>
            <figure>
              <img src="/assets/donate-paypal.jpg" alt="PayPal 打赏二维码" />
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

  const queryError = useMemo(
    () => new URLSearchParams(window.location.search).get('error') ?? '',
    [],
  )

  useEffect(() => {
    const loadCapture = async () => {
      const response = await sendExtensionMessage<CaptureRecord | null>({
        type: 'get-pending-capture',
      })
      setLoading(false)
      if (!response.ok) {
        setLoadError(errorMessage(response.error))
        return
      }
      if (queryError) {
        setLoadError(queryError)
        setCapture(null)
        setTitle('')
        setSubtitle('')
        setUrl('')
        setAuthor('')
        setSource('')
        setPreReadingPrediction('')
        setText('')
        setSourceEditorOpen(true)
        return
      }
      if (!response.data) {
        setLoadError('没有找到待处理的文章。')
        return
      }
      setCapture(response.data)
      setTitle(response.data.title)
      setSubtitle(response.data.metadata?.subtitle ?? '')
      setUrl(response.data.url)
      setAuthor(response.data.metadata?.author ?? response.data.author ?? '')
      setSource(response.data.metadata?.source ?? '')
      setPreReadingPrediction(response.data.preReadingPrediction ?? '')
      setText(response.data.text)
      setSourceEditorOpen(false)
    }

    void loadCapture()
  }, [queryError])

  const saveCurrentArticle = async () => {
    const trimmedText = text.trim()
    if (trimmedText.length < 120 || trimmedText.length > 36_000) {
      setStatus('正文需要 120–36,000 个字符，或先从网页重新获取文章。')
      return
    }

    setSaving(true)
    const blocks = getArticleBlocks(
      trimmedText,
      capture && capture.text.trim() === trimmedText ? capture.blocks : undefined,
    )
    const article: CaptureRecord = {
      id: capture?.id ?? crypto.randomUUID(),
      title: title.trim() || '未命名文章',
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
    setStatus('已保存到本地文章架。你可以继续编辑，或返回插件面板打开其他文章。')
  }

  const currentArticle = (): CaptureRecord | SavedArticle => {
    const trimmedText = text.trim()
    const fields = {
      title: title.trim() || '未命名文章',
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
    const model = buildReadingExportModel(article, session)
    if (format === 'markdown') {
      downloadText(generateReadingMarkdown(model), sanitizeFilename(article.title, 'md'), 'text/markdown')
      setStatus('已导出完整 Markdown 训练记录。')
      return
    }
    if (format === 'json') {
      downloadText(generateReadingJson(model), sanitizeFilename(article.title, 'json'), 'application/json')
      setStatus('已导出完整 JSON 训练记录。')
      return
    }
    const markdown = generateReadingMarkdown(model)
    const obsidian = buildObsidianUrl(markdown, { title: article.title })
    if (obsidian.useClipboard) {
      if (!navigator.clipboard?.writeText) {
        setStatus('内容较长且浏览器不支持剪贴板，请改用 Markdown 导出。')
        return
      }
      try {
        await navigator.clipboard.writeText(markdown)
      } catch {
        setStatus('无法写入剪贴板，请改用 Markdown 导出。')
        return
      }
      window.open(obsidian.url, '_blank', 'noopener,noreferrer')
      setStatus('内容已复制，Obsidian 将从剪贴板创建笔记。')
      return
    }
    window.open(obsidian.url, '_blank', 'noopener,noreferrer')
    setStatus('已请求 Obsidian 创建完整训练记录。')
  }

  const openPrintPage = async () => {
    if (!capture || !('savedAt' in capture)) {
      setStatus('请先保存文章，再打开打印页。')
      return
    }
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({
      type: 'open-print-article',
      articleId: capture.id,
    })
    setStatus(response.ok ? '已打开打印页，可选择“保存为 PDF”。' : errorMessage(response.error))
  }

  return (
    <main className="app-shell training-shell">
      <header className="training-header">
        <div>
          <span className="eyebrow">READ BEFORE YOU TRAIN</span>
          <h1>先把文章读进来</h1>
          <p>文章默认保存在本地；启用 AI 后，训练所需正文和回答会直接发送到你配置的模型服务商。</p>
        </div>
        <span className="local-pill">LOCAL ONLY</span>
      </header>

      {loading ? (
        <div className="loading-state">正在加载捕获内容…</div>
      ) : (
        <>
          {loadError && (
            <div className="notice error-notice" role="alert">
              <strong>这次没有自动读到正文</strong>
              <span>{loadError}</span>
            </div>
          )}
          <section className="editor-card">
            <div className="editor-meta">
              <span className="section-kicker">ARTICLE INTAKE</span>
              {capture?.selectedText && <span className="selection-pill">使用了选中文本</span>}
            </div>
            <label>
              标题
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="文章标题" />
            </label>
            <label>
              副标题（可选）
              <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="没有就留空" maxLength={240} />
            </label>
            <label>
              来源 URL
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" inputMode="url" />
            </label>
            <label>
              作者（可选）
              <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="作者名" />
            </label>
            <label>
              来源说明（可选）
              <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="例如：期刊、专栏或书名" maxLength={240} />
            </label>
            <label className="prediction-field">
              <span>阅读前预测（可选）</span>
              <small>只根据标题、来源和已有信息，猜测文章可能讨论的问题、主张或论证方向。读完后回看。</small>
              <textarea value={preReadingPrediction} onChange={(event) => setPreReadingPrediction(event.target.value)} placeholder="例如：这篇文章可能解释一个现象背后的原因，以及它对公众判断的影响。" rows={4} maxLength={2000} />
            </label>
            <details className="source-editor" open={sourceEditorOpen} onToggle={(event) => setSourceEditorOpen(event.currentTarget.open)}>
              <summary>
                <span>编辑原文</span>
                <small>提取异常或需要手动修正时展开</small>
              </summary>
              <label>
                正文
                <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="把文章正文粘贴到这里…" rows={22} maxLength={36_000} />
              </label>
            </details>
            {text.trim() && <ArticlePreview blocks={getArticleBlocks(text, capture && capture.text.trim() === text.trim() ? capture.blocks : undefined)} />}
            <div className="editor-footer">
              <span className="character-count">{text.length.toLocaleString()} 字符</span>
              <div className="editor-actions">
                <button className="secondary-button" type="button" onClick={() => void exportCurrentArticle('markdown')}>Markdown</button>
                <button className="secondary-button" type="button" onClick={() => void exportCurrentArticle('json')}>JSON</button>
                <button className="secondary-button" type="button" onClick={() => void exportCurrentArticle('obsidian')}>Obsidian</button>
                <button className="secondary-button" type="button" onClick={() => void openPrintPage()}>打印 / PDF</button>
                <button className="primary-button" type="button" onClick={() => void saveCurrentArticle()} disabled={saving}>
                  {saving ? '保存中…' : '保存并开始训练'}
                </button>
              </div>
            </div>
            {status && <p className="status-message" role="status">{status}</p>}
          </section>
          {capture && 'savedAt' in capture && <TrainingCoach articleId={capture.id} />}
        </>
      )}
    </main>
  )
}

function ArticlePreview({ blocks }: { blocks: ArticleBlock[] }) {
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
        <span className="section-kicker">READING PREVIEW</span>
        <span>保留原文结构，使用插件阅读样式</span>
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
      setError('请先写下至少 5 个字符的独立回答。')
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
      setBridgeError('评分请求已复制，可以粘贴到 ChatGPT。')
    } catch {
      setBridgeError('浏览器不允许自动复制，请展开请求文本后手动复制。')
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
    if (!window.confirm('重新开始这篇文章的训练？现有回答会被删除。')) return
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

  const step = session ? LESSON_STEPS[Math.min(session.currentStep, LESSON_STEPS.length - 1)] : null
  const latestTurn = session?.turns.at(-1)
  const completed = session?.currentStep === LESSON_STEPS.length

  return (
    <section className="coach-card" aria-label="图尔敏阅读训练">
      <div className="coach-heading">
        <div>
          <span className="section-kicker">{aiConfigured ? 'AI COACH' : 'LOCAL COACH'}</span>
          <h2>八轮独立阅读训练</h2>
          <p>{aiConfigured ? '先独立回答，再由已配置的模型依据原文评分和追问。' : '先自己读和回答；打开设置即可接入 AI 出题与评分。'}</p>
        </div>
        {session && <span className="progress-pill">{Math.min(session.currentStep, LESSON_STEPS.length)} / {LESSON_STEPS.length}</span>}
      </div>

      {!loaded ? (
        <p className="loading-state compact-loading">正在加载训练进度…</p>
      ) : !session ? (
        <div className="coach-start">
          <ol className="pre-read-list">
            <li>先读完标题、正文和段落结构，不看摘要或外部资料。</li>
            <li>回答只依据当前文章；原文没有交代的地方可以写“未交代”。</li>
            <li>每轮提交后会保存在本地，刷新页面可以继续。</li>
          </ol>
          <label className="read-confirmation">
            <input type="checkbox" checked={readConfirmed} onChange={(event) => setReadConfirmed(event.target.checked)} />
            我已独立读完，准备开始第一轮
          </label>
          <button className="primary-button" type="button" onClick={() => void start()} disabled={!readConfirmed || busy}>
            {busy ? '正在开始…' : aiConfigured ? '开始第一轮（AI 出题）' : '开始第一轮'}
          </button>
          {!aiConfigured && <button className="text-button" type="button" onClick={() => void sendExtensionMessage({ type: 'open-settings' })}>去设置 AI</button>}
        </div>
      ) : completed && !reinforcing ? (
        <>
          <div className="coach-complete">
            <span className="complete-mark">✓</span>
            <div>
              <h3>八轮训练已完成</h3>
              <p>你已经留下了完整的阅读思考记录。每轮回答和 AI 反馈都保存在本地。</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => void reset()}>重新开始</button>
            <button className="secondary-button" type="button" onClick={() => { setReinforcing(true); setAnswer(''); setError(''); setBridge(null); setBridgeReply(''); setBridgeError('') }}>再巩固一轮</button>
          </div>
          {latestTurn?.feedback && <FeedbackCard feedback={latestTurn.feedback} />}
        </>
      ) : step ? (
        <div className="coach-round">
          <div className="round-meta">
            <span>{reinforcing ? '巩固复盘' : `${step.stage} · ${step.name}`}</span>
            <strong>{step.focus}</strong>
          </div>
          {latestTurn?.feedback && <FeedbackCard feedback={latestTurn.feedback} />}
          <h3>{session.currentQuestion || step.question}</h3>
          <p className="round-instruction">{step.instruction}</p>
          {aiConfigured && session.turns.length === 0 && session.currentStep === 0 && session.currentQuestion === LESSON_STEPS[0].question && (
            <button className="text-button retry-button" type="button" onClick={() => void retryAiStart()} disabled={busy}>重新请求 AI 首轮问题</button>
          )}
          <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="先写下自己的理解，不必追求一次答对…" rows={8} maxLength={4000} disabled={busy || Boolean(bridge)} />
          <div className="round-footer">
            <span>{answer.length.toLocaleString()} / 4,000 字符</span>
            <button className="primary-button" type="button" onClick={() => void submit()} disabled={busy || Boolean(bridge) || answer.trim().length < 5}>
              {busy ? aiConfigured ? 'AI 评分中…' : '保存中…' : aiConfigured ? '提交并评分' : '生成评分请求'}
            </button>
          </div>
          {bridge && <BridgeCard bridge={bridge} reply={bridgeReply} error={bridgeError} busy={busy} onCopy={() => void copyBridgePrompt()} onOpenChat={() => window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer')} onReply={setBridgeReply} onImport={() => void importBridgeFeedback()} />}
          {session.turns.length > 0 && (
            <details className="training-history">
              <summary>查看已完成的 {session.turns.length} 轮</summary>
              {session.turns.map((turn) => (
                <div key={`${turn.stepIndex}-${turn.submittedAt}`}>
                  <strong>第 {turn.stepIndex + 1} 轮{turn.feedback ? ` · ${turn.feedback.total} / 100` : ''}</strong>
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
  const dimensions = [
    ['原文忠实度', feedback.dimensions.fidelity],
    ['核心主张', feedback.dimensions.claim],
    ['因果分析', feedback.dimensions.cause],
    ['论证结构', feedback.dimensions.structure],
  ] as const

  return (
    <div className="feedback-card">
      <div className="feedback-header">
        <div>
          <span className="section-kicker">AI FEEDBACK</span>
          <h4>本轮评分：{feedback.total} / 100</h4>
        </div>
      </div>
      <div className="feedback-dimensions">
        {dimensions.map(([label, dimension]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{dimension.score === null ? '未测' : `${dimension.score} / 10`}</strong>
            <small>{dimension.reason}</small>
          </div>
        ))}
      </div>
      {(feedback.strengths.length > 0 || feedback.gaps.length > 0) && (
        <div className="feedback-notes">
          {feedback.strengths.map((item, index) => <p className="feedback-strength" key={`strength-${index}`}><strong>做得好：</strong>{item.comment}{item.answerQuote && `「${item.answerQuote}」`}</p>)}
          {feedback.gaps.map((item, index) => <p className="feedback-gap" key={`gap-${index}`}><strong>可以改进：</strong>{item.comment}{item.answerQuote && `「${item.answerQuote}」`}</p>)}
        </div>
      )}
      <details className="feedback-sources">
        <summary>查看原文依据</summary>
        {feedback.sources.map((source) => <p key={`${source.paragraph}-${source.quote}`}><strong>第 {source.paragraph} 段：</strong>“{source.quote}”<br />{source.comment}</p>)}
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
  return (
    <div className="bridge-card">
      <span className="section-kicker">CHATGPT ASSISTED REVIEW</span>
      <h4>回答已保存，完成一次辅助评分</h4>
      <p>将评分请求复制到 ChatGPT，只粘贴完整 JSON 反馈回来。导入前会重新核验 requestId、分数、回答引用和原文依据。</p>
      <div className="bridge-actions">
        <button className="secondary-button" type="button" onClick={onCopy}>复制评分请求</button>
        <button className="text-button" type="button" onClick={onOpenChat}>打开 ChatGPT</button>
      </div>
      <details className="bridge-prompt">
        <summary>查看评分请求</summary>
        <textarea aria-label="评分请求" readOnly value={bridge.prompt} rows={8} />
      </details>
      <textarea aria-label="评分反馈 JSON" value={reply} onChange={(event) => onReply(event.target.value)} placeholder={'粘贴 ChatGPT 返回的 JSON，例如：{"requestId":"…","feedback":{…}}'} rows={6} maxLength={30_000} disabled={busy} />
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="primary-button" type="button" onClick={onImport} disabled={busy || !reply.trim()}>
        {busy ? '校验中…' : '校验并导入反馈'}
      </button>
    </div>
  )
}

function PrintPage() {
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
        setError('没有找到待打印的文章。')
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
      setHtml(generateReadingPdfHtml(buildReadingExportModel(response.data, session)))
    }
    void loadArticle()
  }, [])

  if (error) {
    return <main className="print-shell"><div className="notice error-notice">{error}</div></main>
  }
  if (!html) {
    return <main className="print-shell"><div className="loading-state">正在加载打印内容…</div></main>
  }

  return <main className="print-shell"><iframe className="print-frame" title="问读完整训练记录" srcDoc={html} /></main>
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
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
