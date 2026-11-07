import { useEffect, useState } from 'react'

// SUBMIT: one Promise.all per screen, re-run when its key (the URL inputs)
// changes. Responses are cached per request in the query layer.
export type Loaded<T> = { state: 'loading' } | { state: 'error'; error: unknown } | { state: 'ok'; data: T }

export function useSubmit<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading' })
  useEffect(() => {
    let live = true
    setResult({ state: 'loading' })
    load().then(
      (data) => live && setResult({ state: 'ok', data }),
      (error) => live && setResult({ state: 'error', error }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return result
}
