import { leaderboard, type RankSpec, type WireLift } from '../api/endpoints'
import type { LeaderRow } from '../gen/engine_pb'
import { ErrorState, HeaderStrip, Loading } from '../components/Shell'
import { abbreviate, int, kg, pctText } from '../lib/format'
import { EQUIP_LABEL, classGroup, toQuery, type Inputs } from '../lib/inputs'
import { CountUp, i as stagger } from '../lib/motion'
import { useSubmit } from '../lib/useSubmit'
import { navigate } from '../router'

// The composer's state lives in the URL like everything else, every key
// prefixed "r" -- the lifter's own inputs already use s, b, d, bw, and an
// unprefixed `b` (second operand) overwrote their bench, which emptied the page:
//   /lb?...&rank=custom&ra=deadlift&ram=pct&rop=minus&rb=squat&rbm=pct&rdir=desc
type LiftKey = 'squat' | 'bench' | 'deadlift' | 'total'
type MetricKey = 'kg' | 'pct'
type OpKey = 'none' | 'minus' | 'plus' | 'ratio'
type PresetKey = 'top' | 'dots' | 'balanced' | 'custom'

type Composer = { rank: PresetKey; a: LiftKey; am: MetricKey; op: OpKey; b: LiftKey; bm: MetricKey; dir: 'desc' | 'asc'; all: boolean }

const LIFT_WIRE: Record<LiftKey, WireLift> = {
  squat: 'LIFT_KIND_SQUAT', bench: 'LIFT_KIND_BENCH', deadlift: 'LIFT_KIND_DEADLIFT', total: 'LIFT_KIND_TOTAL',
}
const OP_WIRE = { none: 'COMBINE_NONE', minus: 'COMBINE_MINUS', plus: 'COMBINE_PLUS', ratio: 'COMBINE_RATIO' } as const
const PRESETS: [PresetKey, string][] = [['top', 'Top total'], ['dots', 'Pound for pound'], ['balanced', 'Most balanced']]

// One unit for both sides: "bench kg minus squat percentile" has no meaning,
// and a ratio over a percentile explodes near 0 (x13,980 at the top of the
// board), so a ratio is always kg/kg.
function normalise(c: Composer): Composer {
  const am = c.op === 'ratio' ? 'kg' : c.am
  return { ...c, am, bm: am }
}

function readComposer(p: URLSearchParams): Composer {
  const pick = <T extends string>(k: string, allowed: readonly T[], d: T): T => {
    const v = p.get(k) as T | null
    return v && allowed.includes(v) ? v : d
  }
  const lifts = ['squat', 'bench', 'deadlift', 'total'] as const
  return normalise({
    rank: pick('rank', ['top', 'dots', 'balanced', 'custom'] as const, 'top'),
    a: pick('ra', lifts, 'deadlift'),
    am: pick('ram', ['kg', 'pct'] as const, 'pct'),
    op: pick('rop', ['none', 'minus', 'plus', 'ratio'] as const, 'minus'),
    b: pick('rb', lifts, 'squat'),
    bm: pick('rbm', ['kg', 'pct'] as const, 'pct'),
    dir: pick('rdir', ['desc', 'asc'] as const, 'desc'),
    all: p.get('rall') === '1',
  })
}

function toSpec(c: Composer): RankSpec {
  switch (c.rank) {
    case 'top': return { preset: 'RANK_PRESET_TOP_TOTAL' }
    case 'dots': return { preset: 'RANK_PRESET_DOTS' }
    case 'balanced': return { preset: 'RANK_PRESET_BALANCED' }
    case 'custom':
      return {
        preset: 'RANK_PRESET_CUSTOM',
        a: { lift: LIFT_WIRE[c.a], metric: c.am === 'kg' ? 'METRIC_KG' : 'METRIC_PERCENTILE' },
        combine: OP_WIRE[c.op],
        b: { lift: LIFT_WIRE[c.b], metric: c.bm === 'kg' ? 'METRIC_KG' : 'METRIC_PERCENTILE' },
        ascending: c.dir === 'asc',
      }
  }
}

const term = (l: LiftKey, m: MetricKey) => `${l} ${m === 'kg' ? 'kg' : 'percentile'}`
function describe(c: Composer): string {
  switch (c.rank) {
    case 'top': return 'Ranked by best total, highest first.'
    case 'dots': return 'Ranked by DOTS, bodyweight-adjusted total, highest first.'
    case 'balanced': return 'Ranked by the spread between the best and worst lift percentile, smallest first.'
    case 'custom': {
      const ops = { none: '', minus: ' minus ', plus: ' plus ', ratio: ' divided by ' }
      const expr = c.op === 'none' ? term(c.a, c.am) : `${term(c.a, c.am)}${ops[c.op]}${term(c.b, c.bm)}`
      return `Ranked by ${expr}, ${c.dir === 'desc' ? 'highest' : 'lowest'} first.`
    }
  }
}

