import { describe, expect, it } from 'vitest'
import { simulateResignings } from './autoresign'
import { capSummary } from './cap'
import { isStarter } from './depth'
import { advancePhase } from './phase'
import { table } from './resign'

import { loadSnapshot, startRun } from './snapshot.testutil'
import type { Mode, RunState, Snapshot } from './types'

const snap: Snapshot = loadSnapshot()
const atResign = (mode: Mode = 'genuine'): RunState => {
  const r = advancePhase(startRun(snap, { mode, objective: 'balanced', seed: 3 }), snap)
  if (!r.ok) throw new Error(r.reason)
  return r.run
}
const space = (run: RunState) => capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase).effectiveSpace

describe('simulated re-signings', () => {
  it('settles every open decision', () => {
    const run = atResign()
    const { run: out, decisions } = simulateResignings(run, snap)
    expect(decisions).toHaveLength(run.expiring.filter((p) => p.status === 'open').length)
    expect(out.expiring.filter((p) => p.status === 'open')).toHaveLength(0)
  })

  it('only re-signs starters 30 or younger and leaves room for free agency', () => {
    const { run: out, decisions } = simulateResignings(atResign(), snap)
    for (const d of decisions.filter((x) => x.move.kind === 'sign')) {
      expect(isStarter(d.player)).toBe(true)
      expect(d.player.age).toBeLessThanOrEqual(30)
    }
    expect(space(out)).toBeGreaterThanOrEqual(25_000_000)
  })

  it('tenders rights players in Genuine mode and negotiates with them in Simplified', () => {
    const genuine = simulateResignings(atResign('genuine'), snap).decisions
    const simplified = simulateResignings(atResign('simplified'), snap).decisions
    const kind = (ds: typeof genuine, name: string) => ds.find((d) => d.player.name === name)?.move.kind
    expect(kind(genuine, 'Austin McNamara')).toBe('tender')
    expect(kind(simplified, 'Austin McNamara')).toBe('sign')
  })

  it('is deterministic', () => {
    expect(simulateResignings(atResign(), snap)).toEqual(simulateResignings(atResign(), snap))
  })
})

describe('asking terms', () => {
  it('never ask below the league minimum, even after rounding', () => {
    const run = atResign('simplified')
    for (const p of run.expiring) {
      const t = table(run, snap, p)
      expect(t.ask.aav).toBeGreaterThanOrEqual(t.minimum)
    }
  })
})

describe('editorial re-sign calls', () => {
  const withCalls = (calls: NonNullable<NonNullable<Snapshot['editorial']>['resign']>['calls']): Snapshot => ({
    ...snap,
    editorial: { version: 1, coach: { coordinatorIds: [], manual: [] }, resign: { calls } },
  })
  const decisionFor = (s: Snapshot, name: string, mode: Mode = 'genuine') => {
    const run = atResign(mode)
    const p = run.expiring.find((x) => x.name === name)!
    return simulateResignings(run, s).decisions.find((d) => d.player.id === p.id)!
  }
  const idOf = (name: string) => atResign().expiring.find((x) => x.name === name)!.id

  it('follows the editor over the rule, with the editor’s reason', () => {
    // The rule re-signs Dane Belton (a 27-year-old starter) and lets Geno Smith (37) walk.
    expect(decisionFor(snap, 'Dane Belton').move.kind).toBe('sign')
    expect(decisionFor(snap, 'Geno Smith').move.kind).toBe('let-walk')
    const s = withCalls({
      [idOf('Dane Belton')]: { call: 'walk', reason: 'Safety depth is better spent elsewhere.' },
      [idOf('Geno Smith')]: { call: 're-sign', reason: 'A bridge year while Klubnik develops.' },
    })
    const belton = decisionFor(s, 'Dane Belton')
    const geno = decisionFor(s, 'Geno Smith')
    expect([belton.move.kind, belton.reason, belton.editorial]).toEqual(['let-walk', 'Safety depth is better spent elsewhere.', true])
    expect([geno.move.kind, geno.reason, geno.editorial]).toEqual(['sign', 'A bridge year while Klubnik develops.', true])
  })

  it('re-signs a player the editor wants tendered when he can’t be tendered', () => {
    const s = withCalls({ [idOf('Harrison Phillips')]: { call: 'tender', reason: 'Keep him.' } })
    expect(decisionFor(s, 'Harrison Phillips').move.kind).toBe('sign')
  })

  it('explains rule-based decisions too', () => {
    const d = decisionFor(snap, 'Geno Smith')
    expect(d.editorial).toBe(false)
    expect(d.reason.length).toBeGreaterThan(0)
  })
})
