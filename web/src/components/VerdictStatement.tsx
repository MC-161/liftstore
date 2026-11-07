import type { Cdf } from '../api/cdf'
import type { ConditionalPercentileResponse } from '../gen/engine_pb'
import { int, kg, pctText, type Lift } from '../lib/format'
import { EQUIP_LABEL, type Inputs } from '../lib/inputs'
import { LIFT_HEX } from '../lib/lifts'
import { i as stagger } from '../lib/motion'

// The verdict, said the way a lifter would ask it: "is my bench weak for
// someone like me?" Counts instead of percentiles, the group named, the
// spread drawn, and one thing to aim for.

type Props = {
  inputs: Inputs
  strongest: Lift
  weakest: Lift
  cond: ConditionalPercentileResponse
  classLabel: string
  totalCdf: Cdf
  totalPct: number // server percentile of the current total, in the class
}

const value = (i: Inputs, l: Lift) => (l === 'squat' ? i.s : l === 'bench' ? i.b : i.d)

// "Less than all 3,272 of them" reads; "below the 1st percentile" doesn't.
function frequency(below: number, n: number, verb: string): string {
  if (below === 0) return `less than all ${int(n)} of them`
  if (below === n) return `more than all ${int(n)} of them`
  const k = Math.round((100 * below) / n)
  if (k < 1) return `fewer than 1 in 100 of them ${verb} less`
  if (k > 99) return `more than 99 in 100 of them`
  return `${k} in 100 of them ${verb} less`
}

export function VerdictStatement({ inputs, strongest, weakest, cond, classLabel, totalCdf, totalPct }: Props) {
  const mine = value(inputs, weakest)
  const cv = value(inputs, strongest)
  const share = cond.n > 0 ? cond.below / cond.n : 0
  const who = cond.allClasses ? 'Lifters' : 'Lifters your size'
  const sex = inputs.sex === 'm' ? 'MEN' : 'WOMEN'

  if (cond.n === 0) {
    return <p className="sentence rise">Nobody in the data {strongest}s {kg(cv)} kg with a recorded {weakest}.</p>
  }

  const headline = share < 0.25
    ? <>Your <span className="accent">{weakest}</span> is what’s holding you back.</>
    : share < 0.45
      ? <>Your <span className="accent">{weakest}</span> is a little behind.</>
      : <>Your lifts are <span className="accent">in balance</span>.</>

  // What closing the gap is worth: the total with the typical number swapped
  // in, read off the class's total distribution (local, interpolated).
  const gap = cond.targetMedian - mine
  const newTotal = inputs.s + inputs.b + inputs.d + gap
  const newPct = totalCdf.percentileAt(newTotal)

  return (
    <div className="statement">
      <p className="sentence rise" style={stagger(3)}>{headline}</p>
      <p className="sentence-sub rise" style={stagger(4)}>
        {who} who {strongest} about <b>{kg(cv)} kg</b> usually {weakest} around <b>{kg(cond.targetMedian)} kg</b>.
        You {weakest} <b>{kg(mine)} kg</b> — {frequency(cond.below, cond.n, weakest)}.
      </p>

      <Strip cond={cond} mine={mine} lift={weakest} />

      <div className="chip-row rise" style={stagger(6)}>
        <span className="chip">{cond.allClasses ? 'ALL CLASSES' : `${classLabel} KG`}</span>
        <span className="chip">{EQUIP_LABEL[inputs.eq]}</span>
        <span className="chip">{sex}</span>
        <span className="chip">{strongest.toUpperCase()} {kg(cv - cond.tolUsed)}–{kg(cv + cond.tolUsed)} KG</span>
        <span className="chip">{int(cond.n)} RESULTS</span>
        <span className="chip faint" title="Share of the group lifting strictly less">{pctText(cond.percentile).toUpperCase()} PERCENTILE</span>
      </div>
      {cond.allClasses && (
        <div className="note" style={{ textAlign: 'center' }}>
          Too few {classLabel} kg results at this {strongest} to compare fairly, so this group spans every weight class.
        </div>
      )}

      {gap > 0 && (
        <p className="target rise" style={stagger(7)}>
          {weakest[0].toUpperCase() + weakest.slice(1)} <b>{kg(cond.targetMedian)} kg</b> and your total goes from the{' '}
          <b>{pctText(totalPct)}</b> to about the <b>{pctText(newPct)}</b> percentile in your class.
        </p>
      )}
    </div>
  )
}

// The weak lift across the group, as a strip of 5 kg bins, with the typical
// value ticked and the lifter's own number as a dot.
function Strip({ cond, mine, lift }: { cond: ConditionalPercentileResponse; mine: number; lift: Lift }) {
  const bins = cond.targetBins
  if (bins.length === 0) return null
  const W = 600, H = 70, base = 46
  const lo = Math.min(bins[0].low, mine - 5)
  const hi = Math.max(bins[bins.length - 1].high, mine + 5)
  const x = (v: number) => ((v - lo) / (hi - lo)) * W
  const peak = Math.max(...bins.map((b) => b.count))
  const color = LIFT_HEX[lift]
  const mx = x(mine)
  const md = x(cond.targetMedian)
  const near = Math.abs(mx - md) < 70
  return (
    <svg className="lift-strip rise" style={stagger(5)} viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`${lift} of the group: typical ${cond.targetMedian} kg, yours ${mine} kg`}>
      {bins.map((b) => {
        const h = Math.max(1, (b.count / peak) * 34)
        return <rect key={b.low} className="grow-y" x={x(b.low) + 0.5} y={base - h} width={Math.max(1, x(b.high) - x(b.low) - 1)} height={h}
          fill={color} opacity={0.45} rx={1} />
      })}
      <line x1={0} x2={W} y1={base} y2={base} stroke="var(--line)" />
      <line x1={md} x2={md} y1={6} y2={base} stroke="var(--text-dim)" strokeDasharray="2 3" />
      <text x={md} y={62} fontSize={11} fill="var(--text-dim)" textAnchor="middle" letterSpacing="0.08em">
        USUALLY {kg(cond.targetMedian)}
      </text>
      <circle cx={mx} cy={base} r={6} fill="var(--text)" stroke="var(--bg)" strokeWidth={2} />
      <text x={mx} y={near ? 14 : 62} fontSize={11} fill="var(--text)" textAnchor="middle" letterSpacing="0.08em" fontWeight={600}>
        YOU {kg(mine)}
      </text>
    </svg>
  )
}
