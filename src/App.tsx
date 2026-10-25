import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CaptureRecord,
  ExtensionError,
  ExtensionMessage,
  ExtensionResponse,
  SavedArticle,
} from './types'
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

  return isTrainingPage ? <TrainingPage /> : <SidePanel />
}

function SidePanel() {
  const [articles, setArticles] = useState<SavedArticle[]>([])
  const [status, setStatus] = useState('准备从当前网页捕获文章。')
  const [loading, setLoading] = useState(false)

  const loadArticles = useCallback(async () => {
    const response = await sendExtensionMessage<SavedArticle[]>({
      type: 'get-saved-articles',
    })
    if (response.ok) {
      setArticles(response.data)
    }
  }, [])

  useEffect(() => {
    void loadArticles()
  }, [loadArticles])

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

  return (
    <main className="app-shell side-panel-shell">
      <header className="brand-header">
        <div>
          <span className="eyebrow">TOULMIN READER</span>
          <h1>问读</h1>
        </div>
        <span className="status-dot" aria-label="本地模式" />
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
        {articles.length === 0 ? (
          <div className="empty-state">
            <span className="empty-mark">○</span>
            <p>保存后的文章会出现在这里。</p>
          </div>
        ) : (
          <ul className="article-list">
            {articles.slice(0, 8).map((article) => (
              <li key={article.id}>
                <button className="article-list-item" type="button" onClick={() => void openSavedArticle(article.id)}>
                  <strong>{article.title}</strong>
                  <span>{formatDate(article.savedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="panel-footer">正文只保存在此浏览器的插件存储中。</footer>
    </main>
  )
}

function TrainingPage() {
  const [capture, setCapture] = useState<CaptureRecord | null>(null)
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

  return (
    <main className="app-shell training-shell">
      <header className="training-header">
        <div>
          <span className="eyebrow">READ BEFORE YOU TRAIN</span>
          <h1>先把文章读进来</h1>
          <p>确认正文后再开始图尔敏阅读训练。当前版本不会上传文章。</p>
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
              <button className="primary-button" type="button" onClick={() => void saveCurrentArticle()} disabled={saving}>
                {saving ? '保存中…' : '保存并开始训练'}
              </button>
            </div>
            {status && <p className="status-message" role="status">{status}</p>}
          </section>
        </>
      )}
    </main>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

export default App
