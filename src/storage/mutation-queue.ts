export function createKeyedMutationQueue() {
  const tails = new Map<string, Promise<void>>()

  return async function run<T>(key: string, mutation: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(mutation)
    const tail = next.then(() => undefined, () => undefined)
    tails.set(key, tail)

    try {
      return await next
    } finally {
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}
