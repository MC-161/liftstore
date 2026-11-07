// The group's empirical CDF, built once per SUBMIT from Distribution's bins.
// Everything LIVE (sliders, projections, the figure's lighting) is a lookup in
// this, so a drag never touches the network (spec 5.2).
//
// Linear within a bin. The server's own percentile counts strictly below with
// no interpolation, so on SUBMIT the screens show the server's number and only
// the live, dragged values come from here.

export type Bin = { low: number; high: number; count: number }

export class Cdf {
  readonly bins: Bin[]
  readonly cumulative: number[] // prefix sums, length bins.length + 1
  readonly n: number

  constructor(bins: Bin[]) {
    this.bins = bins
    this.cumulative = [0]
    for (const b of bins) this.cumulative.push(this.cumulative[this.cumulative.length - 1] + b.count)
    this.n = this.cumulative[this.cumulative.length - 1]
  }

  get empty() {
    return this.n === 0
  }

  percentileAt(value: number): number {
    if (this.empty) return 0
    const first = this.bins[0]
    const last = this.bins[this.bins.length - 1]
    if (value <= first.low) return 0
    if (value >= last.high) return 100
    // Bins are contiguous and equal-width (q4.sh checks both), so direct index.
    const width = first.high - first.low
    const i = Math.min(this.bins.length - 1, Math.floor((value - first.low) / width))
    const b = this.bins[i]
    const below = this.cumulative[i] + ((value - b.low) / width) * b.count
    return (100 * below) / this.n
  }

  valueAt(pct: number): number {
    if (this.empty) return 0
    const target = (Math.min(100, Math.max(0, pct)) / 100) * this.n
    let i = 0
    while (i < this.bins.length - 1 && this.cumulative[i + 1] < target) i++
    const b = this.bins[i]
    const frac = b.count === 0 ? 0 : (target - this.cumulative[i]) / b.count
    return b.low + frac * (b.high - b.low)
  }

  get binWidth() {
    return this.empty ? 0 : this.bins[0].high - this.bins[0].low
  }
}
