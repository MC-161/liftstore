import type { CSSProperties, ReactNode } from 'react'
import { BodyMap } from '../src/components/Figure'
import { MARK_PLATES } from '../src/components/Shell'
import { int, kg, LIFT_LABEL, LIFTS, pctNumber, pctSuffix, pctText, type Lift } from '../src/lib/format'
import { LIFT_COLOR, liftVars, type Lit } from '../src/lib/lifts'
import type { FilmData } from './data'
import TL from './timeline.json'

// ---------------------------------------------------------------- timing
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const prog = (t: number, s: number, d: number) => clamp((t - s) / d)
const out4 = (x: number) => 1 - Math.pow(1 - x, 4)
const inOut = (x: number) => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2)
const back = (x: number) => { const c = 1.25; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) }
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

// Rise in with a blur, the film's one entrance.
function rise(t: number, s: number, d = 650, dist = 44, blur = 16): CSSProperties {
  const k = out4(prog(t, s, d))
  return { opacity: k, transform: `translateY(${(1 - k) * dist}px)`, filter: k < 1 ? `blur(${(1 - k) * blur}px)` : undefined }
}
// Slam in: overshoot from large, for numbers.
function slam(t: number, s: number, d = 560): CSSProperties {
  const k = prog(t, s, d)
  const sc = lerp(1.6, 1, back(k))
  return { opacity: clamp(k * 3), transform: `scale(${sc})`, filter: k < 0.6 ? `blur(${(1 - k / 0.6) * 18}px)` : undefined }
}
const count = (t: number, s: number, d: number, from: number, to: number) => lerp(from, to, out4(prog(t, s, d)))

// Scenes: [start, end). Each fades in and out with blur and a little scale.
// The timeline is built from the voiceover (scratch audio/timeline.py): each
// scene's length and its key beats come from when the words are spoken.
type SceneTL = { start: number; dur: number; shift: number; slams?: number[]; ask?: number; men?: number; eq?: number[]; back?: number; press?: number; second?: number }
const SC = TL.scenes as Record<string, SceneTL>
const span = (k: string) => [SC[k].start, SC[k].start + SC[k].dur] as const
export const S = Object.fromEntries(Object.keys(SC).map((k) => [k, span(k)])) as Record<string, readonly [number, number]>
const sh = (k: string) => SC[k].shift
export const DURATION = TL.duration
const FADE = 380

function Scene({ t, at, children, zoom = 0.035, last = false }: { t: number; at: readonly [number, number]; children: (lt: number) => ReactNode; zoom?: number; last?: boolean }) {
  const [a, b] = at
  if (t < a - 1 || t >= b) return null
  const kin = out4(prog(t, a, FADE))
  const kout = last ? 0 : inOut(prog(t, b - FADE, FADE))
  const drift = 1 + zoom * prog(t, a, b - a) // slow push-in over the scene
  const style: CSSProperties = {
    opacity: kin * (1 - kout),
    transform: `scale(${drift * lerp(1.04, 1, kin) * lerp(1, 0.96, kout)})`,
    filter: kin < 1 || kout > 0 ? `blur(${(1 - kin) * 14 + kout * 16}px)` : undefined,
  }
  return <div className="scene" style={style}>{children(t - a)}</div>
}

function Words({ t, s, text, step = 80, accent }: { t: number; s: number; text: string; step?: number; accent?: Record<string, Lift | 'amber'> }) {
  return (
    <>
      {text.split(' ').map((w, k) => {
        const key = w.replace(/[.,?]/g, '').toLowerCase()
        const a = accent?.[key]
        const color = a === 'amber' ? 'var(--accent)' : a ? LIFT_COLOR[a] : undefined
        return <span key={k} className="f-word" style={{ ...rise(t, s + k * step, 700, 50, 18), color }}>{w}{' '}</span>
      })}
    </>
  )
}

