import { capSummary } from './cap'
import { isStarter } from './depth'
import { letWalk, offerExpiring, applyTender, table } from './resign'
import { tenderOptions } from './rights'
import type { Expiring, Move, RunState, Snapshot } from './types'

// Editorial first: the editor can set each expiring player's call (re-sign, tender
// or let walk) with a reason on the editorial screen. Players without a call fall
// back to the rule below, which uses only real data: depth-chart role, age,
// contract type and cap space. No ratings.

/** Starters this old or younger are worth keeping at their ask. */
const MAX_RESIGN_AGE = 30
/** Room left for free agency; a rule-based re-signing that would dip below this is skipped. */
const FA_RESERVE = 25_000_000

export interface SimDecision {
  player: Expiring
  move: Move
  /** Why: the editor's reason, or the rule that decided it. */
  reason: string
  /** True when the editor made this call. */
  editorial: boolean
}

type Kept = { run: RunState; move: Move; reason: string }

/**
 * Settle every open decision on our own players. An editorial call wins when there
 * is one; otherwise, the way a cautious front office would:
 *
 * - ERFAs on a depth chart are tendered (it costs the minimum and he can't leave).
 * - RFAs who start or play second string get the cheapest tender. Simplified mode
 *   has no tenders, so they're treated like everyone else.
 * - Starters 30 or younger are re-signed at their ask, best-paid first, while at
 *   least $25M of effective space is left for free agency.
 * - Everyone else is allowed to walk.
 *
 * Pure: returns the new run and what happened to each player, so the UI can
 * preview it before committing.
 */
export function simulateResignings(run: RunState, snap: Snapshot): { run: RunState; decisions: SimDecision[] } {
  const calls = snap.editorial?.resign?.calls ?? {}
  const open = run.expiring
    .filter((p) => p.status === 'open')
    // Editorial calls first, then starters, then the bigger market price, so the budget goes to them.
    .sort((a, b) => Number(!!calls[b.id]) - Number(!!calls[a.id]) || Number(isStarter(b)) - Number(isStarter(a)) || b.marketAAV - a.marketAAV)
  const decisions: SimDecision[] = []
  let next = run

  for (const p of open) {
    const call = calls[p.id]
    const kept = call ? (call.call === 'walk' ? undefined : keepByCall(next, snap, p, call.call)) : keepByRule(next, snap, p)
    if (kept) {
      next = kept.run
      decisions.push({ player: p, move: kept.move, reason: call?.reason || kept.reason, editorial: !!call })
      continue
    }
    const walked = letWalk(next, p.id)
    if (walked.ok) {
      next = walked.run
      const reason = call
        ? call.call === 'walk'
          ? call.reason
          : `${call.reason ? `${call.reason} ` : ''}(Couldn't be done: not enough cap room or no deal at his ask.)`
        : 'Not a starter 30 or younger, so the rule lets him go'
      decisions.push({ player: p, move: walked.move, reason, editorial: !!call })
    }
  }
  return { run: next, decisions }
}

function cheapestTender(run: RunState, snap: Snapshot, p: Expiring): Kept | undefined {
  const tenders = run.mode === 'genuine' ? tenderOptions(snap, p) : []
  if (!tenders.length) return undefined
  const cheapest = [...tenders].sort((a, b) => a.amount - b.amount)[0]
  const res = applyTender(run, snap, p.id, cheapest.level)
  return res.ok ? { run: res.run, move: res.move, reason: `${cheapest.name} keeps his rights` } : undefined
}

function signAtAsk(run: RunState, snap: Snapshot, p: Expiring): Kept | undefined {
  const res = offerExpiring(run, snap, p.id, table(run, snap, p).ask)
  if (!res.ok || res.response.kind !== 'accept' || !res.move) return undefined
  return { run: res.run, move: res.move, reason: 'Re-signed at his ask' }
}

/**
 * The editor's call, honoured whenever the rules allow it: a tender call on a
 * player who can't be tendered (a UFA, or any player in Simplified mode) re-signs
 * him instead, and the free-agency reserve doesn't apply.
 */
function keepByCall(run: RunState, snap: Snapshot, p: Expiring, call: 're-sign' | 'tender'): Kept | undefined {
  if (call === 'tender') return cheapestTender(run, snap, p) ?? signAtAsk(run, snap, p)
  return signAtAsk(run, snap, p)
}

function keepByRule(run: RunState, snap: Snapshot, p: Expiring): Kept | undefined {
  if (run.mode === 'genuine' && tenderOptions(snap, p).length) {
    const playsNow = p.type === 'ERFA' ? !!p.chart : !!p.chart && p.chart.depth <= 2
    if (!playsNow) return undefined
    const t = cheapestTender(run, snap, p)
    // The tender's own detail already says what it does; the reason is why he qualified.
    return t && { ...t, reason: `Plays now: ${p.chart!.depth === 1 ? 'starter' : 'second string'} at ${p.chart!.slot}` }
  }

  if (!isStarter(p) || p.age > MAX_RESIGN_AGE) return undefined
  const signed = signAtAsk(run, snap, p)
  if (!signed) return undefined
  const space = capSummary(signed.run, snap.rookieScale.slots, snap.minimumRookieBase).effectiveSpace
  return space >= FA_RESERVE ? { ...signed, reason: `Starter aged ${p.age}: re-signed at his ask` } : undefined
}
