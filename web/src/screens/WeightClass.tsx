import { useMemo, useState } from 'react'
import { Cdf } from '../api/cdf'
import { classChange, classSweep, distribution } from '../api/endpoints'
import { ErrorState, HeaderStrip, Loading } from '../components/Shell'
import { int, kg, pctText, signed } from '../lib/format'
import { CLASS_COUNT, classBodyweight, classGroup, className, group, ipfClassIndex, toQuery, total, type Inputs } from '../lib/inputs'
import { useSubmit } from '../lib/useSubmit'
import { CountUp, i as stagger } from '../lib/motion'
import { navigate } from '../router'

// Classes with fewer results than this are drawn faint and can't be "best":
// a percentile over a few hundred results is too easy to top (spec 3.4 --
// grey them, don't remove them).
const THIN = 500
// The measured rate comes from ONE-class moves (median bodyweight change ~5 kg).
// Applying it to a three-class cut is extrapolation, so those classes are drawn
// faint and can't be "best". Without this, 0 kg/kg puts an 83 kg lifter's
// total in the 53 kg class at the 100th percentile.
const REACH = 1

async function load(i: Inputs) {
  const g = group(i)
  const t = total(i)
  // Nine Distributions, one CDF per class for the LIVE slider, in one Promise.all.
  const [dists, sweep, down, up] = await Promise.all([
    Promise.all(Array.from({ length: CLASS_COUNT }, (_, c) => distribution(classGroup(i, c), 'LIFT_KIND_TOTAL'))),
    classSweep(g, 'LIFT_KIND_TOTAL', t),
    classChange(g, -1),
    classChange(g, 1),
  ])
  return { dists, sweep, down, up }
}

export function WeightClass({ inputs, params }: { inputs: Inputs; params: URLSearchParams }) {
  const key = toQuery(inputs)
  const res = useSubmit(key, () => load(inputs))
  return (
    <>
      <HeaderStrip inputs={inputs} />
      <main className="main">
        {res.state === 'loading' && <Loading />}
        {res.state === 'error' && <ErrorState error={res.error} />}
        {res.state === 'ok' && <Body key={key} inputs={inputs} data={res.data} initialLoss={params.get('loss')} />}
      </main>
    </>
  )
}

