import { describe, expect, it } from 'vitest'
import { capSummary } from './cap'
import {
  acceptTradeDown,
  closedPositions,
  ourNeed,
  counterablePicks,
  counterTradeDown,
  proposeTradeUp,
  tradeablePicks,
  tradeUpAsk,
  tradeUpTargets,
  applyDraftOrder,
  available,
  bestForUs,
  draftClass,
  draftDone,
  draftOrder,
  draftPlayer,
  onTheClock,
  signUdfa,
  simToUser,
  sourceTeamOrder,
  tradeDownOffers,
  udfaBudgetLeft,
} from './draft'
import { advancePhase } from './phase'
import { pickValue } from './trades'

import { loadSnapshot, startRun } from './snapshot.testutil'
import type { RawPick, RunState, Snapshot } from './types'

const snap: Snapshot = loadSnapshot()
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason)
  return r as Extract<T, { ok: true }>
}
const cap = (run: RunState) => capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase)

function toDraft(seed = 31, mode: 'genuine' | 'simplified' = 'genuine') {
  let run = startRun(snap, { mode, objective: 'balanced', seed })
  for (let i = 0; i < 3; i++) run = ok(advancePhase(run, snap)).run
  return run
}

/** Draft best-available every time we're up, to the end. */
function runDraft(run: RunState) {
  while (!draftDone(run)) {
    const p = bestForUs(run, snap)!
    run = ok(draftPlayer(run, snap, p.id)).run
    run = simToUser(run, snap).run
  }
  return run
}

describe('draft', () => {
  it('opens with the AI picking until our first selection at #6', () => {
    const run = toDraft()
    expect(run.phase).toBe('draft')
    expect(onTheClock(run)!.overall).toBe(6)
    expect(Object.keys(run.draft!.selections)).toHaveLength(5)
  })

  it('varies who returns to school between runs', () => {
    const counts = new Set([1, 2, 3, 4, 5, 6].map((s) => draftClass(toDraft(s), snap).length))
    expect(counts.size).toBeGreaterThan(1)
  })

  it('follows editorial declaration calls in every run', () => {
    const under = snap.prospects.filter((p) => p.declaration?.canReturn)
    const [stays, goes] = [under[0], under[1]]
    const withCalls = { ...snap, prospects: snap.prospects.map((p) => (p === stays ? { ...p, declareCall: 'returns' as const } : p === goes ? { ...p, declareCall: 'declares' as const } : p)) }
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const ids = draftClass(toDraft(seed), withCalls).map((p) => p.id)
      expect(ids).not.toContain(stays.id)
      expect(ids).toContain(goes.id)
    }
  })

  it('signs our pick to the slot contract and releases the draft reserve', () => {
    const run = toDraft()
    const before = cap(run)
    const p = bestForUs(run, snap)!
    const res = ok(draftPlayer(run, snap, p.id))
    const rookie = res.run.roster.find((c) => c.id === p.id)!
    const slot = snap.rookieScale.slots['6'][0]
    expect(rookie.years[0].base + rookie.years[0].bonus).toBe(slot.base + slot.bonus)
    const after = cap(res.run)
    // The reserve already held his cost above the minimum, so effective space only moves by the minimum.
    expect(Math.round(before.effectiveSpace - after.effectiveSpace)).toBe(snap.minimumRookieBase)
    expect(after.draftReserve).toBeLessThan(before.draftReserve)
  })

  it('never selects the same player twice and fills every pick', () => {
    const run = runDraft(toDraft())
    const chosen = Object.values(run.draft!.selections)
    expect(new Set(chosen).size).toBe(chosen.length)
    expect(chosen.length).toBe(draftOrder(run).length)
    expect(cap(run).draftReserve).toBe(0)
  })

  it('takes the top prospect first overall', () => {
    const run = toDraft()
    const first = draftOrder(run)[0]
    const top = [...draftClass(run, snap)].sort((a, b) => a.rank - b.rank)[0]
    expect(run.draft!.selections[first.id]).toBe(top.id)
  })

  it('trades down for more value when an offer comes', () => {
    for (let seed = 1; seed < 60; seed++) {
      const run = toDraft(seed)
      const offers = tradeDownOffers(run, snap)
      if (!offers.length) continue
      const ours = onTheClock(run)!
      const res = ok(acceptTradeDown(run, snap, offers[0].id))
      expect(res.run.picks.find((p) => p.id === ours.id)!.owner).toBe(offers[0].team)
      offers[0].pickIds.forEach((id) => expect(res.run.picks.find((p) => p.id === id)!.owner).toBe('NYJ'))
      // We're no longer on the clock; the AI picks next.
      expect(onTheClock(res.run)!.owner).not.toBe('NYJ')
      return
    }
    throw new Error('no trade-down offers in 60 seeds')
  })
})

