import { useEffect, useRef, useState, type ReactNode } from 'react'

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Counts up from 0 on arrival (ms; 0 = start at the value), then glides between values (step) when
// something changes them, such as a what-if slider: short enough that a drag
// still feels immediate, long enough that the eye sees which way it moved.
// Each change starts from whatever is on screen, so fast drags never jump.
export function CountUp({ value, format, children, ms = 900, step = 240 }: {
  value: number
  ms?: number
  step?: number
} & ({ format: (v: number) => string; children?: undefined } | { format?: undefined; children: (v: number) => ReactNode })) {
  const still = useRef(reduced())
  const [shown, setShown] = useState(() => (still.current || ms === 0 ? value : 0))
  const cur = useRef(shown)
  const arrived = useRef(still.current || ms === 0)

  useEffect(() => {
    if (still.current) {
      cur.current = value
      setShown(value)
      return
    }
    const from = cur.current
    if (from === value) return
    const dur = arrived.current ? step : ms
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur)
      const v = from + (value - from) * (1 - Math.pow(1 - k, 3))
      cur.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(tick)
      else arrived.current = true
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms, step])

  // children renders the in-flight value, so parts like an ordinal suffix
  // stay in step with the number rather than jumping to the target's.
  return <>{children ? children(shown) : format!(shown)}</>
}

// Stagger index for the CSS animation helpers (.rise, .grow-y, ...).
export const i = (n: number) => ({ '--i': n }) as React.CSSProperties
