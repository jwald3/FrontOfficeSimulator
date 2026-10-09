import { describe, expect, it } from 'vitest'
import { releaseSavings } from './cap'
import { DEFAULT_INHOUSE_RULE, type EditorialData, type InHouseCall, type InHouseRule } from './editorial'
import { placeOnTradeBlock, restructure } from './moves'

import { loadSnapshot, startRun } from './snapshot.testutil'
import { replacementCost, simulateInHouse, suggestInHouse } from './suggest'
import type { RunState, Snapshot } from './types'

const snap: Snapshot = loadSnapshot()
const fresh = (seed = 7): RunState => startRun(snap, { mode: 'genuine', objective: 'balanced', seed })
const names = (run: RunState) => suggestInHouse(run, snap).map((s) => `${s.kind}:${s.player.name}`)
const tight = (run: RunState): RunState => ({ ...run, adjustedCap: run.adjustedCap - 70_000_000 })

describe('in-house suggestions', () => {
  it('flags the expensive non-starter and the starter a free agent can replace for less', () => {
    expect(names(fresh())).toEqual(['release:Jeremy Ruckert', 'release:Jamien Sherwood'])
  })

  it('only suggests releases that clear at least $2M this season', () => {
    for (const s of suggestInHouse(fresh(), snap).filter((x) => x.kind === 'release')) {
      expect(releaseSavings(s.player, 2027)).toBeGreaterThanOrEqual(2_000_000)
    }
  })

  it('prices a replacement as the median free agent who starts on his current depth chart', () => {
    expect(replacementCost(snap, 'LB')).toBe(7_450_000)
    expect(replacementCost(snap, 'CB')).toBe(10_000_000)
  })

  it('suggests restructures of young lineup starters only once cap space is tight', () => {
    expect(suggestInHouse(fresh(), snap).some((s) => s.kind === 'restructure')).toBe(false)

    const restructures = suggestInHouse(tight(fresh()), snap).filter((s) => s.kind === 'restructure')
    expect(restructures.map((s) => s.player.name)).toContain('Garrett Wilson')
    for (const s of restructures) expect(s.player.age).toBeLessThanOrEqual(30)
  })

  it('never suggests restructures when the objective is creating cap room', () => {
    const capRoom: RunState = { ...tight(fresh()), objective: 'cap-room' }
    expect(suggestInHouse(capRoom, snap).some((s) => s.kind === 'restructure')).toBe(false)
  })
})

describe('editorial in-house calls', () => {
  const withCalls = (calls: Record<string, { call: InHouseCall; reason: string }>): Snapshot => ({
    ...snap,
    editorial: { ...(snap.editorial as EditorialData), inHouse: { calls } },
  })
  const idOf = (name: string) => fresh().roster.find((p) => p.name === name)!.id

  it('lists editor calls first, with their reasons, and keeps players off with "keep"', () => {
    const ed = withCalls({
      [idOf('Garrett Wilson')]: { call: 'restructure', reason: 'Lock in the cornerstone' },
      [idOf('Breece Hall')]: { call: 'block', reason: 'Sell high' },
      [idOf('Jeremy Ruckert')]: { call: 'keep', reason: 'Blocking tight end the scheme needs' },
    })
    const list = suggestInHouse(fresh(), ed)
    expect(list.slice(0, 2).map((s) => [s.kind, s.player.name, s.editorial])).toEqual(
      expect.arrayContaining([['restructure', 'Garrett Wilson', true], ['block', 'Breece Hall', true]]),
    )
    expect(list.find((s) => s.player.name === 'Breece Hall')!.reason).toBe('Sell high')
    expect(list.map((s) => s.player.name)).not.toContain('Jeremy Ruckert')
    expect(list.map((s) => `${s.kind}:${s.player.name}`)).toContain('release:Jamien Sherwood')
  })

  it('drops a call once its move has been made', () => {
    const ed = withCalls({
      [idOf('Garrett Wilson')]: { call: 'restructure', reason: '' },
      [idOf('Breece Hall')]: { call: 'block', reason: '' },
    })
    let run = fresh()
    run = (restructure(run, idOf('Garrett Wilson')) as { run: RunState }).run
    run = (placeOnTradeBlock(run, idOf('Breece Hall')) as { run: RunState }).run
    const names = suggestInHouse(run, ed).map((s) => s.player.name)
    expect(names).not.toContain('Garrett Wilson')
    expect(names).not.toContain('Breece Hall')
  })

  it('fills in a reason when the editor left it blank', () => {
    const ed = withCalls({ [idOf('Breece Hall')]: { call: 'release', reason: '  ' } })
    expect(suggestInHouse(fresh(), ed).find((s) => s.player.name === 'Breece Hall')!.reason).toMatch(/^Cutting him frees/)
  })
})

describe('simulating in-house decisions', () => {
  it('makes every suggested move, best first, until nothing is left to suggest', () => {
    const run = fresh()
    const { run: after, made } = simulateInHouse(run, snap)
    expect(made.map((s) => `${s.kind}:${s.player.name}`)).toEqual(names(run))
    expect(suggestInHouse(after, snap)).toHaveLength(0)
    expect(after.moves.slice(run.moves.length).map((m) => m.kind)).toEqual(made.map((s) => s.kind))
  })

  it('re-checks after each move: restructures stop once enough space is cleared', () => {
    const { run: after } = simulateInHouse(tight(fresh()), snap)
    expect(suggestInHouse(after, snap)).toHaveLength(0)
  })
})

describe('the editable default rule', () => {
  const withRule = (rule: Partial<InHouseRule>, calls: Record<string, { call: InHouseCall; reason: string }> = {}): Snapshot => ({
    ...snap,
    editorial: { ...(snap.editorial as EditorialData), inHouse: { calls, rule: { ...DEFAULT_INHOUSE_RULE, ...rule } } },
  })

  it('matches the old behaviour with the default settings', () => {
    expect(suggestInHouse(fresh(), withRule({})).map((s) => s.player.name)).toEqual(names(fresh()).map((n) => n.split(':')[1]))
  })

  it('switches releases and restructures off, leaving editor calls alone', () => {
    const wilson = fresh().roster.find((p) => p.name === 'Garrett Wilson')!.id
    const ed = withRule({ release: false, restructure: false }, { [wilson]: { call: 'block', reason: 'Sell high' } })
    expect(suggestInHouse(tight(fresh()), ed).map((s) => `${s.kind}:${s.player.name}`)).toEqual(['block:Garrett Wilson'])
  })

  it('moves with its thresholds', () => {
    const strict = suggestInHouse(fresh(), withRule({ minSurplus: 4_500_000 })).map((s) => s.player.name)
    expect(strict).toEqual(['Jeremy Ruckert'])
    const loose = suggestInHouse(fresh(), withRule({ tightSpace: 200_000_000, maxAge: 26 }))
    expect(loose.some((s) => s.kind === 'restructure')).toBe(true)
    for (const s of loose.filter((x) => x.kind === 'restructure')) expect(s.player.age).toBeLessThanOrEqual(26)
  })
})
