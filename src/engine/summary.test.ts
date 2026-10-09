import { describe, expect, it } from 'vitest'
import { bestForUs, draftDone, draftPlayer, simToUser } from './draft'
import { release } from './moves'
import { advancePhase } from './phase'

import { loadSnapshot, startRun } from './snapshot.testutil'
import { gradeOffseason, letterFor, LINEUP, provenStarters, startingLineup } from './summary'
import type { Objective, RunState, Snapshot } from './types'

const snap: Snapshot = loadSnapshot()
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason)
  return r as Extract<T, { ok: true }>
}

function playThrough(objective: Objective, tweak: (run: RunState) => RunState = (r) => r) {
  let run = tweak(startRun(snap, { mode: 'genuine', objective, seed: 41 }))
  for (let i = 0; i < 3; i++) run = ok(advancePhase(run, snap)).run
  while (!draftDone(run)) {
    run = ok(draftPlayer(run, snap, bestForUs(run, snap)!.id)).run
    run = simToUser(run, snap).run
  }
  return ok(advancePhase(run, snap)).run
}

describe('lineup', () => {
  it('fills 24 starting spots from the real depth chart, then by contract', () => {
    const lineup = startingLineup(snap.roster)
    expect(lineup).toHaveLength(LINEUP.reduce((a, l) => a + l.count, 0))
    // Klubnik is QB2 behind Geno Smith, whose contract is up, so he starts for us.
    expect(lineup.find((s) => s.pos === 'QB')!.player!.name).toBe('Cade Klubnik')
    expect(lineup.filter((s) => s.pos === 'LB').map((s) => s.player!.name).sort()).toEqual(['Demario Davis', 'Jamien Sherwood'])
  })

  it('counts one fewer proven starter when a starter is released', () => {
    const run = startRun(snap, { mode: 'genuine', objective: 'balanced', seed: 1 })
    const wilson = run.roster.find((p) => p.name === 'Garrett Wilson')!
    expect(provenStarters(ok(release(run, wilson.id)).run.roster)).toBe(provenStarters(run.roster) - 1)
  })
})

describe('grade', () => {
  it('maps scores to letters', () => {
    expect(letterFor(95)).toBe('A+')
    expect(letterFor(75)).toBe('B')
    expect(letterFor(10)).toBe('F')
  })

  it('reaches the summary phase with a full verdict', () => {
    const run = playThrough('balanced')
    expect(run.phase).toBe('summary')
    const v = gradeOffseason(run, snap)
    expect(v.categories).toHaveLength(5)
    expect(v.categories.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1)
    expect(v.score).toBeGreaterThan(0)
    expect(v.score).toBeLessThanOrEqual(100)
  })

  it('weights the same offseason differently by objective', () => {
    const scores = (['balanced', 'draft', 'win-now', 'cap-room'] as const).map((o) => gradeOffseason(playThrough(o), snap).score)
    expect(new Set(scores.map((s) => s.toFixed(2))).size).toBeGreaterThan(1)
  })

  it('punishes gutting the roster when the objective is to win now', () => {
    const gut = (run: RunState) =>
      [...run.roster]
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 8)
        .reduce((r, p) => ok(release(r, p.id)).run, run)
    const kept = gradeOffseason(playThrough('win-now'), snap).score
    const gutted = gradeOffseason(playThrough('win-now', gut), snap).score
    expect(gutted).toBeLessThan(kept)
  })
})
