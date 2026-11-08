import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import { kg } from '../lib/format'
import { EQUIP_LABEL, className, ipfClassIndex, toQuery, total, type Inputs } from '../lib/inputs'
import { onLinkClick } from '../router'
import { effectiveTheme, setTheme, type Theme } from '../lib/theme'

type Screen = 'verdict' | 'weight-class' | 'attempts' | 'head-to-head' | 'leaderboards' | 'entry'

// The mark: three bars, rising. Drawn, so it takes the theme's colours.
// The mark: a loaded barbell, side on. The plates are the three lifts,
// deadlift innermost and largest, squat outermost.
export const MARK_PLATES = [
  { lift: 'squat', x: 2, y: 7, h: 10 },
  { lift: 'bench', x: 6, y: 4, h: 16 },
  { lift: 'deadlift', x: 10, y: 1, h: 22 },
  { lift: 'deadlift', x: 27, y: 1, h: 22 },
  { lift: 'bench', x: 31, y: 4, h: 16 },
  { lift: 'squat', x: 35, y: 7, h: 10 },
] as const

export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={(size * 40) / 24} height={size} viewBox="0 0 40 24" aria-hidden="true">
      <rect x="0" y="11" width="40" height="2" rx="1" fill="var(--text-3)" />
      {MARK_PLATES.map((p) => <rect key={p.x} x={p.x} y={p.y} width="3" height={p.h} rx="1" fill={`var(--${p.lift})`} />)}
    </svg>
  )
}

export function ThemeToggle() {
  const [theme, set] = useState<Theme>(effectiveTheme)
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <button className="iconbtn" type="button" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      onClick={() => { setTheme(next); set(next) }}>
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
          <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
        </svg>
      )}
    </button>
  )
}

// Desktop: one row of tabs. Phone: the same destinations as a bottom bar,
// where a thumb reaches them. Entry is an action ("Edit lifts"), not a tab.
const ICON: Record<Exclude<Screen, 'entry'>, ReactNode> = {
  verdict: <path d="M3 14a7 7 0 0 1 14 0M10 14l3.5-4.5" />,
  'weight-class': <path d="M4 16V9M8 16V6M12 16V8M16 16V4" />,
  attempts: <path d="M3 16h14M5 16v-3M10 16V8M15 16V4M13 6l2-2 2 2" />,
  'head-to-head': <path d="M4 16V6M8 16v-6M12 16v-8M16 16V9M10 3v14" />,
  leaderboards: <path d="M3 16h14M7.5 16V9h5v7M3 16v-4h4.5M12.5 16v-6H17v6" />,
}

