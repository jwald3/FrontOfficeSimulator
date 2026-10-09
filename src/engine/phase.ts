import { coachSettled } from './coach'
import { draftDone, simToUser } from './draft'
import { advanceWave, openMarket, pendingSheets, WAVES } from './market'
import { expireOffers, generateOffers } from './trades'
import { PHASES, type RunState, type Snapshot } from './types'

export type PhaseResult = { ok: true; run: RunState } | { ok: false; reason: string }

/** Move to the next phase, running whatever happens on the way in. */
export function advancePhase(run: RunState, snap: Snapshot): PhaseResult {
  const i = PHASES.indexOf(run.phase)
  if (i >= PHASES.length - 1) return { ok: false, reason: 'The offseason is over.' }
  const pending = pendingSheets(run)
  if (run.phase === 'free-agency' && pending.length) {
    return { ok: false, reason: `Decide on ${pending.length} offer sheet${pending.length > 1 ? 's' : ''} before the draft.` }
  }
  if (run.phase === 'coach' && !coachSettled(run)) return { ok: false, reason: 'Keep the head coach or hire a new one first.' }
  if (run.phase === 'draft' && !draftDone(run)) return { ok: false, reason: 'Finish the draft first.' }
  let next: RunState = { ...run, phase: PHASES[i + 1] }
  if (next.phase === 'free-agency') {
    next = openMarket(next, snap)
    next = { ...next, tradeOffers: generateOffers(next, snap, 0) }
  }
  if (next.phase === 'draft') {
    // Trade offers expire when free agency closes; the AI is on the clock until our first pick.
    next = simToUser({ ...expireOffers(next), draft: { cursor: 0, selections: {}, udfa: {} } }, snap).run
  }
  return { ok: true, run: next }
}

/** Run the free-agency clock forward one wave; trade offers from the last wave expire. */
export function advanceClock(run: RunState, snap: Snapshot): PhaseResult {
  if (run.phase !== 'free-agency' || !run.market) return { ok: false, reason: 'Free agency is not open.' }
  if (run.market.wave >= WAVES.length - 1) return { ok: false, reason: 'This is the last wave of free agency.' }
  const next = expireOffers(advanceWave(run, snap))
  return { ok: true, run: { ...next, tradeOffers: generateOffers(next, snap, next.market!.wave) } }
}
