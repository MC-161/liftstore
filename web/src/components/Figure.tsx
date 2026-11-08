// The body map: front and back, each muscle group lit by the lift that trains
// it, by RELATIVE percentile -- each lift against the lifter's other two, not
// the population -- so a strong lifter doesn't glow uniformly and the weak
// lift stays visible.
//   squat    -> quads, adductors
//   bench    -> chest, front delts, triceps
//   deadlift -> hamstrings, glutes, lower back, lats, traps
// Everything else is neutral: no lift here is scored on it.

import type { Lift } from '../lib/format'
import { LIFT_COLOR, relative, strength, type Lit } from '../lib/lifts'

type Part = { d: string; lift: Lift | null }

const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${200 - Number(x)} ${y}`)
const both = (lift: Lift | null, d: string): Part[] => [{ d, lift }, { d: mirror(d), lift }]
const one = (lift: Lift | null, d: string): Part[] => [{ d, lift }]

const HEAD = 'M100 12 Q118 12 118 34 Q118 56 100 56 Q82 56 82 34 Q82 12 100 12 Z'
const NECK = 'M92 54 L108 54 L110 66 L90 66 Z'
const FOOT = 'M78 386 L92 386 L95 400 L72 400 Q72 392 78 386 Z'
const FOREARM = 'M54 141 Q47 166 50 192 L59 192 Q67 166 66 141 Z'
const UPPER_ARM = 'M56 100 Q51 120 55 138 L66 137 Q70 118 68 104 Z'
const KNEE = 'M80 291 Q87 286 94 291 Q94 300 87 302 Q80 300 80 291 Z'

const FRONT: Part[] = [
  ...one(null, HEAD), ...one(null, NECK),
  ...one('deadlift', 'M90 64 Q100 70 110 64 L122 71 Q100 76 78 71 Z'),
  ...both('bench', 'M78 72 Q62 74 56 92 Q58 104 69 102 Q72 88 84 80 Z'),
  ...both('bench', 'M99 78 L85 80 Q73 90 74 104 Q86 113 99 109 Z'),
  ...both(null, UPPER_ARM),
  ...both(null, FOREARM),
  ...one(null, 'M88 113 Q100 117 112 113 L114 168 Q100 179 86 168 Z'),
  ...both(null, 'M75 108 Q85 113 87 117 L85 166 Q78 160 76 140 Q73 122 75 108 Z'),
  ...both('squat', 'M86 178 Q74 183 72 212 Q70 252 80 288 L94 288 Q101 242 98 186 Z'),
  ...both('squat', 'M99 181 L99 238 Q97 250 95 248 Q93 214 98 186 Z'),
  ...both(null, KNEE),
  ...both(null, 'M79 305 Q74 342 80 382 L91 382 Q97 342 93 305 Z'),
  ...both(null, FOOT),
]

const BACK: Part[] = [
  ...one(null, HEAD), ...one(null, NECK),
  ...one('deadlift', 'M100 56 L124 71 Q113 92 100 112 Q87 92 76 71 Z'),
  ...both('bench', 'M76 72 Q62 74 56 92 Q58 104 69 102 Q72 88 80 79 Z'),
  ...both('bench', UPPER_ARM),
  ...both(null, FOREARM),
  ...both('deadlift', 'M77 82 Q70 116 80 150 L95 142 Q92 112 88 96 Q84 88 77 82 Z'),
  ...one('deadlift', 'M94 114 L106 114 L109 170 L91 170 Z'),
  ...both('deadlift', 'M99 173 Q80 172 75 191 Q78 210 98 209 Z'),
  ...both('deadlift', 'M76 212 Q72 252 80 288 L94 288 Q99 252 98 213 Z'),
  ...both(null, KNEE),
  ...both(null, 'M78 304 Q70 334 80 366 L92 366 Q99 334 93 304 Z'),
  ...both(null, 'M81 369 L91 369 L91 384 L81 384 Z'),
  ...both(null, FOOT),
]

const NAME: Record<Lift, string> = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' }

// Colours: CSS variables on the page (they follow the theme); explicit hex
// when the SVG is rasterised outside the page (the share card's PNG).
export type Palette = { lift: Record<Lift, string>; off: string; edge: string; mix: (hue: string, k: number, off: string) => string }

export const CSS_PALETTE: Palette = {
  lift: LIFT_COLOR,
  off: 'var(--muscle-off)',
  edge: 'var(--surface)',
  mix: (hue, k, off) => `color-mix(in oklab, ${hue} ${Math.round(k * 100)}%, ${off})`,
}

function View({ parts, percentiles, focus, onHover, palette }: {
  parts: Part[]; percentiles: Lit; focus: Lift | null; onHover?: (l: Lift | null) => void; palette: Palette
}) {
  const rel = relative(percentiles)
  return (
    <>
      {parts.map((p, k) => (
        <path key={k} d={p.d} data-lift={p.lift ?? ''} className={p.lift && p.lift === focus ? 'on' : undefined}
          fill={p.lift ? palette.mix(palette.lift[p.lift], strength(rel[p.lift]), palette.off) : palette.off}
          stroke={palette.edge} strokeWidth={1.6} strokeLinejoin="round"
          onMouseEnter={onHover && p.lift ? () => onHover(p.lift) : undefined}
          onMouseLeave={onHover && p.lift ? () => onHover(null) : undefined}
          style={onHover && p.lift ? { cursor: 'pointer' } : undefined}>
          {p.lift && <title>{`${NAME[p.lift]} · ${Math.floor(percentiles[p.lift])}th percentile`}</title>}
        </path>
      ))}
    </>
  )
}

type Props = {
  percentiles: Lit
  height?: number
  views?: 'both' | 'front'
  focus?: Lift | null
  onHover?: (l: Lift | null) => void
}

// On-page body map, captioned.
export function BodyMap({ percentiles, height = 380, views = 'both', focus = null, onHover }: Props) {
  const w = (height * 200) / 420
  const label = `Muscles lit by relative strength: squat ${Math.floor(percentiles.squat)}th, bench ${Math.floor(percentiles.bench)}th, deadlift ${Math.floor(percentiles.deadlift)}th percentile`
  const sides: ['Front' | 'Back', Part[]][] = views === 'both' ? [['Front', FRONT], ['Back', BACK]] : [['Front', FRONT]]
  return (
    <div className={`bodymap${focus ? ' focus' : ''}`} role="img" aria-label={label}>
      {sides.map(([name, parts]) => (
        <figure key={name}>
          <svg viewBox="0 0 200 420" width={w} height={height} aria-hidden="true">
            <View parts={parts} percentiles={percentiles} focus={focus} onHover={onHover} palette={CSS_PALETTE} />
          </svg>
          {views === 'both' && <figcaption>{name}</figcaption>}
        </figure>
      ))}
    </div>
  )
}

// Bare SVG group for embedding in another SVG (the share card), with fixed
// colours. Front and back side by side, 400 wide x 420 tall in its own units.
export function BodyMapGroup({ percentiles, palette }: { percentiles: Lit; palette: Palette }) {
  return (
    <g>
      <g><View parts={FRONT} percentiles={percentiles} focus={null} palette={palette} /></g>
      <g transform="translate(200 0)"><View parts={BACK} percentiles={percentiles} focus={null} palette={palette} /></g>
    </g>
  )
}

// JS colour mix for the exported PNG (no color-mix() outside the page).
export function hexMix(hue: string, k: number, off: string): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const a = rgb(off), b = rgb(hue)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