describe('undrafted free agents', () => {
  it('signs within the bonus pool after the draft', () => {
    let run = runDraft(toDraft())
    const pool = available(run, snap).sort((a, b) => a.rank - b.rank)
    let signed = 0
    for (const p of pool.slice(0, 12)) {
      const res = signUdfa(run, snap, p.id, 25_000)
      if (!res.ok) break
      run = res.run
      if (res.move.kind === 'udfa') signed++
    }
    expect(signed).toBeGreaterThan(0)
    expect(udfaBudgetLeft(run, snap)).toBe(snap.salaryRules.udfaBonusPool - signed * 25_000)
    expect(advancePhase(run, snap).ok).toBe(true)
  })

  it('is closed in Simplified mode', () => {
    const run = runDraft(toDraft(31, 'simplified'))
    expect(signUdfa(run, snap, available(run, snap)[0].id, 10_000).ok).toBe(false)
  })
})

describe('editorial draft order', () => {
  const season = snap.season
  const fresh = () => loadSnapshot().picks.map((p) => ({ ...p }))
  const ofSeason = (picks: RawPick[]) => picks.filter((p) => p.year === season && p.overall != null)

  it('re-slots every round to the team order, keeping comp picks last and slot values', () => {
    const picks = fresh()
    const source = sourceTeamOrder(picks, season)
    const before = new Map(ofSeason(picks).map((p) => [p.overall, p.value]))
    applyDraftOrder(picks, season, ['NYJ', ...source.filter((t) => t !== 'NYJ')])

    const current = ofSeason(picks)
    expect(current.map((p) => p.overall).sort((a, b) => a! - b!)).toEqual([...before.keys()].sort((a, b) => a! - b!))
    for (const p of current) expect(p.value).toBe(before.get(p.overall))
    for (const round of [1, 2, 3, 7]) {
      const inRound = current.filter((p) => p.round === round).sort((a, b) => a.overall! - b.overall!)
      expect(inRound[0].originalTeam).toBe('NYJ')
      const firstComp = inRound.findIndex((p) => p.compensatory)
      if (firstComp >= 0) expect(inRound.slice(firstComp).every((p) => p.compensatory)).toBe(true)
    }
    expect(current.find((p) => p.round === 1 && p.originalTeam === source[0])!.overall).toBe(2)
  })

  it('restores the source slots when the order is cleared or matches the projection', () => {
    const picks = fresh()
    const source = sourceTeamOrder(picks, season)
    const snapshot = ofSeason(picks).map((p) => [p.id, p.overall, p.value].join())
    applyDraftOrder(picks, season, [...source].reverse())
    applyDraftOrder(picks, season)
    expect(ofSeason(picks).map((p) => [p.id, p.overall, p.value].join())).toEqual(snapshot)
    applyDraftOrder(picks, season, source)
    expect(ofSeason(picks).map((p) => [p.id, p.overall, p.value].join())).toEqual(snapshot)
  })

  it('moves our draft reserve with our slots', () => {
    const edited = loadSnapshot()
    applyDraftOrder(edited.picks, season, ['NYJ', ...sourceTeamOrder(edited.picks, season).filter((t) => t !== 'NYJ')])
    const reserve = (s: Snapshot) => {
      const run = startRun(s, { mode: 'genuine', objective: 'balanced', seed: 1 })
      return capSummary(run, s.rookieScale.slots, s.minimumRookieBase).draftReserve
    }
    expect(reserve(edited)).toBeGreaterThan(reserve(snap))
  })
})

describe('countering a trade-down', () => {
  const withOffer = () => {
    for (let seed = 1; seed < 80; seed++) {
      const run = toDraft(seed)
      const offers = tradeDownOffers(run, snap)
      if (offers.length) return { run, o: offers[0] }
    }
    throw new Error('no trade-down offers in 80 seeds')
  }

  it('goes through when we ask for what they offered', () => {
    const { run, o } = withOffer()
    const res = counterTradeDown(run, snap, o.id, o.pickIds)
    if (!res.ok) throw new Error(res.reason)
    expect(res.verdict).toBe('accept')
    o.pickIds.forEach((id) => expect(res.run.picks.find((p) => p.id === id)!.owner).toBe('NYJ'))
  })

  it('hangs up on an ask far past their ceiling, and the offer is gone', () => {
    const { run, o } = withOffer()
    const everything = counterablePicks(run, o).map((p) => p.id)
    const res = counterTradeDown(run, snap, o.id, everything)
    if (!res.ok) throw new Error(res.reason)
    expect(res.verdict).toBe('insult')
    expect(tradeDownOffers(res.run, snap).some((x) => x.id === o.id)).toBe(false)
  })
})

