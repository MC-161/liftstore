import type { ClassGroup, Group, WireEquipment, WireSex } from '../api/endpoints'

// Everything a screen needs, and all of it lives in the URL (spec section 9).
export type Sex = 'm' | 'f'
export type Equip = 'raw' | 'wraps' | 'single' | 'multi'

export type Inputs = { s: number; b: number; d: number; bw: number; sex: Sex; eq: Equip }

export const EQUIP_LABEL: Record<Equip, string> = { raw: 'Raw', wraps: 'Wraps', single: 'Single-ply', multi: 'Multi-ply' }
const EQUIP_WIRE: Record<Equip, WireEquipment> = {
  raw: 'EQUIPMENT_RAW', wraps: 'EQUIPMENT_WRAPS', single: 'EQUIPMENT_SINGLE_PLY', multi: 'EQUIPMENT_MULTI_PLY',
}
export const equipWire = (e: Equip) => EQUIP_WIRE[e]

export const total = (i: Inputs) => i.s + i.b + i.d

export function group(i: Inputs): Group {
  return { sex: (i.sex === 'm' ? 'SEX_M' : 'SEX_F') as WireSex, equipment: EQUIP_WIRE[i.eq], event: 'EVENT_SBD' }
}

export function classGroup(i: Inputs, ipfClass = ipfClassIndex(i.sex, i.bw)): ClassGroup {
  return { ...group(i), ipf_class: ipfClass }
}

// --- IPF classes: mirrors src/ipf_class.cpp, and the server's weightClass
// label is checked against it on Verdict so the two can't drift unnoticed.
const LIMITS: Record<Sex, number[]> = {
  m: [53, 59, 66, 74, 83, 93, 105, 120],
  f: [43, 47, 52, 57, 63, 69, 76, 84],
}
export const CLASS_COUNT = 9

export function ipfClassIndex(sex: Sex, bw: number): number {
  const t = LIMITS[sex]
  for (let i = 0; i < t.length; i++) if (bw <= t[i]) return i
  return t.length
}

export function className(sex: Sex, index: number): string {
  const t = LIMITS[sex]
  return index < t.length ? String(t[index]) : `${t[t.length - 1]}+`
}

// The bodyweight a lifter would compete at in class `index`: its upper limit
// if they cut down to it, just over the previous limit if they move up. Their
// own class: their own bodyweight.
export function classBodyweight(sex: Sex, index: number, bw: number): number {
  const t = LIMITS[sex]
  const own = ipfClassIndex(sex, bw)
  if (index === own) return bw
  if (index < own) return t[index]
  return t[index - 1] + 0.1
}

// --- URL ---
const INPUT_KEYS = ['s', 'b', 'd', 'bw', 'sex', 'eq']

export function toQuery(i: Inputs, extra: Record<string, string> = {}): string {
  // A screen's own params must not reuse an input's key: the leaderboard's
  // `b` once silently replaced the lifter's bench.
  for (const k of Object.keys(extra)) {
    if (INPUT_KEYS.includes(k)) throw new Error(`query key "${k}" collides with a lifter input`)
  }
  const q = new URLSearchParams({
    s: String(i.s), b: String(i.b), d: String(i.d), bw: String(i.bw), sex: i.sex, eq: i.eq, ...extra,
  })
  return q.toString()
}

export function fromQuery(p: URLSearchParams): Inputs | null {
  const num = (k: string) => {
    const v = p.get(k)
    return v === null || v.trim() === '' ? NaN : Number(v)
  }
  const sex = p.get('sex')
  const eq = p.get('eq')
  const i = { s: num('s'), b: num('b'), d: num('d'), bw: num('bw'), sex, eq } as Inputs
  if (sex !== 'm' && sex !== 'f') return null
  if (!eq || !(eq in EQUIP_LABEL)) return null
  return Object.keys(validate(i)).length === 0 ? i : null
}

// --- validation (spec, Entry) ---
export type Field = 's' | 'b' | 'd' | 'bw'
export function validate(i: Partial<Record<Field, number>>): Partial<Record<Field, string>> {
  const errs: Partial<Record<Field, string>> = {}
  for (const f of ['s', 'b', 'd'] as const) {
    const v = i[f]
    if (v === undefined || Number.isNaN(v)) errs[f] = 'Required, as a number'
    else if (!(v > 0) || v > 600) errs[f] = 'Between 0 and 600 kg'
  }
  const bw = i.bw
  if (bw === undefined || Number.isNaN(bw)) errs.bw = 'Required, as a number'
  else if (bw < 30 || bw > 250) errs.bw = 'Between 30 and 250 kg'
  return errs
}

// --- prefill: last-entered numbers only, and storage may be blocked ---
const KEY = 'ple.last'
export function loadLast(): Partial<Inputs> | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Partial<Inputs>) : null
  } catch {
    return null
  }
}
export function saveLast(i: Inputs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(i))
  } catch {
    /* blocked storage: prefill is a convenience, never a requirement */
  }
}
