import { useMemo } from 'react'
import { ApiError } from '../api/client'
import { Cdf } from '../api/cdf'
import { distribution, leaderboard, lifterByName, percentile } from '../api/endpoints'
import { DistributionChart } from '../components/DistributionChart'
import { Figure } from '../components/Figure'
import { Eyebrow, ErrorState, HeaderStrip, Loading } from '../components/Shell'
import { abbreviate, int, kg, LIFT_LABEL, LIFTS, pctText, signed, type Lift } from '../lib/format'
import { classGroup, className, group, ipfClassIndex, toQuery, total, type Inputs } from '../lib/inputs'
import { LIFT_HEX, liftVars, type Lit } from '../lib/lifts'
import { CountUp, i as stagger } from '../lib/motion'
import { dots } from '../lib/dots'
import { useSubmit } from '../lib/useSubmit'
import { navigate } from '../router'

const WIRE = { squat: 'LIFT_KIND_SQUAT', bench: 'LIFT_KIND_BENCH', deadlift: 'LIFT_KIND_DEADLIFT', total: 'LIFT_KIND_TOTAL' } as const
const yours = (i: Inputs) => ({ squat: i.s, bench: i.b, deadlift: i.d, total: total(i) })

// No name search yet (by request): opponents are picked from lifters the
// engine already put in front of you -- the top of your class, and the
// results just above your total.
async function loadPicker(i: Inputs) {
  const [board, pt] = await Promise.all([
    leaderboard(classGroup(i), { preset: 'RANK_PRESET_TOP_TOTAL' }, undefined, 6),
    percentile(group(i), i.bw, 'LIFT_KIND_TOTAL', total(i)),
  ])
  const above = pt.neighbours.filter((n) => n.value >= total(i)).slice(0, 3)
  return { board, above }
}

type Scope = 'class' | 'any'

async function loadVs(i: Inputs, vs: string, scope: Scope) {
  const g = group(i)
  // Default: their best IN YOUR CLASS -- John Haack's best overall is a
  // 105 kg total, and against an 83 kg cohort that reads 100th everywhere,
  // which compares nothing. If they never lifted in your class, fall back.
  let fellBack = false
  const them = scope === 'any'
    ? await lifterByName(g, vs)
    : await lifterByName(g, vs, ipfClassIndex(i.sex, i.bw)).catch((e) => {
        if (e instanceof ApiError && e.status === 404) { fellBack = true; return lifterByName(g, vs) }
        throw e
      })
  const their = { squat: them.squat, bench: them.bench, deadlift: them.deadlift, total: them.total }
  // Both lifters measured against YOUR cohort: same class, same bodyweight input.
  const pctOf = (v: number, l: keyof typeof WIRE) =>
    v > 0 ? percentile(g, i.bw, WIRE[l], v).then((r) => r.percentile) : Promise.resolve(NaN)
  const mine = yours(i)
  const [ys, yb, yd, yt, ts, tb, td, tt, dist] = await Promise.all([
    pctOf(mine.squat, 'squat'), pctOf(mine.bench, 'bench'), pctOf(mine.deadlift, 'deadlift'), pctOf(mine.total, 'total'),
    pctOf(their.squat, 'squat'), pctOf(their.bench, 'bench'), pctOf(their.deadlift, 'deadlift'), pctOf(their.total, 'total'),
    distribution(classGroup(i), 'LIFT_KIND_TOTAL'),
  ])
  return {
    them, their, fellBack,
    youPct: { squat: ys, bench: yb, deadlift: yd, total: yt },
    themPct: { squat: ts, bench: tb, deadlift: td, total: tt },
    dist,
  }
}

export function HeadToHead({ inputs, params }: { inputs: Inputs; params: URLSearchParams }) {
  const vs = params.get('vs')
  return (
    <>
      <HeaderStrip inputs={inputs} />
      <main className="main">
        {vs ? <Versus key={`${vs}|${params.get('scope')}`} inputs={inputs} vs={vs} scope={params.get('scope') === 'any' ? 'any' : 'class'} />
          : <Picker inputs={inputs} />}
      </main>
    </>
  )
}

const choose = (i: Inputs, name: string | null) =>
  navigate(`/h2h?${toQuery(i, name ? { vs: name } : {})}`)

