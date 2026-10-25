import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CaptureRecord,
  AiSettings,
  AiFeedback,
  ExtensionError,
  ExtensionMessage,
  ExtensionResponse,
  SavedArticle,
  TrainingSession,
} from './types'
import { AI_PROVIDERS, defaultAiSettings, providerById } from './ai/providers'
import { articleToJson } from './export/json'
import { articleToMarkdown } from './export/markdown'
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
  const [status, setStatus] = useState('准备从当前网页捕获文章。')
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const loadArticles = useCallback(async () => {
    const response = await sendExtensionMessage<SavedArticle[]>({
      type: 'get-saved-articles',
    })
    if (response.ok) {
      // This is the async result of the storage synchronization effect.
      // oxlint-disable-next-line react(set-state-in-effect)
      setArticles(response.data)
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
    if (!query) return articles
    return articles.filter((article) =>
      [article.title, article.author, article.url, article.text]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query)),
    )
  }, [articles, searchTerm])

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

  const exportArticle = (article: SavedArticle, format: 'markdown' | 'json') => {
    const content = format === 'markdown' ? articleToMarkdown(article) : articleToJson(article)
    const extension = format === 'markdown' ? 'md' : 'json'
    downloadText(content, `${safeFilename(article.title)}.${extension}`, format === 'markdown' ? 'text/markdown' : 'application/json')
    setStatus(`已导出 ${format === 'markdown' ? 'Markdown' : 'JSON'}。`)
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
            <h2>最近保存</h2>
          </div>
          <button className="icon-button" type="button" onClick={() => void loadArticles()} aria-label="刷新文章列表">
            ↻
          </button>
        </div>
        <input
          className="search-input"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="搜索标题、作者或正文…"
          aria-label="搜索本地文章"
        />
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
            {filteredArticles.slice(0, 8).map((article) => (
              <li key={article.id}>
                <div className="article-list-item">
                  <button className="article-open-button" type="button" onClick={() => void openSavedArticle(article.id)}>
                    <strong>{article.isFavorite ? '★ ' : ''}{article.title}</strong>
                    <span>{formatDate(article.savedAt)} · {article.text.length.toLocaleString()} 字符</span>
                  </button>
                  <div className="article-actions">
                    <button type="button" onClick={() => void toggleFavorite(article.id)} aria-label={article.isFavorite ? '取消收藏' : '收藏'}>
                      {article.isFavorite ? '★' : '☆'}
                    </button>
                    <button type="button" onClick={() => exportArticle(article, 'markdown')} aria-label="导出 Markdown">MD</button>
                    <button type="button" onClick={() => exportArticle(article, 'json')} aria-label="导出 JSON">JSON</button>
                    <button type="button" onClick={() => void printArticle(article.id)} aria-label="打印或保存为 PDF">PDF</button>
                    <button type="button" onClick={() => void deleteArticle(article.id)} aria-label="删除文章">×</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="panel-footer">正文只保存在此浏览器的插件存储中。</footer>
    </main>
  )
}

function SettingsPage() {
  const [settings, setSettings] = useState<AiSettings>(defaultAiSettings())
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState('')
  const [permissionStatus, setPermissionStatus] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void sendExtensionMessage<AiSettings>({ type: 'get-ai-settings' }).then((response) => {
        setLoaded(true)
        if (response.ok) setSettings(response.data)
        else setStatus(errorMessage(response.error))
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const provider = providerById(settings.provider)

  const ensurePermission = async () => {
    if (!extensionAvailable || !chrome.permissions) return false
    const origins = [provider.hostPattern]
    const alreadyGranted = await chrome.permissions.contains({ origins })
    if (alreadyGranted) return true
    setPermissionStatus(`需要允许访问 ${provider.baseUrl} 才能测试或调用该模型。`)
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
    const response = await sendExtensionMessage<AiSettings>({
      type: 'save-ai-settings',
      settings: { ...settings, apiKey: settings.apiKey.trim() },
    })
    setBusy(false)
    setStatus(response.ok ? '已保存到插件本地存储。API key 不会写入文章或日志。' : errorMessage(response.error))
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
    setStatus(response.ok ? `连接成功：${response.data.provider} · ${response.data.model}` : errorMessage(response.error))
  }

  const selectProvider = (providerId: AiSettings['provider']) => {
    const nextProvider = providerById(providerId)
    setSettings((current) => ({ ...current, provider: providerId, model: nextProvider.defaultModel }))
    setPermissionStatus('')
    setStatus('')
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
            <input value={settings.model} onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))} placeholder={provider.defaultModel} />
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
  const [url, setUrl] = useState('')
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
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
      if (!response.data) {
        setLoadError(queryError)
        return
      }
      setCapture(response.data)
      setTitle(response.data.title)
      setUrl(response.data.url)
      setAuthor(response.data.author ?? '')
      setText(response.data.text)
    }

    void loadCapture()
  }, [queryError])

  const saveCurrentArticle = async () => {
    const trimmedText = text.trim()
    if (trimmedText.length < 20) {
      setStatus('正文至少需要 20 个字符，或先从网页重新获取文章。')
      return
    }

    setSaving(true)
    const article: CaptureRecord = {
      id: capture?.id ?? crypto.randomUUID(),
      title: title.trim() || '未命名文章',
      url: url.trim(),
      ...(author.trim() ? { author: author.trim() } : {}),
      text: trimmedText,
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
    const fields = {
      title: title.trim() || '未命名文章',
      url: url.trim(),
      ...(author.trim() ? { author: author.trim() } : {}),
      text: text.trim(),
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

  const exportCurrentArticle = (format: 'markdown' | 'json') => {
    const article = currentArticle()
    const content = format === 'markdown' ? articleToMarkdown(article) : articleToJson(article)
    const extension = format === 'markdown' ? 'md' : 'json'
    downloadText(content, `${safeFilename(article.title)}.${extension}`, format === 'markdown' ? 'text/markdown' : 'application/json')
    setStatus(`已导出 ${format === 'markdown' ? 'Markdown' : 'JSON'}。`)
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
              来源 URL
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" inputMode="url" />
            </label>
            <label>
              作者（可选）
              <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="作者名" />
            </label>
            <label>
              正文
              <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="把文章正文粘贴到这里…" rows={22} />
            </label>
            <div className="editor-footer">
              <span className="character-count">{text.length.toLocaleString()} 字符</span>
              <div className="editor-actions">
                <button className="secondary-button" type="button" onClick={() => exportCurrentArticle('markdown')}>Markdown</button>
                <button className="secondary-button" type="button" onClick={() => exportCurrentArticle('json')}>JSON</button>
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

function TrainingCoach({ articleId }: { articleId: string }) {
  const [session, setSession] = useState<TrainingSession | null>(null)
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [aiLoaded, setAiLoaded] = useState(false)
  const [readConfirmed, setReadConfirmed] = useState(false)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [offlineContinuation, setOfflineContinuation] = useState(false)
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
        if (sessionResponse.ok) setSession(sessionResponse.data)
        else setError(errorMessage(sessionResponse.error))
        if (settingsResponse.ok) setAiSettings(settingsResponse.data)
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [articleId])

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

  const submit = async () => {
    if (answer.trim().length < 5) {
      setError('请先写下至少 5 个字符的独立回答。')
      return
    }
    setBusy(true)
    setError('')
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'submit-training-answer',
      articleId,
      answer,
    })
    if (!response.ok) {
      setBusy(false)
      setError(errorMessage(response.error))
      return
    }
    setSession(response.data)
    setAnswer('')
    setOfflineContinuation(false)

    if (!aiConfigured) {
      setBusy(false)
      return
    }
    const aiResponse = await sendExtensionMessage<TrainingSession>({
      type: 'ai-grade',
      articleId,
    })
    setBusy(false)
    if (aiResponse.ok) setSession(aiResponse.data)
    else setError(errorMessage(aiResponse.error))
  }

  const retryGrade = async () => {
    setBusy(true)
    setError('')
    const response = await sendExtensionMessage<TrainingSession>({
      type: 'ai-grade',
      articleId,
    })
    setBusy(false)
    if (response.ok) {
      setSession(response.data)
      setOfflineContinuation(false)
    } else {
      setError(errorMessage(response.error))
    }
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
    setAnswer('')
    setOfflineContinuation(false)
    setError('')
  }

  const step = session ? LESSON_STEPS[session.currentStep] : null
  const latestTurn = session?.turns.at(-1)
  const aiPending = Boolean(aiConfigured && latestTurn && !latestTurn.feedback && !offlineContinuation)
  const completed = session?.currentStep === LESSON_STEPS.length && !aiPending

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
      ) : aiPending && latestTurn ? (
        <div className="ai-pending-card">
          <span className="section-kicker">AI REVIEW PENDING</span>
          <h3>回答已保存，等待 AI 评分</h3>
          <p>这轮回答不会丢失。评分成功后，下一轮问题才会解锁；如果服务暂时不可用，可以稍后重试。</p>
          <blockquote>{latestTurn.answer}</blockquote>
          <div className="round-footer">
            <button className="primary-button" type="button" onClick={() => void retryGrade()} disabled={busy}>
              {busy ? '评分中…' : '重试 AI 评分'}
            </button>
            <button className="text-button" type="button" onClick={() => setOfflineContinuation(true)} disabled={busy}>跳过评分，继续离线训练</button>
          </div>
        </div>
      ) : completed ? (
        <>
          <div className="coach-complete">
            <span className="complete-mark">✓</span>
            <div>
              <h3>八轮训练已完成</h3>
              <p>你已经留下了完整的阅读思考记录。每轮回答和 AI 反馈都保存在本地。</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => void reset()}>重新开始</button>
          </div>
          {latestTurn?.feedback && <FeedbackCard feedback={latestTurn.feedback} />}
        </>
      ) : step ? (
        <div className="coach-round">
          <div className="round-meta">
            <span>{step.stage} · {step.name}</span>
            <strong>{step.focus}</strong>
          </div>
          {latestTurn?.feedback && <FeedbackCard feedback={latestTurn.feedback} />}
          <h3>{session.currentQuestion || step.question}</h3>
          <p className="round-instruction">{step.instruction}</p>
          <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="先写下自己的理解，不必追求一次答对…" rows={8} maxLength={4000} disabled={busy || aiPending} />
          <div className="round-footer">
            <span>{answer.length.toLocaleString()} / 4,000 字符</span>
            <button className="primary-button" type="button" onClick={() => void submit()} disabled={busy || aiPending || answer.trim().length < 5}>
              {busy ? aiConfigured ? 'AI 评分中…' : '保存中…' : aiConfigured ? '提交并评分' : '保存这一轮'}
            </button>
          </div>
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

function PrintPage() {
  const [article, setArticle] = useState<CaptureRecord | SavedArticle | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadArticle = async () => {
      const response = await sendExtensionMessage<CaptureRecord | null>({
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
      setArticle(response.data)
    }
    void loadArticle()
  }, [])

  if (error) {
    return <main className="print-shell"><div className="notice error-notice">{error}</div></main>
  }
  if (!article) {
    return <main className="print-shell"><div className="loading-state">正在加载打印内容…</div></main>
  }

  return (
    <main className="print-shell">
      <div className="print-toolbar no-print">
        <span>问读 · 打印阅读稿</span>
        <button className="primary-button" type="button" onClick={() => window.print()}>打印 / 保存为 PDF</button>
      </div>
      <article className="print-article">
        <span className="eyebrow">TOULMIN READER</span>
        <h1>{article.title}</h1>
        <div className="print-meta">
          {article.author && <span>{article.author}</span>}
          {safeHttpUrl(article.url) && <a href={safeHttpUrl(article.url)}>{article.url}</a>}
          <time dateTime={article.capturedAt}>{formatDateTime(article.capturedAt)}</time>
        </div>
        <div className="print-content">
          {article.text.split('\n').map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
          ))}
        </div>
      </article>
    </main>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function safeFilename(value: string) {
  return (value.trim() || '未命名文章')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
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
