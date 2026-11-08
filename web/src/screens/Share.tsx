import { useRef } from 'react'
import { conditionalPercentile, percentile } from '../api/endpoints'
import { BodyMapGroup, hexMix } from '../components/Figure'
import { QrCode } from '../components/QrCode'
import { ErrorState, Loading, MARK_PLATES } from '../components/Shell'
import { int, kg, LIFT_WIRE, LIFTS, pctNumber, pctSuffix, pctText, type Lift } from '../lib/format'
import { EQUIP_LABEL, classGroup, group, toQuery, total, type Inputs } from '../lib/inputs'
import { LIFT_HEX, type Lit } from '../lib/lifts'
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
    a.download = 'weak-link-verdict.png'
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
            <button className="btn" onClick={() => navigate(`/v?${key}`)}>Back to verdict</button>
            <button className="btn primary" onClick={savePng}>Save PNG</button>
          </div>
        </div>
      )}
    </main>
  )
}

// Hard-coded colours, not CSS variables: the PNG export rasterises this SVG
// outside the page, where var(--x) resolves to nothing.
const C = { bg: '#0A0A0B', track: '#1C1C21', line: '#26262C', text: '#F5F5F7', dim: '#9A9AA2', faint: '#8A8F99', accent: '#FFB020' }
const F = 'Inter, system-ui, -apple-system, sans-serif'
const NAME: Record<Lift, string> = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' }

function Card({ inputs, data, href, label }: {
  inputs: Inputs; data: Awaited<ReturnType<typeof load>>; href: string | null; label: string | null
}) {
  const { lit, pt, weakest, cond } = data
  // Fixed palette: the PNG export draws this SVG outside the page.
  const palette = { lift: LIFT_HEX, off: '#262A31', edge: C.bg, mix: hexMix }
  const share = cond.n > 0 ? cond.below / cond.n : 0.5

  // First person: it's the lifter's card, posted by the lifter.
  const [lead, rest] = share < 0.25
    ? [NAME[weakest], 'is holding me back.']
    : share < 0.45 ? [NAME[weakest], 'is a little behind.'] : ['Balanced', 'across all three.']

  const who = `${pt.weightClass} kg · ${EQUIP_LABEL[inputs.eq].toLowerCase()} · ${inputs.sex === 'm' ? 'men' : 'women'}`
  const hero = pctNumber(pt.percentile)

  return (
    <svg viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg" fontFamily={F}>

      <rect width="1080" height="1080" fill={C.bg} />

      {/* wordmark */}
      <g transform="translate(72 74) scale(1.3)">
        <rect x="0" y="11" width="40" height="2" rx="1" fill={C.faint} />
        {MARK_PLATES.map((p) => <rect key={p.x} x={p.x} y={p.y} width="3" height={p.h} rx="1" fill={LIFT_HEX[p.lift]} />)}
      </g>
      <text x="138" y="99" fill={C.text} fontSize="26" fontWeight="600" letterSpacing="-0.3">Weak Link</text>

      {/* QR, top right */}
      {href && (
        <>
          <QrCode text={href} x={872} y={52} size={156} />
          <text x="950" y="238" fill={C.dim} fontSize="19" textAnchor="middle">Scan to see yours</text>
        </>
      )}

      {/* the body map, lit by the lifter's own numbers */}
      <g transform="translate(624 216) scale(0.94)">
        <BodyMapGroup percentiles={lit} palette={palette} />
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
