import { simulateResignings } from './autoresign'
import { capSummary } from './cap'
import { keepCoach } from './coach'
import { isStarter } from './depth'
import { demand, entryFor, marketPool, marketTable, matchSheet, declineSheet, offerFreeAgent, pendingSheets, WAVES } from './market'
import type { MoveResult } from './moves'
import { advanceClock, advancePhase, type PhaseResult } from './phase'
import { simulateInHouse } from './suggest'
import { startingLineup } from './summary'
import type { RunState, Snapshot } from './types'

// Quick start: skip ahead to free agency or the draft, with every decision before it
// made the way a cautious front office would, using the same rules (and editorial
// calls) the game already offers as suggestions. Deterministic for a seed.

export type StartingPoint = 'start' | 'free-agency' | 'draft'

/** Effective space a simulated free agency keeps in hand, for rookies and in-season moves. */
const FA_BUFFER = 10_000_000

function ok(r: MoveResult | PhaseResult, run: RunState): RunState {
  return r.ok ? r.run : run
}

/**
 * A new run fast-forwarded to the starting point:
 *
 * - Head coach: kept.
 * - In-house: the Suggested moves, best first, re-checked after each since cap
 *   space changes what's suggested. Editor calls included.
 * - Re-sign: "Simulate re-signings" (editor calls, then the rule).
 * - Free agency (when starting at the draft): fill lineup spots without a proven
 *   starter with the best available starter at his Day 1 ask, keeping $10M of room;
 *   match offer sheets we can afford; then the league's waves run out.
 */
export function fastForward(run: RunState, snap: Snapshot, to: StartingPoint): RunState {
  if (to === 'start') return run
  let next = ok(keepCoach(run), run)
  next = ok(advancePhase(next, snap), next)

  next = simulateInHouse(next, snap).run
  next = ok(advancePhase(next, snap), next)

  next = simulateResignings(next, snap).run
  next = ok(advancePhase(next, snap), next)
  if (to === 'free-agency') return withNews(next, 'Quick start: the front office kept the coach, made the suggested moves and settled every re-signing')

  next = signForLineup(next, snap)
  for (const s of pendingSheets(next)) {
    const matched = matchSheet(next, snap, s.id)
    next = matched.ok ? matched.run : ok(declineSheet(next, s.id), next)
  }
  for (let w = next.market?.wave ?? 0; w < WAVES.length - 1; w++) next = ok(advanceClock(next, snap), next)
  next = withNews(next, 'Quick start: the front office kept the coach, made the suggested moves, settled re-signings and filled lineup holes in free agency')
  return ok(advancePhase(next, snap), next)
}

function withNews(run: RunState, text: string): RunState {
  return { ...run, news: [...run.news, { id: run.nextId, tone: 'team', text }], nextId: run.nextId + 1 }
}

/** Sign a proven starter for each lineup spot that lacks one, the most coveted available first. */
function signForLineup(run: RunState, snap: Snapshot): RunState {
  let next = run
  const gaps = startingLineup(next.roster).filter((s) => !s.player || !isStarter(s.player))
  for (const gap of gaps) {
    const candidates = marketPool(next, snap)
      .filter((p) => p.pos === gap.pos && isStarter(p) && entryFor(next, p).status === 'available')
      .sort((a, b) => demand(b) - demand(a) || b.marketAAV - a.marketAAV)
    for (const p of candidates) {
      const ask = marketTable(next, snap, p).ask
      const space = capSummary(next, snap.rookieScale.slots, snap.minimumRookieBase).effectiveSpace
      if (ask.aav > space - FA_BUFFER) continue
      const r = offerFreeAgent(next, snap, p.id, ask)
      if (r.ok && next.roster.length < r.run.roster.length) {
        next = r.run
        break
      }
    }
  }
  return next
}
