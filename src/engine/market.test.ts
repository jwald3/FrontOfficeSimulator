import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { capSummary } from './cap'
import { attachEditorial } from './editorial'
import { declineSheet, entryFor, marketPool, marketTable, matchSheet, offerFreeAgent, pendingSheets, RETENTION_RATE, WAVES } from './market'
import { placeOnTradeBlock } from './moves'
import { advanceClock, advancePhase } from './phase'
import { applyTender, letWalk } from './resign'
import { tradeValue as valueOf } from './valuation'

import { loadSnapshot, startRun } from './snapshot.testutil'
import { acceptTradeOffer, counterOffer, askingValue, declineOffer, generateCalls, generateOffers, negotiateOffer, pickValue, proposeTrade, tradeTargets } from './trades'
import type { RunState, Snapshot } from './types'

const snap: Snapshot = loadSnapshot()
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason)
  return r as Extract<T, { ok: true }>
}
const toFreeAgencyWith = (run: RunState, s: Snapshot) => ok(advancePhase(ok(advancePhase(run, s)).run, s)).run
const toFreeAgency = (run: RunState) => toFreeAgencyWith(run, snap)
const fresh = (seed = 21) => startRun(snap, { mode: 'genuine', objective: 'balanced', seed })

describe('market pool', () => {
  it('includes our unsigned players without their loyalty discount', () => {
    let run = fresh()
    const belton = run.expiring.find((p) => p.name === 'Dane Belton')!
    run = ok(letWalk(run, belton.id)).run
    run = toFreeAgency(run)
    const inPool = marketPool(run, snap).find((p) => p.id === belton.id)!
    expect(inPool.own).toBe(false)
  })

  it('opens at the Day 1 premium and softens later', () => {
    let run = toFreeAgency(fresh())
    const p = marketPool(run, snap).find((x) => x.marketAAV >= 15_000_000 && entryFor(run, x).status === 'available')!
    const day1 = marketTable(run, snap, p).ask.aav
    run = ok(advanceClock(run, snap)).run
    run = ok(advanceClock(run, snap)).run
    expect(marketTable(run, snap, p).ask.aav).toBeLessThan(day1)
  })
})

describe('re-signings before the market', () => {
  const others = () => snap.freeAgents.filter((p) => !p.own)

  it('keeps about the historical share of each price group with their teams', () => {
    const run = toFreeAgency(fresh())
    const share = (group: typeof snap.freeAgents) => group.filter((p) => entryFor(run, p).status === 'retained').length / group.length
    const cheap = others().filter((p) => (p.currentAPY ?? 0) < 2_000_000)
    const paid = others().filter((p) => (p.currentAPY ?? 0) >= 2_000_000)
    expect(Math.abs(share(cheap) - RETENTION_RATE.underTwoMillion)).toBeLessThan(0.08)
    expect(Math.abs(share(paid) - RETENTION_RATE.twoMillionPlus)).toBeLessThan(0.08)
  })

  it('never holds back our own free agents', () => {
    const run = toFreeAgency(fresh())
    expect(marketPool(run, snap).filter((p) => run.expiring.some((e) => e.id === p.id)).every((p) => entryFor(run, p).status !== 'retained')).toBe(true)
  })

  it('takes re-signed players off the board for us and for rival teams', () => {
    let run = toFreeAgency(fresh())
    const kept = others().find((p) => entryFor(run, p).status === 'retained')!
    expect(offerFreeAgent(run, snap, kept.id, marketTable(run, snap, kept).ask).ok).toBe(false)
    for (let i = 1; i < WAVES.length; i++) run = ok(advanceClock(run, snap)).run
    expect(others().filter((p) => entryFor(run, p).status === 'retained').every((p) => !run.market!.entries[p.id])).toBe(true)
  })

  it('reports the re-signings on the wire when the market opens', () => {
    const run = toFreeAgency(fresh())
    expect(run.news.some((n) => n.text.includes('re-sign with their teams'))).toBe(true)
  })

  it('follows editorial calls over the roll, and leaves our own players alone', () => {
    const run = toFreeAgency(fresh())
    const kept = others().find((p) => entryFor(run, p).status !== 'retained')!
    const freed = others().find((p) => entryFor(run, p).status === 'retained')!
    const own = snap.freeAgents.find((p) => p.own)!
    const ed = attachEditorial(loadSnapshot(), JSON.parse(readFileSync('public/data/coordinators.json', 'utf8')), {
      ...snap.editorial!,
      market: { calls: { [kept.id]: { call: 'stays', reason: 'Extension talks are close' }, [freed.id]: { call: 'market', reason: '' }, [own.id]: { call: 'stays', reason: '' } } },
    })
    const find = (id: string) => ed.freeAgents.find((p) => p.id === id)!
    const edRun = toFreeAgencyWith(fresh(), ed)
    expect(entryFor(edRun, find(kept.id)).status).toBe('retained')
    expect(entryFor(edRun, find(freed.id)).status).not.toBe('retained')
    expect(find(own.id).marketCall).toBeUndefined()
    expect(offerFreeAgent(edRun, ed, kept.id, marketTable(edRun, ed, find(kept.id)).ask).ok).toBe(false)
  })
})

