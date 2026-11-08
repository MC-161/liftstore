import { useEffect, useState } from 'react'
import { datasetStats } from '../api/endpoints'
import type { DatasetStatsResponse } from '../gen/engine_pb'
import { int } from '../lib/format'
import { EQUIP_LABEL, loadLast, saveLast, toQuery, validate, type Equip, type Field, type Inputs, type Sex } from '../lib/inputs'
import { navigate } from '../router'
import { Mark, ThemeToggle } from '../components/Shell'
import { liftVars } from '../lib/lifts'
import { kg } from '../lib/format'

const FIELDS: [Field, string][] = [['s', 'Squat'], ['b', 'Bench'], ['d', 'Deadlift'], ['bw', 'Bodyweight']]
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
      <div className="entry-top">
        <span className="brand"><Mark />Weak Link</span>
        <ThemeToggle />
      </div>
      <div className="inner">
        <h1>Which lift is holding you back?</h1>
        <p className="lede">
          Your squat, bench and deadlift against{' '}
          {stats ? `${(stats.results / 1e6).toFixed(1)} million` : 'millions of'} competition results, compared with
          lifters your size. No account.
        </p>

        <div className="entry-card">
          <div className="fields">
            {FIELDS.map(([f, label]) => (
              <div key={f} className={`field${errs[f] ? ' invalid' : ''}`}
                style={f === 'bw' ? undefined : liftVars(FIELD_LIFT[f])}>
                <label htmlFor={f}>{f !== 'bw' && <span className="sw" aria-hidden="true" />}{label}</label>
                <div className="box">
                  <input id={f} inputMode="decimal" autoComplete="off" value={text[f]}
                    aria-invalid={!!errs[f]} aria-describedby={`${f}-err`}
                    onChange={(e) => {
                      setText({ ...text, [f]: e.target.value })
                      if (errs[f]) setErrs({ ...errs, [f]: undefined }) // cleared on edit
                    }} />
                  <span className="unit">kg</span>
                </div>
                <div className="err" id={`${f}-err`}>{errs[f] ?? ''}</div>
              </div>
            ))}
          </div>

          <div className="choices">
            <div className="choice-group" role="group" aria-label="Sex">
              <span className="label">Sex</span>
              {(['m', 'f'] as Sex[]).map((v) => (
                <button type="button" key={v} className="choice" aria-pressed={sex === v} onClick={() => setSex(v)}>
                  {v === 'm' ? 'Men' : 'Women'}
                </button>
              ))}
            </div>
            <div className="choice-group" role="group" aria-label="Equipment">
              <span className="label">Equipment</span>
              {(Object.keys(EQUIP_LABEL) as Equip[]).map((v) => (
                <button type="button" key={v} className="choice" aria-pressed={eq === v} onClick={() => setEq(v)}>
                  {EQUIP_LABEL[v]}
                </button>
              ))}
            </div>
          </div>

          <div className="entry-foot">
            <div className="livetotal" aria-live="polite">
              {liveTotal !== null ? <>Total<b>{kg(liveTotal)} kg</b></> : 'Enter all three lifts'}
            </div>
            <button className="btn primary analyse" type="submit">See my verdict</button>
          </div>
        </div>

        <div className="statsrow">
          {stats ? (
            <>
              <span><b>{int(stats.results)}</b>results</span>
              <span><b>{int(stats.federations)}</b>federations</span>
              {/* Static, from docs/benchmarks.md -- not a live readout (spec 2.3). */}
              <span title="Hero query, benchmarked single-threaded over the full dataset"><b>8.8 ms</b>per comparison, benchmarked</span>
            </>
          ) : <span>&nbsp;</span>}
        </div>
      </div>
    </form>
  )
}
