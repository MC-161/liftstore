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
import { BodyMap } from '../components/Figure'
import { VerdictStatement } from '../components/VerdictStatement'
import { Ruler } from '../components/Ruler'
import { LIFT_COLOR, liftVars, type Lit } from '../lib/lifts'
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
      {/* ---- left: the three lifts, what-if sliders, projection ---- */}
      <section className="col-lifts" aria-label="Your lifts">
        {LIFTS.map((l, k) => (
          <div className={`panel liftpanel rise${focus === l ? ' lit' : ''}`} key={l}
            style={{ ...liftVars(l), ...stagger(k) }}
            onMouseEnter={() => setFocus(l)} onMouseLeave={() => setFocus(null)}>
            <div className="top">
              <h2 className="name" style={{ margin: 0 }}>{LIFT_LABEL[l]}</h2>
              <span className="tag">{tier(live[l])}</span>
            </div>
            <div className="mid">
              <span><span className="kgv">{kg(value(inputs, l) + delta[l])}</span><span className="unit">kg</span></span>
              <span className="pv"><CountUp value={live[l]} format={pctNumber} /><sup>{pctSuffix(live[l])}</sup></span>
            </div>
            <Ruler pct={live[l]} color={LIFT_COLOR[l]} />
          </div>
        ))}

        <div className="panel adjust">
          <div className="kv" style={{ padding: 0 }}>
            <h2 className="label">What if</h2>
            <button className="btn ghost" style={{ height: 30, padding: '0 8px' }} disabled={!moved}
              onClick={() => setDelta({ squat: 0, bench: 0, deadlift: 0 })}>Reset</button>
          </div>
          {LIFTS.map((l) => (
            <div className="row" key={l} style={liftVars(l)}
              onMouseEnter={() => setFocus(l)} onMouseLeave={() => setFocus(null)}>
              <div className="head">
                <label className={`c-${l}`} htmlFor={`d-${l}`}>{LIFT_LABEL[l]}</label>
                <span className="dim">{signed(delta[l])} kg</span>
              </div>
              <input id={`d-${l}`} className="slider" type="range" min={-20} max={20} step={2.5} value={delta[l]}
                onChange={(e) => setDelta({ ...delta, [l]: Number(e.target.value) })} />
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="kv"><span className="label">Projected total</span><span className="v">{kg(projected)} kg</span></div>
          <div className="kv"><span className="label">Projected percentile</span><span className="v">{pctText(heroPct)}</span></div>
          <div className="kv">
            <span className="label">For the {target.p}th you need</span>
            <span className="v">{target.r.n > 0 ? `${kg(target.r.value)} kg` : '—'}</span>
          </div>
          {target.r.n > 0 && (
            <div className="note">
              {kg(target.r.value)} kg itself lands at the {pctText(target.r.actualPercentile)}: lifters tie at that weight.
              {disagree && ` Local estimate ${kg(localTarget)} kg differs by more than a bin.`}
            </div>
          )}
        </div>
      </section>

      {/* ---- centre: the verdict, on a body ---- */}
      <section className="col-verdict centre" aria-label="Verdict">
        <div className="verdict-head">
          <span className="meta">{data.pt.weightClass} kg · {EQUIP_LABEL[inputs.eq].toLowerCase()} · {inputs.sex === 'm' ? 'men' : 'women'}</span>
          <button className="btn" onClick={() => navigate(`/share?${toQuery(inputs)}`)}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 10V2M5 5l3-3 3 3M3 9v4h10V9" /></svg>
            Share
          </button>
        </div>

        {/* The product. Largest text on the screen. */}
        <VerdictStatement inputs={inputs} strongest={data.strongest} weakest={data.weakest} cond={data.cond}
          classLabel={data.pt.weightClass} totalCdf={cdf.total} totalPct={data.pt.percentile} />

        <BodyMap percentiles={live} height={300} focus={focus} onHover={setFocus} />
        <div className="legend">
          {LIFTS.map((l) => (
            <span key={l} style={liftVars(l)} onMouseEnter={() => setFocus(l)} onMouseLeave={() => setFocus(null)}>
              <i aria-hidden="true" />{LIFT_LABEL[l]} <b>{pctText(live[l])}</b>
            </span>
          ))}
        </div>

        <div className="herorow">
          <div className="cell">
            <span className="label">Overall</span>
            <span className="v"><CountUp value={heroPct} format={pctNumber} /><sup>{pctSuffix(heroPct)}</sup></span>
          </div>
          <div className="cell">
            <span className="label">Total</span>
            <span className="v">{kg(projected)}<span className="unit">kg</span></span>
          </div>
          <div className="cell">
            <span className="label" title="Standard deviations from the class mean">vs class mean</span>
            <span className="v">{signed(z, 2)}<span className="unit">sd</span></span>
          </div>
        </div>
        {classMismatch && (
          <div className="note" style={{ color: 'var(--danger)' }}>
            Server placed you in {data.pt.weightClass} kg; the client computed {clientClass} kg.
          </div>
        )}
      </section>

      {/* ---- right: context ---- */}
      <section className="col-context" aria-label="Context">
        <div className="panel">
          <div className="kv" style={{ paddingTop: 0 }}>
            <h2 className="label">Totals in the {data.pt.weightClass} kg class</h2>
            <span className="v">{kg(projected)} kg</span>
          </div>
          <DistributionChart cdf={cdf.total} marker={projected} mean={mean} sd={sd} />
          <div className="note">
            {int(data.dt.summary?.n ?? 0)} results · mean {kg(mean)} kg · sd {kg(sd)} kg. Percentages under each band are read from the data.
          </div>
        </div>

        <div className="panel">
          <h2 className="label" style={{ marginBottom: 6 }}>Nearest lifters by total</h2>
          <div className="nearest">
            {nearest.map((r, k) => (
              <div key={k} className={`row${r.you ? ' you' : ''}`}>
                <span title={r.you ? undefined : r.name}>{r.you ? 'You' : abbreviate(r.name)}</span>
                <span className={r.you ? undefined : 'dim'}>{kg(r.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel callout">
          {swapPct !== null ? (
            <>
              <div className="kv">
                <h2 className="label">In {EQUIP_LABEL[data.swapTo].toLowerCase()} you’d be</h2>
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
            <div className="note" style={{ marginTop: 12 }}>
              This class’s mean total has {last.mean >= first.mean ? 'risen' : 'fallen'}{' '}
              {kg(Math.abs(last.mean - first.mean))} kg since {first.year}.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
