import { INCENTIVE_SHARE, type Structure, type Terms } from './contracts'
import { roll, rollRange } from './rng'
import type { RawMarketPlayer } from './types'

/**
 * A player's negotiating personality for this run. Every value is rolled once
 * from the run seed, so the same offer always gets the same answer — revising an
 * offer by a dollar can't fish for a better roll.
 */
export interface Personality {
  /** Multiplier on the published market value. */
  askFactor: number
  preferredYears: number
  /** Guaranteed share he expects, 0–1. */
  guaranteeExpect: number
  /** Rejected offers he'll sit through before ending talks. */
  patience: number
  /** Discount he'll give his current team. */
  loyalty: number
  /** How strongly he cares about cash up front vs. total value. */
  wantsCashNow: boolean
}

/** Guaranteed share expected at each market price, richest first. */
const GUARANTEE_BY_PRICE: [number, number][] = [[20_000_000, 0.55], [8_000_000, 0.4], [2_000_000, 0.22], [0, 0.08]]
/** Discount a player gives the team he already plays for. */
export const HOMETOWN_DISCOUNT = 0.04

export function personality(seed: number, p: RawMarketPlayer): Personality {
  const k = (s: string) => `${s}:${p.id}`
  const vet = p.age >= 31
  const yearsShift = Math.round(rollRange(seed, k('years'), -1, 1))
  return {
    askFactor: rollRange(seed, k('ask'), 0.94, 1.1),
    preferredYears: clamp(p.preferredYears + yearsShift, 1, 5),
    guaranteeExpect: clamp(
      GUARANTEE_BY_PRICE.find(([price]) => p.marketAAV >= price)![1] + rollRange(seed, k('gtd'), -0.06, 0.06),
      0,
      0.9,
    ),
    patience: 2 + Math.floor(roll(seed, k('patience')) * 3),
    loyalty: p.own ? HOMETOWN_DISCOUNT : 0,
    wantsCashNow: vet || roll(seed, k('cash')) < 0.35,
  }
}

/** What the player asks for. */
export function askingTerms(p: RawMarketPlayer, pers: Personality, minimum: number): Terms {
  return {
    // Round first, then floor: rounding a minimum-salary ask down would put it below his minimum.
    aav: Math.max(minimum, roundTo(p.marketAAV * pers.askFactor * (1 - pers.loyalty), 50_000)),
    years: pers.preferredYears,
    guaranteePct: roundTo(pers.guaranteeExpect, 0.05),
    structure: pers.wantsCashNow ? 'front-loaded' : 'backloaded',
  }
}

export type Band = 'insulting' | 'short' | 'close' | 'deal'

export interface Evaluation {
  /** Offer value relative to the ask; ≥ 1 is a deal. */
  score: number
  band: Band
}

const STRUCTURE_VALUE: Record<Structure, (cashNow: boolean) => number> = {
  backloaded: (cashNow) => (cashNow ? 0.97 : 1),
  balanced: () => 1,
  'front-loaded': (cashNow) => (cashNow ? 1.04 : 1.02),
  // Incentives are worth something, but only if he earns them.
  incentive: () => 1 + INCENTIVE_SHARE * 0.35,
}

export function evaluateOffer(ask: Terms, pers: Personality, offer: Terms): Evaluation {
  const money = offer.aav / ask.aav
  // Timing preferences only matter when there is more than one year to shape.
  const structure = offer.years > 1 || offer.structure === 'incentive' ? STRUCTURE_VALUE[offer.structure](pers.wantsCashNow) : 1
  const gtd = 1 + (offer.guaranteePct - ask.guaranteePct) * 0.4
  const yearGap = offer.years - ask.years
  // Fewer years than he wants hurts more than extra years.
  const years = 1 - (yearGap < 0 ? 0.06 * -yearGap : 0.025 * yearGap)
  const score = money * structure * gtd * years
  return { score, band: band(score) }
}

function band(score: number): Band {
  if (score >= 0.995) return 'deal'
  if (score >= 0.95) return 'close'
  if (score >= 0.85) return 'short'
  return 'insulting'
}

export type Response =
  | { kind: 'accept' }
  | { kind: 'counter'; patienceLeft: number }
  | { kind: 'walk' }

/** One round at the table. An insulting offer costs two rounds of patience. */
export function respond(evaluation: Evaluation, patience: number): Response {
  if (evaluation.band === 'deal') return { kind: 'accept' }
  const left = patience - (evaluation.band === 'insulting' ? 2 : 1)
  return left <= 0 ? { kind: 'walk' } : { kind: 'counter', patienceLeft: left }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function roundTo(n: number, step: number) {
  return Math.round(n / step) * step
}
