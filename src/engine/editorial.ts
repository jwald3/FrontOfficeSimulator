import type { CoachCandidate } from './coach'
import { chartPlayers } from './depth'
import { applyDraftOrder } from './draft'
import { valuationContext } from './valuation'
import { DEFAULT_VALUATION, type EditorialData } from './editorialSchema'
import type { Snapshot } from './types'

export { coachCase, DECLARE_CALLS, DEFAULT_DRAFT_ADVICE, DEFAULT_INHOUSE_RULE, DEFAULT_VALUATION, DEFAULT_INTEREST_LEVELS, EMPTY_EDITORIAL, FIXED_INTERESTS, INHOUSE_CALLS, INTERESTS, interestLevel, MARKET_CALLS, RESIGN_CALLS, validateEditorial, type CoachCase, type ColorSet, type DeclareCall, type EditorialColors, type FixedColors, type DraftAdviceRule, type EditorialData, type InHouseCall, type InHouseRule, type Interest, type InterestLevel, type ManualCandidate, type MarketCall, type PositionValue, type ResignCall, type ValuationModel } from './editorialSchema'

// Editorial controls: choices an editor makes about the game's content, saved to
// public/data/editorial.json and shipped with the snapshot. The editor screen
// (ui/Editorial.tsx) writes the file through the dev server.

/** public/data/coordinators.json, built by scripts/coordinators.mjs. */
export interface CoordinatorsData {
  source: string
  asOf: string
  /** Each team's head coach, by team id. */
  headCoaches?: Record<string, string>
  coordinators: { id: string; name: string; team: string; role: 'OC' | 'DC' }[]
}

/** "Michigan's Sherrone Moore" → "manual-michigan-s-sherrone-moore", unique against taken ids. */
export function manualId(name: string, taken: string[]): string {
  const base = `manual-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

/**
 * The hiring board: chosen coordinators (ours first, then by team) followed by
 * manual entries. Our own coordinators are internal, so promoting one always works.
 * Ids that no longer match a coordinator (he changed jobs) are dropped.
 */
export function coachCandidates(snap: Pick<Snapshot, 'teams' | 'team'>, coordinators: CoordinatorsData, editorial: EditorialData): CoachCandidate[] {
  const chosen = new Set(editorial.coach.coordinatorIds)
  const teamName = (id: string) => snap.teams.find((t) => t.id === id)?.fullName ?? id
  const fromStaffs: CoachCandidate[] = coordinators.coordinators
    .filter((c) => chosen.has(c.id))
    .sort((a, b) => Number(b.team === snap.team) - Number(a.team === snap.team) || teamName(a.team).localeCompare(teamName(b.team)) || a.role.localeCompare(b.role))
    .map((c) => ({
      id: c.id,
      name: c.name,
      role: `${teamName(c.team)} ${c.role === 'OC' ? 'offensive' : 'defensive'} coordinator`,
      kind: c.role,
      internal: c.team === snap.team,
    }))
  const manual: CoachCandidate[] = editorial.coach.manual.map((m) => ({ id: m.id, name: m.name, role: m.role, kind: 'other', internal: false }))
  return [...fromStaffs, ...manual].map((c) => ({
    ...c,
    // Our own coordinators are promotions: they always accept.
    interest: c.internal ? 'yes' : (editorial.coach.interest?.[c.id] ?? 'maybe'),
    note: editorial.coach.notes?.[c.id] || undefined,
  }))
}

/** Attach the editorial content the engine needs to the snapshot, in place. */
export function attachEditorial(snap: Snapshot, coordinators: CoordinatorsData, editorial: EditorialData): Snapshot {
  snap.coachCandidates = coachCandidates(snap, coordinators, editorial)
  snap.headCoach = coordinators.headCoaches?.[snap.team]
  snap.editorial = editorial
  // Free-agency calls ride on each player, so the market sees them wherever he goes.
  const calls = editorial.market?.calls ?? {}
  for (const p of snap.freeAgents) {
    if (calls[p.id] && !p.own) p.marketCall = calls[p.id]
    else delete p.marketCall
  }
  // Depth-chart spots: the editor's spot replaces the source one on every copy of the
  // player, so starters, the lineup, trade value and market demand all follow it.
  const spots = editorial.depth?.spots ?? {}
  for (const p of chartPlayers(snap)) {
    const spot = spots[p.id]
    p.chart = spot === undefined ? p.sourceChart : spot === null ? undefined : { team: p.sourceChart?.team ?? p.team, ...spot }
  }
  // The trade-value model, with what it needs from the league, for valuation.ts.
  snap.valuation = valuationContext(snap, { ...DEFAULT_VALUATION, ...editorial.valuation }, editorial.playerValues)
  // The draft order: picks re-slot to the editor's team order, with values and rookie
  // contracts following the new slots.
  applyDraftOrder(snap.picks, snap.season, editorial.draftOrder?.teams)
  // The draft board: the editor's order becomes each prospect's rank, so the board,
  // AI teams and projections all read it. The source rank is kept for comparison.
  const draft = editorial.draft ?? {}
  boardOrder(snap.prospects, draft.order).forEach((p, i) => {
    p.rank = i + 1
    if (draft.notes?.[p.id]?.trim()) p.note = draft.notes[p.id].trim()
    else delete p.note
    if (draft.declare?.[p.id] && p.declaration?.canReturn) p.declareCall = draft.declare[p.id]
    else delete p.declareCall
  })
  return snap
}

/**
 * Prospects in board order: the editor's order when there is one, otherwise the
 * source ranking. Prospects the order doesn't list (new to the snapshot) slot in
 * at their source rank; ids that no longer match a prospect are dropped. Records
 * each prospect's source rank on first sight, in place.
 */
export function boardOrder<P extends Pick<Snapshot['prospects'][number], 'id' | 'rank' | 'consensusRank'>>(prospects: P[], order?: string[]): P[] {
  for (const p of prospects) p.consensusRank ??= p.rank
  const consensus = [...prospects].sort((a, b) => a.consensusRank! - b.consensusRank!)
  if (!order?.length) return consensus
  const byId = new Map(prospects.map((p) => [p.id, p]))
  const board = order.flatMap((id) => byId.get(id) ?? [])
  const listed = new Set(board.map((p) => p.id))
  for (const p of consensus) if (!listed.has(p.id)) board.splice(Math.min(p.consensusRank! - 1, board.length), 0, p)
  return board
}
