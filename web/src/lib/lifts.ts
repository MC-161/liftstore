import type { Lift } from './format'

export type Lit = Record<Lift, number> // percentiles 0-100

// Hex, not CSS variables: the share card's PNG export draws outside the page.
// Must match --squat / --bench / --deadlift in index.css.
export const LIFT_HEX: Record<Lift, string> = { squat: '#2FD4C1', bench: '#8F7BFF', deadlift: '#FF7A59' }
export const LIFT_GLOW: Record<Lift, string> = {
  squat: 'var(--squat-glow)', bench: 'var(--bench-glow)', deadlift: 'var(--deadlift-glow)',
}
export const liftVars = (l: Lift) => ({ '--lc': LIFT_HEX[l], '--lg': LIFT_GLOW[l] }) as React.CSSProperties

// 0 = weakest of the three, 1 = strongest. All equal: everything mid.
export function relative(p: Lit): Record<Lift, number> {
  const vals = [p.squat, p.bench, p.deadlift]
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const r = (v: number) => (hi - lo < 1e-9 ? 0.5 : (v - lo) / (hi - lo))
  return { squat: r(p.squat), bench: r(p.bench), deadlift: r(p.deadlift) }
}

const DARK = [0x23, 0x27, 0x30]
const WHITE = [0xf5, 0xf5, 0xf7]
const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))
function mix(a: number[], b: number[], t: number) {
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

// Weakest lift: barely lit, a dark tint of its hue. Strongest: the hue pushed
// toward white. The lighting is the information; the hue says which lift.
export function shade(lift: Lift, t: number): string {
  const hue = rgb(LIFT_HEX[lift])
  if (t < 0.6) return mix(DARK, hue, 0.18 + (t / 0.6) * 0.82)
  return mix(hue, WHITE, ((t - 0.6) / 0.4) * 0.35)
}
