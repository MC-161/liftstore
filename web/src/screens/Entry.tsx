import { useEffect, useState } from 'react'
import { datasetStats } from '../api/endpoints'
import type { DatasetStatsResponse } from '../gen/engine_pb'
import { int } from '../lib/format'
import { EQUIP_LABEL, loadLast, saveLast, toQuery, validate, type Equip, type Field, type Inputs, type Sex } from '../lib/inputs'
import { navigate } from '../router'
import { liftVars } from '../lib/lifts'
import { i as stagger } from '../lib/motion'
import { kg } from '../lib/format'

const FIELDS: [Field, string][] = [['s', 'SQUAT'], ['b', 'BENCH'], ['d', 'DEADLIFT'], ['bw', 'BODYWEIGHT']]
const FIELD_LIFT = { s: 'squat', b: 'bench', d: 'deadlift' } as const

export function Entry({ initial }: { initial: Inputs | null }) {
  const last = initial ?? loadLast()
  const [text, setText] = useState<Record<Field, string>>({
    s: last?.s?.toString() ?? '', b: last?.b?.toString() ?? '', d: last?.d?.toString() ?? '', bw: last?.bw?.toString() ?? '',
  })
  const [sex, setSex] = useState<Sex>(last?.sex ?? 'm')
  const [eq, setEq] = useState<Equip>(last?.eq ?? 'raw')
  const [errs, setErrs] = useState<Partial<Record<Field, string>>>({})
  const [stats, setStats] = useState<DatasetStatsResponse | null>(null)

  // BOOT: once per page load, cached in the query layer.
  useEffect(() => {
    datasetStats().then(setStats, () => setStats(null))
  }, [])

  const parse = (v: string) => (v.trim() === '' ? NaN : Number(v))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const nums = { s: parse(text.s), b: parse(text.b), d: parse(text.d), bw: parse(text.bw) }
    const found = validate(nums)
    setErrs(found)
    if (Object.keys(found).length) return // do not advance until valid
    const inputs: Inputs = { ...nums, sex, eq }
    saveLast(inputs)
    navigate(`/v?${toQuery(inputs)}`)
  }

  const nums = [parse(text.s), parse(text.b), parse(text.d)]
  const liveTotal = nums.every((v) => v > 0) ? nums[0] + nums[1] + nums[2] : null

  return (
    <form className="entry" onSubmit={submit} noValidate>
      <span className="glow-blob" style={{ background: 'var(--squat)', left: '-20vw', top: '-25vw' }} aria-hidden />
      <span className="glow-blob" style={{ background: 'var(--bench)', right: '-25vw', top: '5vw', animationDelay: '-7s' }} aria-hidden />
      <span className="glow-blob" style={{ background: 'var(--deadlift)', left: '15vw', bottom: '-35vw', animationDelay: '-14s' }} aria-hidden />
      <div className="inner">
        <h1 className="rise">Which lift is holding you back?</h1>
        <p className="lede rise" style={stagger(1)}>
          {stats ? `${(stats.results / 1e6).toFixed(1)} million competition results.` : 'Competition results.'} No account.
        </p>

        <div className="fields">
          {FIELDS.map(([f, label], k) => (
            <div key={f} className={`field rise${errs[f] ? ' invalid' : ''}`}
              style={{ ...(f === 'bw' ? { '--lc': 'var(--text)' } as React.CSSProperties : liftVars(FIELD_LIFT[f])), ...stagger(k + 2) }}>
              <label className="label" htmlFor={f}>{label}</label>
              <div className="box">
                <input id={f} inputMode="decimal" autoComplete="off" value={text[f]}
                  aria-invalid={!!errs[f]} aria-describedby={`${f}-err`}
                  onChange={(e) => {
                    setText({ ...text, [f]: e.target.value })
                    if (errs[f]) setErrs({ ...errs, [f]: undefined }) // cleared on edit
                  }} />
                <span className="unit">KG</span>
              </div>
              <div className="err" id={`${f}-err`}>{errs[f] ?? ''}</div>
            </div>
          ))}
        </div>

        <div className="livetotal label">
          {liveTotal !== null && <>TOTAL<span className="stat" style={{ color: 'var(--accent)' }}>{kg(liveTotal)}</span>KG</>}
        </div>

        <div className="choices rise" style={stagger(6)}>
          <div className="choice-group" role="group" aria-label="Sex">
            <span className="label">SEX</span>
            {(['m', 'f'] as Sex[]).map((v) => (
              <button type="button" key={v} className="choice" aria-pressed={sex === v} onClick={() => setSex(v)}>
                {v === 'm' ? 'Male' : 'Female'}
              </button>
            ))}
          </div>
          <div className="choice-group" role="group" aria-label="Equipment">
            <span className="label">EQUIPMENT</span>
            {(Object.keys(EQUIP_LABEL) as Equip[]).map((v) => (
              <button type="button" key={v} className="choice" aria-pressed={eq === v} onClick={() => setEq(v)}>
                {EQUIP_LABEL[v]}
              </button>
            ))}
          </div>
        </div>

        <button className="analyse rise" style={stagger(7)} type="submit">ANALYSE</button>

        <div className="statsrow label faint">
          {stats ? (
            <>
              <span>{int(stats.results)} RESULTS</span><span>·</span>
              <span>{int(stats.federations)} FEDERATIONS</span><span>·</span>
              {/* Static, from docs/benchmarks.md -- not a live readout (spec 2.3). */}
              <span title="Hero query, benchmarked single-threaded over the full dataset">8.8 MS HERO QUERY, BENCHMARKED</span>
            </>
          ) : <span>&nbsp;</span>}
        </div>
      </div>
    </form>
  )
}
