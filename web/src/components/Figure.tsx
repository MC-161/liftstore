// The figure: a low-poly humanoid whose regions are lit by RELATIVE percentile
// -- each lift against the lifter's other two, not against the population --
// so a strong lifter doesn't glow uniformly and the weak lift stays visible.
// chest/shoulders/arms <- bench, back/core/hips <- deadlift, thighs/shins <- squat.
// Each lift draws in its own hue; how far it is lit says how strong it is.

import type { Lift } from '../lib/format'
import { LIFT_HEX, relative, shade, type Lit } from '../lib/lifts'

// [region, lift or null for neutral, points]. Left side; mirrored below.
type Poly = [string, Lift | null, string]
const LEFT: Poly[] = [
  ['shoulder', 'bench', '92,82 70,88 58,106 66,119 84,101'],
  ['chest', 'bench', '93,85 85,101 77,122 98,128 100,92'],
  ['upperarm', 'bench', '58,106 66,119 61,160 50,156'],
  ['forearm', 'bench', '50,156 61,160 57,208 47,205'],
  ['hand', null, '47,205 57,208 55,222 46,219'],
  ['lat', 'deadlift', '77,122 66,119 70,160 87,177'],
  ['hip', 'deadlift', '87,178 100,178 100,201 81,207 74,190'],
  ['thigh', 'squat', '74,192 81,208 100,202 96,280 80,283 72,240'],
  ['knee', 'squat', '80,284 96,281 95,297 82,297'],
  ['shin', 'squat', '82,298 95,298 92,368 84,368'],
  ['foot', null, '84,369 92,369 95,382 75,382'],
]
const mirror = (pts: string) =>
  pts.split(' ').map((p) => { const [x, y] = p.split(','); return `${200 - Number(x)},${y}` }).join(' ')

const CENTRE: Poly[] = [
  ['head', null, '100,18 117,37 113,62 100,71 87,62 83,37'],
  ['neck', null, '93,71 107,71 109,83 91,83'],
  ['core', 'deadlift', '98,129 77,123 87,177 113,177 123,123 102,129'],
]
const POLYS: Poly[] = [...CENTRE, ...LEFT, ...LEFT.map(([n, l, pts]) => [`${n}-r`, l, mirror(pts)] as Poly)]
const NEUTRAL = '#2a2d33'

// CSS variables by default; explicit colours when the SVG is rasterised
// outside the page (the share card's PNG), where var(--x) resolves to nothing.
type Colors = { bg: string; line: string; dim: string }
const CSS_COLORS: Colors = { bg: 'var(--bg)', line: 'var(--line)', dim: 'var(--text-dim)' }

type Props = {
  percentiles: Lit
  size?: number
  arcs?: boolean
  asGroup?: boolean
  colors?: Colors
  focus?: Lift | null
  onHover?: (l: Lift | null) => void
}

export function Figure({ percentiles, size = 400, arcs = true, asGroup = false, colors = CSS_COLORS, focus = null, onHover }: Props) {
  const rel = relative(percentiles)
  const strongest = (Object.keys(rel) as Lift[]).reduce((a, b) => (rel[b] > rel[a] ? b : a))
  const label: Record<Lift, string> = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' }

  const body = (
    <>
      {arcs && <Arcs percentiles={percentiles} colors={colors} />}
      {POLYS.map(([name, lift, pts]) => (
        <polygon key={name} data-region={name} data-lift={lift ?? ''} points={pts}
          className={[lift && lift === focus ? 'on' : '', lift && lift === strongest ? 'strong' : ''].join(' ')}
          fill={lift ? shade(lift, rel[lift]) : NEUTRAL} stroke={colors.bg} strokeWidth={1.6} strokeLinejoin="round"
          onMouseEnter={onHover && lift ? () => onHover(lift) : undefined}
          onMouseLeave={onHover && lift ? () => onHover(null) : undefined}
          style={onHover && lift ? { cursor: 'pointer' } : undefined}>
          {lift && <title>{`${label[lift]} · ${Math.floor(percentiles[lift])}th percentile`}</title>}
        </polygon>
      ))}
    </>
  )
  if (asGroup) return <g transform="translate(125 25)">{body}</g>
  return (
    <svg className={`figure${focus ? ' focus' : ''}`} viewBox="-125 -25 450 450" width={size} height={size} role="img"
      aria-label={`Figure lit by relative percentile: squat ${Math.floor(percentiles.squat)}, bench ${Math.floor(percentiles.bench)}, deadlift ${Math.floor(percentiles.deadlift)}`}>
      {body}
    </svg>
  )
}

// Three thin arcs, open at the bottom, each swept in proportion to that
// lift's population percentile, in that lift's colour. They draw in on arrival.
function Arcs({ percentiles, colors }: { percentiles: Lit; colors: Colors }) {
  const cx = 100, cy = 200
  const span = 270 // degrees; the 90 left open at the bottom
  const start = 135
  const rows: [Lift, number, string][] = [
    ['bench', 158, 'BP'], ['squat', 176, 'SQ'], ['deadlift', 194, 'DL'],
  ]
  const pt = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  return (
    <g fill="none">
      {rows.map(([lift, r, tag], k) => {
        const sweep = Math.max(0.5, (span * Math.max(0, Math.min(100, percentiles[lift]))) / 100)
        const [x0, y0] = pt(r, start)
        const [x1, y1] = pt(r, start + sweep)
        const [tx1, ty1] = pt(r, start + span)
        // Labels sit where the arcs START: the radii keep them apart, whereas
        // at the sweep end two close percentiles would print on top of each other.
        const [lx, ly] = pt(r, start - 9)
        const len = (Math.PI * r * sweep) / 180
        return (
          <g key={lift}>
            <path d={`M${x0},${y0} A${r},${r} 0 1 1 ${tx1},${ty1}`} stroke={colors.line} strokeWidth={1} />
            <path className="draw" style={{ '--len': len, '--i': k } as React.CSSProperties}
              d={`M${x0},${y0} A${r},${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1},${y1}`}
              stroke={LIFT_HEX[lift]} strokeWidth={2} strokeLinecap="round" />
            <circle cx={x1} cy={y1} r={3} fill={LIFT_HEX[lift]} className="fade-in" style={{ '--i': k + 6 } as React.CSSProperties} />
            <text x={lx} y={ly} fontSize={11} fill={LIFT_HEX[lift]} textAnchor="middle" dominantBaseline="middle"
              letterSpacing="0.08em">{tag} {Math.floor(percentiles[lift])}%</text>
          </g>
        )
      })}
    </g>
  )
}

