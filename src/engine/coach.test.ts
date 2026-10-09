import { describe, expect, it } from 'vitest'
import { coachSettled, fireCoach, keepCoach, offerCoachJob } from './coach'
import { advancePhase } from './phase'
import { createRun } from './run'
import { loadSnapshot } from './snapshot.testutil'
import type { RunState, Snapshot } from './types'
import type { Interest } from './editorialSchema'

const snap: Snapshot = loadSnapshot()
const fresh = (seed = 5): RunState => createRun(snap, { mode: 'genuine', objective: 'balanced', seed })
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason)
  return r as Extract<T, { ok: true }>
}

describe('head coach', () => {
  it('opens the offseason and blocks advancing until decided', () => {
    const run = fresh()
    expect(run.phase).toBe('coach')
    expect(advancePhase(run, snap).ok).toBe(false)
  })

  it('keeping him settles the phase', () => {
    const kept = ok(keepCoach(fresh())).run
    expect(kept.coach).toEqual({ status: 'kept', name: 'Aaron Glenn' })
    expect(ok(advancePhase(kept, snap)).run.phase).toBe('in-house')
    expect(keepCoach(kept).ok).toBe(false)
  })

  it('firing him opens a search that must end in a hire', () => {
    const fired = ok(fireCoach(fresh())).run
    expect(coachSettled(fired)).toBe(false)
    expect(advancePhase(fired, snap).ok).toBe(false)
    const hired = ok(offerCoachJob(fired, snap, 'nyj-oc-frank-reich')).run
    expect(hired.coach).toMatchObject({ status: 'hired', name: 'Frank Reich' })
    expect(ok(advancePhase(hired, snap)).run.phase).toBe('in-house')
  })

  it('outside candidates sometimes decline, and a decline takes them off the board', () => {
    const outside = snap.coachCandidates!.filter((c) => !c.internal).slice(0, 6).map((c) => c.id)
    let declines = 0
    for (let seed = 1; seed <= 40; seed++) {
      const fired = ok(fireCoach(fresh(seed))).run
      for (const id of outside) {
        const res = ok(offerCoachJob(fired, snap, id))
        if (res.move.kind === 'coach-decline') {
          declines++
          expect(offerCoachJob(res.run, snap, id).ok).toBe(false)
        }
      }
    }
    expect(declines).toBeGreaterThan(0)
    expect(declines).toBeLessThan(40 * outside.length)
  })

  it('is deterministic for a seed', () => {
    const fired = ok(fireCoach(fresh(9))).run
    const id = snap.coachCandidates!.find((c) => !c.internal)!.id
    expect(offerCoachJob(fired, snap, id)).toEqual(offerCoachJob(ok(fireCoach(fresh(9))).run, snap, id))
  })
})

describe('editorial candidate interest', () => {
  const withInterest = (id: string, interest: Interest) => ({
    ...snap,
    coachCandidates: snap.coachCandidates!.map((c) => (c.id === id ? { ...c, interest } : c)),
  })

  it("'yes' always accepts and 'no' always refuses, whatever the seed", () => {
    const id = snap.coachCandidates!.find((c) => !c.internal)!.id
    for (let seed = 1; seed <= 20; seed++) {
      const fired = ok(fireCoach(fresh(seed))).run
      expect(ok(offerCoachJob(fired, withInterest(id, 'yes'), id)).move.kind).toBe('coach-hire')
      expect(ok(offerCoachJob(fired, withInterest(id, 'no'), id)).move.kind).toBe('coach-decline')
    }
  })

  it('the leans accept more or less often than a coin flip', () => {
    const id = snap.coachCandidates!.find((c) => !c.internal)!.id
    const rate = (interest: Interest) => {
      let yes = 0
      for (let seed = 1; seed <= 400; seed++) {
        const fired = ok(fireCoach(fresh(seed))).run
        if (ok(offerCoachJob(fired, withInterest(id, interest), id)).move.kind === 'coach-hire') yes++
      }
      return yes / 400
    }
    const [likely, maybe, unlikely] = [rate('likely'), rate('maybe'), rate('unlikely')]
    expect(likely).toBeGreaterThan(0.65)
    expect(likely).toBeLessThan(0.85)
    expect(maybe).toBeGreaterThan(0.4)
    expect(maybe).toBeLessThan(0.6)
    expect(unlikely).toBeGreaterThan(0.15)
    expect(unlikely).toBeLessThan(0.35)
  })

  it("follows the editor's tuned chance for a level", () => {
    const id = snap.coachCandidates!.find((c) => !c.internal)!.id
    const tuned = (chance: number) => ({
      ...withInterest(id, 'unlikely'),
      editorial: { ...snap.editorial!, coach: { ...snap.editorial!.coach, levels: { unlikely: { chance } } } },
    })
    for (let seed = 1; seed <= 20; seed++) {
      const fired = ok(fireCoach(fresh(seed))).run
      expect(ok(offerCoachJob(fired, tuned(1), id)).move.kind).toBe('coach-hire')
      expect(ok(offerCoachJob(fired, tuned(0), id)).move.kind).toBe('coach-decline')
    }
  })

  it('our own coordinators accept even if marked uninterested', () => {
    const fired = ok(fireCoach(fresh())).run
    const id = 'nyj-dc-brian-duker'
    expect(ok(offerCoachJob(fired, withInterest(id, 'no'), id)).move.kind).toBe('coach-hire')
  })
})
