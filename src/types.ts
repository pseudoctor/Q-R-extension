export type CaptureSource = 'shortcut' | 'side-panel'

export type Locale = 'zh-CN' | 'en' | 'ja' | 'ko'

export type AiProviderId = 'openai' | 'deepseek' | 'gemini' | 'qwen' | 'glm' | 'kimi' | 'custom'

export type AiDimensionId = 'fidelity' | 'claim' | 'cause' | 'structure'

export type ArticleMetadata = {
  date?: string
  subtitle: string
  author: string
  source: string
}

export type MetadataStatus = 'found' | 'not-extracted' | 'verified-absent'
export type MetadataField = 'title' | 'subtitle' | 'author' | 'source' | 'date'
export type MetadataReview = { reviewed: boolean; fields: Record<MetadataField, { value: string; status: MetadataStatus }> }

export type ArticleInline = {
  text: string
  emphasis?: 'strong' | 'emphasis' | 'strong-emphasis'
}

export type ArticleBlock =
  | { type: 'paragraph'; text: string; inlines?: ArticleInline[]; id?: string }
  | { type: 'heading'; level: number; text: string; inlines?: ArticleInline[]; id?: string }
  | { type: 'quote'; text: string; inlines?: ArticleInline[]; id?: string }
  | { type: 'list'; ordered: boolean; items: string[]; itemInlines?: ArticleInline[][]; id?: string }
  | { type: 'code'; language?: string; text: string; id?: string }
  | { type: 'image'; src: string; alt: string; id?: string }
  | { type: 'chart'; text: string; alt: string; id?: string }
  | { type: 'divider'; id?: string }

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
  blockId?: string
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

export type SavedArticle = CaptureRecord & {
  isFavorite: boolean
  savedAt: string
}

export type SavedArticleStore = {
  version: 2
  items: SavedArticle[]
}

export type TrainingTurn = {
  revisionReason?: string
  stepIndex: number
  stepId?: string
  courseVersion?: TrainingCourseVersion
  answerVersionId?: string
  question: string
  answer: string
  submittedAt: string
  structuredDraft?: TrainingStructuredDraft
  importantParagraphs?: number[]
  threeSentenceDrafts?: ThreeSentenceDraft[]
  paragraphCursor?: number
  referenceAnswer?: AiReferenceAnswer
  feedback?: AiFeedback
}

export type TrainingStepStatus = 'not-started' | 'draft' | 'frozen' | 'completed' | 'needs-review'

export type TrainingStepRecord = {
  stepId: string
  status: TrainingStepStatus
  draft: string
  structuredDraft?: TrainingStructuredDraft
  importantParagraphs?: number[]
  threeSentenceDrafts?: ThreeSentenceDraft[]
  paragraphCursor?: number
  answerVersionId?: string
  completedAt?: string
  needsReviewBecause?: string
}

export type TrainingAnswerVersion = {
  revisionReason?: string
  id: string
  stepId: string
  stepIndex: number
  answer: string
  structuredDraft?: TrainingStructuredDraft
  importantParagraphs?: number[]
  threeSentenceDrafts?: ThreeSentenceDraft[]
  paragraphCursor?: number
  createdAt: string
  basedOnVersionId?: string
  feedback?: AiFeedback
}

export type TrainingRequestKind = 'grade' | 'reference'

export type TrainingRevision = Pick<TrainingTurn, 'answer' | 'structuredDraft' | 'importantParagraphs' | 'threeSentenceDrafts' | 'paragraphCursor'> & { reason: string }

export type TrainingRequestStatus = 'pending' | 'succeeded' | 'failed' | 'stale'

export type TrainingAiRequest = {
  id: string
  kind: TrainingRequestKind
  sessionId: string
  stepId: string
  answerVersionId?: string
  status: TrainingRequestStatus
  createdAt: string
  updatedAt: string
  errorCode?: ErrorCode
  errorMessage?: string
}

export type TrainingArticleSnapshot = {
  metadataReview?: MetadataReview
  id: string
  title: string
  metadata: ArticleMetadata
  text: string
  blocks: ArticleBlock[]
  capturedAt: string
}

export type ThreeSentenceDraft = {
  paragraph: number
  what: string
  why: string
  takeaway: string
  role: string
  evidence: string
  evidenceType?: 'explicit' | 'inferred' | 'not-stated'
}

export type TrainingDraftFieldId =
  | 'preview.metadata'
  | 'threePoints.evidence'
  | 'applicability.mode'
  | 'applicability.reason'
  | 'applicability.sourceId'
  | 'applicability.quote'
  | 'preview.title'
  | 'preview.subtitle'
  | 'preview.author'
  | 'preview.source'
  | 'preview.date'
  | 'preview.firstParagraph'
  | 'preview.lastParagraph'
  | 'preview.structure'
  | 'preview.expectedQuestion'
  | 'preview.unknown'
  | 'quickBrowse.structure'
  | 'quickBrowse.paragraphMap'
  | 'quickBrowse.paragraphLabels'
  | 'quickBrowse.representativeSentences'
  | 'threePoints.sources'
  | 'questions.question'
  | 'questions.category'
  | 'questions.items'
  | 'questions.relatedParagraphs'
  | 'questions.whyImportant'
  | 'questions.answered'
  | 'questions.unanswered'
  | 'assumptions.claim'
  | 'assumptions.evidence'
  | 'assumptions.assumption'
  | 'assumptions.otherExplanations'
  | 'assumptions.evidenceGap'
  | 'assumptions.uncertainty'
  | 'assumptions.claimStatus'
  | 'assumptions.evidenceStatus'
  | 'assumptions.assumptionImpact'
  | 'toulminSimple.claim'
  | 'toulminSimple.argumentId'
  | 'toulminSimple.claimStatus'
  | 'toulminSimple.evidenceStatus'
  | 'toulminSimple.warrantStatus'
  | 'toulminSimple.evidence'
  | 'toulminSimple.warrant'
  | 'toulminFull.backing'
  | 'toulminFull.qualifier'
  | 'toulminFull.rebuttal'
  | 'toulminFull.weakestPoint'
  | 'toulminFull.verification'
  | 'feynman.explanation'
  | 'feynman.example'
  | 'feynman.exampleType'
  | 'feynman.boundary'
  | 'review.articleMainIdea'
  | 'review.threePoints'
  | 'review.coreArgument'
  | 'review.premise'
  | 'review.strongestEvidence'
  | 'review.weakestPoint'
  | 'review.uncertainty'
  | 'review.revisit'

