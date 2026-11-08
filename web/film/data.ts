// Every number the film shows, fetched live from the engine for one lifter.
import { Cdf } from '../src/api/cdf'
import {
  attempts, classChange, classSweep, conditionalPercentile, datasetStats, distribution, lifterByName, percentile,
} from '../src/api/endpoints'
import { LIFT_WIRE, LIFTS, type Lift } from '../src/lib/format'
import { CLASS_COUNT, classBodyweight, classGroup, className, group, ipfClassIndex, total, type Inputs } from '../src/lib/inputs'
import type { Lit } from '../src/lib/lifts'

export const LIFTER: Inputs = { s: 210, b: 140, d: 260, bw: 82.4, sex: 'm', eq: 'raw' }
export const RIVAL = 'John Haack'
const WHAT_IF = 10 // kg added to the weak lift in the what-if scene
const JUMPS = [2.5, 5, 7.5, 10, 12.5]

const value = (i: Inputs, l: Lift) => (l === 'squat' ? i.s : l === 'bench' ? i.b : i.d)

export async function loadFilmData() {
  const i = LIFTER
  const g = group(i)
  const cg = classGroup(i)
  const t = total(i)
  const own = ipfClassIndex(i.sex, i.bw)

  const [ps, pb, pd, pt, stats, dt, sweep, down, dists, rival] = await Promise.all([
    percentile(g, i.bw, 'LIFT_KIND_SQUAT', i.s),
    percentile(g, i.bw, 'LIFT_KIND_BENCH', i.b),
    percentile(g, i.bw, 'LIFT_KIND_DEADLIFT', i.d),
    percentile(g, i.bw, 'LIFT_KIND_TOTAL', t),
    datasetStats(),
    distribution(cg, 'LIFT_KIND_TOTAL'),
    classSweep(g, 'LIFT_KIND_TOTAL', t),
    classChange(g, -1),
    Promise.all(Array.from({ length: CLASS_COUNT }, (_, c) => distribution(classGroup(i, c), 'LIFT_KIND_TOTAL'))),
    lifterByName(g, RIVAL, own),
  ])

  const lit: Lit = { squat: ps.percentile, bench: pb.percentile, deadlift: pd.percentile }
  const order = [...LIFTS].sort((a, b) => lit[a] - lit[b])
  const weakest = order[0]
  const strongest = order[2] === weakest ? order[1] : order[2]
  const [cond, att, weakAfter, totalAfter] = await Promise.all([
    conditionalPercentile(g, LIFT_WIRE[strongest], value(i, strongest), LIFT_WIRE[weakest], value(i, weakest), cg.ipf_class),
    attempts(cg, LIFT_WIRE[weakest]),
    percentile(g, i.bw, LIFT_WIRE[weakest], value(i, weakest) + WHAT_IF),
    percentile(g, i.bw, 'LIFT_KIND_TOTAL', t + WHAT_IF),
  ])

  // The verdict's target line, as the app computes it.
  const totalCdf = new Cdf(dt.bins)
  const gap = cond.targetMedian - value(i, weakest)
  const targetPct = totalCdf.percentileAt(t + gap)

  // Weight classes, as the Weight class screen computes them (measured rate).
  const loss = Math.round(down.medianTotalPerBwKg * 10) / 10
  const cdfs = dists.map((d) => new Cdf(d.bins))
  const classes = sweep.rows.map((r, c) => {
    const n = r.summary?.n ?? 0
    const projected = t - (i.bw - classBodyweight(i.sex, c, i.bw)) * loss
    const pct = n === 0 ? null : c === own && r.hasPercentile ? r.percentile : cdfs[c].percentileAt(projected)
    return { c, label: className(i.sex, c), n, projected, pct }
  })
  const eligible = classes.filter((r) => r.pct !== null && r.n >= 500 && Math.abs(r.c - own) <= 1)
  const best = eligible.reduce<number | null>((a, r) => (a === null || r.pct! > classes[a].pct! ? r.c : a), null)

  // Third attempts for the weak lift, as the Attempts screen computes them.
  const cards = JUMPS.map((j) => {
    const b = att.jumpBins.find((x) => Math.abs(x.low - j) < 1e-3)
    return { j, count: b?.count ?? 0, rate: b && b.count > 0 ? b.successes / b.count : null }
  })
  const pick = [...cards].reverse().find((c) => c.rate !== null && c.count >= 30 && c.rate >= 0.6)?.j ?? null

  return {
    inputs: i, total: t, own, lit, totalPct: pt.percentile, weakest, strongest, cond, gap, targetPct,
    stats, whatIf: { add: WHAT_IF, weakPct: weakAfter.percentile, totalPct: totalAfter.percentile },
    classes, best, loss, downLifters: down.lifters, cards, pick, attemptsN: att.n,
    rival: { name: rival.name, squat: rival.squat, bench: rival.bench, deadlift: rival.deadlift, total: rival.total, bw: rival.bodyweight },
    weakValue: value(i, weakest), strongValue: value(i, strongest),
  }
}

export type FilmData = Awaited<ReturnType<typeof loadFilmData>>
