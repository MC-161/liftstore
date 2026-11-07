import { useMemo, useState } from 'react'
import { Cdf } from '../api/cdf'
import {
  classTrend,
  conditionalPercentile,
  distribution,
  equipmentSwap,
  percentile,
  valueAtPercentile,
} from '../api/endpoints'
import { DistributionChart } from '../components/DistributionChart'
import { Figure } from '../components/Figure'
import { VerdictStatement } from '../components/VerdictStatement'
import { Ruler } from '../components/Ruler'
import { liftVars, LIFT_HEX, relative, type Lit } from '../lib/lifts'
import { CountUp, i as stagger } from '../lib/motion'
import { ErrorState, HeaderStrip, Loading } from '../components/Shell'
import { abbreviate, int, kg, LIFT_LABEL, LIFT_WIRE, LIFTS, pctNumber, pctSuffix, pctText, signed, tier, type Lift } from '../lib/format'
import { EQUIP_LABEL, classGroup, className, equipWire, group, ipfClassIndex, toQuery, total, type Equip, type Inputs } from '../lib/inputs'
import { useSubmit } from '../lib/useSubmit'
import { navigate } from '../router'

const value = (i: Inputs, l: Lift) => (l === 'squat' ? i.s : l === 'bench' ? i.b : i.d)

async function load(i: Inputs) {
  const g = group(i)
  const cg = classGroup(i)
  const t = total(i)
  const swapTo: Equip = i.eq === 'raw' ? 'wraps' : 'raw'

  // Stage 1: everything that depends only on the inputs, in parallel.
  const [ps, pb, pd, pt, ds, db, dd, dt, at90, at99, swap, swapDist, trend] = await Promise.all([
    percentile(g, i.bw, 'LIFT_KIND_SQUAT', i.s),
    percentile(g, i.bw, 'LIFT_KIND_BENCH', i.b),
    percentile(g, i.bw, 'LIFT_KIND_DEADLIFT', i.d),
    percentile(g, i.bw, 'LIFT_KIND_TOTAL', t),
    distribution(cg, 'LIFT_KIND_SQUAT'),
    distribution(cg, 'LIFT_KIND_BENCH'),
    distribution(cg, 'LIFT_KIND_DEADLIFT'),
    distribution(cg, 'LIFT_KIND_TOTAL'),
    valueAtPercentile(g, i.bw, 'LIFT_KIND_TOTAL', 90),
    valueAtPercentile(g, i.bw, 'LIFT_KIND_TOTAL', 99),
    equipmentSwap(g.sex, equipWire(i.eq), equipWire(swapTo), cg.ipf_class, 'LIFT_KIND_TOTAL'),
    distribution({ ...cg, equipment: equipWire(swapTo) }, 'LIFT_KIND_TOTAL'),
    classTrend(cg, 'LIFT_KIND_TOTAL', 2014),
  ])

  // Stage 2: the verdict sentence needs to know which lift is strongest and
  // which weakest, and that comes from stage 1. One extra round trip.
  const lit: Lit = { squat: ps.percentile, bench: pb.percentile, deadlift: pd.percentile }
  const order = [...LIFTS].sort((a, b) => lit[a] - lit[b])
  const weakest = order[0]
  const strongest = order[2] === weakest ? order[1] : order[2]
  const cond = await conditionalPercentile(g, LIFT_WIRE[strongest], value(i, strongest), LIFT_WIRE[weakest], value(i, weakest), cg.ipf_class)

  return { ps, pb, pd, pt, ds, db, dd, dt, at90, at99, swap, swapTo, swapDist, trend, cond, weakest, strongest }
}

const toCdf = (d: { bins: { low: number; high: number; count: number }[] }) => new Cdf(d.bins)

export function Verdict({ inputs }: { inputs: Inputs }) {
  const key = toQuery(inputs)
  const res = useSubmit(key, () => load(inputs))
  return (
    <>
      <HeaderStrip inputs={inputs} />
      <main className="main">
        {res.state === 'loading' && <Loading />}
        {res.state === 'error' && <ErrorState error={res.error} />}
        {res.state === 'ok' && <VerdictBody key={key} inputs={inputs} data={res.data} />}
      </main>
    </>
  )
}

