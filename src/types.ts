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
  isFavorite: boolean
  savedAt: string
}

export type SavedArticleStore = {
  version: 1
  items: SavedArticle[]
}

export type TrainingTurn = {
  stepIndex: number
  question: string
  answer: string
  submittedAt: string
}

export type TrainingSession = {
  articleId: string
  currentStep: number
  turns: TrainingTurn[]
  startedAt: string
  updatedAt: string
  completedAt?: string
}

export type TrainingSessionStore = {
  version: 1
  items: TrainingSession[]
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
  | { type: 'open-print-article'; articleId: string }
  | { type: 'delete-article'; articleId: string }
  | { type: 'toggle-favorite'; articleId: string }
  | { type: 'get-training-session'; articleId: string }
  | { type: 'start-training-session'; articleId: string }
  | { type: 'submit-training-answer'; articleId: string; answer: string }
  | { type: 'reset-training-session'; articleId: string }
  | { type: 'save-article'; article: CaptureRecord }

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ExtensionError }

export type StorageState = {
  pendingCapture?: CaptureRecord | null
  savedArticles?: SavedArticleStore | SavedArticle[]
  trainingSessions?: TrainingSessionStore | TrainingSession[]
  lastTrainingTabId?: number
  lastPrintTabId?: number
}

