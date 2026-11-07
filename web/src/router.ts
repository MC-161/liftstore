// A 40-line router: five screens, and the URL is the state (spec section 9).
import { useEffect, useState } from 'react'

export type Route = { path: string; params: URLSearchParams }

function read(): Route {
  return { path: window.location.pathname, params: new URLSearchParams(window.location.search) }
}

const listeners = new Set<() => void>()
window.addEventListener('popstate', () => listeners.forEach((l) => l()))

export function navigate(to: string, replace = false) {
  if (replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  listeners.forEach((l) => l())
  if (!replace) window.scrollTo(0, 0)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => setRoute(read())
    listeners.add(on)
    return () => {
      listeners.delete(on)
    }
  }, [])
  return route
}

// Link that keeps the click client-side but stays a real <a> (open in new tab works).
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  navigate(e.currentTarget.getAttribute('href')!)
}