// The barbell mark, built plate by plate.
function Barbell({ t, s, scale = 7 }: { t: number; s: number; scale?: number }) {
  const shaft = out4(prog(t, s, 600))
  const order = [2, 1, 0, 0, 1, 2] // inner plates first
  return (
    <svg width={40 * scale} height={24 * scale} viewBox="0 0 40 24" style={{ overflow: 'visible' }}>
      <rect x={20 - 20 * shaft} y="11" width={40 * shaft} height="2" rx="1" fill="var(--text-3)" />
      {MARK_PLATES.map((p, k) => {
        const kk = back(prog(t, s + 220 + order[k] * 110, 480))
        const dx = (p.x < 20 ? -1 : 1) * (1 - kk) * 6
        return <rect key={k} x={p.x + dx} y={p.y + (p.h / 2) * (1 - clamp(kk))} width="3" height={p.h * clamp(kk)} rx="1"
          fill={`var(--${p.lift})`} opacity={clamp(kk * 2)} />
      })}
    </svg>
  )
}

const pct = (p: number) => <>{pctNumber(p)}<sup>{pctSuffix(p)}</sup></>

// ---------------------------------------------------------------- the film
export function Film({ t, d }: { t: number; d: FilmData }) {
  const i = d.inputs
  const W = d.weakest, Sg = d.strongest
  return (
    <div className="film">
      <div className="halo" />

      {/* 1. The mark */}
      <Scene t={t} at={S.logo} zoom={0.05}>{(lt) => (
        <div className="f-brand">
          <Barbell t={lt} s={150} />
          <div className="word" style={rise(lt, 850, 700)}>Weak Link</div>
        </div>
      )}</Scene>

      {/* 2. Three numbers, one question */}
      <Scene t={t} at={S.nums}>{(lt) => (
        <>
          {/* keep the numbers that have landed centred: slide the row as each one arrives */}
          <div className="f-nums" style={{ transform: `translateX(${(3 - SC.nums.slams!.reduce((a, c) => a + out4(prog(lt, c - 120, 520)), 0)) * 220}px)` }}>
            {LIFTS.map((l, k) => (
              <div key={l} className="f-num" style={liftVars(l)}>
                <div className="v" style={slam(lt, SC.nums.slams![k] - 120)}>{value(i, l)}</div>
                <div className="k" style={rise(lt, SC.nums.slams![k] + 80, 500, 20, 8)}>{LIFT_LABEL[l]}</div>
              </div>
            ))}
          </div>
          <p className="f-h2" style={{ marginTop: 90 }}><Words t={lt} s={SC.nums.ask! - 80} text="Which one’s holding you back?" step={95} /></p>
        </>
      )}</Scene>

      {/* 3. Enter them */}
      <Scene t={t} at={S.entry} zoom={0.02}>{(lt) => <Entry lt={lt} d={d} />}</Scene>

      {/* 4. The answer */}
      <Scene t={t} at={S.verdict} zoom={0.015}>{(lt) => <Verdict lt={lt} k={lt - sh('verdict')} d={d} />}</Scene>

      {/* 5. The body */}
      <Scene t={t} at={S.body} zoom={0.04}>{(lt) => <Body lt={lt} k={lt - sh('body')} d={d} />}</Scene>

      {/* 6. How many it's measured against */}
      <Scene t={t} at={S.stats}>{(lt) => {
        const at2 = SC.stats.second!
        const second = lt > at2 - 50
        const s = second ? at2 : 100
        const to = second ? d.stats.results : d.cond.n
        const k = second ? out4(prog(lt, at2 - 50, 300)) : 0
        return (
          <div style={{ textAlign: 'center' }}>
            <div className="f-giant" style={{ ...rise(lt, s, 600, 60, 20), opacity: second ? k : 1 - out4(prog(lt, at2 - 300, 250)) }}>
              {int(Math.round(count(lt, s, 1100, 0, to)))}
            </div>
            <p className="f-sub" style={{ ...rise(lt, s + 300, 600, 24, 10), fontSize: 40, marginTop: 30, opacity: second ? k : 1 - out4(prog(lt, at2 - 300, 250)) }}>
              {second
                ? <>competition results behind every answer.</>
                : <>results from lifters your size who {Sg} around <b>{kg(d.strongValue)} kg</b>.</>}
            </p>
          </div>
        )
      }}</Scene>

      {/* 7. What if */}
      <Scene t={t} at={S.whatif} zoom={0.02}>{(lt) => <WhatIf lt={lt} k={lt - sh('whatif')} d={d} />}</Scene>

      {/* 8. Every weight class */}
      <Scene t={t} at={S.classes} zoom={0.025}>{(lt, k2 = lt - sh('classes')) => (
        <>
          <p className="f-h2" style={{ marginBottom: 70 }}><Words t={lt} s={100} text="Every weight class." /></p>
          <div className="f-classes">
            {d.classes.map((r, k) => {
              const g = out4(prog(k2, 600 + k * 70, 900))
              const p = r.pct ?? 0
              return (
                <div key={r.c} className={`f-col${d.best === r.c ? ' best' : ''}`} style={{ opacity: r.n < 500 || Math.abs(r.c - d.own) > 1 ? 0.55 : 1 }}>
                  <div className="tag" style={rise(k2, 1700, 500, 14, 6)}>{d.best === r.c ? 'Best' : ''}</div>
                  <div className="pct" style={{ opacity: g }}>{r.pct === null ? '—' : pctText(p * g)}</div>
                  <div className="bar" style={{ height: (40 + (p / 100) * 330) * g }} />
                  <div className="cls" style={{ opacity: out4(prog(k2, 350 + k * 70, 500)) }}>{r.label}</div>
                  <div className="own" style={{ opacity: out4(prog(k2, 900, 500)) }}>{r.c === d.own ? 'Your class' : ''}</div>
                </div>
              )
            })}
          </div>
          <p className="f-sub" style={{ ...rise(k2, 1900, 600, 20, 8), marginTop: 46, fontSize: 28 }}>
            Projected from <b>{int(d.downLifters)}</b> lifters who actually moved down a class, not an assumed ratio.
          </p>
        </>
      )}</Scene>

      {/* 9. Call your third */}
      <Scene t={t} at={S.attempts} zoom={0.025}>{(lt, k2 = lt - sh('attempts')) => (
        <>
          <p className="f-h2" style={{ marginBottom: 64 }}><Words t={lt} s={100} text="Call your third." /></p>
          <div className="f-cards" style={liftVars(W)}>
            {d.cards.map((c, k) => {
              const g = out4(prog(k2, 500 + k * 90, 900))
              const isPick = d.pick === c.j && k2 > 1800
              return (
                <div key={c.j} className={`f-card${isPick ? ' pick' : ''}`} style={{ ...rise(lt, 400 + k * 90, 600, 40, 10), transform: `${rise(lt, 400 + k * 90, 600, 40, 10).transform} scale(${isPick ? lerp(1, 1.06, back(prog(k2, 1800, 400))) : 1})` }}>
                  <span className="j">+{c.j.toFixed(1)} kg</span>
                  <span className="r">{c.rate === null ? '—' : `${Math.round(c.rate * 100 * g)}%`}</span>
                  <span className="stem" style={{ height: (c.rate === null ? 0 : 20 + c.rate * 150) * g }} />
                  <span className="w">{kg(d.weakValue + c.j)}<span>kg</span></span>
                </div>
              )
            })}
          </div>
          <p className="f-sub" style={{ ...rise(k2, 1900, 600, 20, 8), marginTop: 46, fontSize: 28 }}>
            Make rates from <b>{int(d.attemptsN)}</b> real third attempts in your class.
          </p>
        </>
      )}</Scene>

      {/* 10. Head to head */}
      <Scene t={t} at={S.h2h} zoom={0.02}>{(lt) => <H2H lt={lt - sh('h2h')} d={d} />}</Scene>

      {/* 11. Speed */}
      <Scene t={t} at={S.speed} zoom={0.05}>{(lt, k2 = lt - sh('speed')) => (
        <div style={{ textAlign: 'center' }}>
          <p className="f-kicker" style={{ ...rise(lt, 100, 500, 16, 6), fontSize: 34 }}>The question at its heart is answered in</p>
          <div className="f-giant" style={{ ...rise(k2, 250, 600, 50, 20), marginTop: 18 }}>
            {count(k2, 250, 1200, 0, 8.8).toFixed(1)}<span style={{ fontSize: 120, color: 'var(--text-2)', marginLeft: 16, letterSpacing: '-0.03em' }}>ms</span>
          </div>
          <p className="f-sub" style={{ ...rise(k2, 900, 600, 20, 8), marginTop: 36 }}>
            <b>Liftstore</b>, a C++ columnar engine over 4 million rows. Benchmarked, not estimated.
          </p>
        </div>
      )}</Scene>

      {/* 12. End */}
      <Scene t={t} at={S.end} zoom={0.03} last>{(lt) => (
        <div className="f-brand">
          <Barbell t={lt} s={100} scale={5.5} />
          <div className="word" style={{ ...rise(lt, 600, 700), fontSize: 112, marginTop: 34 }}>Find your weak link.</div>
          <div className="f-url" style={{ ...rise(lt, 1200, 600, 16, 6), marginTop: 44 }}>github.com/MC-161/liftstore</div>
        </div>
      )}</Scene>
    </div>
  )
}