function Body({ inputs, data, initialLoss }: { inputs: Inputs; data: Awaited<ReturnType<typeof load>>; initialLoss: string | null }) {
  // Measured, not assumed: the median of (total change / bodyweight change)
  // over lifters who actually moved DOWN a class.
  const measured = Math.round(data.down.medianTotalPerBwKg * 10) / 10
  const parsed = initialLoss === null ? NaN : Number(initialLoss)
  const [loss, setLoss] = useState(Number.isFinite(parsed) ? parsed : measured)
  // Click a bar or a table row to pin that class and see how its number is made.
  const [pinned, setPinned] = useState<number | null>(null)

  const cdfs = useMemo(() => data.dists.map((d) => new Cdf(d.bins)), [data])
  const t = total(inputs)
  const own = ipfClassIndex(inputs.sex, inputs.bw)

  const rows = data.sweep.rows.map((r, c) => {
    const s = r.summary!
    const targetBw = classBodyweight(inputs.sex, c, inputs.bw)
    const projected = t - (inputs.bw - targetBw) * loss
    // Own class: the server's exact percentile. Elsewhere: the class's CDF at
    // the projected total, so the slider stays local.
    const pct = s.n === 0 ? null : c === own && r.hasPercentile ? r.percentile : cdfs[c].percentileAt(projected)
    const z = s.sd > 0 ? (projected - s.mean) / s.sd : 0
    return { c, label: className(inputs.sex, c), n: s.n, mean: s.mean, sd: s.sd, targetBw, projected, pct, z }
  })

  const reachable = (c: number) => Math.abs(c - own) <= REACH
  const eligible = rows.filter((r) => r.pct !== null && r.n >= THIN && reachable(r.c))
  const best = eligible.reduce<(typeof rows)[number] | null>((a, r) => (a === null || r.pct! > a.pct! ? r : a), null)
  const current = rows[own]

  function onLoss(v: number) {
    setLoss(v)
    navigate(`/wc?${toQuery(inputs, { loss: v.toFixed(1) })}`, true) // URL is the state; replace, no history spam
  }

  const lo = Math.min(-2, measured - 1)
  const hi = Math.max(6, measured + 1)
  const markerAt = ((measured - lo) / (hi - lo)) * 100

  return (
    <>
      <h1 className="large">Where would you rank at each weight class?</h1>
      <p className="subtitle">
        Based on {int(data.down.lifters)} lifters who actually moved down a class — not an assumed ratio.
      </p>

      <h2 className="sr-only">Your percentile in each class</h2>
      <div className="sweep">
        {rows.map((r) => {
          const h = r.pct === null ? 0 : 40 + (r.pct / 100) * 260
          const cls = `col${best?.c === r.c ? ' best' : ''}${r.n < THIN || !reachable(r.c) ? ' thin' : ''}${pinned === r.c ? ' pinned' : ''}`
          return (
            <button type="button" key={r.c} className={cls} title={`n = ${int(r.n)}`} aria-pressed={pinned === r.c}
              onClick={() => setPinned(pinned === r.c ? null : r.c)}>
              <span className="marker accent">{best?.c === r.c ? 'Best' : ''}</span>
              <span className="pct">{r.pct === null ? '—' : <CountUp value={r.pct} format={pctText} />}</span>
              {/* --h: bar height on desktop; --p: bar width when it lies flat on a phone. */}
              <span className="stem grow-y" style={{ '--h': `${h}px`, '--p': `${r.pct ?? 0}%`, ...stagger(r.c) } as React.CSSProperties} />
              <span className="cls">{r.label}</span>
              <span className="meta">{kg(r.projected)} kg</span>
              <span className="marker dim" style={{ marginTop: 6 }}>{r.c === own ? 'Your class' : ''}</span>
            </button>
          )
        })}
      </div>

      {pinned !== null && (() => {
        const r = rows[pinned]
        const diff = inputs.bw - r.targetBw
        return (
          <div className="panel rise" style={{ maxWidth: 820, margin: '0 auto 20px' }}>
            <div className="kv" style={{ paddingTop: 0 }}>
              <h2 className="label">{r.label} kg{r.c === own ? ' · your class' : ''}</h2>
              <span className="v">{r.pct === null ? '—' : pctText(r.pct)}</span>
            </div>
            <div className="dim" style={{ lineHeight: 1.6 }}>
              {r.c === own
                ? <>You compete at {kg(inputs.bw)} kg. Your {kg(t)} kg total, ranked by the engine against {int(r.n)} results.</>
                : <>Compete at {kg(r.targetBw)} kg ({signed(-diff)} kg bodyweight). At {loss.toFixed(1)} kg of total per kg,
                  your total becomes {kg(r.projected)} kg, read against {int(r.n)} results in the class.</>}
              {r.n > 0 && <> Class mean {kg(r.mean)} kg, so you’d sit {signed(r.z, 2)} SD from it.</>}
            </div>
          </div>
        )
      })()}

      <p className="note" style={{ textAlign: 'center', marginTop: 0 }}>
        Faint classes are more than one class away: the rate below is measured on one-class moves, so it doesn’t
        reach them.
      </p>

      <div className="losstrack">
        <div className="head">
          <label className="label" htmlFor="loss">Total change per kg of bodyweight</label>
          <span>{loss.toFixed(1)} kg per kg</span>
        </div>
        <div style={{ position: 'relative' }}>
          <input id="loss" className="slider" type="range" min={lo} max={hi} step={0.1} value={loss}
            onChange={(e) => onLoss(Number(e.target.value))} />
          <span style={{ position: 'absolute', left: `${markerAt}%`, top: 2, width: 1, height: 18, background: 'var(--text-2)', pointerEvents: 'none' }} />
        </div>
        <div className="ends label faint">
          <span>{lo.toFixed(1)}</span>
          <span>Measured median, moving down · {measured.toFixed(1)}</span>
          <span>{hi.toFixed(1)}</span>
        </div>
        <div className="note" style={{ textAlign: 'center' }}>
          Lighter classes: your total minus {loss.toFixed(1)} kg for each kg cut to the class limit. Heavier: plus, per kg gained.
          Lifters moving up gained a median {data.up.medianTotalPerBwKg.toFixed(1)} kg per kg, which includes the
          training between meets.
        </div>
      </div>

      <table className="pop">
        <thead>
          <tr>
            {['Class', 'Results', 'Mean', 'SD', 'Your total there', 'vs mean (sd)'].map((h) => <th key={h} scope="col">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.c} className={`${r.c === own ? 'current' : ''}${pinned === r.c ? ' pinned' : ''}`}
              style={r.n < THIN ? { color: 'var(--text-3)' } : undefined}
              onClick={() => setPinned(pinned === r.c ? null : r.c)}>
              <td>{r.label} kg {r.c === own && <span className="meta" style={{ marginLeft: 8 }}>your class</span>}</td>
              <td>{int(r.n)}</td>
              <td>{r.n ? `${kg(r.mean)} kg` : '—'}</td>
              <td>{r.n ? `${kg(r.sd)} kg` : '—'}</td>
              <td>{kg(r.projected)} kg</td>
              <td>{r.n ? signed(r.z, 2) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="summary">
        <span className="label">Your class</span>
        <span>{current.label} kg · {kg(current.projected)} kg · {current.pct === null ? '—' : `${pctText(current.pct)} percentile`} · {int(current.n)} results</span>
        {best && (
          <>
            <span className="label">Best</span>
            <span>{best.label} kg · {kg(best.projected)} kg · {pctText(best.pct!)} percentile · {int(best.n)} results</span>
          </>
        )}
        <span className="label">Based on</span>
        <span>
          {int(data.down.transitions)} moves down one class by {int(data.down.lifters)} lifters · median bodyweight change{' '}
          {signed(data.down.medianBwDelta)} kg · mean total change {signed(data.down.meanTotalDelta)} kg
        </span>
      </div>
    </>
  )
}
