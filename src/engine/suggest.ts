import { capSummary, releaseSavings, seasonCapHit } from './cap'
import { isStarter } from './depth'
import { money } from './format'
import { placeOnTradeBlock, previewRestructure, release, restructure } from './moves'
import { startingLineup } from './summary'
import { isUntouchable } from './valuation'
import { DEFAULT_INHOUSE_RULE, type InHouseCall } from './editorialSchema'
import type { Contract, Position, RunState, Snapshot } from './types'

export type SuggestionKind = 'release' | 'restructure' | 'block'

export interface Suggestion {
  kind: SuggestionKind
  player: Contract
  /** Cap space this season the move is worth, net of replacing him. Ranks the list. */
  value: number
  reason: string
  /** True when the editor made this call. */
  editorial: boolean
}

/** Guard against a suggestion that never clears (it shouldn't happen). */
const MAX_SIMULATED_MOVES = 20

/**
 * "Simulate in-house decisions": make the suggested moves, best first, re-checking
 * after each one since cap space changes what's suggested. Returns the moves made,
 * in order. Quick start uses the same pass.
 */
export function simulateInHouse(run: RunState, snap: Snapshot): { run: RunState; made: Suggestion[] } {
  let next = run
  const made: Suggestion[] = []
  for (let i = 0; i < MAX_SIMULATED_MOVES; i++) {
    const s = suggestInHouse(next, snap)[0]
    if (!s) break
    const act = s.kind === 'release' ? release : s.kind === 'restructure' ? restructure : placeOnTradeBlock
    const r = act(next, s.player.id, snap)
    if (!r.ok) break
    next = r.run
    made.push(s)
  }
  return { run: next, made }
}


/**
 * What it costs to sign a proven starter at this position: the median price of
 * unrestricted free agents listed first on their current depth charts (the cheapest
 * are often fill-ins on weak teams), or undefined if the market has none.
 */
export function replacementCost(snap: Snapshot, pos: Position): number | undefined {
  const asks = snap.freeAgents
    .filter((f) => f.pos === pos && isStarter(f) && (f.type === 'UFA' || f.type === 'Void'))
    .map((f) => f.marketAAV)
    .sort((a, b) => a - b)
  return asks.length ? asks[Math.floor(asks.length / 2)] : undefined
}

/**
 * The in-house moves to suggest, best first. An editorial call wins when there is
 * one (editorial.json, set on the editorial screen): it lists the move with the
 * editor's reason, or keeps the player off the list. Editorial calls come first, and
 * one whose move can't be made any more (already restructured or listed) drops out.
 *
 * Players without a call follow the rule, which the editor can tune or switch off
 * (DEFAULT_INHOUSE_RULE otherwise):
 *
 * - Release a lineup starter when the cut saves at least $2M more than signing a
 *   proven starter at his position. Anyone outside the lineup only needs to save $2M.
 * - Restructure a lineup starter aged 30 or under, only when cap space is actually
 *   tight (under $25M), since it borrows from future years. Never when the objective
 *   is creating cap room.
 */
export function suggestInHouse(run: RunState, snap: Snapshot): Suggestion[] {
  const lineup = new Set(startingLineup(run.roster).map((s) => s.player?.id))
  const space = capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase).effectiveSpace
  const calls = snap.editorial?.inHouse?.calls ?? {}
  const rule = { ...DEFAULT_INHOUSE_RULE, ...snap.editorial?.inHouse?.rule }
  const out: Suggestion[] = []

  for (const p of run.roster) {
    const call = calls[p.id]
    if (call) {
      const s = call.call === 'block' && isUntouchable(snap, p.id) ? undefined : editorialSuggestion(run, p, call.call, call.reason.trim())
      if (s) out.push(s)
      continue
    }

    const saves = releaseSavings(p, run.season)
    const starter = lineup.has(p.id)
    const replace = starter ? replacementCost(snap, p.pos) : 0
    if (rule.release && replace !== undefined && saves - replace >= rule.minSurplus) {
      out.push({
        kind: 'release',
        player: p,
        value: saves - replace,
        reason: starter
          ? `Frees ${money(saves)}. A proven starting ${p.pos} costs about ${money(replace)} in free agency`
          : `Outside the starting lineup on a ${money(seasonCapHit(p, run.season))} cap hit. Cutting him frees ${money(saves)}`,
        editorial: false,
      })
      continue
    }

    const rs = previewRestructure(run, p.id)
    if (rule.restructure && rs.eligible && space < rule.tightSpace && run.objective !== 'cap-room' && starter && p.age <= rule.maxAge) {
      out.push({
        kind: 'restructure',
        player: p,
        value: rs.savings,
        reason: `Cap is tight. Converting salary to bonus frees ${money(rs.savings)} now and keeps him`,
        editorial: false,
      })
    }
  }

  return out.sort((a, b) => Number(b.editorial) - Number(a.editorial) || b.value - a.value)
}

/** The editor's call as a suggestion, or undefined for 'keep' or a move that's no longer possible. */
function editorialSuggestion(run: RunState, p: Contract, call: InHouseCall, reason: string): Suggestion | undefined {
  if (call === 'release') {
    const saves = releaseSavings(p, run.season)
    return { kind: 'release', player: p, value: saves, reason: reason || `Cutting him frees ${money(saves)}`, editorial: true }
  }
  if (call === 'restructure') {
    const rs = previewRestructure(run, p.id)
    if (!rs.eligible) return undefined
    return { kind: 'restructure', player: p, value: rs.savings, reason: reason || `Converting salary to bonus frees ${money(rs.savings)} now`, editorial: true }
  }
  if (call === 'block') {
    if (p.onTradeBlock) return undefined
    const saves = seasonCapHit(p, run.season) - p.tradeDead
    return { kind: 'block', player: p, value: saves, reason: reason || `Shop him and see what teams offer`, editorial: true }
  }
  return undefined
}
