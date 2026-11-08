import type { Cdf } from '../api/cdf'
import type { ConditionalPercentileResponse } from '../gen/engine_pb'
import { int, kg, pctText, type Lift } from '../lib/format'
import { EQUIP_LABEL, type Inputs } from '../lib/inputs'
import { liftVars } from '../lib/lifts'

// The verdict, said the way a lifter would ask it: "is my bench weak for
// someone like me?" Counts instead of percentiles, the group named once,
// the spread drawn, and one thing to aim for.

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

  if (cond.n === 0) {
    return <h1 className="sentence">Nobody in the data {strongest}s {kg(cv)} kg with a recorded {weakest}.</h1>
  }

  const word = <span className="hl" style={liftVars(weakest)}>{weakest}</span>
  const headline = share < 0.25
    ? <>Your {word} is what’s holding you back.</>
    : share < 0.45
      ? <>Your {word} is a little behind.</>
      : <>Your lifts are in balance.</>

  // What closing the gap is worth: the total with the typical number swapped
  // in, read off the class's total distribution (local, interpolated).
  const gap = cond.targetMedian - mine
  const newPct = totalCdf.percentileAt(inputs.s + inputs.b + inputs.d + gap)
  const group = [
    cond.allClasses ? 'all weight classes' : `${classLabel} kg`,
    EQUIP_LABEL[inputs.eq].toLowerCase(),
    inputs.sex === 'm' ? 'men' : 'women',
    `${strongest} ${kg(cv - cond.tolUsed)}–${kg(cv + cond.tolUsed)} kg`,
    `${int(cond.n)} results`,
    `${pctText(cond.percentile)} percentile`,
  ].join(' · ')

  return (
    <div className="statement">
      <h1 className="sentence">{headline}</h1>
      <p className="sentence-sub">
        {who} who {strongest} about <b>{kg(cv)} kg</b> usually {weakest} around <b>{kg(cond.targetMedian)} kg</b>.
        You {weakest} <b>{kg(mine)} kg</b>, {frequency(cond.below, cond.n, weakest)}.
      </p>

      <Strip cond={cond} mine={mine} lift={weakest} />
      <p className="group-line">{group}</p>
      {cond.allClasses && (
        <p className="group-line">Too few {classLabel} kg results at this {strongest} to compare fairly, so the group spans every class.</p>
      )}

      {gap > 0 && (
        <p className="target">
          {weakest[0].toUpperCase() + weakest.slice(1)} <b>{kg(cond.targetMedian)} kg</b> and your total moves from the{' '}
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
  const W = 600, base = 58
  const lo = Math.min(bins[0].low, mine - 5)
  const hi = Math.max(bins[bins.length - 1].high, mine + 5)
  const x = (v: number) => ((v - lo) / (hi - lo)) * W
  const peak = Math.max(...bins.map((b) => b.count))
  const mx = x(mine)
  const md = x(cond.targetMedian)
  const near = Math.abs(mx - md) < 80
  return (
    <svg className="lift-strip" style={liftVars(lift)} viewBox={`0 0 ${W} 82`} width="100%" role="img"
      aria-label={`${lift} across the group: typically ${cond.targetMedian} kg, yours ${mine} kg`}>
      {bins.map((b, k) => {
        const h = Math.max(1, (b.count / peak) * 34)
        return <rect key={b.low} className="grow-y" style={{ '--i': k } as React.CSSProperties}
          x={x(b.low) + 0.5} y={base - h} width={Math.max(1, x(b.high) - x(b.low) - 1)} height={h}
          fill="var(--lc)" opacity={0.42} rx={1} />
      })}
      <line x1={0} x2={W} y1={base} y2={base} stroke="var(--line)" />
      <line x1={md} x2={md} y1={18} y2={base} stroke="var(--text-3)" strokeDasharray="2 3" />
      <text x={md} y={75} fontSize={12} fill="var(--text-3)" textAnchor="middle">Typical {kg(cond.targetMedian)}</text>
      <circle cx={mx} cy={base} r={6} fill="var(--text)" stroke="var(--surface)" strokeWidth={2} />
      <text x={mx} y={near ? 11 : 75} fontSize={12} fill="var(--text)" textAnchor="middle" fontWeight={600}>You {kg(mine)}</text>
    </svg>
  )
}
