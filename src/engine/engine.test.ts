import { describe, expect, it } from 'vitest'
import { capSummary, releaseSavings, seasonCapHit } from './cap'
import { placeOnTradeBlock, previewRestructure, release, restructure } from './moves'

import { loadSnapshot, startRun } from './snapshot.testutil'
import type { RunState, Snapshot } from './types'

const snap: Snapshot = loadSnapshot()
const fresh = (seed = 7): RunState => startRun(snap, { mode: 'genuine', objective: 'balanced', seed })
const summary = (run: RunState) => capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase)
const M = (n: number) => Math.round(n / 1e4) / 100

describe('cap summary', () => {
  it('matches the figures the current simulator shows at the start of a run', () => {
    const s = summary(fresh())
    expect(M(s.adjustedCap)).toBe(337.42)
    expect(M(s.committed)).toBe(228.15)
    expect(M(s.dead)).toBe(10.04)
    expect(M(s.totalSpace)).toBe(99.23)
    expect(M(s.draftReserve)).toBe(19.7)
    expect(M(s.effectiveSpace)).toBe(79.54)
    expect(s.contractCount).toBe(39)
  })
})

describe('release', () => {
  it('saves the cap hit minus accelerated dead money', () => {
    const run = fresh()
    const stephens = run.roster.find((p) => p.name === 'Brandon Stephens')!
    expect(releaseSavings(stephens, run.season)).toBe(8_000_000)

    const res = release(run, stephens.id)
    if (!res.ok) throw new Error(res.reason)
    const before = summary(run)
    const after = summary(res.run)
    expect(after.contractCount).toBe(38)
    expect(after.totalSpace - before.totalSpace).toBe(8_000_000)
    expect(res.move.capDelta).toBe(8_000_000)
    expect(res.run.news.at(-1)!.text).toContain('Brandon Stephens')
  })
})

describe('restructure', () => {
  const candidate = (run: RunState) => run.roster.find((p) => previewRestructure(run, p.id).eligible)!

  it('lowers this year by the converted amount less one year of proration, total value unchanged', () => {
    const run = fresh()
    const p = candidate(run)
    const pv = previewRestructure(run, p.id)
    const res = restructure(run, p.id)
    if (!res.ok) throw new Error(res.reason)
    expect(res.move.kind).toBe('restructure')
    const updated = res.run.roster.find((x) => x.id === p.id)!
    expect(seasonCapHit(p, run.season) - seasonCapHit(updated, run.season)).toBeCloseTo(pv.savings, -1)
    expect(updated.years.find((y) => y.year === run.season)!.base).toBe(p.minimumBase)
    // Base moved into bonus; base+bonus across the deal is preserved.
    const total = (c: typeof p) => c.years.reduce((a, y) => a + y.base + y.bonus + y.other, 0)
    expect(total(updated)).toBeCloseTo(total(p), -1)
    // Already-guaranteed base was dead money anyway; only the rest is newly guaranteed.
    expect(updated.releaseDead).toBeGreaterThanOrEqual(p.releaseDead)
  })

  it('can only be done once per contract', () => {
    const run = fresh()
    const p = candidate(run)
    const res = restructure(run, p.id)
    if (!res.ok) throw new Error(res.reason)
    expect(previewRestructure(res.run, p.id).eligible).toBe(false)
    expect(restructure(res.run, p.id).ok).toBe(false)
  })
})

describe('trade block', () => {
  it('lists the player once', () => {
    const run = fresh()
    const p = run.roster[0]
    const res = placeOnTradeBlock(run, p.id)
    if (!res.ok) throw new Error(res.reason)
    const listed = res.run.roster.find((x) => x.id === p.id)!
    expect(listed.onTradeBlock).toBe(true)
    expect(placeOnTradeBlock(res.run, p.id).ok).toBe(false)
  })
})
