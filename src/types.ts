export type CaptureSource = 'shortcut' | 'side-panel'

export type CaptureRecord = {
  id: string
  title: string
  url: string
  author?: string
  text: string
  selectedText?: string
  capturedAt: string
  source: CaptureSource
}

export type SavedArticle = CaptureRecord & {
  savedAt: string
}

export type ErrorCode =
  | 'NO_ACTIVE_TAB'
  | 'PAGE_NOT_ACCESSIBLE'
  | 'ARTICLE_TOO_SHORT'
  | 'EXTRACTION_FAILED'
  | 'STORAGE_FAILED'
  | 'INVALID_REQUEST'

export type ExtensionError = {
  code: ErrorCode
  message: string
}

export type ExtensionMessage =
  | { type: 'capture-current-page'; source: CaptureSource }
  | { type: 'open-training-page' }
  | { type: 'get-pending-capture' }
  | { type: 'clear-pending-capture' }
  | { type: 'get-saved-articles' }
  | { type: 'open-saved-article'; articleId: string }
  | { type: 'save-article'; article: CaptureRecord }

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ExtensionError }

export type StorageState = {
  pendingCapture?: CaptureRecord | null
  savedArticles?: SavedArticle[]
  lastTrainingTabId?: number
}