// The score in the units it was computed in.
function formatScore(c: Composer, v: number): string {
  if (c.rank === 'top') return `${kg(v)}`
  if (c.rank === 'dots') return v.toFixed(1)
  if (c.rank === 'balanced') return `${v.toFixed(1)} pts`
  if (c.op === 'ratio') return `×${v.toFixed(2)}`
  const pct = c.am === 'pct' && (c.op === 'none' || c.bm === 'pct')
  if (c.op === 'none') return pct ? pctText(v) : `${kg(v)}`
  const sign = v >= 0 ? '+' : '−'
  return pct ? `${sign}${Math.abs(v).toFixed(1)} pts` : `${sign}${kg(Math.abs(v))}`
}
const scoreUnit = (c: Composer) =>
  c.rank === 'top' || (c.rank === 'custom' && c.op !== 'ratio' && c.am === 'kg' && (c.op === 'none' || c.bm === 'kg')) ? 'kg' : ''

async function load(i: Inputs, c: Composer) {
  const t0 = performance.now()
  const res = await leaderboard(classGroup(i), toSpec(c), { squat: i.s, bench: i.b, deadlift: i.d, bodyweight: i.bw }, 10, c.all)
  return { res, ms: performance.now() - t0 }
}

export function Leaderboards({ inputs, params }: { inputs: Inputs; params: URLSearchParams }) {
  const c = readComposer(params)
  const key = `${toQuery(inputs)}|${JSON.stringify(c)}`
  const res = useSubmit(key, () => load(inputs, c))

  const set = (patch: Partial<Composer>) => {
    const next = normalise({ ...c, ...patch })
    navigate(`/lb?${toQuery(inputs, {
      rank: next.rank, ra: next.a, ram: next.am, rop: next.op, rb: next.b, rbm: next.bm, rdir: next.dir,
      ...(next.all ? { rall: '1' } : {}),
    })}`, true)
  }

  return (
    <>
      <HeaderStrip inputs={inputs} />
      <main className="main">
        <h1 className="large">Who’s ahead, and how.</h1>
        <p className="subtitle">
          {res.state === 'ok' ? `${res.data.res.weightClass} kg class · ` : ''}{EQUIP_LABEL[inputs.eq].toLowerCase()} · {inputs.sex === 'm' ? 'men' : 'women'}
          {res.state === 'ok' && ` · ${int(res.data.res.lifters)} lifters ranked`}
        </p>

        <div className="composer panel">
          <span className="label">Rank by</span>
          {/* Always shows the custom rule; under a preset it's dimmed, and
              touching any part of it switches to custom. */}
          <Select value={c.a} dim={c.rank !== 'custom'} options={['squat', 'bench', 'deadlift', 'total']}
            onChange={(v) => set({ rank: 'custom', a: v as LiftKey })} />
          <Select value={c.op} dim={c.rank !== 'custom'} options={['minus', 'plus', 'ratio', 'none']}
            labels={{ minus: 'minus', plus: 'plus', ratio: 'divided by', none: '(alone)' }}
            onChange={(v) => set({ rank: 'custom', op: v as OpKey })} />
          {c.op !== 'none' && (
            <>
              <Select value={c.b} dim={c.rank !== 'custom'} options={['squat', 'bench', 'deadlift', 'total']}
                onChange={(v) => set({ rank: 'custom', b: v as LiftKey })} />
            </>
          )}
          <span className="label faint">IN</span>
          <Select value={c.am} dim={c.rank !== 'custom'} options={c.op === 'ratio' ? ['kg'] : ['pct', 'kg']}
            labels={{ pct: 'percentiles', kg: 'kg' }}
            onChange={(v) => set({ rank: 'custom', am: v as MetricKey })} />
          <Select value={c.dir} dim={c.rank !== 'custom'} options={['desc', 'asc']} labels={{ desc: 'highest first', asc: 'lowest first' }}
            onChange={(v) => set({ rank: 'custom', dir: v as 'desc' | 'asc' })} />
          <button className="choice" aria-pressed={c.rank === 'custom'} onClick={() => set({ rank: 'custom' })}>
            {c.rank === 'custom' ? 'Custom' : 'Use this rule'}
          </button>

          <span className="presets">
            <span className="label">Presets</span>
            {PRESETS.map(([k, label]) => (
              <button key={k} className="choice" aria-pressed={c.rank === k} onClick={() => set({ rank: k })}>{label}</button>
            ))}
          </span>
        </div>
        <div className="kv" style={{ marginTop: 12, gap: 16, flexWrap: 'wrap' }}>
          <span className="dim">{describe(c)}</span>
          <label className="toggle">
            <input type="checkbox" checked={!c.all} onChange={(e) => set({ all: !e.target.checked })} />
            <span className="track" aria-hidden />
            <span>Hide implausible lines</span>
            {res.state === 'ok' && !c.all && res.data.res.hidden > 0 && (
              <span className="meta">· {int(res.data.res.hidden)} hidden</span>
            )}
          </label>
        </div>

        {res.state === 'loading' && <Loading />}
        {res.state === 'error' && <ErrorState error={res.error} />}
        {res.state === 'ok' && <Board inputs={inputs} c={c} rows={res.data.res.rows} you={res.data.res.you}
          lifters={res.data.res.lifters} hidden={res.data.res.hidden} ms={res.data.ms} />}
      </main>
    </>
  )
}