function VerdictBody({ inputs, data }: { inputs: Inputs; data: Awaited<ReturnType<typeof load>> }) {
  const [delta, setDelta] = useState<Record<Lift, number>>({ squat: 0, bench: 0, deadlift: 0 })
  // Hovering a panel spotlights its regions on the figure, and vice versa.
  const [focus, setFocus] = useState<Lift | null>(null)

  const cdf = useMemo(
    () => ({ squat: toCdf(data.ds), bench: toCdf(data.db), deadlift: toCdf(data.dd), total: toCdf(data.dt), swap: toCdf(data.swapDist) }),
    [data],
  )
  const server: Lit = { squat: data.ps.percentile, bench: data.pb.percentile, deadlift: data.pd.percentile }

  // LIVE: no request. At zero delta the server's exact number; once dragged,
  // the local CDF's.
  const moved = delta.squat !== 0 || delta.bench !== 0 || delta.deadlift !== 0
  const live: Lit = {
    squat: delta.squat ? cdf.squat.percentileAt(inputs.s + delta.squat) : server.squat,
    bench: delta.bench ? cdf.bench.percentileAt(inputs.b + delta.bench) : server.bench,
    deadlift: delta.deadlift ? cdf.deadlift.percentileAt(inputs.d + delta.deadlift) : server.deadlift,
  }
  const t = total(inputs)
  const projected = t + delta.squat + delta.bench + delta.deadlift
  const heroPct = moved ? cdf.total.percentileAt(projected) : data.pt.percentile
  const mean = data.dt.summary?.mean ?? 0
  const sd = data.dt.summary?.sd ?? 0
  const z = sd > 0 ? (projected - mean) / sd : 0

  const rel = relative(live)
  const top = LIFTS.reduce((a, b) => (rel[b] > rel[a] ? b : a))

  // The next target: 90th, or 99th once past it.
  const target = data.pt.percentile >= 90 ? { p: 99, r: data.at99 } : { p: 90, r: data.at90 }
  const localTarget = cdf.total.valueAt(target.p)
  const disagree = Math.abs(localTarget - target.r.value) > cdf.total.binWidth

  // Client and server must agree on the class; if not, say so rather than
  // render numbers for a class the user isn't in.
  const clientClass = className(inputs.sex, ipfClassIndex(inputs.sex, inputs.bw))
  const classMismatch = data.pt.weightClass !== clientClass

  // Nearest: server returns 2 below + 3 at-or-above. Keep 2 each side and put
  // the user between them: five rows.
  const nb = data.pt.neighbours
  const below = nb.filter((n) => n.value < t).slice(-2)
  const above = nb.filter((n) => n.value >= t).slice(0, 2)
  const nearest = [
    ...above.slice().reverse().map((n) => ({ name: n.name, value: n.value, you: false })),
    { name: 'You', value: t, you: true },
    ...below.slice().reverse().map((n) => ({ name: n.name, value: n.value, you: false })),
  ]

  const trendRows = data.trend.rows.filter((r) => r.n > 0)
  const first = trendRows[0]
  const last = trendRows[trendRows.length - 1]

  const swapPct = data.swap.lifters > 0 ? cdf.swap.percentileAt(t + data.swap.medianDelta) : null

  return (
    <div className="verdict">
      {/* ---- left: lifts, sliders, projection ---- */}
      <section className="col col-lifts">
        {LIFTS.map((l, k) => (
          <div className={`panel liftpanel rise${focus === l ? ' lit' : ''}`} key={l}
            style={{ ...liftVars(l), ...stagger(k) }}
            onMouseEnter={() => setFocus(l)} onMouseLeave={() => setFocus(null)}>
            <div className="top">
              <span className="label">{LIFT_LABEL[l]}</span>
              <span className="tag">{tier(live[l])}</span>
            </div>
            <div className="mid">
              <span><span className="kgv">{kg(value(inputs, l) + delta[l])}</span><span className="unit">KG</span></span>
              <span className="pv"><CountUp value={live[l]} format={pctNumber} /><sup>{pctSuffix(live[l])}</sup></span>
            </div>
            <Ruler pct={live[l]} color={LIFT_HEX[l]} />
          </div>
        ))}

        <div className="panel adjust rise" style={stagger(3)}>
          <div className="kv" style={{ padding: 0 }}>
            <span className="label">ADJUST</span>
            <button className="tag" style={{ cursor: 'pointer' }} onClick={() => setDelta({ squat: 0, bench: 0, deadlift: 0 })}>RESET</button>
          </div>
          {LIFTS.map((l) => (
            <div className="row" key={l} style={liftVars(l)}
              onMouseEnter={() => setFocus(l)} onMouseLeave={() => setFocus(null)}>
              <div className="head">
                <label className={`label c-${l}`} htmlFor={`d-${l}`}>{LIFT_LABEL[l]}</label>
                <span>{signed(delta[l])} KG</span>
              </div>
              <input id={`d-${l}`} className="slider" type="range" min={-20} max={20} step={2.5} value={delta[l]}
                onChange={(e) => setDelta({ ...delta, [l]: Number(e.target.value) })} />
            </div>
          ))}
        </div>

        <div className="panel rise" style={{ marginTop: 16, ...stagger(4) }}>
          <div className="kv"><span className="label">PROJECTED TOTAL</span><span className="v">{kg(projected)} KG</span></div>
          <div className="kv"><span className="label">PROJECTED PERCENTILE</span><span className="v">{pctText(heroPct)}</span></div>
          <div className="kv">
            <span className="label">FOR {target.p}TH YOU NEED</span>
            <span className="v">{target.r.n > 0 ? `${kg(target.r.value)} KG` : '—'}</span>
          </div>
          {target.r.n > 0 && (
            <div className="note">
              {kg(target.r.value)} kg itself places at the {pctText(target.r.actualPercentile)}: lifters tie at that weight.
              {disagree && ` Local estimate ${kg(localTarget)} kg differs by more than a bin.`}
            </div>
          )}
        </div>
      </section>

      {/* ---- centre: the verdict ---- */}
      <section className="col col-verdict centre">
        <div className="bias kv" style={{ paddingTop: 0 }}>
          <span className="label">RATIO BIAS — <span style={{ color: LIFT_HEX[top] }}>{LIFT_LABEL[top]} DOMINANT</span></span>
          <span className="label faint">SQ / DL {(inputs.s / inputs.d).toFixed(3)}</span>
        </div>

        <div className="figure-wrap fade-in" style={{ '--top-glow': `${LIFT_HEX[top]}33` } as React.CSSProperties}>
          <Figure percentiles={live} size={380} focus={focus} onHover={setFocus} />
        </div>

        {/* The product. Largest text on the screen. */}
        <VerdictStatement inputs={inputs} strongest={data.strongest} weakest={data.weakest} cond={data.cond}
          classLabel={data.pt.weightClass} totalCdf={cdf.total} totalPct={data.pt.percentile} />

        <div className="herorow">
          <div>
            <div className="hero"><CountUp value={heroPct} format={pctNumber} /><sup>{pctSuffix(heroPct)}</sup></div>
            <div className="label" style={{ marginTop: 8 }}>OVERALL PERCENTILE · {data.pt.weightClass} KG</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="kv" style={{ gap: 12 }}><span className="label">TOTAL</span><span className="v">{kg(projected)} KG</span></div>
            <div className="kv" style={{ gap: 12 }}><span className="label">Z-SCORE</span><span className="v">{signed(z, 2)}</span></div>
          </div>
        </div>
        {classMismatch && (
          <div className="note" style={{ color: 'var(--danger)' }}>
            Server placed you in {data.pt.weightClass} kg; the client computed {clientClass} kg.
          </div>
        )}
        <button className="sharebtn" onClick={() => navigate(`/share?${toQuery(inputs)}`)}>SHARE CARD</button>
      </section>

      {/* ---- right: context ---- */}
      <section className="col col-context">
        <div className="kv" style={{ paddingTop: 0 }}>
          <span className="label">DISTRIBUTION · TOTAL</span>
          <span className="v">{kg(projected)} KG</span>
        </div>
        <DistributionChart cdf={cdf.total} marker={projected} mean={mean} sd={sd} />
        <div className="note">
          N = {int(data.dt.summary?.n ?? 0)} · MEAN {kg(mean)} KG · SD {kg(sd)} KG · σ percentages read from the data
        </div>

        <div className="label" style={{ margin: '32px 0 8px' }}>NEAREST LIFTERS</div>
        <div className="nearest">
          {nearest.map((r, k) => (
            <div key={k} className={`row rise${r.you ? ' you' : ''}`} style={stagger(k + 2)}>
              <span title={r.you ? undefined : r.name}>{r.you ? 'You' : abbreviate(r.name)}</span>
              <span>{kg(r.value)} KG</span>
            </div>
          ))}
        </div>

        <div className="panel callout rise" style={stagger(6)}>
          {swapPct !== null ? (
            <>
              <div className="kv">
                <span className="label">IN {EQUIP_LABEL[data.swapTo].toUpperCase()} YOU’D BE</span>
                <span className="v">{pctText(swapPct)}</span>
              </div>
              <div className="note">
                Median change {signed(data.swap.medianDelta)} kg across {int(data.swap.lifters)} lifters who competed in both.
              </div>
            </>
          ) : (
            <div className="note">No lifters in this class competed in both {EQUIP_LABEL[inputs.eq]} and {EQUIP_LABEL[data.swapTo]}.</div>
          )}
          {first && last && first.year !== last.year && (
            <div className="label" style={{ marginTop: 14, lineHeight: 1.6 }}>
              THIS CLASS’S MEAN TOTAL HAS {last.mean >= first.mean ? 'RISEN' : 'FALLEN'}{' '}
              {kg(Math.abs(last.mean - first.mean))} KG SINCE {first.year}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
