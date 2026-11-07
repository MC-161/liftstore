import {
  AttemptsResponseSchema,
  ClassChangeResponseSchema,
  ClassSweepResponseSchema,
  ClassTrendResponseSchema,
  ConditionalPercentileResponseSchema,
  DatasetStatsResponseSchema,
  DistributionResponseSchema,
  EquipmentSwapResponseSchema,
  LeaderboardResponseSchema,
  LifterByNameResponseSchema,
  PercentileResponseSchema,
  ValueAtPercentileResponseSchema,
} from '../gen/engine_pb'
import { get } from './client'
import { cached } from './queryKeys'

// Wire names, exactly as the proto spells them.
export type WireSex = 'SEX_M' | 'SEX_F'
export type WireEquipment = 'EQUIPMENT_RAW' | 'EQUIPMENT_WRAPS' | 'EQUIPMENT_SINGLE_PLY' | 'EQUIPMENT_MULTI_PLY'
export type WireLift = 'LIFT_KIND_SQUAT' | 'LIFT_KIND_BENCH' | 'LIFT_KIND_DEADLIFT' | 'LIFT_KIND_TOTAL'

export type Group = { sex: WireSex; equipment: WireEquipment; event: 'EVENT_SBD' }
export type ClassGroup = Group & { ipf_class: number }

type Q = Record<string, string | number | undefined>
const call = <T>(path: string, q: Q, load: () => Promise<T>) =>
  cached(`${path}?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined) as [string, string][])}`, load)

export const datasetStats = (q: Partial<Group> = {}) =>
  call('dataset-stats', q, () => get(DatasetStatsResponseSchema, 'dataset-stats', q))

export const percentile = (g: Group, bodyweight: number, lift: WireLift, value: number) => {
  const q = { ...g, bodyweight, lift, value }
  return call('percentile', q, () => get(PercentileResponseSchema, 'percentile', q))
}

export const valueAtPercentile = (g: Group, bodyweight: number, lift: WireLift, pct: number) => {
  const q = { ...g, bodyweight, lift, percentile: pct }
  return call('value-at-percentile', q, () => get(ValueAtPercentileResponseSchema, 'value-at-percentile', q))
}

// ipfClass set: "lifters your size", falling back to all classes server-side
// when the class is too thin (response.allClasses says which happened).
export const conditionalPercentile = (g: Group, cond: WireLift, condValue: number, target: WireLift, targetValue: number, ipfClass?: number) => {
  const q = { ...g, condition_lift: cond, condition_value: condValue, target_lift: target, target_value: targetValue, ipf_class: ipfClass }
  return call('conditional-percentile', q, () => get(ConditionalPercentileResponseSchema, 'conditional-percentile', q))
}

// bin_width 2.5: the bins are also the client's CDF (spec 5.2), so finer is
// better; 2.5 kg is the smallest plate step and stays well under kMaxBins.
export const distribution = (g: ClassGroup, lift: WireLift, binWidth = 2.5) => {
  const q = { ...g, lift, bin_width: binWidth }
  return call('distribution', q, () => get(DistributionResponseSchema, 'distribution', q))
}

export const classSweep = (g: Group, lift: WireLift, value: number) => {
  const q = { ...g, lift, value }
  return call('class-sweep', q, () => get(ClassSweepResponseSchema, 'class-sweep', q))
}

export const classTrend = (g: ClassGroup, lift: WireLift, startYear: number) => {
  const q = { ...g, lift, start_year: startYear }
  return call('class-trend', q, () => get(ClassTrendResponseSchema, 'class-trend', q))
}

export const equipmentSwap = (sex: WireSex, from: WireEquipment, to: WireEquipment, ipfClass: number, lift: WireLift) => {
  const q = { sex, event: 'EVENT_SBD', from_equipment: from, to_equipment: to, ipf_class: ipfClass, lift }
  return call('equipment-swap', q, () => get(EquipmentSwapResponseSchema, 'equipment-swap', q))
}

export const classChange = (g: Group, delta: number) => {
  const q = { ...g, class_delta: delta }
  return call('class-change', q, () => get(ClassChangeResponseSchema, 'class-change', q))
}

export const attempts = (g: ClassGroup, lift: WireLift) => {
  const q = { ...g, lift }
  return call('attempts', q, () => get(AttemptsResponseSchema, 'attempts', q))
}

export type RankSpec =
  | { preset: 'RANK_PRESET_TOP_TOTAL' | 'RANK_PRESET_DOTS' | 'RANK_PRESET_BALANCED' }
  | {
      preset: 'RANK_PRESET_CUSTOM'
      a: { lift: WireLift; metric: 'METRIC_KG' | 'METRIC_PERCENTILE' }
      combine: 'COMBINE_NONE' | 'COMBINE_MINUS' | 'COMBINE_PLUS' | 'COMBINE_RATIO'
      b: { lift: WireLift; metric: 'METRIC_KG' | 'METRIC_PERCENTILE' }
      ascending: boolean
    }

export type You = { squat: number; bench: number; deadlift: number; bodyweight: number }

// includeImplausible: keep lines where one lift is under 15% of the total
// (filtered by default -- they're almost always mis-recorded meets).
export const leaderboard = (g: ClassGroup, spec: RankSpec, you?: You, limit = 10, includeImplausible = false) => {
  const q: Q = { ...g, preset: spec.preset, limit, include_implausible: includeImplausible ? 'true' : undefined }
  if (spec.preset === 'RANK_PRESET_CUSTOM') {
    Object.assign(q, {
      a_lift: spec.a.lift, a_metric: spec.a.metric, combine: spec.combine,
      ascending: spec.ascending ? 'true' : undefined,
      ...(spec.combine !== 'COMBINE_NONE' ? { b_lift: spec.b.lift, b_metric: spec.b.metric } : {}),
    })
  }
  if (you) Object.assign(q, { you_squat: you.squat, you_bench: you.bench, you_deadlift: you.deadlift, you_bodyweight: you.bodyweight })
  return call('leaderboard', q, () => get(LeaderboardResponseSchema, 'leaderboard', q))
}

// ipfClass set: their best IN that class; omitted: their best anywhere.
export const lifterByName = (g: Group, name: string, ipfClass?: number) => {
  const q = { ...g, name, ipf_class: ipfClass }
  return call('lifter', q, () => get(LifterByNameResponseSchema, 'lifter', q))
}

