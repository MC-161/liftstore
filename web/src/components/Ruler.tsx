// A percentile as a ruler: 25 ticks, one per 4 points, lit up to the value.
// The tick the value falls in stands taller and carries the number, so the
// eye reads the position, not just a colour. Dark ticks are what's left.
// No transition: sliders drive it, and it must move in the same frame.

const TICKS = 25

export function Ruler({ pct, color }: { pct: number; color: string }) {
  const p = Math.max(0, Math.min(100, pct))
  const at = Math.min(TICKS - 1, Math.floor((p / 100) * TICKS))
  return (
    <div className="ruler" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}
      aria-label={`${Math.floor(p)}th percentile`}>
      {Array.from({ length: TICKS }, (_, k) => (
        <i key={k} className={k === at ? 'here' : k < at ? 'lit' : undefined}
          style={k <= at ? { background: color } : undefined} />
      ))}
      <span className="ruler-ends"><span>0</span><span>50</span><span>100</span></span>
    </div>
  )
}