describe('signing free agents', () => {
  it('signs a player at his ask and charges the cap', () => {
    const run = toFreeAgency(fresh())
    const p = marketPool(run, snap).find((x) => x.marketAAV >= 5_000_000 && x.marketAAV < 10_000_000 && entryFor(run, x).status === 'available')!
    const before = capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase)
    const res = ok(offerFreeAgent(run, snap, p.id, marketTable(run, snap, p).ask))
    expect(res.response.kind).toBe('accept')
    const after = capSummary(res.run, snap.rookieScale.slots, snap.minimumRookieBase)
    expect(after.contractCount).toBe(before.contractCount + 1)
    expect(after.committed).toBeGreaterThan(before.committed)
    expect(entryFor(res.run, p).status).toBe('signed')
  })

  it('respects players who are not interested', () => {
    const run = toFreeAgency(fresh())
    const p = marketPool(run, snap).find((x) => entryFor(run, x).status === 'uninterested')!
    expect(offerFreeAgent(run, snap, p.id, marketTable(run, snap, p).ask).ok).toBe(false)
  })

  it('lets the league sign players as the clock runs', () => {
    let run = toFreeAgency(fresh())
    for (let i = 1; i < WAVES.length; i++) run = ok(advanceClock(run, snap)).run
    const reached = marketPool(run, snap).filter((p) => entryFor(run, p).status !== 'retained')
    const gone = reached.filter((p) => entryFor(run, p).status === 'signed-elsewhere')
    expect(gone.length).toBeGreaterThan(reached.length / 4)
    // Stars who reach the market go early and often.
    const stars = reached.filter((p) => p.marketAAV >= 20_000_000)
    expect(stars.filter((p) => entryFor(run, p).status === 'signed-elsewhere').length).toBeGreaterThan(stars.length / 2)
    expect(advanceClock(run, snap).ok).toBe(false)
  })
})

describe('offer sheets', () => {
  /** Find a seed where a rival sends Isaiah Williams an offer sheet over a refusal tender. */
  function withSheet() {
    for (let seed = 1; seed < 400; seed++) {
      let run = fresh(seed)
      const w = run.expiring.find((p) => p.name === 'Isaiah Williams')!
      run = ok(applyTender(run, snap, w.id, 'second')).run
      run = toFreeAgency(run)
      if (pendingSheets(run).length) return { run, sheet: pendingSheets(run)[0] }
    }
    throw new Error('no offer sheet in 400 seeds')
  }

  it('blocks the draft until every sheet is decided', () => {
    const { run } = withSheet()
    expect(advancePhase(run, snap).ok).toBe(false)
  })

  it('matching keeps him on the rival terms', () => {
    const { run, sheet } = withSheet()
    const res = ok(matchSheet(run, snap, sheet.id))
    const c = res.run.roster.find((x) => x.id === sheet.playerId)!
    expect(c.apy).toBe(sheet.terms.aav)
    expect(c.years.length).toBe(sheet.terms.years)
    expect(pendingSheets(res.run)).toHaveLength(0)
  })

  it('declining a second-round tender returns their second-round pick', () => {
    const { run, sheet } = withSheet()
    const res = ok(declineSheet(run, sheet.id))
    expect(res.run.roster.some((x) => x.id === sheet.playerId)).toBe(false)
    const gained = res.run.picks.filter((p) => p.owner === 'NYJ' && p.year === 2027 && p.round === 2)
    expect(gained.length).toBe(run.picks.filter((p) => p.owner === 'NYJ' && p.year === 2027 && p.round === 2).length + 1)
  })
})

