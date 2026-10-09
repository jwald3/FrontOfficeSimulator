import { minimumSalary } from './contracts'
import type { Position, RawMarketPlayer, Snapshot } from './types'

// ─── RFA / ERFA tenders ─────────────────────────────────────────────────────

export type TenderLevel = 'erfa' | 'first' | 'second' | 'original' | 'refusal'

export interface TenderOption {
  level: TenderLevel
  name: string
  amount: number
  /** Round of the signing team's original 2027 pick owed if we decline to match. */
  compRound: number | null
}

const TENDER_NAME: Record<TenderLevel, string> = {
  erfa: 'Exclusive rights',
  first: 'First-round tender',
  second: 'Second-round tender',
  original: 'Original-round tender',
  refusal: 'Right of first refusal',
}

/**
 * ERFAs are tendered at their minimum and can't negotiate elsewhere. RFA tender
 * amounts grow the 2026 levels by the projected cap growth, with a floor of 110%
 * of the prior-year base.
 */
export function tenderOptions(snap: Snapshot, p: RawMarketPlayer): TenderOption[] {
  if (p.type === 'ERFA') {
    return [{ level: 'erfa', name: TENDER_NAME.erfa, amount: minimumSalary(snap, p.creditedSeasons, snap.season), compRound: null }]
  }
  if (p.type !== 'RFA') return []
  const { rfa2026, rfaGrowth } = snap.salaryRules
  const floor = Math.round((p.priorBase ?? p.currentAPY ?? 0) * 1.1)
  const amt = (base: number) => roundTo(Math.max(base * (1 + rfaGrowth), floor), 1000)
  const opts: TenderOption[] = [
    { level: 'first', name: TENDER_NAME.first, amount: amt(rfa2026.first), compRound: 1 },
    { level: 'second', name: TENDER_NAME.second, amount: amt(rfa2026.second), compRound: 2 },
  ]
  if (p.originalRound) {
    opts.push({ level: 'original', name: `${TENDER_NAME.original} (R${p.originalRound})`, amount: amt(rfa2026.original), compRound: p.originalRound })
  } else {
    opts.push({ level: 'refusal', name: TENDER_NAME.refusal, amount: amt(rfa2026.refusal), compRound: null })
  }
  return opts
}

// ─── Franchise / transition tags ────────────────────────────────────────────

export type TagKind = 'franchise' | 'transition'

const TAG_GROUP: Record<Position, string> = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', OT: 'OL', IOL: 'OL',
  IDL: 'DT', EDGE: 'DE', LB: 'LB', CB: 'CB', S: 'S', K: 'ST', P: 'ST', LS: 'ST',
}

/** One-year, fully guaranteed: the position's tag amount or 120% of last year's salary, whichever is higher. */
export function tagAmount(snap: Snapshot, p: RawMarketPlayer, kind: TagKind): number {
  const proj = snap.salaryRules.tagProjections[TAG_GROUP[p.pos]]
  if (!proj) return 0
  const level = kind === 'franchise' ? proj[0] : proj[1]
  return Math.max(level, Math.round((p.priorYearSalary ?? p.currentAPY ?? 0) * 1.2))
}

function roundTo(n: number, step: number) {
  return Math.round(n / step) * step
}
