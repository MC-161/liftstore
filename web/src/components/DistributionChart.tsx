import { useId, useMemo, useRef, useState } from 'react'
import type { Cdf } from '../api/cdf'
import { kg, pctText } from '../lib/format'

// A histogram drawn as a smooth path through the bin midpoints (Catmull-Rom).
// That is presentation of real counts; it is not a fitted curve, and it is not
// labelled "normal". The sigma axis's percentages are read from the same bins
// (spec 3.2), never from a normal table. Hovering reads the same CDF.

type Props = {
  cdf: Cdf
  marker: number
  mean: number
  sd: number
  height?: number
  smoothing?: number // bins per smoothing window; the 2.5 kg bins are spiky
  extra?: { value: number; color: string; label: string }[] // further labelled markers
}

export function DistributionChart({ cdf, marker, mean, sd, height = 180, smoothing = 4, extra = [] }: Props) {
  const gid = useId().replace(/:/g, '')
  const box = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; v: number } | null>(null)

  const W = 400
  const H = height
  // The path depends only on the bins, not on the marker: built once per
  // SUBMIT, so a slider drag only moves two lines.
  const geom = useMemo(() => {
    if (cdf.empty) return null
    const lo = cdf.bins[0].low
    const hi = cdf.bins[cdf.bins.length - 1].high
    const x = (v: number) => ((v - lo) / (hi - lo)) * W
    // Moving-average over `smoothing` bins, so 2.5 kg bins (plate steps) don't
    // draw as a comb. Counts are only redistributed, never invented.
    const raw = cdf.bins.map((b) => b.count)
    const half = Math.floor(smoothing / 2)
    const smooth = raw.map((_, i) => {
      let s = 0, c = 0
      for (let j = i - half; j <= i + half; j++) if (j >= 0 && j < raw.length) { s += raw[j]; c++ }
      return s / c
    })
    const peak = Math.max(...smooth)
    const pts = cdf.bins.map((b, i) => [x((b.low + b.high) / 2), H - 8 - (smooth[i] / peak) * (H - 24)] as const)
    let d = `M${pts[0][0]},${pts[0][1]}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
      d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
    }
    const area = `${d} L${pts[pts.length - 1][0]},${H - 8} L${pts[0][0]},${H - 8} Z`
    return { lo, hi, x, d, area }
  }, [cdf, H, smoothing])

  if (!geom) return <div className="note">No results in this group.</div>
  const { lo, hi, x, d, area } = geom
  const mx = Math.max(0, Math.min(W, x(marker)))

  const marks = [-3, -2, -1, 0, 1, 2, 3].map((k) => {
    const v = mean + k * sd
    return { k, v, inRange: v >= lo && v <= hi, p: cdf.percentileAt(v) }
  })

  function onMove(e: React.MouseEvent) {
    const r = box.current!.getBoundingClientRect()
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    setHover({ x: fx * r.width, v: lo + fx * (hi - lo) })
  }

  return (
    <div>
      <div ref={box} className="chart" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ display: 'block', height: H }}>
          <defs>
            <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={`rest-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--text-3)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--text-3)" stopOpacity="0.02" />
            </linearGradient>
            <clipPath id={`clip-${gid}`}><rect x={0} y={0} width={mx} height={H} /></clipPath>
          </defs>
          <path d={area} fill={`url(#rest-${gid})`} className="fade-in" />
          {/* The same area, clipped at the lifter's total: "this much of the group is below you". */}
          <path d={area} fill={`url(#fill-${gid})`} clipPath={`url(#clip-${gid})`} className="fade-in" style={{ '--i': 2 } as React.CSSProperties} />
          <path d={d} fill="none" stroke="var(--text-3)" strokeWidth={1.25} vectorEffect="non-scaling-stroke"
            pathLength={1000} className="draw" />
          <line x1={x(mean)} x2={x(mean)} y1={8} y2={H - 8} stroke="var(--text-3)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <line x1={mx} x2={mx} y1={4} y2={H - 8} stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {extra.map((m) => {
            const ex = Math.max(0, Math.min(W, x(m.value)))
            return <line key={m.label} x1={ex} x2={ex} y1={4} y2={H - 8} stroke={m.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          })}
          {hover && (
            <line x1={(hover.x / box.current!.getBoundingClientRect().width) * W} x2={(hover.x / box.current!.getBoundingClientRect().width) * W}
              y1={4} y2={H - 8} stroke="var(--text-2)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          )}
          <line x1={0} x2={W} y1={H - 8} y2={H - 8} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        </svg>
        {extra.length > 0 && [{ value: marker, color: 'var(--accent)', label: 'You' }, ...extra].map((m, k) => (
          <div key={m.label} className="meta" style={{ fontWeight: 600,
            position: 'absolute', top: 2 + k * 16, left: `${(Math.max(0, Math.min(W, x(m.value))) / W) * 100}%`,
            transform: x(m.value) > W * 0.7 ? 'translateX(calc(-100% - 6px))' : 'translateX(6px)', color: m.color, whiteSpace: 'nowrap',
          }}>{m.label}</div>
        ))}
        {hover && (
          <div className="tip" style={{ left: hover.x, top: 20 }}>
            <b>{kg(hover.v)} kg</b> <span className="dim">· {pctText(cdf.percentileAt(hover.v))} percentile</span>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginTop: 8 }}>
        {marks.map((m) => (
          <div key={m.k} style={{ textAlign: 'center', opacity: m.inRange ? 1 : 0.4 }} title={`${kg(m.v)} kg`}>
            <div className="meta">{m.k === 0 ? 'mean' : `${m.k > 0 ? '+' : '−'}${Math.abs(m.k)} sd`}</div>
            <div className="meta" style={{ color: 'var(--text-2)' }}>{m.inRange ? `${m.p.toFixed(1)}%` : '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