const value = (i: FilmData['inputs'], l: Lift) => (l === 'squat' ? i.s : l === 'bench' ? i.b : i.d)

// ---------------------------------------------------------------- scenes
function Entry({ lt, d }: { lt: number; d: FilmData }) {
  const i = d.inputs
  const tilt = lerp(24, 0, inOut(prog(lt, 0, 1300)))
  const fields: [string, string, string, Lift | null][] = [
    ['s', 'Squat', String(i.s), 'squat'], ['b', 'Bench', String(i.b), 'bench'], ['d', 'Deadlift', String(i.d), 'deadlift'], ['bw', 'Bodyweight', String(i.bw), null],
  ]
  // type each field in turn, quickly, under "pop in your lifts"
  const CH = 45
  let at = 250
  const typed = fields.map(([, , v]) => { const s = at; at += v.length * CH + 90; return v.slice(0, Math.max(0, Math.floor((lt - s) / CH) + 1)) })
  const done = lt > at
  const E = SC.entry
  // sex and equipment picked as the voice names them
  const men = lt >= E.men! - 60
  const eqNames = ['Raw', 'Wraps', 'Single-ply', 'Multi-ply']
  const eqIdx = lt >= E.back! ? 0 : E.eq!.reduce((a, c, k) => (lt >= c - 60 ? k : a), -1)
  const since = lt >= E.back! ? lt - E.back! : eqIdx >= 0 ? lt - (E.eq![eqIdx] - 60) : 1e9
  const pop = (dt: number) => 1 + 0.12 * Math.sin(Math.PI * clamp(dt / 260))
  const chip = (on: boolean, dt: number): CSSProperties | undefined => on ? { borderColor: 'var(--accent)', color: 'var(--text)', background: 'var(--accent-soft)', transform: `scale(${pop(dt)})`, display: 'inline-block' } : undefined
  const press = prog(lt, E.press!, 260)
  const pressK = press > 0 && press < 1 ? Math.sin(press * Math.PI) : 0
  return (
    <>
      <p className="f-h2" style={{ marginBottom: 56 }}><Words t={lt} s={50} text="Your lifts. Your category." /></p>
      <div className="f-plane">
        <div className="f-entry" style={{ transform: `rotateX(${tilt}deg) translateY(${tilt * 3}px)` }}>
          <div className="entry-card">
            <div className="fields">
              {fields.map(([f, label, , l], k) => (
                <div key={f} className="field" style={l ? liftVars(l) : undefined}>
                  <label>{l && <span className="sw" />}{label}</label>
                  <div className="box" style={typed[k].length > 0 && typed[k].length < fields[k][2].length + 1 && !(k < 3 && typed[k + 1].length > 0) ? { borderColor: l ? LIFT_COLOR[l] : 'var(--text-2)' } : undefined}>
                    <input readOnly value={typed[k]} /><span className="unit">kg</span>
                  </div>
                  <div className="err" />
                </div>
              ))}
            </div>
            <div className="choices">
              <div className="choice-group"><span className="label">Sex</span>
                <span className="choice" aria-pressed={men} style={chip(men, lt - (E.men! - 60))}>Men</span><span className="choice">Women</span></div>
              <div className="choice-group"><span className="label">Equipment</span>
                {eqNames.map((e, k) => <span key={e} className="choice" aria-pressed={k === eqIdx} style={chip(k === eqIdx, since)}>{e}</span>)}</div>
            </div>
            <div className="entry-foot">
              <div className="livetotal">{done ? <>Total<b>{kg(d.total)} kg</b></> : 'Enter all three lifts'}</div>
              <span className={`btn primary analyse${pressK > 0 ? ' f-press' : ''}`} style={{ transform: `scale(${1 - pressK * 0.06})` }}>See my verdict</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function Verdict({ lt: lt0, k: lt, d }: { lt: number; k: number; d: FilmData }) {
  const W = d.weakest
  const share = d.cond.n > 0 ? d.cond.below / d.cond.n : 0
  const tail = share < 0.25 ? "is what's holding you back." : share < 0.45 ? 'is a little behind.' : 'is in balance.'
  const up = inOut(prog(lt, 2000, 900)) // headline moves up to make room
  const per100 = Math.round((100 * d.cond.below) / d.cond.n)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${lerp(170, 0, up)}px)` }}>
      <p className="f-kicker" style={{ ...rise(lt0, 150, 600, 16, 6), marginBottom: 28, fontSize: 30 }}>
        Your verdict · {d.classes[d.own].label} kg · raw · men
      </p>
      <h1 className="f-h1" style={{ fontSize: lerp(132, 92, up), maxWidth: 1400 }}>
        <Words t={lt} s={150} text={`Your ${W} ${tail}`} step={110} accent={{ [W]: W }} />
      </h1>
      <p className="f-sub" style={{ ...rise(lt, 2500, 700, 24, 10), maxWidth: 1250, marginTop: 34 }}>
        Lifters your size who {d.strongest} about <b>{kg(d.strongValue)} kg</b> usually {W} around <b>{kg(d.cond.targetMedian)} kg</b>.
        You {W} <b>{kg(d.weakValue)} kg</b>: {per100} in 100 of them {W} less.
      </p>
      <Strip lt={lt} d={d} />
      {d.gap > 0 && (
        <div className="f-target" style={rise(lt, 4100, 600, 20, 8)}>
          {LIFT_LABEL[W]} <b>{kg(d.cond.targetMedian)} kg</b> and your total moves from the <b>{pctText(d.totalPct)}</b> to about the <b>{pctText(d.targetPct)}</b> percentile in your class.
        </div>
      )}
    </div>
  )
}

function Strip({ lt, d }: { lt: number; d: FilmData }) {
  const bins = d.cond.targetBins
  if (bins.length === 0) return null
  const Wd = 1200, base = 150
  const mine = d.weakValue
  const lo = Math.min(bins[0].low, mine - 5), hi = Math.max(bins[bins.length - 1].high, mine + 5)
  const x = (v: number) => ((v - lo) / (hi - lo)) * Wd
  const peak = Math.max(...bins.map((b) => b.count))
  const dot = out4(prog(lt, 3400, 700))
  const show = prog(lt, 2700, 200)
  return (
    <svg className="f-strip" width={Wd} height={200} viewBox={`0 0 ${Wd} 200`} style={{ marginTop: 30, overflow: 'visible', opacity: show }}>
      {bins.map((b, k) => {
        const g = out4(prog(lt, 2700 + k * 22, 600))
        const h = Math.max(2, (b.count / peak) * 110) * g
        return <rect key={k} x={x(b.low) + 1} y={base - h} width={Math.max(2, x(b.high) - x(b.low) - 2)} height={h} rx={2} fill={LIFT_COLOR[d.weakest]} opacity={0.45} />
      })}
      <line x1={0} x2={Wd} y1={base} y2={base} stroke="var(--line-strong)" />
      <line x1={x(d.cond.targetMedian)} x2={x(d.cond.targetMedian)} y1={20} y2={base} stroke="var(--text-3)" strokeDasharray="4 5" opacity={dot} />
      <text x={x(d.cond.targetMedian)} y={base + 38} fontSize={22} fill="var(--text-3)" textAnchor="middle" opacity={dot}>Typical {kg(d.cond.targetMedian)}</text>
      <g opacity={dot} transform={`translate(${lerp(x(lo), x(mine), dot)} ${base})`}>
        <circle r={11} fill="var(--text)" stroke="var(--bg)" strokeWidth={4} />
        <text y={-128} fontSize={24} fill="var(--text)" textAnchor="middle" fontWeight={600}>You {kg(mine)}</text>
      </g>
    </svg>
  )
}

function Body({ lt: lt0, k: lt, d }: { lt: number; k: number; d: FilmData }) {
  // Even (every lift equal) underneath, the real spread fading in on top.
  const k = inOut(prog(lt, 700, 1600))
  const even: Lit = { squat: 50, bench: 50, deadlift: 50 }
  // Figure geometry on the 1920x1080 stage: two 200x420 views at height H.
  const H = 640, sc = H / 420, gap = 24, w = 200 * sc
  const x0 = (1920 - (2 * w + gap)) / 2, y0 = 268
  const front = (x: number, y: number) => [x0 + x * sc, y0 + y * sc]
  const back = (x: number, y: number) => [x0 + w + gap + x * sc, y0 + y * sc]
  // Each callout points at a muscle its lift trains.
  const calls: { l: Lift; at: number[]; side: 'l' | 'r' }[] = [
    { l: 'bench', at: front(68, 92), side: 'l' },
    { l: 'squat', at: front(80, 236), side: 'l' },
    { l: 'deadlift', at: back(122, 196), side: 'r' },
  ]
  const COL_L = 560, COL_R = 1360
  return (
    <>
      <div style={{ position: 'absolute', top: 92, left: 0, right: 0 }}>
        <p className="f-h2" style={{ fontSize: 64 }}><Words t={lt0} s={100} text="Every muscle, lit by your numbers." step={70} /></p>
      </div>
      <div className="f-body" style={{ position: 'absolute', left: x0, top: y0, ...rise(lt0, 300, 800, 40, 20) }}>
        <BodyMap percentiles={even} height={H} />
        <div style={{ position: 'absolute', inset: 0, opacity: k }}><BodyMap percentiles={d.lit} height={H} /></div>
      </div>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {calls.map(({ l, at, side }, n) => {
          const s0 = 1700 + n * 220
          const g = out4(prog(lt, s0 + 150, 700))
          const x1 = side === 'l' ? COL_L + 18 : COL_R - 18
          return (
            <g key={l} opacity={prog(lt, s0, 200)}>
              <line x1={x1} y1={at[1]} x2={lerp(x1, at[0], g)} y2={at[1]} stroke={LIFT_COLOR[l]} strokeWidth={2} />
              <circle cx={at[0]} cy={at[1]} r={7 * g} fill={LIFT_COLOR[l]} stroke="var(--bg)" strokeWidth={3} />
            </g>
          )
        })}
      </svg>
      {calls.map(({ l, at, side }, n) => (
        <div key={l} className="f-call" style={{ top: at[1] - 58, ...(side === 'l' ? { right: 1920 - COL_L, textAlign: 'right' } : { left: COL_R, textAlign: 'left' }), ...liftVars(l), ...rise(lt, 1700 + n * 220, 600, 24, 10) }}>
          <span className="n">{LIFT_LABEL[l]}</span>
          <span className="p">{pct(count(lt, 1700 + n * 220, 900, 0, d.lit[l]))}</span>
        </div>
      ))}
    </>
  )
}

function WhatIf({ lt: lt0, k: lt, d }: { lt: number; k: number; d: FilmData }) {
  const W = d.weakest
  const k = inOut(prog(lt, 1300, 1500))
  const v = d.weakValue + d.whatIf.add * k
  const p = lerp(d.lit[W], d.whatIf.weakPct, k)
  const tp = lerp(d.totalPct, d.whatIf.totalPct, k)
  return (
    <>
      <p className="f-h2" style={{ marginBottom: 64 }}><Words t={lt0} s={100} text="Then ask “what if?”" /></p>
      <div className="f-panel f-whatif" style={{ ...liftVars(W), ...rise(lt0, 300, 800, 60, 16) }}>
        <div>
          <div className="f-kicker" style={{ color: 'var(--lc)', fontWeight: 600 }}>{LIFT_LABEL[W]}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '10px 0 22px' }}>
            <span className="big">{kg(Math.round(v / 2.5) * 2.5)}<span className="unit">kg</span></span>
            <span className="pct" style={{ color: 'var(--lc)' }}>{pct(p)}</span>
          </div>
          {/* the app's what-if slider: -20 to +20 kg around your lift */}
          <div className="f-track">
            <div className="rail" />
            <div className="fill" style={{ width: `${(d.whatIf.add * k / 20) * 50}%` }} />
            <div className="mid" />
            <div className="thumb" style={{ left: `${50 + (d.whatIf.add * k / 20) * 50}%`, transform: `scale(${1 + 0.15 * Math.sin(Math.PI * prog(lt, 1100, 1900))})` }} />
            <div className="tip" style={{ left: `${50 + (d.whatIf.add * k / 20) * 50}%`, opacity: prog(lt, 1250, 200) }}>+{(d.whatIf.add * k).toFixed(1)} kg</div>
          </div>
          <div className="f-ends"><span>−20 kg</span><span>+20 kg</span></div>
        </div>
        <div style={{ borderLeft: '1px solid var(--line)', paddingLeft: 56 }}>
          <div className="f-kicker">Total</div>
          <div className="big" style={{ margin: '10px 0 26px' }}>{kg(d.total + d.whatIf.add * k)}<span className="unit">kg</span></div>
          <div className="f-kicker">Overall in your class</div>
          <div className="pct" style={{ marginTop: 10, color: 'var(--accent)' }}>{pct(tp)}</div>
        </div>
      </div>
    </>
  )
}

function H2H({ lt, d }: { lt: number; d: FilmData }) {
  const i = d.inputs
  const rows: [Lift | 'total', number, number][] = [
    ['squat', i.s, d.rival.squat], ['bench', i.b, d.rival.bench], ['deadlift', i.d, d.rival.deadlift], ['total', d.total, d.rival.total],
  ]
  return (
    <>
      <p className="f-h2" style={{ marginBottom: 64 }}><Words t={lt} s={100} text="Measure against anyone." /></p>
      <div className="f-h2h">
        <div className="names" style={rise(lt, 400, 600, 20, 8)}><span>You</span><span className="them">{d.rival.name}</span></div>
        {rows.map(([l, mine, theirs], k) => {
          const max = Math.max(mine, theirs)
          const g = out4(prog(lt, 700 + k * 120, 1000))
          const lc = l === 'total' ? 'var(--f-total)' : LIFT_COLOR[l]
          return (
            <div key={l} className="f-row" style={{ '--lc': lc, ...rise(lt, 600 + k * 120, 600, 24, 8) } as CSSProperties}>
              <div className="side you"><div className="bar" style={{ width: `${(mine / max) * 100 * g}%` }} /><span className="val" style={{ right: `calc(${(mine / max) * 100 * g}% + 18px)` }}>{kg(mine * g)} kg</span></div>
              <div className="lab">{l === 'total' ? 'Total' : LIFT_LABEL[l]}<div style={{ fontSize: 22, color: 'var(--danger)', fontWeight: 500, opacity: prog(lt, 1700, 400) }}>{mine - theirs < 0 ? `−${kg(theirs - mine)}` : `+${kg(mine - theirs)}`} kg</div></div>
              <div className="side them"><div className="bar" style={{ width: `${(theirs / max) * 100 * g}%` }} /><span className="val" style={{ left: `calc(${(theirs / max) * 100 * g}% + 18px)` }}>{kg(theirs * g)} kg</span></div>
            </div>
          )
        })}
      </div>
    </>
  )
}