function Picker({ inputs }: { inputs: Inputs }) {
  const res = useSubmit(`pick|${toQuery(inputs)}`, () => loadPicker(inputs))
  const cls = className(inputs.sex, ipfClassIndex(inputs.sex, inputs.bw))
  return (
    <>
      <Eyebrow>HEAD-TO-HEAD COMPARISON</Eyebrow>
      <h1 className="large">Who do you want to measure against?</h1>
      <p className="subtitle">Pick a lifter. Both of you are measured against the same {cls} kg cohort.</p>
      {res.state === 'loading' && <Loading />}
      {res.state === 'error' && <ErrorState error={res.error} />}
      {res.state === 'ok' && (
        <>
          <div className="label" style={{ marginTop: 32 }}>TOP OF THE {cls} KG CLASS</div>
          <div className="picker">
            {res.data.board.rows.map((r, k) => (
              <button key={r.name} className="panel pick-card rise" style={stagger(k)} onClick={() => choose(inputs, r.name)}>
                <span className="n" title={r.name}>{r.name}</span>
                <span className="dim">{kg(r.total)} kg · {r.federation} · {r.date.slice(0, 4)}</span>
              </button>
            ))}
          </div>
          {res.data.above.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 28 }}>JUST ABOVE YOUR TOTAL</div>
              <div className="picker">
                {res.data.above.map((n, k) => (
                  <button key={n.name} className="panel pick-card rise" style={stagger(k + 6)} onClick={() => choose(inputs, n.name)}>
                    <span className="n" title={n.name}>{n.name}</span>
                    <span className="dim">{kg(n.value)} kg</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="note" style={{ marginTop: 20 }}>Or pick anyone from a Leaderboards row.</p>
        </>
      )}
    </>
  )
}

function Versus({ inputs, vs, scope }: { inputs: Inputs; vs: string; scope: Scope }) {
  const res = useSubmit(`vs|${toQuery(inputs)}|${vs}|${scope}`, () => loadVs(inputs, vs, scope))
  if (res.state === 'loading') return <Loading />
  if (res.state === 'error') {
    return (
      <>
        <ErrorState error={res.error} />
        <div style={{ textAlign: 'center' }}><button className="sharebtn" style={{ width: 'auto', padding: '12px 24px' }} onClick={() => choose(inputs, null)}>PICK SOMEONE ELSE</button></div>
      </>
    )
  }
  return <VersusBody inputs={inputs} data={res.data} scope={scope} vs={vs} />
}

function VersusBody({ inputs, data, scope, vs }: { inputs: Inputs; data: Awaited<ReturnType<typeof loadVs>>; scope: Scope; vs: string }) {
  const { them, their, youPct, themPct } = data
  const mine = yours(inputs)
  const short = abbreviate(them.name)
  const cdf = useMemo(() => new Cdf(data.dist.bins), [data])
  const cls = className(inputs.sex, ipfClassIndex(inputs.sex, inputs.bw))
  const myDots = dots(inputs.sex, inputs.bw, mine.total)

  // The sentence: the single lift with the biggest percentile gap, in
  // whichever direction the totals point.
  const ahead = mine.total >= their.total
  const gaps = LIFTS.filter((l) => !Number.isNaN(themPct[l]))
    .map((l) => ({ l, d: ahead ? youPct[l] - themPct[l] : themPct[l] - youPct[l] }))
    .sort((a, b) => b.d - a.d)
  const key = gaps[0]?.l as Lift | undefined
  const youLit: Lit = { squat: youPct.squat, bench: youPct.bench, deadlift: youPct.deadlift }
  const themLit: Lit = {
    squat: Number.isNaN(themPct.squat) ? 50 : themPct.squat,
    bench: Number.isNaN(themPct.bench) ? 50 : themPct.bench,
    deadlift: Number.isNaN(themPct.deadlift) ? 50 : themPct.deadlift,
  }
  const mean = data.dist.summary?.mean ?? 0
  const sd = data.dist.summary?.sd ?? 0

  const rows: [Lift | 'total', number, number][] = [
    ['squat', mine.squat, their.squat], ['bench', mine.bench, their.bench],
    ['deadlift', mine.deadlift, their.deadlift], ['total', mine.total, their.total],
  ]

  return (
    <>
      <div className="vsstrip rise">
        <div className="line"><b>YOU</b><span>SQUAT <b>{kg(mine.squat)}</b></span><span>BENCH <b>{kg(mine.bench)}</b></span>
          <span>DEADLIFT <b>{kg(mine.deadlift)}</b></span><span>TOTAL <b>{kg(mine.total)}</b></span><span className="dim">BW {kg(inputs.bw)}</span></div>
        <div className="line" style={{ color: 'var(--accent)' }}><b>{them.name.toUpperCase()}</b><span>SQUAT <b>{kg(their.squat)}</b></span>
          <span>BENCH <b>{kg(their.bench)}</b></span><span>DEADLIFT <b>{kg(their.deadlift)}</b></span><span>TOTAL <b>{kg(their.total)}</b></span>
          <span className="dim">BW {kg(them.bodyweight)} · {them.meet}, {them.date}</span></div>
      </div>

      <div className="kv h2h-head" style={{ alignItems: 'flex-end' }}>
        <div>
          <Eyebrow>HEAD-TO-HEAD COMPARISON</Eyebrow>
          <h1 className="large">Where the gap actually is.</h1>
          <p className="subtitle">
            Both lifters measured against the same {int(data.dist.summary?.n ?? 0)} results in the {cls} kg class.
            {data.fellBack && ` ${short} has no results at ${cls} kg, so this is their best anywhere.`}
            {!data.fellBack && them.weightClass !== cls && ` This total came in the ${them.weightClass} kg class.`}
          </p>
        </div>
        <div className="h2h-actions">
          <button className="choice" aria-pressed={scope === 'class'}
            onClick={() => navigate(`/h2h?${toQuery(inputs, { vs })}`, true)}>BEST AT {cls} KG</button>
          <button className="choice" aria-pressed={scope === 'any'}
            onClick={() => navigate(`/h2h?${toQuery(inputs, { vs, scope: 'any' })}`, true)}>BEST ANYWHERE</button>
          <button className="choice" onClick={() => choose(inputs, null)}>CHANGE OPPONENT</button>
        </div>
      </div>

      <div className="h2h">
        <aside className="side side-you panel rise" style={stagger(1)}>
          <div><div className="who">You</div><div className="label">BODYWEIGHT {kg(inputs.bw)} KG</div></div>
          <div className="panel" style={{ background: 'var(--bg)' }}>
            <div className="label">COMPETITION TOTAL</div>
            <div className="stat" style={{ fontSize: 40, fontWeight: 300 }}><CountUp value={mine.total} format={kg} /><span className="unit">KG</span></div>
            <div className="label" style={{ marginTop: 10 }}>DOTS {myDots.toFixed(1)} · {pctText(youPct.total)} PERCENTILE</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Figure percentiles={youLit} size={230} /></div>
        </aside>

        <section className="versus">
          {rows.map(([l, a, b], k) => {
            const color = l === 'total' ? 'var(--accent)' : LIFT_HEX[l]
            const sum = a + b
            const diff = a - b
            return (
              <div key={l} className="panel cmp rise" style={{ ...(l !== 'total' ? liftVars(l) : {}), ...stagger(k + 2) }}>
                <div className="vals">
                  <span className="v">{kg(a)}<span className="unit">KG</span></span>
                  <span className="label" style={{ color }}>{l === 'total' ? 'TOTAL' : LIFT_LABEL[l]}</span>
                  <span className="v" style={{ color }}>{b > 0 ? kg(b) : '—'}<span className="unit">KG</span></span>
                </div>
                <div className="splitbar">
                  <i className="grow-x" style={{ width: `${sum > 0 ? (a / sum) * 100 : 50}%`, background: 'var(--text)', ...stagger(k) }} />
                  <i className="grow-x" style={{ width: `${sum > 0 ? (b / sum) * 100 : 50}%`, background: color, ...stagger(k + 1) }} />
                </div>
                <div className="kv" style={{ padding: 0 }}>
                  <span className="label faint">{l === 'total' ? `${pctText(youPct.total)} vs ${pctText(themPct.total)}` : `${pctText(youPct[l])} vs ${Number.isNaN(themPct[l]) ? '—' : pctText(themPct[l])}`}</span>
                  {b > 0 && <span className="label" style={{ color: diff < 0 ? 'var(--danger)' : 'var(--squat)' }}>{signed(diff)} KG ({signed((diff / b) * 100)}%)</span>}
                </div>
              </div>
            )
          })}

          <div className="panel verdictbox rise" style={stagger(7)}>
            {key ? (ahead ? (
              <>You out-total {short} by <b className="accent">{kg(mine.total - their.total)} kg</b>. Your biggest edge is the {key}:{' '}
                <b>{pctText(youPct[key])}</b> percentile against their {pctText(themPct[key])}.</>
            ) : (
              <>You’re at <b>{Math.round((mine.total / their.total) * 100)}%</b> of {short}’s total — your {key} is{' '}
                <b className="accent">{pctText(youPct[key])}</b> percentile and theirs is <b>{pctText(themPct[key])}</b>.
                That’s the biggest single gap.</>
            )) : <>No lift-by-lift numbers recorded for {short}’s best total.</>}
          </div>
        </section>

        <aside className="side side-them panel rise" style={stagger(2)}>
          <div><div className="who accent" title={them.name}>{them.name}</div><div className="label">BODYWEIGHT {kg(them.bodyweight)} KG · {them.federation}</div></div>
          <div className="panel" style={{ background: 'var(--bg)' }}>
            <div className="label">COMPETITION TOTAL</div>
            <div className="stat accent" style={{ fontSize: 40, fontWeight: 300 }}><CountUp value={their.total} format={kg} /><span className="unit">KG</span></div>
            <div className="label" style={{ marginTop: 10 }}>DOTS {them.dots > 0 ? them.dots.toFixed(1) : '—'} · {pctText(themPct.total)} PERCENTILE</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Figure percentiles={themLit} size={230} /></div>
          <div className="note">
            {int(them.results)} placed results {scope === 'class' && !data.fellBack ? `in the ${cls} kg class` : 'in this category'}; this is their best total.
          </div>
        </aside>
      </div>

      <div className="panel rise" style={{ marginTop: 20, ...stagger(8) }}>
        <div className="kv" style={{ paddingTop: 0 }}>
          <span className="label">DISTRIBUTION · TOTAL ({cls} KG)</span>
          <span className="label faint">N = {int(data.dist.summary?.n ?? 0)} · MEAN {kg(mean)} KG · SD {kg(sd)} KG</span>
        </div>
        <DistributionChart cdf={cdf} marker={mine.total} mean={mean} sd={sd} height={200}
          extra={[{ value: their.total, color: 'var(--squat)', label: `${short.toUpperCase()} ${kg(their.total)}` }]} />
      </div>
    </>
  )
}
