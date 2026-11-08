import type { Lift } from './format'

export type Lit = Record<Lift, number> // percentiles 0-100

// UI colour: the theme's variable, so light and dark each get a hue that
// passes contrast on their own surfaces (index.css defines both).
export const LIFT_COLOR: Record<Lift, string> = { squat: 'var(--squat)', bench: 'var(--bench)', deadlift: 'var(--deadlift)' }
export const liftVars = (l: Lift) => ({ '--lc': LIFT_COLOR[l] }) as React.CSSProperties

// Fixed hex for the share card: its PNG export rasterises the SVG outside
// the page, where var(--x) resolves to nothing. Tuned for its dark ground.
export const LIFT_HEX: Record<Lift, string> = { squat: '#2FD4C1', bench: '#9B87FF', deadlift: '#FF8A5B' }

// 0 = weakest of the three, 1 = strongest. All equal: everything mid.
export function relative(p: Lit): Record<Lift, number> {
  const vals = [p.squat, p.bench, p.deadlift]
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const r = (v: number) => (hi - lo < 1e-9 ? 0.5 : (v - lo) / (hi - lo))
  return { squat: r(p.squat), bench: r(p.bench), deadlift: r(p.deadlift) }
}

// How much of the lift's hue a muscle carries: the weakest lift a faint
// tint, the strongest the full colour. The lighting is the information.
export const strength = (t: number) => 0.2 + 0.8 * t
