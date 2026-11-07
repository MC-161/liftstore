import { useRef } from 'react'
import { conditionalPercentile, percentile } from '../api/endpoints'
import { Figure } from '../components/Figure'
import { QrCode } from '../components/QrCode'
import { ErrorState, Loading } from '../components/Shell'
import { int, kg, LIFT_WIRE, LIFTS, pctNumber, pctSuffix, pctText, type Lift } from '../lib/format'
import { EQUIP_LABEL, classGroup, group, toQuery, total, type Inputs } from '../lib/inputs'
import { LIFT_HEX, relative, type Lit } from '../lib/lifts'
import { shareTarget } from '../lib/publicUrl'
import { useSubmit } from '../lib/useSubmit'
import { navigate } from '../router'

// The share card is one SVG, so it scales to any width and the same markup
// is what "Save PNG" rasterises. Its requests are the Verdict's own and come
// out of the query cache when arriving from there.
const value = (i: Inputs, l: Lift) => (l === 'squat' ? i.s : l === 'bench' ? i.b : i.d)

async function load(i: Inputs) {
  const g = group(i)
  const [ps, pb, pd, pt] = await Promise.all([
    percentile(g, i.bw, 'LIFT_KIND_SQUAT', i.s),
    percentile(g, i.bw, 'LIFT_KIND_BENCH', i.b),
    percentile(g, i.bw, 'LIFT_KIND_DEADLIFT', i.d),
    percentile(g, i.bw, 'LIFT_KIND_TOTAL', total(i)),
  ])
  // Same call, same arguments as Verdict's sentence -> same cache entry.
  const lit: Lit = { squat: ps.percentile, bench: pb.percentile, deadlift: pd.percentile }
  const order = [...LIFTS].sort((a, b) => lit[a] - lit[b])
  const weakest = order[0]
  const strongest = order[2] === weakest ? order[1] : order[2]
  const cond = await conditionalPercentile(g, LIFT_WIRE[strongest], value(i, strongest), LIFT_WIRE[weakest],
    value(i, weakest), classGroup(i).ipf_class)
  return { lit, pt, weakest, strongest, cond }
}

export function Share({ inputs }: { inputs: Inputs }) {
  const key = toQuery(inputs)
  const res = useSubmit(key, () => load(inputs))
  const ref = useRef<HTMLDivElement>(null)
  const target = shareTarget()

  async function savePng() {
    const svg = ref.current?.querySelector('svg')
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = 1080
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, 1080, 1080)
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = 'powerlifting-verdict.png'
    a.click()
  }

  return (
    <main className="main">
      {res.state === 'loading' && <Loading />}
      {res.state === 'error' && <ErrorState error={res.error} />}
      {res.state === 'ok' && (
        <div className="sharepage">
          <div className="sharecard" ref={ref}><Card inputs={inputs} data={res.data} href={target ? `${target.base}/v?${key}` : null} label={target?.label ?? null} /></div>
          {target && !target.label && (
            <p className="note" style={{ maxWidth: 560, textAlign: 'center' }}>
              The QR code opens this verdict on any phone on your Wi-Fi ({target.base}). Set <code>VITE_PUBLIC_URL</code> in{' '}
              <code>web/.env</code> to point it, and the printed link, at the deployed site.
            </p>
          )}
          <div className="actions">
            <button className="sharebtn" onClick={() => navigate(`/v?${key}`)}>← BACK TO VERDICT</button>
            <button className="sharebtn" onClick={savePng}>SAVE PNG</button>
          </div>
        </div>
      )}
    </main>
  )
}

// Hard-coded colours, not CSS variables: the PNG export rasterises this SVG
// outside the page, where var(--x) resolves to nothing.
const C = { bg: '#0A0A0B', track: '#1C1C21', line: '#26262C', text: '#F5F5F7', dim: '#9A9AA2', faint: '#5A5A63', accent: '#FFB020' }
const F = 'Inter, system-ui, -apple-system, sans-serif'
const NAME: Record<Lift, string> = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' }

