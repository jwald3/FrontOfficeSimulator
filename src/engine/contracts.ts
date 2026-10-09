import type { Contract, ContractYear, RawContractPlayer, RawMarketPlayer, Snapshot } from './types'

export type Structure = 'backloaded' | 'balanced' | 'front-loaded' | 'incentive'

export const STRUCTURES: { id: Structure; name: string; blurb: string }[] = [
  { id: 'backloaded', name: 'Backloaded', blurb: 'Lowest cap hit now, rising later' },
  { id: 'balanced', name: 'Balanced', blurb: 'Even base salary every year' },
  { id: 'front-loaded', name: 'Front-Loaded', blurb: 'More cash early; players like it' },
  { id: 'incentive', name: 'Incentive Based', blurb: 'Part of the value is earned, not guaranteed' },
]

export interface Terms {
  /** Average annual value of the fixed contract, excluding incentives. */
  aav: number
  years: number
  /** Share of total fixed value guaranteed at signing, 0–1. */
  guaranteePct: number
  structure: Structure
}

/** Base-salary weights by contract year. */
const WEIGHTS: Record<Structure, (i: number) => number> = {
  backloaded: (i) => 1 + 0.18 * i,
  balanced: () => 1,
  'front-loaded': (i) => 1.3 - 0.12 * i,
  incentive: () => 1,
}

/** Incentive deals add this share of fixed value as not-likely-to-be-earned incentives. */
export const INCENTIVE_SHARE = 0.15
/** Of the guarantee, this share is paid as a prorated signing bonus; the rest guarantees early base. */
const SIGNING_BONUS_SHARE = 0.6
const MAX_PRORATION_YEARS = 5

export function minimumSalary(snap: Snapshot, creditedSeasons: number, year: number): number {
  const table = snap.salaryRules.minimum2027
  const base = table[Math.min(Math.max(creditedSeasons, 0), table.length - 1)]
  return base + Math.max(0, year - snap.season) * snap.salaryRules.annualMinimumIncrease
}

export interface BuiltContract {
  years: ContractYear[]
  signingBonus: number
  guaranteed: number
  incentives: number
  /** Dead money if released before June 1 of the first season. */
  releaseDead: number
}

/**
 * Turns negotiated terms into a year-by-year schedule. Total fixed value is
 * aav × years. Part of the guarantee becomes a signing bonus prorated over up to
 * five years; the remainder guarantees base salary from year one forward.
 */
export function buildContract(terms: Terms, season: number, minBase: (year: number) => number): BuiltContract {
  const total = Math.round(terms.aav * terms.years)
  const guaranteed = Math.round(total * terms.guaranteePct)
  const signingBonus = terms.years > 1 ? Math.round(guaranteed * SIGNING_BONUS_SHARE) : 0
  const proration = signingBonus / Math.min(terms.years, MAX_PRORATION_YEARS)

  const weights = Array.from({ length: terms.years }, (_, i) => WEIGHTS[terms.structure](i))
  const wsum = weights.reduce((a, b) => a + b, 0)
  const cashForBase = total - signingBonus
  const bases = weights.map((w, i) => Math.max(minBase(season + i), Math.round((cashForBase * w) / wsum)))
  // Re-balance the rounding and minimum floors so base totals exactly what's owed.
  const drift = bases.reduce((a, b) => a + b, 0) - cashForBase
  bases[bases.length - 1] = Math.max(minBase(season + terms.years - 1), bases[bases.length - 1] - drift)

  let guaranteeLeft = guaranteed - signingBonus
  const years: ContractYear[] = bases.map((base, i) => {
    const g = Math.min(base, Math.max(0, guaranteeLeft))
    guaranteeLeft -= g
    return {
      year: season + i,
      base,
      bonus: i < MAX_PRORATION_YEARS ? Math.round(proration) : 0,
      other: 0,
      guaranteedBase: g,
    }
  })
  const incentives = terms.structure === 'incentive' ? Math.round(total * INCENTIVE_SHARE) : 0
  const releaseDead = signingBonus + years.reduce((a, y) => a + y.guaranteedBase, 0)
  return { years, signingBonus, guaranteed, incentives, releaseDead }
}

/** A newly signed player as a roster contract. */
export function signedContract(
  snap: Snapshot,
  p: RawMarketPlayer,
  built: Pick<BuiltContract, 'years' | 'releaseDead'>,
  aav: number,
  extra: Partial<Contract> = {},
): Contract {
  const raw: RawContractPlayer = {
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: snap.team,
    apy: aav,
    minimumBase: minimumSalary(snap, p.creditedSeasons, snap.season),
    restructureEligible: false,
    depth: false,
    years: built.years,
    releaseDead: built.releaseDead,
    tradeDead: built.releaseDead,
    reportedCap: built.years[0] ? built.years[0].base + built.years[0].bonus + built.years[0].other : 0,
    age: p.age,
    experience: p.experience,
    creditedSeasons: p.creditedSeasons,
    chart: p.chart,
  }
  return { ...raw, onTradeBlock: false, restructured: false, ...extra }
}
