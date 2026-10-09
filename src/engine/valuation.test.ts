import { describe, expect, it } from 'vitest'
import { DEFAULT_VALUATION } from './editorialSchema'
import { loadSnapshot, startRun } from './snapshot.testutil'
import type { Snapshot } from './types'
import { ageFactor, futurePickValue, modelValue, tradeValue, valuationContext } from './valuation'
import { counterOffer, generateBlockOffers, generateCalls, proposeTrade } from './trades'
import { advancePhase } from './phase'
import type { RunState } from './types'
import { placeOnTradeBlock } from './moves'

const snap: Snapshot = loadSnapshot()
const toFreeAgency = (run: RunState, s: Snapshot): RunState => {
  for (let i = 0; i < 2; i++) {
    const r = advancePhase(run, s)
    if (!r.ok) throw new Error(r.reason)
    run = r.run
  }
  return run
}
const player = (name: string) => [...snap.roster, ...Object.values(snap.otherRosters).flat()].find((p) => p.name === name)!

describe('trade value', () => {
  it('prices a young WR1 like a top-five pick, about two mid firsts', () => {
    const v = tradeValue(player('Garrett Wilson'), snap)
    expect(v).toBeGreaterThan(1500)
    expect(v).toBeLessThan(1800)
  })

  it('pays stars more than linear: the best-paid at a position pull away', () => {
    const chase = player("Ja'Marr Chase")
    const wilson = player('Garrett Wilson')
    expect(tradeValue(chase, snap) / tradeValue(wilson, snap)).toBeGreaterThan(chase.apy / wilson.apy)
  })

  it('ages by position: running backs fade years before quarterbacks', () => {
    expect(ageFactor(DEFAULT_VALUATION, 'RB', 29)).toBeLessThan(ageFactor(DEFAULT_VALUATION, 'QB', 29))
    expect(ageFactor(DEFAULT_VALUATION, 'WR', 24)).toBeGreaterThan(1)
    expect(ageFactor(DEFAULT_VALUATION, 'WR', 32)).toBeLessThan(0.7)
  })

  it('follows the editorial model', () => {
    const wilson = player('Garrett Wilson')
    const richer: Snapshot = {
      ...snap,
      valuation: valuationContext(snap, { ...DEFAULT_VALUATION, positions: { ...DEFAULT_VALUATION.positions, WR: { top: 2400, prime: 28, decline: 0.1 } } }),
    }
    expect(tradeValue(wilson, richer) / tradeValue(wilson, snap)).toBeCloseTo(1.2, 2)
  })
})

describe('future picks', () => {
  const pick = (year: number, round: number) => snap.picks.find((p) => p.year === year && p.round === round && p.originalTeam === 'NYJ')!
  const slot = (n: number) => snap.picks.find((p) => p.year === snap.season && p.overall === n)!.value

  it('drop half a round a season by default', () => {
    expect(futurePickValue(snap, pick(2028, 1), 2027)).toBe(slot(32))
    expect(futurePickValue(snap, pick(2029, 1), 2027)).toBe(slot(48))
    expect(futurePickValue(snap, pick(2028, 2), 2027)).toBe(slot(64))
  })

  it('drop a full round with the NFL rule of thumb', () => {
    const fullRound: Snapshot = { ...snap, valuation: valuationContext(snap, { ...DEFAULT_VALUATION, futureRounds: 1 }) }
    expect(futurePickValue(fullRound, pick(2028, 1), 2027)).toBe(slot(48))
  })
})

