// SUBMIT dedupes identical requests: the same key returns the same promise, so
// Verdict -> Share card -> back costs no new round trips. The data is immutable
// between engine loads, so nothing expires; a failure is evicted so it can retry.
const cache = new Map<string, Promise<unknown>>()

export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit) return hit as Promise<T>
  const p = load()
  cache.set(key, p)
  p.catch(() => cache.delete(key))
  return p
}
