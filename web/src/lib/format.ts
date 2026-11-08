export const kg = (v: number) => v.toFixed(1)

export function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
}

// A percentile counts results strictly below, so it is FLOORED for display:
// 86.9 reads "86th", never rounded up into a rank the lifter didn't reach.
// Above 99, one decimal, or the whole top 1% reads "99th".
// Under 1: "<1st". Floored to "0th" it reads as a bug, and 0.3% is not zero.
export function pctNumber(p: number): string {
  if (p < 1) return '<1'
  if (p >= 99 && p < 100) return (Math.floor(p * 10) / 10).toFixed(1)
  return String(Math.floor(p))
}
export function pctSuffix(p: number): string {
  if (p < 1) return 'st'
  if (p >= 99 && p < 100) return 'th'
  return ordinal(Math.floor(p))
}
export const pctText = (p: number) => `${pctNumber(p)}${pctSuffix(p)}`

export const int = (n: number) => n.toLocaleString('en-GB')

// "Marcus Kjellberg" -> "M. Kjellberg"; full name stays in title=.
export function abbreviate(name: string): string {
  const parts = name.split(' ')
  if (parts.length < 2) return name
  const tail = parts.slice(1).join(' ')
  return `${parts[0][0]}. ${tail}`
}

export const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`

export function tier(p: number): string {
  if (p < 40) return 'Novice'
  if (p < 70) return 'Intermediate'
  if (p < 90) return 'Advanced'
  return 'Elite'
}

export const LIFTS = ['squat', 'bench', 'deadlift'] as const
export type Lift = (typeof LIFTS)[number]
export const LIFT_LABEL: Record<Lift, string> = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' }
export const LIFT_WIRE = {
  squat: 'LIFT_KIND_SQUAT', bench: 'LIFT_KIND_BENCH', deadlift: 'LIFT_KIND_DEADLIFT',
} as const
