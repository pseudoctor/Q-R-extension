export type CaptureSource = 'shortcut' | 'side-panel'

export type AiProviderId = 'openai' | 'deepseek' | 'gemini' | 'qwen' | 'glm' | 'kimi'

export type AiDimensionId = 'fidelity' | 'claim' | 'cause' | 'structure'

export type ArticleMetadata = {
  subtitle: string
  author: string
  source: string
}

export type ArticleBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language?: string; text: string }
  | { type: 'image'; src: string; alt: string }
  | { type: 'divider' }

export type AiSettings = {
  provider: AiProviderId
  model: string
  apiKey: string
}

export type AiModelOption = {
  id: string
  label: string
  created?: number
  publishedAt?: string
}

export type AiDimension = {
  score: number | null
  reason: string
}

export type AiObservation = {
  answerQuote: string
  comment: string
}

export type AiSource = {
  paragraph: number
  quote: string
  comment: string
}

export type AiFeedback = {
  dimensions: {
    fidelity: AiDimension
    claim: AiDimension
    cause: AiDimension
    structure: AiDimension
  }
  strengths: AiObservation[]
  gaps: AiObservation[]
  sources: AiSource[]
  nextQuestion: string
  total: number
}

export type CaptureRecord = {
  id: string
  title: string
  url: string
  metadata?: ArticleMetadata
  author?: string
  text: string
  blocks?: ArticleBlock[]
  preReadingPrediction?: string
  selectedText?: string
  capturedAt: string
  source: CaptureSource
}

export type PreReadingPredictionDraft = {
  articleId: string | null
  value: string
  updatedAt: string
}

export type SavedArticle = CaptureRecord & {
  isFavorite: boolean
  savedAt: string
}

export type SavedArticleStore = {
  version: 2
  items: SavedArticle[]
}

export type TrainingTurn = {
  stepIndex: number
  question: string
  answer: string
  submittedAt: string
  feedback?: AiFeedback
}

export type TrainingSession = {
  articleId: string
  currentStep: number
  currentQuestion: string
  draft: string
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
  | 'AI_NOT_CONFIGURED'
  | 'AI_PERMISSION_REQUIRED'
  | 'AI_CONNECTION_FAILED'
  | 'AI_REQUEST_FAILED'
  | 'AI_INVALID_RESPONSE'

export type ExtensionError = {
  code: ErrorCode
  message: string
}

export type ExtensionMessage =
  | { type: 'capture-current-page'; source: CaptureSource }
  | { type: 'open-training-page' }
  | { type: 'open-manual-paste-page' }
  | { type: 'open-settings' }
  | { type: 'get-pending-capture' }
  | { type: 'get-pre-reading-prediction-draft' }
  | { type: 'save-pre-reading-prediction-draft'; articleId?: string; value: string }
  | { type: 'clear-pending-capture' }
  | { type: 'get-saved-articles' }
  | { type: 'open-saved-article'; articleId: string }
  | { type: 'open-print-article'; articleId: string }
  | { type: 'delete-article'; articleId: string }
  | { type: 'toggle-favorite'; articleId: string }
  | { type: 'get-training-session'; articleId: string }
  | { type: 'start-training-session'; articleId: string }
  | { type: 'save-training-draft'; articleId: string; draft: string }
  | { type: 'submit-training-answer'; articleId: string; answer: string }
  | { type: 'reset-training-session'; articleId: string }
  | { type: 'get-ai-settings' }
  | { type: 'save-ai-settings'; settings: AiSettings }
  | { type: 'list-ai-models'; settings: AiSettings; force?: boolean }
  | { type: 'test-ai-connection'; settings: AiSettings }
  | { type: 'ai-start'; articleId: string }
  | { type: 'ai-grade'; articleId: string }
  | { type: 'prepare-ai-bridge'; articleId: string }
  | { type: 'import-ai-feedback'; articleId: string; requestId: string; raw: string }
  | { type: 'save-article'; article: CaptureRecord }

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ExtensionError }

export type StorageState = {
  pendingCapture?: CaptureRecord | null
  preReadingPredictionDraft?: PreReadingPredictionDraft | null
  savedArticles?: SavedArticleStore | SavedArticle[]
  trainingSessions?: TrainingSessionStore | TrainingSession[]
  aiSettings?: AiSettings
  lastTrainingTabId?: number
  lastPrintTabId?: number
}

