import { describe, expect, it } from 'vitest'
import { buildContract, minimumSalary, type Terms } from './contracts'
import { applyTag, applyTender, canTag, futuresAvailable, letWalk, offerExpiring, signFutures, table } from './resign'
import { tagAmount, tenderOptions } from './rights'

import { loadSnapshot, startRun } from './snapshot.testutil'
import type { RunState, Snapshot } from './types'

const snap: Snapshot = loadSnapshot()
const fresh = (seed = 11, mode: 'genuine' | 'simplified' = 'genuine'): RunState =>
  startRun(snap, { mode, objective: 'balanced', seed })
const byName = (run: RunState, name: string) => run.expiring.find((p) => p.name === name)!

describe('contract builder', () => {
  const min = () => 1_260_000
  const terms: Terms = { aav: 10_000_000, years: 4, guaranteePct: 0.5, structure: 'backloaded' }

  it('schedules exactly the fixed value and guarantees', () => {
    const c = buildContract(terms, 2027, min)
    const total = c.years.reduce((a, y) => a + y.base + y.bonus + y.other, 0)
    expect(Math.abs(total - 40_000_000)).toBeLessThan(10)
    expect(c.guaranteed).toBe(20_000_000)
    expect(c.signingBonus).toBe(12_000_000)
    expect(c.releaseDead).toBe(20_000_000)
    expect(c.years.map((y) => y.year)).toEqual([2027, 2028, 2029, 2030])
  })

  it('orders first-year cap hits by structure', () => {
    const hit = (s: Terms['structure']) => {
      const y = buildContract({ ...terms, structure: s }, 2027, min).years[0]
      return y.base + y.bonus
    }
    expect(hit('backloaded')).toBeLessThan(hit('balanced'))
    expect(hit('balanced')).toBeLessThan(hit('front-loaded'))
  })

  it('keeps every base at or above the minimum', () => {
    const c = buildContract({ aav: 1_300_000, years: 3, guaranteePct: 0.9, structure: 'front-loaded' }, 2027, min)
    c.years.forEach((y) => expect(y.base).toBeGreaterThanOrEqual(1_260_000))
  })
})

describe('negotiation', () => {
  it('accepts his own asking terms and adds him to the roster', () => {
    const run = fresh()
    const p = byName(run, 'Dane Belton')
    const { ask } = table(run, snap, p)
    const res = offerExpiring(run, snap, p.id, ask)
    if (!res.ok) throw new Error(res.reason)
    expect(res.response.kind).toBe('accept')
    expect(res.run.roster.some((c) => c.id === p.id)).toBe(true)
    expect(byName(res.run, 'Dane Belton').status).toBe('signed')
    expect(res.move?.kind).toBe('sign')
  })

  it('gives the same answer to the same offer', () => {
    const p = byName(fresh(5), 'Andre Cisco')
    const t = table(fresh(5), snap, p)
    const low = { ...t.ask, aav: t.ask.aav * 0.9 }
    expect(offerExpiring(fresh(5), snap, p.id, low)).toEqual(offerExpiring(fresh(5), snap, p.id, low))
  })

  it('ends talks after enough lowball offers', () => {
    let run = fresh()
    const p = byName(run, 'Harrison Phillips')
    const { ask, minimum } = table(run, snap, p)
    const insult = { ...ask, aav: Math.max(minimum, ask.aav * 0.5) }
    for (let i = 0; i < 5; i++) {
      const res = offerExpiring(run, snap, p.id, insult)
      if (!res.ok) break
      run = res.run
    }
    expect(byName(run, 'Harrison Phillips').status).toBe('walked')
    expect(offerExpiring(run, snap, p.id, ask).ok).toBe(false)
  })

  it('refuses offers below the league minimum', () => {
    const run = fresh()
    const p = byName(run, 'Troy Reeder')
    const res = offerExpiring(run, snap, p.id, { aav: 500_000, years: 1, guaranteePct: 0, structure: 'balanced' })
    expect(res.ok).toBe(false)
  })
})

describe('tags', () => {
  it('prices the franchise tag at the position level or 120% of last salary', () => {
    const geno = snap.freeAgents.find((p) => p.name === 'Geno Smith')!
    expect(tagAmount(snap, geno, 'franchise')).toBe(50_308_000)
  })

  it('allows one tag per offseason, Genuine only', () => {
    const run = fresh()
    const belton = byName(run, 'Dane Belton')
    const res = applyTag(run, snap, belton.id, 'transition')
    if (!res.ok) throw new Error(res.reason)
    expect(res.run.tagUsed).toBe('transition')
    expect(canTag(res.run, byName(res.run, 'Andre Cisco'))).toMatch(/already used/)
    expect(canTag(fresh(11, 'simplified'), byName(fresh(11, 'simplified'), 'Andre Cisco'))).toMatch(/Genuine/)
  })
})

describe('tenders', () => {
  it('grows RFA levels with the cap and floors at 110% of prior base', () => {
    const williams = snap.rightsPlayers.find((p) => p.name === 'Isaiah Williams' && p.own)!
    const opts = tenderOptions(snap, williams)
    expect(opts.map((o) => o.level)).toEqual(['first', 'second', 'refusal'])
    expect(opts[0].amount).toBe(Math.round((snap.salaryRules.rfa2026.first * (1 + snap.salaryRules.rfaGrowth)) / 1000) * 1000)
  })

  it('offers an original-round tender only to drafted players', () => {
    const briggs = snap.rightsPlayers.find((p) => p.name === 'Jowon Briggs' && p.own)!
    expect(tenderOptions(snap, briggs).find((o) => o.level === 'original')?.compRound).toBe(7)
  })

  it('tenders an ERFA at his minimum and adds him to the roster', () => {
    const run = fresh()
    const p = byName(run, 'Austin McNamara')
    const res = applyTender(run, snap, p.id, 'erfa')
    if (!res.ok) throw new Error(res.reason)
    const c = res.run.roster.find((x) => x.id === p.id)!
    expect(c.years[0].base).toBe(minimumSalary(snap, p.creditedSeasons, 2027))
    expect(byName(res.run, 'Austin McNamara').status).toBe('tendered')
  })

  it('letting a player walk resolves him without a contract', () => {
    const run = fresh()
    const p = byName(run, 'Jamaal Pritchett')
    const res = letWalk(run, p.id)
    if (!res.ok) throw new Error(res.reason)
    expect(byName(res.run, 'Jamaal Pritchett').status).toBe('declined')
    expect(res.run.roster.some((c) => c.id === p.id)).toBe(false)
  })
})

describe('futures', () => {
  it('signs available practice-squad players at the minimum as depth', () => {
    const run = fresh()
    const c = snap.depthCandidates.find((d) => futuresAvailable(run.seed, d))!
    const res = signFutures(run, snap, c.id)
    if (!res.ok) throw new Error(res.reason)
    const added = res.run.roster.find((x) => x.id === c.id)!
    expect(added.depth).toBe(true)
    expect(signFutures(res.run, snap, c.id).ok).toBe(false)
  })

  it('cannot sign a player who already signed elsewhere this run', () => {
    const run = fresh()
    const gone = snap.depthCandidates.find((d) => !futuresAvailable(run.seed, d))!
    expect(signFutures(run, snap, gone.id).ok).toBe(false)
  })
})
