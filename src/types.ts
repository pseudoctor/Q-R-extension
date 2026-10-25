export type CaptureSource = 'shortcut' | 'side-panel'

export type Locale = 'zh-CN' | 'en' | 'ja' | 'ko'

export type AiProviderId = 'openai' | 'deepseek' | 'gemini' | 'qwen' | 'glm' | 'kimi' | 'custom'

export type AiDimensionId = 'fidelity' | 'claim' | 'cause' | 'structure'

export type ArticleMetadata = {
  subtitle: string
  author: string
  source: string
}

export type ArticleInline = {
  text: string
  emphasis?: 'strong' | 'emphasis' | 'strong-emphasis'
}

export type ArticleBlock =
  | { type: 'paragraph'; text: string; inlines?: ArticleInline[] }
  | { type: 'heading'; level: number; text: string; inlines?: ArticleInline[] }
  | { type: 'quote'; text: string; inlines?: ArticleInline[] }
  | { type: 'list'; ordered: boolean; items: string[]; itemInlines?: ArticleInline[][] }
  | { type: 'code'; language?: string; text: string }
  | { type: 'image'; src: string; alt: string }
  | { type: 'chart'; text: string; alt: string }
  | { type: 'divider' }

export type AiSettings = {
  provider: AiProviderId
  model: string
  apiKey: string
  endpoint: string
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
  nextStepId: string | null
  total: number
}

export type AiReferenceAnswer = {
  answer: string
  sources: AiSource[]
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
  stepId?: string
  question: string
  answer: string
  submittedAt: string
  threeSentenceDrafts?: ThreeSentenceDraft[]
  paragraphCursor?: number
  referenceAnswer?: AiReferenceAnswer
  feedback?: AiFeedback
}

export type ThreeSentenceDraft = {
  paragraph: number
  what: string
  why: string
  takeaway: string
}

export type TrainingFlowId = 'reading-10' | 'legacy-8'

export type TrainingSession = {
  articleId: string
  flowId: TrainingFlowId
  currentStep: number
  currentQuestion: string
  draft: string
  threeSentenceDrafts?: ThreeSentenceDraft[]
  paragraphCursor?: number
  turns: TrainingTurn[]
  startedAt: string
  updatedAt: string
  completedAt?: string
}

export type TrainingSessionStore = {
  version: 1
  items: TrainingSession[]
}

export type TrainingSessionStoreV2 = {
  version: 2
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
  | 'AI_INVALID_ENDPOINT'
  | 'AI_CONNECTION_FAILED'
  | 'AI_REQUEST_FAILED'
  | 'AI_INVALID_RESPONSE'
  | 'AI_RESPONSE_INVALID_JSON'
  | 'AI_QUESTION_INVALID'
  | 'AI_FEEDBACK_INVALID'
  | 'AI_ANSWER_INVALID'
  | 'TRAINING_ANSWER_FORMAT_INVALID'
  | 'TRAINING_READ_ONLY'
  | 'SHORTCUTS_PAGE_FAILED'

export type ExtensionError = {
  code: ErrorCode
  message: string
}

export type ExtensionMessage =
  | { type: 'capture-current-page'; source: CaptureSource }
  | { type: 'open-manual-paste-page' }
  | { type: 'open-settings' }
  | { type: 'open-shortcuts' }
  | { type: 'get-locale' }
  | { type: 'save-locale'; locale: Locale }
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
  | { type: 'save-training-draft'; articleId: string; draft: string; threeSentenceDrafts?: ThreeSentenceDraft[]; paragraphCursor?: number }
  | { type: 'rewind-training-session'; articleId: string }
  | { type: 'reset-training-session'; articleId: string }
  | { type: 'get-ai-settings' }
  | { type: 'save-ai-settings'; settings: AiSettings }
  | { type: 'list-ai-models'; settings: AiSettings }
  | { type: 'test-ai-connection'; settings: AiSettings }
  | { type: 'ai-start'; articleId: string }
  | { type: 'ai-grade'; articleId: string }
  | { type: 'ai-reference-answer'; articleId: string; submittedAt: string }
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
  trainingSessionsV2?: TrainingSessionStoreV2
  aiSettings?: AiSettings
  locale?: Locale
  lastTrainingTabId?: number
  lastPrintTabId?: number
}

