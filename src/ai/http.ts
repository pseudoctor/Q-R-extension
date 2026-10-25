export function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort()
      reject(new DOMException('Request timed out', 'AbortError'))
    }, timeoutMs)
  })
  const request = Promise.resolve().then(() => operation(controller.signal))

  return Promise.race([request, timeout]).finally(() => {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId)
  })
}