export type TrainingStructuredDraft = Partial<Record<TrainingDraftFieldId, string>>

export type TrainingFlowId = 'reading-10' | 'legacy-8'

export type TrainingCourseVersion = 'guided-reading-10-v1' | 'guided-reading-10-v0'

export type TrainingSession = {
  articleId: string
  flowId: TrainingFlowId
  courseVersion?: TrainingCourseVersion
  sessionId?: string
  isTest?: boolean
  currentStepId?: string
  draftRevision?: number
  answerVersionId?: string
  argumentId?: string
  articleSnapshotId?: string
  articleSnapshot?: TrainingArticleSnapshot
  answerVersions?: TrainingAnswerVersion[]
  reinforcements?: { id: string; answer: string; createdAt: string }[]
  aiRequests?: TrainingAiRequest[]
  stepRecords?: Record<string, TrainingStepRecord>
  isArchived?: boolean
  archivedAt?: string
  readingPosition?: { original: number; training: number }
  currentStep: number
  currentQuestion: string
  draft: string
  structuredDraft?: TrainingStructuredDraft
  importantParagraphs?: number[]
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

export type TrainingSessionStoreV3 = {
  version: 3
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
  | 'TRAINING_AI_REQUIRED'
  | 'TRAINING_CONFLICT'
  | 'TRAINING_READ_ONLY'
  | 'SHORTCUTS_PAGE_FAILED'

export type ExtensionError = {
  code: ErrorCode
  message: string
  detail?: string
}

export type ExtensionMessage =
  | { type: 'capture-current-page'; source: CaptureSource }
  | { type: 'open-manual-paste-page' }
  | { type: 'open-settings' }
  | { type: 'open-shortcuts' }
  | { type: 'get-locale' }
  | { type: 'save-locale'; locale: Locale }
  | { type: 'get-test-mode' }
  | { type: 'save-test-mode'; enabled: boolean }
  | { type: 'get-pending-capture' }
  | { type: 'clear-pending-capture' }
  | { type: 'get-saved-articles' }
  | { type: 'open-saved-article'; articleId: string }
  | { type: 'open-print-article'; articleId: string }
  | { type: 'delete-article'; articleId: string }
  | { type: 'toggle-favorite'; articleId: string }
  | { type: 'get-training-session'; articleId: string }
  | { type: 'start-training-session'; articleId: string }
  | { type: 'get-training-history'; articleId: string }
  | { type: 'set-training-step'; articleId: string; stepIndex: number; sessionId?: string; draftRevision?: number }
  | { type: 'save-training-draft'; articleId: string; draft: string; sessionId?: string; stepId?: string; draftRevision?: number; structuredDraft?: TrainingStructuredDraft; importantParagraphs?: number[]; threeSentenceDrafts?: ThreeSentenceDraft[]; paragraphCursor?: number }
  | { type: 'freeze-training-answer'; articleId: string; sessionId?: string; stepId?: string; draftRevision?: number }
  | { type: 'confirm-training-step'; articleId: string; sessionId?: string; stepId?: string; draftRevision?: number; targetStepId?: string }
  | { type: 'revise-training-turn'; articleId: string; turnIndex: number; sessionId: string; draftRevision: number; revision: TrainingRevision }
  | { type: 'save-training-reinforcement'; articleId: string; sessionId: string; id: string; answer: string }
  | { type: 'continue-training'; articleId: string; sessionId?: string; stepId?: string; draftRevision?: number; answerVersionId?: string }
  | { type: 'edit-training-turn'; articleId: string; turnIndex: number; sessionId?: string; draftRevision?: number }
  | { type: 'rewind-training-session'; articleId: string }
  | { type: 'reset-training-session'; articleId: string }
  | { type: 'get-ai-settings' }
  | { type: 'save-ai-settings'; settings: AiSettings }
  | { type: 'list-ai-models'; settings: AiSettings }
  | { type: 'test-ai-connection'; settings: AiSettings }
  | { type: 'ai-start'; articleId: string }
  | { type: 'ai-grade'; articleId: string; sessionId?: string; answerVersionId?: string }
  | { type: 'ai-reference-answer'; articleId: string; submittedAt: string }
  | { type: 'save-article'; article: CaptureRecord }

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ExtensionError }

export type StorageState = {
  pendingCapture?: CaptureRecord | null
  savedArticles?: SavedArticleStore | SavedArticle[]
  trainingSessions?: TrainingSessionStore | TrainingSession[]
  trainingSessionsV2?: TrainingSessionStoreV2
  trainingSessionsV3?: TrainingSessionStoreV3
  trainingTestSessionsV3?: TrainingSessionStoreV3
  aiSettings?: AiSettings
  locale?: Locale
  testMode?: boolean
  lastTrainingTabId?: number
  lastPrintTabId?: number
}

