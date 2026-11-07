import { useEffect, useRef, useState } from 'react'

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Counts up from 0 on first render only. After that it shows `value` as-is,
// so a slider driving it updates in the same frame -- the arrival animates,
// a drag never does.
export function CountUp({ value, format, ms = 900 }: { value: number; format: (v: number) => string; ms?: number }) {
  const [shown, setShown] = useState(() => (reduced() ? value : 0))
  const done = useRef(reduced())
  const target = useRef(value)
  target.current = value

  useEffect(() => {
    if (done.current) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setShown(target.current * e)
      if (k < 1) raf = requestAnimationFrame(tick)
      else done.current = true
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ms])

  return <>{format(done.current ? value : shown)}</>
}

// Stagger index for the CSS animation helpers (.rise, .grow-y, ...).
export const i = (n: number) => ({ '--i': n }) as React.CSSProperties
