import { yearsRemaining } from './cap'
import { DEFAULT_VALUATION, type ValuationModel } from './editorialSchema'
import type { RawContractPlayer, RawPick, Snapshot } from './types'

// Trade value, in draft-chart points (this season's pick 1 = 3000), from real inputs
// only: what the market pays a player against the best-paid at his position, his
// age against his position's prime, his depth-chart role and the years of control
// left on his deal. The model is editorial (editorial.json → valuation); every part
// has a default in DEFAULT_VALUATION.
//
// Future picks are discounted the way teams trade them: each season ahead drops a
// pick by part of a round (half, by default), valued from this season's chart.

/** What valuation needs from the league, worked out once per snapshot and model. */
export interface ValuationContext {
  model: ValuationModel
  /** Average APY of the five best-paid players at each position, league-wide. */
  top5: Record<string, number>
  /** This season's chart: value by overall slot, index 1 = pick 1. */
  chart: number[]
  /** By player id: the editor's value for him, which replaces the model's. */
  overrides: Record<string, number>
}

export function valuationContext(snap: Snapshot, model: ValuationModel = DEFAULT_VALUATION, overrides: Record<string, number> = {}): ValuationContext {
  const byPos: Record<string, number[]> = {}
  for (const p of [...snap.roster, ...Object.values(snap.otherRosters).flat()]) (byPos[p.pos] ??= []).push(p.apy)
  const top5 = Object.fromEntries(
    Object.entries(byPos).map(([pos, apys]) => {
      const top = apys.sort((a, b) => b - a).slice(0, 5)
      return [pos, top.reduce((a, b) => a + b, 0) / top.length]
    }),
  )
  const chart: number[] = []
  for (const p of snap.picks) {
    const slot = p.sourceOverall ?? p.overall
    if (p.year === snap.season && slot) chart[slot] = p.sourceValue ?? p.value
  }
  return { model, top5, chart, overrides }
}

/** The context attached at load, or the default model for a snapshot without one. */
function ctx(snap: Snapshot): ValuationContext {
  return snap.valuation ?? (snap.valuation = valuationContext(snap))
}

/** Age against the position's prime: a small bonus before it, a yearly decline after. */
export function ageFactor(model: ValuationModel, pos: string, age: number): number {
  const p = model.positions[pos] ?? model.positions.WR
  if (age <= p.prime) return 1 + Math.min(0.15, 0.03 * (p.prime - age))
  return Math.max(0.2, (1 - p.decline) ** (age - p.prime))
}

/** The editor has ruled him out of any trade (editorial.json → untouchable). */
export function isUntouchable(snap: Pick<Snapshot, 'editorial'>, playerId: string): boolean {
  return !!snap.editorial?.untouchable?.includes(playerId)
}

/** The editor has ruled that he's never worth a first-round pick (editorial.json → noFirsts). */
export function noFirsts(snap: Pick<Snapshot, 'editorial'>, playerId: string): boolean {
  return !!snap.editorial?.noFirsts?.includes(playerId)
}

/** His value: the editor's, when one is set, otherwise the model's. */
export function tradeValue(p: Pick<RawContractPlayer, 'id' | 'pos' | 'apy' | 'age' | 'chart' | 'years'>, snap: Snapshot): number {
  const set = ctx(snap).overrides[p.id]
  return set ?? modelValue(p, snap)
}

/** What the model makes of him, ignoring any editorial value. */
export function modelValue(p: Pick<RawContractPlayer, 'pos' | 'apy' | 'age' | 'chart' | 'years'>, snap: Snapshot): number {
  const { model, top5 } = ctx(snap)
  const pos = model.positions[p.pos] ?? model.positions.WR
  // Market standing: his APY as a share of the position's top-5 average, with a
  // premium for stars (the exponent), and a floor for listed starters on cheap deals.
  const share = Math.min(1.2, p.apy / (top5[p.pos] || p.apy || 1))
  const starter = p.chart?.depth === 1
  const market = Math.max(pos.top * share ** model.starPower, starter ? pos.top * model.starterFloor : 0)
  const role = starter ? 1 : p.chart?.depth === 2 ? model.role.second : model.role.deeper
  const left = yearsRemaining(p as RawContractPlayer, snap.season)
  const control = left <= 1 ? model.control.one : left === 2 ? model.control.two : 1
  return Math.round(market * role * ageFactor(model, p.pos, p.age) * control)
}

/**
 * A pick in chart points. This season's picks use their slot. A future pick is
 * valued as the middle of its round, dropped by `futureRounds` rounds for each
 * season ahead, on this season's chart.
 */
export function futurePickValue(snap: Snapshot, pick: RawPick, season: number): number {
  const { model, chart } = ctx(snap)
  const last = chart.length - 1
  const slot = Math.round(32 * (pick.round - 1) + 16 + 32 * model.futureRounds * Math.max(1, pick.year - season))
  return chart[Math.min(Math.max(1, slot), last)] ?? chart[last] ?? 0
}