describe('player values', () => {
  const wilson = player('Garrett Wilson')
  const withValue = (v: number): Snapshot => ({ ...snap, valuation: valuationContext(snap, DEFAULT_VALUATION, { [wilson.id]: v }) })

  it('replace the model for that player only', () => {
    const ed = withValue(2500)
    expect(tradeValue(wilson, ed)).toBe(2500)
    expect(modelValue(wilson, ed)).toBe(tradeValue(wilson, snap))
    const chase = player("Ja'Marr Chase")
    expect(tradeValue(chase, ed)).toBe(tradeValue(chase, snap))
  })

  it('drive what teams offer for him', () => {
    const ed = withValue(2500)
    let run = startRun(ed, { mode: 'genuine', objective: 'balanced', seed: 3 })
    const placed = placeOnTradeBlock(run, wilson.id)
    if (!placed.ok) throw new Error(placed.reason)
    run = placed.run
    for (const o of generateBlockOffers(run, ed, 0)) expect(o.value).toBeGreaterThan(2500 * 0.6)
  })
})

describe('untouchable players', () => {
  const locked = (...names: string[]): Snapshot => ({ ...snap, editorial: { ...snap.editorial!, untouchable: names.map((n) => player(n).id) } })

  it("can't be traded for: his team refuses every package", () => {
    const ed = locked('Patrick Mahomes')
    const run = toFreeAgency(startRun(ed, { mode: 'genuine', objective: 'balanced', seed: 4 }), ed)
    const mahomes = player('Patrick Mahomes')
    const everything = run.picks.filter((p) => p.owner === 'NYJ').map((p) => p.id)
    const res = proposeTrade(run, ed, mahomes.id, everything)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/untouchable/)
  })

  it('of ours draw no calls and no block offers, and stay off the block', () => {
    const ed = locked('Garrett Wilson')
    const run = startRun(ed, { mode: 'genuine', objective: 'balanced', seed: 4 })
    const wilson = player('Garrett Wilson')
    expect(placeOnTradeBlock(run, wilson.id, ed).ok).toBe(false)
    const listed = placeOnTradeBlock(run, wilson.id) // listed before the lock
    if (!listed.ok) throw new Error(listed.reason)
    expect(generateBlockOffers(listed.run, ed, 0).some((o) => o.playerId === wilson.id)).toBe(false)
    expect(generateCalls(run, ed, 0).some((o) => o.playerId === wilson.id)).toBe(false)
  })
})

describe('players never worth a first', () => {
  const capped = (...names: string[]): Snapshot => ({ ...snap, editorial: { ...snap.editorial!, noFirsts: names.map((n) => player(n).id) } })

  it('draw offers and calls with no first-round picks, this year or future', () => {
    const wilson = player('Garrett Wilson')
    const ed = capped('Garrett Wilson')
    for (const seed of [1, 2, 3, 4, 5]) {
      const listed = placeOnTradeBlock(startRun(ed, { mode: 'genuine', objective: 'balanced', seed }), wilson.id)
      if (!listed.ok) throw new Error(listed.reason)
      for (const o of generateBlockOffers(listed.run, ed, 0).filter((x) => x.playerId === wilson.id)) {
        const rounds = listed.run.picks.filter((p) => o.pickIds.includes(p.id)).map((p) => p.round)
        expect(rounds).not.toContain(1)
      }
    }
  })

  it("can't be bought with a first", () => {
    const ed = capped("Ja'Marr Chase")
    const run = toFreeAgency(startRun(ed, { mode: 'genuine', objective: 'balanced', seed: 4 }), ed)
    const first = run.picks.find((p) => p.owner === 'NYJ' && p.round === 1)!
    const res = proposeTrade(run, ed, player("Ja'Marr Chase").id, [first.id])
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/isn't worth one/)
  })

  it("won't let a counter ask for a first", () => {
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const plain = toFreeAgency(startRun(snap, { mode: 'genuine', objective: 'balanced', seed }), snap)
      const o = plain.tradeOffers[0]
      if (!o) continue
      const c = plain.roster.find((p) => p.id === o.playerId)!
      const ed = capped(c.name)
      const theirFirst = plain.picks.find((p) => p.owner === o.team && p.round === 1)
      if (!theirFirst) continue
      const res = counterOffer(plain, ed, o.id, [theirFirst.id])
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.reason).toMatch(/isn't worth one/)
      return
    }
    throw new Error('no offer with a first to ask for')
  })
})
