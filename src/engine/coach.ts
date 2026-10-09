import { withMove, type MoveResult } from './moves'
import { roll } from './rng'
import { interestLevel, type Interest } from './editorialSchema'
import type { RunState, Snapshot } from './types'

// Editorial throughout (see editorial.ts): the candidate pool, each candidate's
// interest in the job, and the case for keeping or firing the coach are set on the
// editorial screen. Nothing here is rated: the decision has no effect on the cap
// or the grade.

export interface CoachCandidate {
  id: string
  name: string
  /** Who he is now, e.g. "Kansas City Chiefs defensive coordinator". */
  role: string
  kind: 'OC' | 'DC' | 'other'
  /** On our staff already: promoting him always works. */
  internal: boolean
  /** Editorial: does he want the job? Unset counts as 'maybe'. */
  interest?: Interest
  /** Editorial: a line shown on his card. */
  note?: string
}


export type CoachState =
  | { status: 'kept'; name: string }
  | { status: 'searching'; declined: string[] }
  | { status: 'hired'; name: string; candidateId: string; declined: string[] }

/** The coach phase is done once the coach is kept or a replacement is hired. */
export function coachSettled(run: RunState): boolean {
  return run.coach?.status === 'kept' || run.coach?.status === 'hired'
}

export function keepCoach(run: RunState): MoveResult {
  if (run.phase !== 'coach' || run.coach) return { ok: false, reason: 'The head coach decision is already made.' }
  return {
    ok: true,
    ...withMove(
      { ...run, coach: { status: 'kept', name: run.coachName } },
      'coach-keep',
      'coach',
      `${run.coachName} returns as head coach`,
      `He leads the team into ${run.season}`,
      0,
      { tone: 'team', text: `${run.teamName} confirm ${run.coachName} will coach the team in ${run.season}` },
    ),
  }
}

export function fireCoach(run: RunState): MoveResult {
  if (run.phase !== 'coach' || run.coach) return { ok: false, reason: 'The head coach decision is already made.' }
  return {
    ok: true,
    ...withMove(
      { ...run, coach: { status: 'searching', declined: [] } },
      'coach-fire',
      'coach',
      `Fired head coach ${run.coachName}`,
      'The search for his replacement begins',
      0,
      { tone: 'alert', text: `BREAKING: ${run.teamName} fire head coach ${run.coachName}` },
    ),
  }
}

/**
 * Offer the job. The editor decides how interested each candidate is: 'yes' always
 * accepts (staff promotions always do), 'no' always refuses, and the levels between
 * are a seeded roll at their chance (editorial, see DEFAULT_INTEREST_LEVELS), so the
 * same run always gets the same answer.
 * A refusal takes him off the board.
 */
export function offerCoachJob(run: RunState, snap: Pick<Snapshot, 'coachCandidates' | 'editorial'>, candidateId: string): MoveResult {
  const search = run.coach
  if (search?.status !== 'searching') return { ok: false, reason: 'There is no coaching search under way.' }
  const c = snap.coachCandidates?.find((x) => x.id === candidateId)
  if (!c) return { ok: false, reason: 'Unknown candidate.' }
  if (search.declined.includes(c.id)) return { ok: false, reason: `${c.name} already turned us down.` }

  const interest: Interest = c.internal ? 'yes' : (c.interest ?? 'maybe')
  const accepts = roll(run.seed, `coach:${c.id}`) < interestLevel(snap.editorial?.coach.levels, interest).chance
  if (!accepts) {
    return {
      ok: true,
      ...withMove(
        { ...run, coach: { ...search, declined: [...search.declined, c.id] } },
        'coach-decline',
        'coach',
        `${c.name} turned down the job`,
        c.role,
        0,
        { tone: 'alert', text: `Report: ${run.teamName} head coaching target ${c.name} withdraws from consideration` },
      ),
    }
  }
  const name = c.name
  return {
    ok: true,
    ...withMove(
      { ...run, coach: { status: 'hired', name, candidateId: c.id, declined: search.declined } },
      'coach-hire',
      'coach',
      c.internal ? `Promoted ${c.name} to head coach` : `Hired ${c.name} as head coach`,
      c.role,
      0,
      { tone: 'team', text: c.internal ? `${run.teamName} promote ${c.name} to head coach` : `${run.teamName} hire ${c.name} as head coach` },
    ),
  }
}
