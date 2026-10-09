import { releaseSavings, seasonCapHit, yearOf, yearsRemaining } from './cap'
import { money } from './format'
import type { Contract, Move, MoveKind, NewsItem, RunState, Snapshot } from './types'
import { isUntouchable } from './valuation'

/** Converted salary is spread over at most five seasons. */
export const MAX_PRORATION_YEARS = 5

export type MoveResult =
  | { ok: true; run: RunState; move: Move }
  | { ok: false; reason: string }

function findPlayer(run: RunState, id: string): Contract | undefined {
  return run.roster.find((p) => p.id === id)
}

export function withMove(
  run: RunState,
  kind: MoveKind,
  playerId: string,
  headline: string,
  detail: string,
  capDelta: number,
  news?: Omit<NewsItem, 'id'>,
): { run: RunState; move: Move } {
  const move: Move = { id: run.nextId, kind, playerId, headline, detail, capDelta, phase: run.phase }
  const items = news ? [{ ...news, id: run.nextId + 1 }] : []
  return {
    move,
    run: { ...run, moves: [...run.moves, move], news: [...run.news, ...items], nextId: run.nextId + 2 },
  }
}

// ─── Release ────────────────────────────────────────────────────────────────

export function release(run: RunState, playerId: string): MoveResult {
  const p = findPlayer(run, playerId)
  if (!p) return { ok: false, reason: 'Player is not under contract.' }
  const saved = releaseSavings(p, run.season)
  const next: RunState = {
    ...run,
    roster: run.roster.filter((x) => x.id !== playerId),
    dead: p.releaseDead > 0
      ? [...run.dead, { playerId, name: p.name, amount: p.releaseDead, reason: 'release' }]
      : run.dead,
  }
  const { run: out, move } = withMove(
    next,
    'release',
    playerId,
    `Released ${p.pos} ${p.name}`,
    p.releaseDead > 0 ? `${money(p.releaseDead)} dead money` : 'No dead money',
    saved,
    { tone: 'team', text: `${run.teamName} release ${p.pos} ${p.name}, clearing ${money(saved)} in ${run.season} cap space` },
  )
  return { ok: true, run: out, move }
}

// ─── Restructure ────────────────────────────────────────────────────────────

export interface RestructurePreview {
  eligible: boolean
  reason?: string
  converted: number
  prorationYears: number
  savings: number
}

export function previewRestructure(run: RunState, playerId: string): RestructurePreview {
  const p = findPlayer(run, playerId)
  const none = { converted: 0, prorationYears: 0, savings: 0 }
  if (!p) return { eligible: false, reason: 'Not under contract', ...none }
  const y = yearOf(p, run.season)
  const remaining = yearsRemaining(p, run.season)
  const converted = y ? Math.max(0, y.base - p.minimumBase) : 0
  const prorationYears = Math.min(MAX_PRORATION_YEARS, remaining)
  const savings = prorationYears > 1 ? Math.round(converted - converted / prorationYears) : 0
  const base = { converted, prorationYears, savings }
  if (!p.restructureEligible) return { ...base, eligible: false, reason: 'Contract does not allow conversion' }
  if (p.restructured) return { ...base, eligible: false, reason: 'Already restructured' }
  if (remaining < 2) return { ...base, eligible: false, reason: 'Needs two or more years remaining' }
  if (savings < 250_000) return { ...base, eligible: false, reason: 'Not enough base salary to convert' }
  return { ...base, eligible: true }
}

/** The contract after a restructure. */
export function restructuredContract(run: RunState, p: Contract, pv: RestructurePreview): Contract {
  const perYear = pv.converted / pv.prorationYears
  const years = p.years.map((y) => {
    if (y.year < run.season || y.year >= run.season + pv.prorationYears) return y
    return y.year === run.season
      ? { ...y, base: y.base - pv.converted, bonus: y.bonus + perYear, guaranteedBase: Math.min(y.guaranteedBase, y.base - pv.converted) }
      : { ...y, bonus: y.bonus + perYear }
  })
  // The converted salary becomes bonus that would all accelerate on release.
  const y = yearOf(p, run.season)!
  const newlyGuaranteed = pv.converted - Math.min(pv.converted, y.guaranteedBase)
  return {
    ...p,
    years,
    restructured: true,
    releaseDead: p.releaseDead + newlyGuaranteed,
    tradeDead: p.tradeDead + newlyGuaranteed,
  }
}

/**
 * Convert base salary above the player's minimum into a prorated bonus. Cash is
 * unchanged, so players agree: this year's charge drops and later years absorb the
 * proration.
 */
export function restructure(run: RunState, playerId: string): MoveResult {
  const p = findPlayer(run, playerId)
  const pv = previewRestructure(run, playerId)
  if (!p || !pv.eligible) return { ok: false, reason: pv.reason ?? 'Not eligible' }

  const updated = restructuredContract(run, p, pv)
  const before = seasonCapHit(p, run.season)
  const after = seasonCapHit(updated, run.season)
  const next: RunState = { ...run, roster: run.roster.map((x) => (x.id === p.id ? updated : x)) }
  const { run: out, move } = withMove(
    next,
    'restructure',
    p.id,
    `Restructured ${p.pos} ${p.name}`,
    `${money(pv.converted)} converted over ${pv.prorationYears} years · cap hit ${money(before)} → ${money(after)}`,
    before - after,
    { tone: 'team', text: `${run.teamName} restructure ${p.name}, freeing ${money(before - after)} in ${run.season} space` },
  )
  return { ok: true, run: out, move }
}

// ─── Trade block ────────────────────────────────────────────────────────────

/** Listing a player is public and can't be quietly taken back. Untouchable players can't be listed. */
export function placeOnTradeBlock(run: RunState, playerId: string, snap?: Pick<Snapshot, 'editorial'>): MoveResult {
  const p = findPlayer(run, playerId)
  if (!p) return { ok: false, reason: 'Player is not under contract.' }
  if (snap && isUntouchable(snap, playerId)) return { ok: false, reason: `${p.name} is untouchable. He isn't going anywhere.` }
  if (p.onTradeBlock) return { ok: false, reason: 'Already on the trade block.' }
  const updated: Contract = { ...p, onTradeBlock: true }
  const next: RunState = { ...run, roster: run.roster.map((x) => (x.id === p.id ? updated : x)) }
  const { run: out, move } = withMove(
    next,
    'trade-block',
    p.id,
    `${p.name} placed on the trade block`,
    'Teams can now make offers; they arrive in the free agency inbox',
    0,
    { tone: 'league', text: `Report: ${run.teamName} are shopping ${p.pos} ${p.name}` },
  )
  return { ok: true, run: out, move }
}
