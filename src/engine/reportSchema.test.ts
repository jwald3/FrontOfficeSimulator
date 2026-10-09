import { describe, expect, it } from 'vitest'
import { buildReport } from '../game/reports'
import { advancePhase } from './phase'
import { resolveReport, validateNewReport, type OfferReport } from './reportSchema'
import { loadSnapshot, startRun } from './snapshot.testutil'
import type { RunState } from './types'

const snap = loadSnapshot()

/** A run at free agency, with whatever calls came in. */
function atFreeAgency(): RunState {
  let run = startRun(snap, { mode: 'genuine', objective: 'balanced', seed: 21 })
  for (let i = 0; i < 2; i++) {
    const r = advancePhase(run, snap)
    if (!r.ok) throw new Error(r.reason)
    run = r.run
  }
  return run
}

describe('offer reports', () => {
  it('build from an offer with everything an editor needs, and pass validation', () => {
    const run = atFreeAgency()
    const o = run.tradeOffers[0]
    const report = buildReport(run, snap, o, 'too-low', '  He is worth a first  ')
    expect(validateNewReport(report)).toBe(report)
    expect(report).toMatchObject({ id: `${run.seed}-${o.id}`, verdict: 'too-low', note: 'He is worth a first', offer: { team: o.team, kind: o.kind } })
    expect(report.offer.picks.length).toBe(o.pickIds.length)
    expect(report.player.value).toBeGreaterThan(0)
  })

  it('reject malformed reports', () => {
    expect(() => validateNewReport({})).toThrow()
    expect(() => validateNewReport({ id: 'x', verdict: 'meh', note: '' })).toThrow()
  })

  it('keep every step in their history', () => {
    const report = { ...buildReport(atFreeAgency(), snap, atFreeAgency().tradeOffers[0], 'too-high', ''), status: 'open', history: [{ at: 't0', action: 'flagged' }] } as OfferReport
    const adjusted = resolveReport(report, 'adjusted', 'Value 1,636 → 1,400', 't1')
    const reopened = resolveReport(adjusted, 'reopened', undefined, 't2')
    const ignored = resolveReport(reopened, 'ignored', undefined, 't3')
    expect([adjusted.status, reopened.status, ignored.status]).toEqual(['adjusted', 'open', 'ignored'])
    expect(ignored.history.map((e) => e.action)).toEqual(['flagged', 'adjusted', 'reopened', 'ignored'])
    expect(ignored.history[1].detail).toBe('Value 1,636 → 1,400')
  })
})
