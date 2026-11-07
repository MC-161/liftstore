import type { Sex } from './inputs'

// DOTS, mirroring dots_score() in src/leaderboard.cpp (which reproduces the
// dataset's Dots column). tests/leaderboard.sh pins 610 kg @ 82.4 kg = 413.49.
export function dots(sex: Sex, bodyweight: number, total: number): number {
  const men = sex === 'm'
  const bw = Math.min(Math.max(bodyweight, 40), men ? 210 : 150)
  const [a, b, c, d, e] = men
    ? [-0.000001093, 0.0007391293, -0.1918759221, 24.0900756, -307.75076]
    : [-0.0000010706, 0.0005158568, -0.1126655495, 13.6175032, -57.96288]
  return (total * 500) / ((((a * bw + b) * bw + c) * bw + d) * bw + e)
}
