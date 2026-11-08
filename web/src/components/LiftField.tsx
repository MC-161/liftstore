import { useEffect, useRef } from 'react'

// Entry-page background: a dotted ground plane seen in perspective, with
// three bell-curve hills rising out of it, one per lift, drifting slowly.
// Dots on a hill take that lift's colour; the plane fades into a horizon.
// The hills grow from flat on load, and the pointer lifts the dots under it.
// Colours come from the theme tokens and are re-read when the theme flips.
// Reduced motion gets one still frame with no pointer response.
const LIFTS = ['--squat', '--bench', '--deadlift'] as const
type RGB = [number, number, number]

function rgb(hex: string): RGB {
  const h = hex.trim().replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function readColours() {
  const cs = getComputedStyle(document.documentElement)
  return { base: rgb(cs.getPropertyValue('--text-3')), lifts: LIFTS.map((v) => rgb(cs.getPropertyValue(v))) }
}

// World units: x across, z into the screen (NEAR..FAR), y up. Each hill
// wanders on its own loop; periods differ so the three never sync.
const NEAR = 1, FAR = 9, CAM = 1.15
const HILLS = [
  { x: -1.95, z: 3.6, ax: 0.35, az: 0.9, px: 41, pz: 53, ph: 0, amp: 1.05 },
  { x: 2.0, z: 4.2, ax: 0.4, az: 1.1, px: 47, pz: 37, ph: 2.1, amp: 1.3 },
  { x: 1.25, z: 2.7, ax: 0.5, az: 0.3, px: 59, pz: 67, ph: 4.2, amp: 0.5 },
]
const SIGMA = 0.85

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)

export function LiftField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let colours = readColours()
    let w = 0, h = 0, raf = 0, cols = 0, rows = 0
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fine = window.matchMedia('(pointer: fine)')
    const t0 = performance.now()
    const ptr = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, on: 0, ton: 0 }
    const k = 1 / (2 * SIGMA * SIGMA)

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.round(Math.min(96, Math.max(36, w / 17)))
      rows = Math.round(Math.min(44, Math.max(26, h / 22)))
    }

    function draw(now: number, settled = false) {
      const t = (now - t0) / 1000
      const grow = settled ? 1 : ease((t - 0.15) / 1.6)
      const F = Math.max(w, h * 1.4) * 0.62
      const horizon = h * (w < 760 ? 0.5 : 0.44)
      ptr.x += (ptr.tx - ptr.x) * 0.12
      ptr.y += (ptr.ty - ptr.y) * 0.12
      ptr.on += (ptr.ton - ptr.on) * 0.08
      const hills = HILLS.map((p) => [
        p.x + p.ax * Math.sin((2 * Math.PI * t) / p.px + p.ph),
        p.z + p.az * Math.sin((2 * Math.PI * t) / p.pz + p.ph * 1.3),
        p.amp * grow,
      ])
      const [br, bg, bb] = colours.base
      ctx!.clearRect(0, 0, w, h)

      // Far rows first so near dots paint over them.
      for (let r = rows - 1; r >= 0; r--) {
        const z = NEAR * Math.pow(FAR / NEAR, r / (rows - 1))
        const half = ((w / 2) * z) / F * 1.15
        const depth = (z - NEAR) / (FAR - NEAR) // 0 near .. 1 far
        const fog = Math.pow(1 - depth, 1.6) * Math.min(1, 0.3 + depth * 5) // fades at the horizon and the bottom edge
        for (let c = 0; c <= cols; c++) {
          const x = -half + (2 * half * c) / cols
          let y = 0.05 * Math.sin(x * 1.7 + t * 0.7) * Math.cos(z * 1.3 - t * 0.5) * grow
          let best = 0, bi = 0
          for (let i = 0; i < 3; i++) {
            const dx = x - hills[i][0], dz = z - hills[i][1]
            const v = Math.exp(-(dx * dx + dz * dz) * k)
            y += v * hills[i][2]
            if (v > best) { best = v; bi = i }
          }
          const sx = w / 2 + (x * F) / z
          let sy = horizon + ((CAM - y) * F) / z - F * CAM / FAR
          if (ptr.on > 0.01) {
            const dx = sx - ptr.x, dy = sy - ptr.y
            const lift = Math.exp(-(dx * dx + dy * dy) / (2 * 110 * 110)) * ptr.on
            sy -= lift * 34 * (1 - depth * 0.6)
            best = Math.max(best, lift * 0.5)
          }
          if (sy < -4 || sy > h + 4 || sx < -4 || sx > w + 4) continue
          const m = Math.min(1, best * 2.2 * grow)
          const a = (0.2 + 0.72 * m) * fog
          if (a < 0.015) continue
          const rad = Math.min(2.6, Math.max(0.55, 2.3 / z + 0.35)) * (1 + 0.7 * m)
          const [lr, lg, lb] = colours.lifts[bi]
          ctx!.fillStyle = `rgba(${(br + (lr - br) * m) | 0},${(bg + (lg - bg) * m) | 0},${(bb + (lb - bb) * m) | 0},${a})`
          ctx!.beginPath()
          ctx!.arc(sx, sy, rad, 0, Math.PI * 2)
          ctx!.fill()
        }
      }
    }

    const drawStill = () => draw(t0 + 12000, true)

    function loop(now: number) {
      draw(now)
      raf = requestAnimationFrame(loop)
    }

    function start() {
      cancelAnimationFrame(raf)
      if (still.matches || document.hidden) drawStill()
      else raf = requestAnimationFrame(loop)
    }

    function onMove(e: PointerEvent) {
      if (!fine.matches || still.matches) return
      if (ptr.ton === 0) { ptr.x = e.clientX; ptr.y = e.clientY }
      ptr.tx = e.clientX; ptr.ty = e.clientY; ptr.ton = 1
    }
    const onLeave = () => { ptr.ton = 0 }

    resize()
    start()
    const onResize = () => { resize(); if (still.matches) drawStill() }
    const themeObs = new MutationObserver(() => { colours = readColours(); if (still.matches) drawStill() })
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', start)
    still.addEventListener('change', start)
    return () => {
      cancelAnimationFrame(raf)
      themeObs.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', start)
      still.removeEventListener('change', start)
    }
  }, [])

  return <canvas ref={ref} className="lift-field" aria-hidden="true" />
}