describe('trades', () => {
  it('discounts future picks by half a round a season, on the current chart', () => {
    const r1 = snap.picks.find((p) => p.id === '2028-NYJ-r1')!
    const r1b = snap.picks.find((p) => p.id === '2029-NYJ-r1')!
    const slot = (n: number) => snap.picks.find((p) => p.year === 2027 && p.overall === n)!.value
    // A 2028 first is valued like pick 32 this year, a 2029 first like pick 48.
    expect(pickValue(snap, r1, 2027)).toBe(slot(32))
    expect(pickValue(snap, r1b, 2027)).toBe(slot(48))
  })

  it('brings offers for players on the block, and accepting moves the picks', () => {
    let run = fresh()
    const wilson = run.roster.find((p) => p.name === 'Garrett Wilson')!
    run = ok(placeOnTradeBlock(run, wilson.id)).run
    run = toFreeAgency(run)
    expect(run.tradeOffers.length).toBeGreaterThan(0)
    const offer = run.tradeOffers[0]
    const res = ok(acceptTradeOffer(run, snap, offer.id))
    expect(res.run.roster.some((p) => p.id === wilson.id)).toBe(false)
    offer.pickIds.forEach((id) => expect(res.run.picks.find((p) => p.id === id)!.owner).toBe('NYJ'))
    expect(res.run.dead.some((d) => d.playerId === wilson.id)).toBe(true)
  })

  it('offers expire when the clock moves', () => {
    let run = fresh()
    run = ok(placeOnTradeBlock(run, run.roster[0].id)).run
    run = toFreeAgency(run)
    const first = run.tradeOffers.map((o) => o.id)
    run = ok(advanceClock(run, snap)).run
    run.tradeOffers.forEach((o) => expect(first).not.toContain(o.id))
    expect(generateOffers(run, snap, 1)).toEqual(run.tradeOffers)
    expect(run.offerLog?.filter((e) => e.outcome === 'expired').map((e) => e.id)).toEqual(first)
  })

  it('acquires a target when the package meets the ask, and refuses lowballs', () => {
    const run = toFreeAgency(fresh())
    const target = tradeTargets(run, snap).find((t) => valueOf(t, snap) > 300 && valueOf(t, snap) < 700)!
    const ask = askingValue(run, snap, target)
    const ours = run.picks.filter((p) => p.owner === 'NYJ' && p.year === 2027).sort((a, b) => a.value - b.value)
    const cheap = [ours[0]]
    const low = proposeTrade(run, snap, target.id, cheap.map((p) => p.id))
    expect(low.ok).toBe(false)

    const enough = ours.find((p) => pickValue(snap, p, 2027) >= ask)!
    const res = ok(proposeTrade(run, snap, target.id, [enough.id]))
    expect(res.run.roster.some((p) => p.id === target.id)).toBe(true)
    expect(res.run.picks.find((p) => p.id === enough.id)!.owner).toBe(target.team)
  })

  it('stops answering after three failed calls', () => {
    let run = toFreeAgency(fresh())
    const target = tradeTargets(run, snap).find((t) => valueOf(t, snap) > 800)!
    const cheap = run.picks.filter((p) => p.owner === 'NYJ').sort((a, b) => a.value - b.value)[0]
    for (let i = 0; i < 3; i++) {
      const r = proposeTrade(run, snap, target.id, [cheap.id])
      if (!r.ok && r.run) run = r.run
    }
    expect(proposeTrade(run, snap, target.id, [cheap.id]).ok).toBe(false)
    expect(run.tradeTalks?.[target.id]).toBeGreaterThanOrEqual(3)
  })
})

