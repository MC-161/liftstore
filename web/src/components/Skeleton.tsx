import { useEffect, useState, type CSSProperties } from 'react'

// Loading placeholders in the shape of each screen, built from the screens'
// own layout classes so they reflow the same way on tablet and phone. The
// API scales to zero, so the first visit after a quiet spell can wait while
// the engine loads its data; after a few seconds the wait is explained.
export type SkeletonShape = 'verdict' | 'classes' | 'attempts' | 'versus' | 'board' | 'share'

const B = ({ w = '100%', h = 14, r, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) => (
  <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />
)

const Title = () => (
  <div className="skel-stack">
    <B w="min(520px, 80%)" h={34} />
    <B w="min(420px, 65%)" h={16} style={{ marginTop: 8 }} />
  </div>
)

function Body({ shape }: { shape: SkeletonShape }) {
  switch (shape) {
    case 'verdict':
      return (
        <div className="verdict">
          <div className="col-lifts">
            {[0, 1, 2].map((k) => <div key={k} className="panel"><B w="40%" /><B w="70%" h={28} style={{ marginTop: 14 }} /><B h={8} style={{ marginTop: 14 }} /></div>)}
            <div className="panel" style={{ height: 190 }}><B w="30%" /></div>
          </div>
          <div className="col-verdict centre">
            <B w="70%" h={30} style={{ margin: '28px auto 0' }} />
            <B w="55%" h={30} style={{ margin: '10px auto 0' }} />
            <B w="80%" h={14} style={{ margin: '18px auto 0' }} />
            <B w={150} h={280} r={75} style={{ margin: '28px auto 0' }} />
            <div className="herorow">{[0, 1, 2].map((k) => <div key={k} className="cell"><B w="50%" h={12} /><B w="60%" h={22} style={{ marginTop: 6 }} /></div>)}</div>
          </div>
          <div className="col-context">
            <div className="panel" style={{ height: 230 }}><B w="60%" /></div>
            <div className="panel" style={{ height: 170 }}><B w="50%" /></div>
            <div className="panel" style={{ height: 110 }}><B w="55%" /></div>
          </div>
        </div>
      )
    case 'classes':
      return (
        <>
          <Title />
          <div className="sweep skel-sweep">
            {[30, 46, 64, 82, 100, 92, 74, 56, 40].map((h, k) => (
              <div key={k} className="col" style={{ '--h': `${h * 1.6}px`, '--p': `${h * 0.6}%` } as CSSProperties}>
                <B w={40} h={18} /><span className="skel skel-stem" /><B w={36} h={18} />
              </div>
            ))}
          </div>
        </>
      )
    case 'attempts':
      return (
        <>
          <Title />
          {[0, 1, 2].map((k) => (
            <div key={k} style={{ marginTop: 28 }}>
              <B w="min(320px, 60%)" h={16} />
              <div className="cards" style={{ marginTop: 12 }}>{[0, 1, 2, 3, 4].map((c) => <B key={c} h={112} r={12} />)}</div>
            </div>
          ))}
        </>
      )
    case 'versus':
      return (
        <>
          <Title />
          <div className="skel-rows" style={{ marginTop: 28 }}>{Array.from({ length: 6 }, (_, k) => <B key={k} h={52} r={10} />)}</div>
        </>
      )
    case 'board':
      return (
        <>
          <Title />
          <div className="skel-chips">{[90, 64, 74, 64, 52, 78].map((w, k) => <B key={k} w={w} h={34} r={8} />)}</div>
          <div className="board">{Array.from({ length: 10 }, (_, k) => <div key={k} className="skel-row"><B w={24} /><B w="40%" /><B w={64} style={{ marginLeft: 'auto' }} /></div>)}</div>
        </>
      )
    case 'share':
      return <div className="sharepage"><B w="min(600px, 100%)" h={315} r={16} /><B w={240} h={38} r={10} /></div>
  }
}

export function Skeleton({ shape }: { shape: SkeletonShape }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 2500)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="skeleton-screen" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {slow && <p className="skel-note">Waking the engine. The first visit after a quiet spell takes a few seconds while it loads millions of results.</p>}
      <div aria-hidden="true"><Body shape={shape} /></div>
    </div>
  )
}
