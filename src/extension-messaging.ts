import type { ExtensionError, ExtensionMessage, ExtensionResponse } from './types'
import { detectLocale } from './i18n/types'
import { translate } from './i18n/messages'

const extensionAvailable = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)

export async function sendExtensionMessage<T>(message: ExtensionMessage): Promise<ExtensionResponse<T>> {
  if (!extensionAvailable) {
    return {
      ok: false,
      error: {
        code: 'PAGE_NOT_ACCESSIBLE',
        message: translate(detectLocale(), 'common.pageAccessible'),
      },
    }
  }

  try {
    return await chrome.runtime.sendMessage(message) as ExtensionResponse<T>
  } catch {
    return {
      ok: false,
      error: {
        code: 'EXTENSION_UNAVAILABLE',
        message: translate(detectLocale(), 'error.EXTENSION_UNAVAILABLE'),
      },
    }
  }
}

export function errorMessage(error: ExtensionError) {
  return `${error.message}${error.detail ? ` ${error.detail}` : ''}（${error.code}）`
}
