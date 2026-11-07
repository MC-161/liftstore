import type { ReactNode } from 'react'
import { ApiError } from '../api/client'
import { kg } from '../lib/format'
import { EQUIP_LABEL, className, ipfClassIndex, toQuery, total, type Inputs } from '../lib/inputs'
import { onLinkClick } from '../router'

type Screen = 'verdict' | 'weight-class' | 'attempts' | 'head-to-head' | 'leaderboards' | 'entry'

// Desktop: one row of tabs. Phone: the same destinations as a bottom bar,
// where a thumb reaches them; the logo stands in for Entry, and the header
// strip carries an Edit link.
const ICON: Record<Exclude<Screen, 'entry'>, ReactNode> = {
  // 20x20, stroke icons drawn for this app: a gauge, a ladder of classes, a
  // rising bar, two facing columns, a podium.
  verdict: <path d="M3 14a7 7 0 0 1 14 0M10 14l3.5-4.5" />,
  'weight-class': <path d="M4 16V9M8 16V6M12 16V8M16 16V4" />,
  attempts: <path d="M3 16h14M5 16v-3M10 16V8M15 16V4M13 6l2-2 2 2" />,
  'head-to-head': <path d="M4 16V6M8 16v-6M12 16v-8M16 16V9M10 3v14" />,
  leaderboards: <path d="M3 16h14M7.5 16V9h5v7M3 16v-4h4.5M12.5 16v-6H17v6" />,
}

export function TopNav({ active, inputs }: { active: Screen; inputs: Inputs | null }) {
  const q = inputs ? `?${toQuery(inputs)}` : ''
  const tabs: [Exclude<Screen, 'entry'>, string, string, string][] = [
    ['verdict', 'VERDICT', 'Verdict', `/v${q}`],
    ['weight-class', 'WEIGHT CLASS', 'Classes', `/wc${q}`],
    ['attempts', 'ATTEMPTS', 'Attempts', `/at${q}`],
    ['head-to-head', 'HEAD TO HEAD', 'Versus', `/h2h${q}`],
    ['leaderboards', 'LEADERBOARDS', 'Ranks', `/lb${q}`],
  ]
  return (
    <>
      <nav className="topnav">
        <a className="brand" href="/" onClick={onLinkClick}>POWERLIFTING ENGINE</a>
        <div className="tabs">
          {tabs.map(([id, label, , href]) => (
            <a key={id} className={`tab${active === id ? ' active' : ''}`} href={href} onClick={onLinkClick}>
              {label}
            </a>
          ))}
          <a className={`tab${active === 'entry' ? ' active' : ''}`} href="/" onClick={onLinkClick}>ENTRY</a>
        </div>
        <span className="right" />
      </nav>
      <nav className="bottomnav" aria-label="Screens">
        {tabs.map(([id, , short, href]) => (
          <a key={id} className={active === id ? 'on' : undefined} href={href} onClick={onLinkClick}
            aria-current={active === id ? 'page' : undefined}>
            <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICON[id]}</svg>
            <span>{short}</span>
          </a>
        ))}
      </nav>
    </>
  )
}

export function HeaderStrip({ inputs }: { inputs: Inputs }) {
  const items: [string, number][] = [
    ['SQUAT', inputs.s], ['BENCH', inputs.b], ['DEADLIFT', inputs.d], ['TOTAL', total(inputs)], ['BODYWEIGHT', inputs.bw],
  ]
  const cls = className(inputs.sex, ipfClassIndex(inputs.sex, inputs.bw))
  return (
    <>
      <div className="strip">
        {items.map(([l, v]) => (
          <span className="item" key={l}>
            <span className="label">{l}</span>
            <span className="v">{kg(v)}</span>
            <span className="unit">KG</span>
          </span>
        ))}
        <span className="chips">
          <span className="chip">{cls}KG</span>
          <span className="chip">{EQUIP_LABEL[inputs.eq]}</span>
          <span className="chip">{inputs.sex === 'm' ? 'Male' : 'Female'}</span>
          <span className="chip">Full power</span>
        </span>
      </div>
      {/* Phone: the same facts on one line, and the way back to change them. */}
      <div className="strip-compact">
        <span className="nums">
          {inputs.s}<i>/</i>{inputs.b}<i>/</i>{inputs.d}
          <b>{kg(total(inputs))}</b><span className="unit">KG</span>
        </span>
        <span className="meta">{cls} kg · {EQUIP_LABEL[inputs.eq].toLowerCase()} · {inputs.sex === 'm' ? 'M' : 'F'}</span>
        <a className="edit" href="/" onClick={onLinkClick}>Edit</a>
      </div>
    </>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <span className="label faint">OPENPOWERLIFTING · IPF WEIGHT CLASSES</span>
      <span className="label faint">DATA: OPENPOWERLIFTING.ORG, PUBLIC DOMAIN</span>
    </footer>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow label">{children}</div>
}

// A 4xx carries the engine's own message, shown verbatim; a dead engine is
// a different state, said differently.
export function ErrorState({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.engineDown) {
      return (
        <div className="state error">
          The engine isn’t answering.
          <span className="code label">Start engine_server and the gateway, then reload.</span>
        </div>
      )
    }
    return (
      <div className="state error">
        {error.message}
        <span className="code label">{error.status} · {error.code}</span>
      </div>
    )
  }
  return <div className="state error">{String(error)}</div>
}

export function Loading() {
  return <div className="state skeleton label">Querying 4,032,180 results…</div>
}

export function MissingInputs() {
  return (
    <div className="state">
      Enter your lifts first.
      <span className="code label"><a href="/" onClick={onLinkClick}>Go to entry →</a></span>
    </div>
  )
}