function Card({ inputs, data, href, label }: {
  inputs: Inputs; data: Awaited<ReturnType<typeof load>>; href: string | null; label: string | null
}) {
  const { lit, pt, weakest, cond } = data
  const rel = relative(lit)
  const top = LIFTS.reduce((a, b) => (rel[b] > rel[a] ? b : a))
  const glow = LIFT_HEX[top]
  const share = cond.n > 0 ? cond.below / cond.n : 0.5

  // First person: it's the lifter's card, posted by the lifter.
  const [lead, rest] = share < 0.25
    ? [NAME[weakest], 'is holding me back.']
    : share < 0.45 ? [NAME[weakest], 'is a little behind.'] : ['Balanced', 'across all three.']

  const who = `${pt.weightClass} kg · ${EQUIP_LABEL[inputs.eq].toLowerCase()} · ${inputs.sex === 'm' ? 'men' : 'women'}`
  const hero = pctNumber(pt.percentile)

  return (
    <svg viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg" fontFamily={F}>
      <defs>
        <radialGradient id="glow" cx="0.72" cy="0.36" r="0.55">
          <stop offset="0%" stopColor={glow} stopOpacity="0.30" />
          <stop offset="60%" stopColor={glow} stopOpacity="0.06" />
          <stop offset="100%" stopColor={glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="glow2" cx="0.1" cy="1" r="0.6">
          <stop offset="0%" stopColor={LIFT_HEX[weakest]} stopOpacity="0.14" />
          <stop offset="100%" stopColor={LIFT_HEX[weakest]} stopOpacity="0" />
        </radialGradient>
        {/* Film grain: keeps big flat gradients from banding in the PNG. */}
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0" />
        </filter>
      </defs>

      <rect width="1080" height="1080" fill={C.bg} />
      <rect width="1080" height="1080" fill="url(#glow)" />
      <rect width="1080" height="1080" fill="url(#glow2)" />
      <rect width="1080" height="1080" filter="url(#grain)" />

      {/* wordmark */}
      <circle cx="80" cy="90" r="7" fill={C.accent} />
      <text x="98" y="99" fill={C.text} fontSize="26" fontWeight="600" letterSpacing="-0.3">Powerlifting Engine</text>

      {/* QR, top right */}
      {href && (
        <>
          <QrCode text={href} x={872} y={52} size={156} />
          <text x="950" y="238" fill={C.dim} fontSize="19" textAnchor="middle">Scan to see yours</text>
        </>
      )}

      {/* figure, lit by the lifter's own numbers */}
      <g transform="translate(560 220) scale(0.98)">
        <Figure percentiles={lit} asGroup arcs={false} colors={{ bg: C.bg, line: C.line, dim: C.dim }} />
      </g>

      {/* the number */}
      <text x="72" y="420" fill={C.text} fontSize="250" fontWeight="200" letterSpacing="-12">
        {hero}<tspan fontSize="84" fontWeight="300" fill={C.dim} dx="10" letterSpacing="0">{pctSuffix(pt.percentile)}</tspan>
      </text>
      <text x="78" y="472" fill={C.dim} fontSize="28">percentile overall · {who}</text>

      {/* the verdict, one line, first person */}
      <text x="76" y="572" fill={C.text} fontSize="56" fontWeight="500" letterSpacing="-1.2">
        <tspan fill={share < 0.45 ? C.accent : C.text}>{lead}</tspan>
      </text>
      <text x="76" y="636" fill={C.text} fontSize="56" fontWeight="300" letterSpacing="-1.2">{rest}</text>

      {/* the three lifts */}
      {LIFTS.map((l, k) => {
        const y = 730 + k * 92
        const w = (Math.max(0, Math.min(100, lit[l])) / 100) * 936
        const weak = l === weakest && share < 0.45
        return (
          <g key={l}>
            <text x="72" y={y} fill={LIFT_HEX[l]} fontSize="30" fontWeight="600">{NAME[l]}</text>
            <text x="1008" y={y} fill={weak ? C.accent : C.text} fontSize="30" fontWeight="500" textAnchor="end">
              {pctText(lit[l])}<tspan fill={C.dim} fontWeight="400">  ·  {kg(value(inputs, l))} kg</tspan>
            </text>
            <rect x="72" y={y + 18} width="936" height="10" rx="5" fill={C.track} />
            <rect x="72" y={y + 18} width={Math.max(10, w)} height="10" rx="5" fill={LIFT_HEX[l]} />
          </g>
        )
      })}

      {/* footer */}
      <line x1="72" x2="1008" y1="972" y2="972" stroke={C.line} strokeWidth="2" />
      <text x="72" y="1022" fill={C.dim} fontSize="24">
        Total {kg(total(inputs))} kg{label ? <tspan fill={C.text} fontWeight="500">  ·  {label}</tspan> : null}
      </text>
      <text x="1008" y="1022" fill={C.faint} fontSize="22" textAnchor="end">
        measured against {int(pt.n)} results
      </text>
    </svg>
  )
}