describe('the inbox: calls and answers', () => {
  const opened = (seed = 21) => toFreeAgency(fresh(seed))

  it('brings unsolicited calls about players we did not shop, from teams that need the position', () => {
    const run = opened()
    const calls = run.tradeOffers.filter((o) => o.kind === 'call')
    expect(calls.length).toBeGreaterThan(0)
    for (const o of calls) {
      const c = run.roster.find((p) => p.id === o.playerId)!
      expect(c.onTradeBlock).toBe(false)
      expect(snap.teams.find((t) => t.id === o.team)!.needs[c.pos]).toBeGreaterThanOrEqual(0.6)
      expect(o.line).toBeTruthy()
    }
  })

  it('never calls about a player we just signed', () => {
    const run = opened()
    const signed = run.moves.filter((m) => m.kind === 'sign').map((m) => m.playerId)
    expect(generateCalls(run, snap, 0).some((o) => signed.includes(o.playerId))).toBe(false)
  })

  it('declines into the log', () => {
    const run = opened()
    const o = run.tradeOffers[0]
    const after = ok(declineOffer(run, o.id)).run
    expect(after.tradeOffers.map((x) => x.id)).not.toContain(o.id)
    expect(after.offerLog?.at(-1)).toMatchObject({ id: o.id, outcome: 'declined' })
  })

  it('answers a push-back once: sweetened within 110% of his value, final, or pulled', () => {
    const outcomes = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const run = opened(seed)
      for (const o of run.tradeOffers) {
        const r = negotiateOffer(run, snap, o.id)
        if (!r.ok) continue
        outcomes.add(r.outcome)
        const after = r.run.tradeOffers.find((x) => x.id === o.id)
        if (r.outcome === 'pulled') expect(after).toBeUndefined()
        else {
          expect(after!.negotiated).toBe(r.outcome)
          expect(negotiateOffer(r.run, snap, o.id).ok).toBe(false)
        }
        if (r.outcome === 'sweetened') {
          const c = run.roster.find((p) => p.id === o.playerId)!
          expect(after!.value).toBeGreaterThan(o.value)
          expect(after!.value).toBeLessThanOrEqual(Math.max(o.value, valueOf(c, snap) * 1.1) + 1)
        }
      }
    }
    expect(outcomes.size).toBe(3)
  })
})

describe('countering offers for our players', () => {
  const opened = (seed = 21) => toFreeAgency(fresh(seed))

  it('goes through on our terms when the ask is within their ceiling', () => {
    const run = opened()
    const o = run.tradeOffers[0]
    const res = counterOffer(run, snap, o.id, o.pickIds)
    if (!res.ok) throw new Error(res.reason)
    expect(res.verdict).toBe('accept')
    expect(res.run.roster.some((p) => p.id === o.playerId)).toBe(false)
    o.pickIds.forEach((id) => expect(res.run.picks.find((p) => p.id === id)!.owner).toBe('NYJ'))
  })

  it('pulls the offer on an outrageous ask, and allows only two counters', () => {
    const run = opened()
    const o = run.tradeOffers[0]
    const all = run.picks.filter((p) => p.owner === o.team).map((p) => p.id)
    const res = counterOffer(run, snap, o.id, all)
    if (!res.ok) throw new Error(res.reason)
    expect(res.verdict).toBe('insult')
    expect(res.run.tradeOffers.some((x) => x.id === o.id)).toBe(false)
    expect(res.run.offerLog?.at(-1)).toMatchObject({ id: o.id, outcome: 'pulled' })

    const capped = { ...run, counters: { [o.id]: 2 } }
    expect(counterOffer(capped, snap, o.id, o.pickIds).ok).toBe(false)
  })
})
