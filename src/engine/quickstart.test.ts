import { describe, expect, it } from 'vitest'
import { capSummary } from './cap'
import { pendingSheets } from './market'
import { fastForward } from './quickstart'
import { createRun } from './run'
import { loadSnapshot } from './snapshot.testutil'
import { provenStarters } from './summary'
import type { Snapshot } from './types'

const snap: Snapshot = loadSnapshot()
const fresh = (seed = 11) => createRun(snap, { mode: 'genuine', objective: 'balanced', seed })

describe('quick start', () => {
  it('leaves a run alone when starting at the beginning', () => {
    expect(fastForward(fresh(), snap, 'start')).toEqual(fresh())
  })

  it('arrives at free agency with the coach kept, suggestions made and every re-sign settled', () => {
    const run = fastForward(fresh(), snap, 'free-agency')
    expect(run.phase).toBe('free-agency')
    expect(run.coach?.status).toBe('kept')
    expect(run.expiring.every((e) => e.status !== 'open')).toBe(true)
    expect(run.moves.some((m) => m.kind === 'release')).toBe(true)
    expect(run.market?.wave).toBe(0)
  })

  it('arrives at the draft after a free agency that fills lineup holes and keeps room', () => {
    const start = fastForward(fresh(), snap, 'free-agency')
    const run = fastForward(fresh(), snap, 'draft')
    const space = capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase).effectiveSpace
    expect(run.phase).toBe('draft')
    expect(run.draft).toBeDefined()
    expect(pendingSheets(run)).toHaveLength(0)
    expect(provenStarters(run.roster)).toBeGreaterThanOrEqual(provenStarters(start.roster))
    expect(space).toBeGreaterThanOrEqual(0)
  })

  it('records the phase each simulated move was made in', () => {
    const run = fastForward(fresh(), snap, 'draft')
    const phaseOf = (kind: string) => [...new Set(run.moves.filter((m) => m.kind === kind).map((m) => m.phase))]
    expect(phaseOf('coach-keep')).toEqual(['coach'])
    expect(phaseOf('release')).toEqual(['in-house'])
    expect(phaseOf('let-walk')).toEqual(['re-sign'])
    expect(run.moves.some((m) => m.kind === 'sign' && m.phase === 'free-agency')).toBe(true)
  })

  it('is deterministic for a seed', () => {
    expect(fastForward(fresh(5), snap, 'draft')).toEqual(fastForward(fresh(5), snap, 'draft'))
  })
})