describe('trading up', () => {
  /** A run waiting on another team, with a pick to move up to. */
  const waiting = () => {
    let run = toDraft(31)
    run = ok(draftPlayer(run, snap, bestForUs(run, snap)!.id)).run
    return run
  }

  it('offers the picks between the clock and our next pick', () => {
    const run = waiting()
    const targets = tradeUpTargets(run)
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.every((p) => p.owner !== 'NYJ')).toBe(true)
    expect(targets[0].id).toBe(onTheClock(run)!.id)
  })

  it('takes the pick when the package meets the ask, and we go on the clock', () => {
    const run = waiting()
    const target = tradeUpTargets(run)[0]
    const ask = tradeUpAsk(run, snap, target)
    expect(ask).toBeGreaterThan(pickValue(snap, target, run.season))
    const ours = tradeablePicks(run, 'NYJ').sort((a, b) => pickValue(snap, b, run.season) - pickValue(snap, a, run.season))
    const pack: string[] = []
    let total = 0
    for (const p of ours) {
      if (total >= ask) break
      pack.push(p.id)
      total += pickValue(snap, p, run.season)
    }
    const res = ok(proposeTradeUp(run, snap, target.id, pack))
    expect(res.run.picks.find((p) => p.id === target.id)!.owner).toBe('NYJ')
    expect(onTheClock(res.run)!.owner).toBe('NYJ')
  })

  it('refuses a lowball and stops answering after three calls', () => {
    let run = waiting()
    const target = tradeUpTargets(run)[0]
    const cheapest = tradeablePicks(run, 'NYJ').sort((a, b) => pickValue(snap, a, run.season) - pickValue(snap, b, run.season))[0]
    for (let i = 0; i < 2; i++) {
      const res = proposeTradeUp(run, snap, target.id, [cheapest.id])
      expect(res.ok).toBe(false)
      if (!res.ok && res.run) run = res.run
    }
    const last = proposeTradeUp(run, snap, target.id, [cheapest.id])
    expect(last.ok).toBe(false)
    if (!last.ok) expect(last.reason).toMatch(/stopped taking calls/)
  })
})

describe('trade-up counters', () => {
  const waiting = () => ok(draftPlayer(toDraft(31), snap, bestForUs(toDraft(31), snap)!.id)).run
  /** Our picks, biggest first, packed until they reach `share` of the ask. */
  const packTo = (run: RunState, target: RawPick, share: number) => {
    const ask = tradeUpAsk(run, snap, target)
    const pack: string[] = []
    let total = 0
    for (const p of tradeablePicks(run, 'NYJ').sort((a, b) => pickValue(snap, a, run.season) - pickValue(snap, b, run.season))) {
      if (total + pickValue(snap, p, run.season) > ask * share) continue
      pack.push(p.id)
      total += pickValue(snap, p, run.season)
    }
    return { pack, total, ask }
  }

  it('counter an offer in range with ours plus what it takes, and accepting it lands the pick', () => {
    const run = waiting()
    const target = tradeUpTargets(run)[0]
    const { pack, total, ask } = packTo(run, target, 0.9)
    expect(total / ask).toBeGreaterThan(0.75)
    const res = proposeTradeUp(run, snap, target.id, pack)
    expect(res.ok).toBe(false)
    if (res.ok || !res.counter || !res.run) throw new Error('expected a counter')
    expect(res.counter).toEqual(expect.arrayContaining(pack))
    expect(res.reason).toMatch(/counter/)
    const done = ok(proposeTradeUp(res.run, snap, target.id, res.counter))
    expect(done.run.picks.find((p) => p.id === target.id)!.owner).toBe('NYJ')
  })

  it("don't counter a lowball", () => {
    const run = waiting()
    const target = tradeUpTargets(run)[0]
    const { pack } = packTo(run, target, 0.3)
    const res = proposeTradeUp(run, snap, target.id, pack)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.counter).toBeUndefined()
  })
})

describe('recommendations after an early pick', () => {
  /** Take the best quarterback on the board with our first pick, then sim to our next one. */
  const afterEarlyQB = (s: Snapshot = snap) => {
    let run = toDraft(31)
    const qb = available(run, s).filter((p) => p.pos === 'QB').sort((a, b) => a.rank - b.rank)[0]
    run = ok(draftPlayer(run, s, qb.id)).run
    return simToUser(run, s).run
  }

  it('stop suggesting a quarterback once we take one in the first three rounds, and show QB as filled', () => {
    for (let i = 0; i < 3; i++) {
      let run = afterEarlyQB()
      for (let k = 0; k < i; k++) run = simToUser(ok(draftPlayer(run, snap, bestForUs(run, snap)!.id)).run, snap).run
      expect(bestForUs(run, snap)!.pos).not.toBe('QB')
    }
    const run = afterEarlyQB()
    expect(closedPositions(run, snap).has('QB')).toBe(true)
    expect(ourNeed(run, snap, 'QB')).toBe(0)
  })

  it('follow the editorial rules: none means nothing is closed', () => {
    const open: Snapshot = { ...snap, editorial: { ...snap.editorial!, draftAdvice: [] } }
    expect(closedPositions(afterEarlyQB(open), open).size).toBe(0)
  })
})