function Select({ value, options, labels, onChange, dim }: {
  value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void; dim?: boolean
}) {
  return (
    <select className={`select${dim ? ' dimmed' : ''}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
    </select>
  )
}

function Board({ inputs, c, rows, you, lifters, hidden, ms }: {
  inputs: Inputs; c: Composer; rows: LeaderRow[]; you: LeaderRow | undefined; lifters: number; hidden: number; ms: number
}) {
  // "You" slots in at your rank if that's inside the board, otherwise it
  // sits under it with the rank you'd hold.
  const youAt = you && you.rank <= rows.length ? you.rank - 1 : rows.length
  const lines: (LeaderRow | 'you')[] = [...rows]
  if (you) lines.splice(youAt, 0, 'you')
  const compare = (name: string) => navigate(`/h2h?${toQuery(inputs, { vs: name })}`)
  const unit = scoreUnit(c)
  const custompct = c.rank === 'custom' && (c.am === 'pct' || c.bm === 'pct')

  return (
    <>
      <h2 className="sr-only">Rankings</h2>
      <div className="board">
        <div className="board-head">
          <span>Rank</span><span>Lifter · lifts from their best total</span><span style={{ textAlign: 'right' }}>Score</span>
        </div>
        {lines.map((r, k) => r === 'you' ? (
          <div key="you" className="board-row you rise" style={stagger(k)}>
            <span className="rank">{you!.rank <= rows.length ? `#${you!.rank}` : '—'}</span>
            <span>
              <span className="who">You <span className="badge">You would rank #{int(you!.rank)}</span></span>
              <span className="lifts">Squat {kg(you!.squat)} · bench {kg(you!.bench)} · deadlift {kg(you!.deadlift)} · total {kg(you!.total)}</span>
            </span>
            <span className="score accent">
              {custompct && <span className="sub">squat {pctText(you!.squatPct)} · bench {pctText(you!.benchPct)} · deadlift {pctText(you!.deadliftPct)}</span>}
              <CountUp value={you!.score} format={(v) => formatScore(c, v)} />{unit && <span className="unit">{unit}</span>}
            </span>
          </div>
        ) : (
          <button type="button" key={r.name} className="board-row rise" style={stagger(k)}
            title={`${r.name} · ${r.federation} · ${r.date}`} aria-label={`Compare with ${r.name}, rank ${r.rank}`}
            onClick={() => compare(r.name)}>
            <span className="rank">#{r.rank}</span>
            <span>
              <span className="who">{abbreviate(r.name)} <span className="compare">Compare →</span></span>
              <span className="lifts">Squat {kg(r.squat)} · bench {kg(r.bench)} · deadlift {kg(r.deadlift)} · total {kg(r.total)} · bodyweight {kg(r.bodyweight)}</span>
            </span>
            <span className="score">
              {custompct && <span className="sub">squat {pctText(r.squatPct)} · bench {pctText(r.benchPct)} · deadlift {pctText(r.deadliftPct)}</span>}
              <CountUp value={r.score} format={(v) => formatScore(c, v)} />{unit && <span className="unit">{unit}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="kv" style={{ marginTop: 14 }}>
        <span className="dim">Ranked across {int(lifters)} lifters in this class{ms >= 2 ? ` · ${Math.round(ms)} ms round trip` : ' · cached'}</span>
        <span className="meta">One line per lifter: their best-total result</span>
      </div>
      <p className="note">
        {c.all
          ? 'Showing every line, including ones where a single lift is under 15% of the total — usually a mis-recorded meet.'
          : `${int(hidden)} lifter${hidden === 1 ? '' : 's'} hidden because one lift on their best total is under 15% of it — almost always a mis-recorded meet (a 25 kg squat beside a 292.5 kg deadlift). Your own line is never hidden.`}
        {custompct && ' Percentiles are against every result in this class.'}
      </p>
    </>
  )
}
