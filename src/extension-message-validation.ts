import type { AiSettings, CaptureRecord, ExtensionMessage, TrainingStructuredDraft } from './types'

const MESSAGE_TYPES = [
  'capture-current-page',
  'open-manual-paste-page',
  'open-settings',
  'open-shortcuts',
  'get-locale',
  'save-locale',
  'get-test-mode',
  'save-test-mode',
  'get-pending-capture',
  'clear-pending-capture',
  'get-saved-articles',
  'open-saved-article',
  'open-print-article',
  'delete-article',
  'toggle-favorite',
  'get-training-session',
  'start-training-session',
  'get-training-history',
  'set-training-step',
  'save-training-draft',
  'freeze-training-answer',
  'confirm-training-step',
  'revise-training-turn',
  'save-training-reinforcement',
  'continue-training',
  'continue-training-partial',
  'ai-field-assist',
  'edit-training-turn',
  'rewind-training-session',
  'reset-training-session',
  'get-ai-settings',
  'save-ai-settings',
  'list-ai-models',
  'test-ai-connection',
  'ai-start',
  'ai-grade',
  'ai-reference-answer',
  'save-article',
] as const

const AI_PROVIDERS = new Set(['openai', 'deepseek', 'gemini', 'qwen', 'glm', 'kimi', 'custom'])
const CAPTURE_SOURCES = new Set(['shortcut', 'side-panel'])
const ASSIST_MODES = new Set(['hint', 'reference'])
const LOCALES = new Set(['zh-CN', 'en', 'ja', 'ko'])
const MAX_MESSAGE_SIZE = 300_000

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value) || !isMessageType(value.type) || !isReasonableMessageSize(value)) return false
  switch (value.type) {
    case 'capture-current-page':
      return typeof value.source === 'string' && CAPTURE_SOURCES.has(value.source)
    case 'save-locale':
      return typeof value.locale === 'string' && LOCALES.has(value.locale)
    case 'save-test-mode':
      return typeof value.enabled === 'boolean'
    case 'open-saved-article':
    case 'open-print-article':
    case 'delete-article':
    case 'toggle-favorite':
    case 'get-training-session':
    case 'start-training-session':
    case 'get-training-history':
    case 'ai-start':
      return isId(value.articleId)
    case 'set-training-step':
      return isId(value.articleId) && isFiniteInteger(value.stepIndex) && optionalTrainingIdentity(value)
    case 'save-training-draft':
      return isId(value.articleId) && isText(value.draft, 40_000) && optionalTrainingIdentity(value) &&
        optionalStructuredDraft(value.structuredDraft) && optionalNumberArray(value.importantParagraphs) &&
        optionalDraftArray(value.threeSentenceDrafts) && optionalNonNegativeInteger(value.paragraphCursor)
    case 'freeze-training-answer':
    case 'confirm-training-step':
    case 'continue-training':
    case 'continue-training-partial':
    case 'edit-training-turn':
    case 'ai-grade':
      return isId(value.articleId) && optionalTrainingIdentity(value) &&
        (value.type !== 'edit-training-turn' || isFiniteInteger(value.turnIndex)) &&
        (value.type !== 'ai-grade' || optionalId(value.answerVersionId)) &&
        (value.type !== 'confirm-training-step' || optionalId(value.targetStepId))
    case 'revise-training-turn':
      return isId(value.articleId) && isFiniteInteger(value.turnIndex) && isId(value.sessionId) &&
        isNonNegativeInteger(value.draftRevision) && isRecord(value.revision) && isText(value.revision.reason, 1_000)
    case 'save-training-reinforcement':
      return isId(value.articleId) && isId(value.sessionId) && isId(value.id) && isText(value.answer, 40_000)
    case 'ai-field-assist':
      return isId(value.articleId) && isId(value.sessionId) && isId(value.stepId) &&
        isNonNegativeInteger(value.draftRevision) && isId(value.fieldId) &&
        typeof value.mode === 'string' && ASSIST_MODES.has(value.mode) && isText(value.draft, 40_000) &&
        optionalStructuredDraft(value.structuredDraft) && optionalNumberArray(value.importantParagraphs) &&
        optionalDraftArray(value.threeSentenceDrafts) && optionalNonNegativeInteger(value.paragraphCursor)
    case 'save-ai-settings':
      return isAiSettings(value.settings) && optionalBoolean(value.preserveApiKey) && optionalBoolean(value.clearApiKey)
    case 'list-ai-models':
    case 'test-ai-connection':
      return isAiSettings(value.settings)
    case 'ai-reference-answer':
      return isId(value.articleId) && isText(value.submittedAt, 100)
    case 'save-article':
      return isCaptureRecord(value.article)
    default:
      return true
  }
}

function isMessageType(value: unknown): value is typeof MESSAGE_TYPES[number] {
  return typeof value === 'string' && (MESSAGE_TYPES as readonly string[]).includes(value)
}

function isAiSettings(value: unknown): value is AiSettings {
  if (!isRecord(value)) return false
  return typeof value.provider === 'string' && AI_PROVIDERS.has(value.provider) &&
    isText(value.model, 120) && isText(value.apiKey, 500, false) && isText(value.endpoint, 1_000, false)
}

function isCaptureRecord(value: unknown): value is CaptureRecord {
  if (!isRecord(value)) return false
  return isId(value.id) && isText(value.title, 1_000) && isText(value.url, 4_000) &&
    isText(value.text, 36_000) && isText(value.capturedAt, 100) &&
    typeof value.source === 'string' && CAPTURE_SOURCES.has(value.source)
}

function optionalTrainingIdentity(value: Record<string, unknown>) {
  return optionalId(value.sessionId) && optionalId(value.stepId) && optionalNonNegativeInteger(value.draftRevision)
}

function optionalStructuredDraft(value: unknown): value is TrainingStructuredDraft | undefined {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => typeof item === 'string' && item.length <= 10_000)
}

function optionalNumberArray(value: unknown): value is number[] | undefined {
  return value === undefined || (Array.isArray(value) && value.length <= 40 && value.every(isFiniteInteger))
}

function optionalDraftArray(value: unknown): value is unknown[] | undefined {
  return value === undefined || (Array.isArray(value) && value.length <= 40 && value.every(isRecord))
}

function optionalBoolean(value: unknown) {
  return value === undefined || typeof value === 'boolean'
}

function optionalId(value: unknown) {
  return value === undefined || isId(value)
}

function isId(value: unknown): value is string {
  return isText(value, 200)
}

function isText(value: unknown, maxLength: number, requireNonEmpty = true): value is string {
  if (typeof value !== 'string' || value.length > maxLength) return false
  if (requireNonEmpty && !value.trim()) return false
  return ![...value].some((character) => character.charCodeAt(0) <= 8 || character.charCodeAt(0) === 127)
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteInteger(value) && value >= 0
}

function optionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value)
}

function isReasonableMessageSize(value: unknown) {
  try {
    return JSON.stringify(value).length <= MAX_MESSAGE_SIZE
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
