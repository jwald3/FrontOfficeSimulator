import type { ContractYear, RawContractPlayer, RawPick, RookieSlotYear, RunState } from './types'

/** Offseason cap accounting only counts the 51 largest charges. */
export const TOP_51 = 51

export function capHit(y: ContractYear | undefined): number {
  return y ? y.base + y.bonus + y.other : 0
}

export function yearOf(p: RawContractPlayer, season: number): ContractYear | undefined {
  return p.years.find((y) => y.year === season)
}

export function seasonCapHit(p: RawContractPlayer, season: number): number {
  return capHit(yearOf(p, season))
}

export function yearsRemaining(p: RawContractPlayer, season: number): number {
  return p.years.filter((y) => y.year >= season).length
}

/** Cap space gained this season by a pre-June 1 release (all proration accelerates). */
export function releaseSavings(p: RawContractPlayer, season: number): number {
  return seasonCapHit(p, season) - p.releaseDead
}

/** Projected first-season charge for a drafted rookie at this overall slot. */
export function rookieHit(slots: Record<string, RookieSlotYear[]>, overall: number, season: number): number {
  const y = slots[String(overall)]?.find((s) => s.year === season)
  return y ? y.base + y.bonus : 0
}

export interface CapSummary {
  adjustedCap: number
  /** Top-51 contract charges. */
  committed: number
  dead: number
  /** Adjusted cap minus committed and dead. */
  totalSpace: number
  /**
   * What unsigned picks cost above a minimum-salary roster spot. A rookie fills a
   * spot the team would otherwise fill at the rookie minimum, so only the excess
   * reduces usable room.
   */
  draftReserve: number
  effectiveSpace: number
  contractCount: number
}

export function capSummary(
  run: Pick<RunState, 'adjustedCap' | 'roster' | 'dead' | 'picks' | 'season' | 'draft' | 'team'>,
  slots: Record<string, RookieSlotYear[]>,
  minimumRookieBase: number,
): CapSummary {
  const hits = run.roster
    .map((p) => seasonCapHit(p, run.season))
    .sort((a, b) => b - a)
  const committed = hits.slice(0, TOP_51).reduce((a, b) => a + b, 0)
  const dead = run.dead.reduce((a, d) => a + d.amount, 0)
  const totalSpace = run.adjustedCap - committed - dead
  const draftReserve = unsignedPicks(run.picks, run.season, run.team, run.draft?.selections).reduce(
    (sum, pick) => sum + Math.max(0, rookieHit(slots, pick.overall!, run.season) - minimumRookieBase),
    0,
  )
  return {
    adjustedCap: run.adjustedCap,
    committed,
    dead,
    totalSpace,
    draftReserve,
    effectiveSpace: totalSpace - draftReserve,
    contractCount: run.roster.length,
  }
}

/** Our picks in this draft that haven't been used yet; a used pick's rookie is on the roster. */
export function unsignedPicks(picks: RawPick[], season: number, team: string, used: Record<string, string> = {}): RawPick[] {
  return picks.filter((p) => p.owner === team && p.year === season && p.overall != null && !used[p.id])
}
