import { attempts } from '../api/endpoints'
import { ErrorState, HeaderStrip, Loading } from '../components/Shell'
import { int, kg, LIFT_LABEL, LIFT_WIRE, LIFTS, type Lift } from '../lib/format'
import { EQUIP_LABEL, classGroup, className, ipfClassIndex, toQuery, type Inputs } from '../lib/inputs'
import { useState } from 'react'
import { useSubmit } from '../lib/useSubmit'
import { liftVars } from '../lib/lifts'
import { CountUp, i as stagger } from '../lib/motion'

const JUMPS = [2.5, 5, 7.5, 10, 12.5]
const THRESHOLD = 0.6
const MIN_COUNT = 30 // below this a bucket's rate is shown but never picked

const value = (i: Inputs, l: Lift) => (l === 'squat' ? i.s : l === 'bench' ? i.b : i.d)

async function load(i: Inputs) {
  const cg = classGroup(i)
  const [squat, bench, deadlift] = await Promise.all(LIFTS.map((l) => attempts(cg, LIFT_WIRE[l])))
  return { squat, bench, deadlift }
}

export function Attempts({ inputs }: { inputs: Inputs }) {
  const key = toQuery(inputs)
  const res = useSubmit(key, () => load(inputs))
  return (
    <>
      <HeaderStrip inputs={inputs} />
      <main className="main">
        {res.state === 'loading' && <Loading />}
        {res.state === 'error' && <ErrorState error={res.error} />}
        {res.state === 'ok' && <Body inputs={inputs} data={res.data} />}
      </main>
    </>
  )
}

function Body({ inputs, data }: { inputs: Inputs; data: Awaited<ReturnType<typeof load>> }) {
  const n = data.squat.n + data.bench.n + data.deadlift.n
  const cls = className(inputs.sex, ipfClassIndex(inputs.sex, inputs.bw))
  // The jump the user clicked, per lift. Starts on the pick.
  const [chosen, setChosen] = useState<Partial<Record<Lift, number>>>({})
  return (
    <>
      <div className="titlerow">
        <h1 className="large">What should you call?</h1>
        <span className="criteria">Pick: the largest jump at least 60% made</span>
      </div>

      {LIFTS.map((l, k) => {
        const r = data[l]
        // Select the five buckets by their lower edge; a missing one renders
        // empty rather than shifting the others (spec, Attempts).
        const cards = JUMPS.map((j) => {
          const b = r.jumpBins.find((x) => Math.abs(x.low - j) < 1e-3)
          return { j, count: b?.count ?? 0, rate: b && b.count > 0 ? b.successes / b.count : null }
        })
        const pick = [...cards].reverse().find((c) => c.rate !== null && c.count >= MIN_COUNT && c.rate >= THRESHOLD)
        return (
          <section className={`liftsection rise c-${l}-section`} key={l} style={{ ...liftVars(l), ...stagger(k) }}>
            <div className="head">
              <h2 className="label" style={{ color: 'inherit' }}><span className={`name c-${l}`}>{LIFT_LABEL[l]}</span> <span className="meta">· {int(r.n)} third attempts</span></h2>
              <span><span className="label">If your second is </span><span className="stat">{kg(value(inputs, l))}</span><span className="unit">kg</span></span>
            </div>
            <div className="cards">
              {cards.map((c, ci) => (
                <button type="button" key={c.j} className={`card${pick?.j === c.j ? ' pick' : ''}${c.rate === null ? ' empty' : ''}${(chosen[l] ?? pick?.j) === c.j ? ' chosen' : ''}`}
                  title={`${int(c.count)} lifters jumped this much`} aria-pressed={(chosen[l] ?? pick?.j) === c.j}
                  onClick={() => setChosen({ ...chosen, [l]: c.j })}>
                  <span className="label">+{c.j.toFixed(1)} kg</span>
                  <span className="rate">{c.rate === null ? '—' : <CountUp value={c.rate * 100} format={(v) => `${Math.round(v)}%`} />}</span>
                  <span className="stem grow-y" style={{ '--h': `${c.rate === null ? 0 : 20 + c.rate * 130}px`, '--p': `${(c.rate ?? 0) * 100}%`, ...stagger(k * 5 + ci) } as React.CSSProperties} />
                  <span className="w">{kg(value(inputs, l) + c.j)}<span className="unit">kg</span></span>
                  <span className="meta" style={{ marginTop: 4 }}>{int(c.count)} tried</span>
                </button>
              ))}
            </div>
            {(() => {
              const j = chosen[l] ?? pick?.j
              const c = cards.find((x) => x.j === j)
              if (!c) return <div className="note">No jump here was made by 60% of the lifters who chose it. Tap a card to call one anyway.</div>
              return (
                <div className="called">
                  <span className="label">Your call</span>
                  <span className="stat" style={{ color: 'var(--lc)' }}>{kg(value(inputs, l) + c.j)}</span><span className="unit">kg</span>
                  <span className="dim">
                    +{c.j.toFixed(1)} kg · {c.rate === null ? 'no lifters jumped this much' : `made by ${Math.round(c.rate * 100)}% of ${int(c.count)} who tried it`}
                    {pick?.j === c.j ? ' · the pick' : ''}
                  </span>
                </div>
              )
            })()}
          </section>
        )
      })}

      <p className="dim" style={{ marginTop: 28 }}>
        Based on {int(n)} third attempts in the {cls} kg class ({inputs.sex === 'm' ? 'men' : 'women'}, {EQUIP_LABEL[inputs.eq].toLowerCase()},
        full power) with both the second and third recorded.
      </p>
      <p className="note">
        These are the rates for the jumps lifters chose. A bigger jump tends to be chosen on a better day, so a rate is
        not the odds for a jump you pick.
      </p>
    </>
  )
}
