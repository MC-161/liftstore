// The launch film: a 1920x1080 stage driven by one clock. Nothing animates on
// its own; the recorder sets the time, waits a frame and captures, so every
// frame is deterministic. Numbers come live from the engine at load.
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '../src/index.css'
import './film.css'
import { Film, DURATION } from './Film'
import { loadFilmData, type FilmData } from './data'

declare global {
  interface Window { __film: { ready: boolean; duration: number; seek: (ms: number) => Promise<void>; error?: string } }
}

const theme = new URLSearchParams(location.search).get('theme')
if (theme) document.documentElement.dataset.theme = theme

const root = createRoot(document.getElementById('root')!)
let data: FilmData | null = null

window.__film = {
  ready: false,
  duration: DURATION,
  async seek(ms: number) {
    flushSync(() => root.render(<Film t={ms} d={data!} />))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  },
}

loadFilmData()
  .then(async (d) => {
    data = d
    await document.fonts.ready
    const q = new URLSearchParams(location.search).get('t')
    await window.__film.seek(q ? Number(q) : 0)
    window.__film.ready = true
  })
  .catch((e) => { window.__film.error = String(e); console.error(e) })
