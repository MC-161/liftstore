// Light / dark. No stored choice: follow the system (CSS handles it, no
// attribute). A stored choice pins data-theme on <html>. Storage may be
// blocked, so every access is guarded and the system default still works.
export type Theme = 'light' | 'dark'
const KEY = 'ple.theme'

export function storedTheme(): Theme | null {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function effectiveTheme(): Theme {
  const s = document.documentElement.dataset.theme
  if (s === 'light' || s === 'dark') return s
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

// Transitions are switched off for one frame while the theme flips: a
// background transition doesn't re-resolve a changed CSS variable, so
// without this, buttons and rows keep the previous theme's fill.
export function applyTheme(t: Theme | null) {
  const root = document.documentElement
  root.dataset.switching = ''
  if (t) root.dataset.theme = t
  else delete root.dataset.theme
  void root.offsetHeight // commit the new values before transitions return
  requestAnimationFrame(() => delete root.dataset.switching)
}

export function setTheme(t: Theme) {
  applyTheme(t)
  try {
    window.localStorage.setItem(KEY, t)
  } catch {
    /* blocked storage: the choice lasts for this page only */
  }
}