export function TopNav({ active, inputs }: { active: Screen; inputs: Inputs | null }) {
  const q = inputs ? `?${toQuery(inputs)}` : ''
  const tabs: [Exclude<Screen, 'entry'>, string, string, string][] = [
    ['verdict', 'Verdict', 'Verdict', `/v${q}`],
    ['weight-class', 'Weight class', 'Classes', `/wc${q}`],
    ['attempts', 'Attempts', 'Attempts', `/at${q}`],
    ['head-to-head', 'Head to head', 'Versus', `/h2h${q}`],
    ['leaderboards', 'Leaderboards', 'Ranks', `/lb${q}`],
  ]
  // One underline that slides to the active tab instead of each tab drawing
  // its own. Measured from the DOM so it follows real label widths; the first
  // placement doesn't animate, later ones glide.
  const tabsRef = useRef<HTMLDivElement>(null)
  const [ink, setInk] = useState({ x: 0, w: 0, ready: false })
  useLayoutEffect(() => {
    const box = tabsRef.current
    if (!box) return
    const place = () => {
      const a = box.querySelector<HTMLElement>('.tab.active')
      if (!a) return
      setInk((p) => ({ x: a.offsetLeft, w: a.offsetWidth, ready: p.w > 0 }))
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(box)
    return () => ro.disconnect()
  }, [active])
  // The bottom bar needs no measuring (equal columns); it only waits a frame
  // so its first position doesn't animate in.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(r)
  }, [])

  return (
    <>
      <nav className="topnav" aria-label="Main">
        <a className="brand" href="/" onClick={onLinkClick}><Mark />Weak Link</a>
        <div className="tabs" ref={tabsRef}>
          {tabs.map(([id, label, , href]) => (
            <a key={id} className={`tab${active === id ? ' active' : ''}`} href={href} onClick={onLinkClick}
              aria-current={active === id ? 'page' : undefined}>
              {label}
            </a>
          ))}
          <span className={`tab-ink${ink.ready ? ' ready' : ''}`} aria-hidden="true"
            style={{ transform: `translateX(${ink.x}px)`, width: ink.w }} />
        </div>
        <div className="nav-actions">
          <ThemeToggle />
          <a className="btn nav-edit" href={inputs ? `/?${toQuery(inputs)}` : '/'} onClick={onLinkClick}>Edit lifts</a>
        </div>
      </nav>
      <nav className="bottomnav" aria-label="Screens" style={{ '--at': Math.max(0, tabs.findIndex(([id]) => id === active)) } as React.CSSProperties}>
        <span className={`bottom-ink${mounted ? ' ready' : ''}`} aria-hidden="true" />
        {tabs.map(([id, , short, href]) => (
          <a key={id} className={active === id ? 'on' : undefined} href={href} onClick={onLinkClick}
            aria-current={active === id ? 'page' : undefined}>
            <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[id]}</svg>
            <span>{short}</span>
          </a>
        ))}
      </nav>
    </>
  )
}

export function HeaderStrip({ inputs }: { inputs: Inputs }) {
  const cls = className(inputs.sex, ipfClassIndex(inputs.sex, inputs.bw))
  const meta = `${cls} kg class · ${EQUIP_LABEL[inputs.eq].toLowerCase()} · ${inputs.sex === 'm' ? 'men' : 'women'}`
  return (
    <>
      <div className="strip">
        <span className="item">Squat <b>{kg(inputs.s)}</b></span>
        <span className="item">Bench <b>{kg(inputs.b)}</b></span>
        <span className="item">Deadlift <b>{kg(inputs.d)}</b></span>
        <span className="item">Total <b>{kg(total(inputs))} kg</b></span>
        <span className="item">Bodyweight <b>{kg(inputs.bw)} kg</b></span>
        <span className="meta-line">{meta}</span>
      </div>
      {/* Phone: the same facts on one line, and the way back to change them. */}
      <div className="strip-compact">
        <span className="nums">
          {inputs.s}<i>/</i>{inputs.b}<i>/</i>{inputs.d}
        </span>
        <span className="meta">{kg(total(inputs))} kg · {cls} kg · {EQUIP_LABEL[inputs.eq].toLowerCase()}</span>
        <a className="edit" href={`/?${toQuery(inputs)}`} onClick={onLinkClick}>Edit</a>
      </div>
    </>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <span>Data: OpenPowerlifting, public domain · IPF weight classes</span>
      <span>C++20 columnar engine · gRPC · Go gateway</span>
    </footer>
  )
}

// A 4xx carries the engine's own message, shown verbatim; a dead engine is
// a different state, said differently.
export function ErrorState({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.engineDown) {
      return (
        <div className="state error">
          The engine isn’t answering.
          <span className="code">Start engine_server and the gateway, then reload.</span>
        </div>
      )
    }
    return (
      <div className="state error">
        {error.message}
        <span className="code">{error.status} · {error.code}</span>
      </div>
    )
  }
  return <div className="state error">{String(error)}</div>
}

export function Loading() {
  return <div className="state skeleton" role="status">Querying 4,032,180 results…</div>
}

export function MissingInputs() {
  return (
    <div className="state">
      Enter your lifts first.
      <span className="code"><a href="/" onClick={onLinkClick} className="accent">Enter your lifts</a></span>
    </div>
  )
}
