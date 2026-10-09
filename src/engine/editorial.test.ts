import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { attachEditorial, boardOrder, coachCandidates, EMPTY_EDITORIAL, manualId, validateEditorial, type CoordinatorsData, type EditorialData } from './editorial'
import { isStarter } from './depth'
import { loadSnapshot, startRun } from './snapshot.testutil'

const snap = loadSnapshot()
const coordinators: CoordinatorsData = JSON.parse(readFileSync('public/data/coordinators.json', 'utf8'))
const shipped: EditorialData = JSON.parse(readFileSync('public/data/editorial.json', 'utf8'))

describe('editorial: head coach candidates', () => {
  it('ships a valid file offering every current coordinator', () => {
    expect(validateEditorial(shipped)).toBe(shipped)
    expect(coachCandidates(snap, coordinators, shipped)).toHaveLength(coordinators.coordinators.length)
  })

  it('puts our own coordinators first, as internal promotions', () => {
    const board = coachCandidates(snap, coordinators, shipped)
    expect(board.slice(0, 2).map((c) => [c.name, c.internal])).toEqual([['Brian Duker', true], ['Frank Reich', true]])
    expect(board.slice(2).every((c) => !c.internal)).toBe(true)
  })

  it('offers only the chosen coordinators plus manual entries, and drops stale ids', () => {
    const editorial: EditorialData = {
      version: 1,
      coach: { coordinatorIds: ['kc-dc-steve-spagnuolo', 'gone-oc-someone'], manual: [{ id: 'manual-x', name: 'Jane Coach', role: 'College head coach' }] },
    }
    const board = coachCandidates(snap, coordinators, editorial)
    expect(board.map((c) => [c.name, c.kind])).toEqual([['Steve Spagnuolo', 'DC'], ['Jane Coach', 'other']])
    expect(board[0].role).toBe('Kansas City Chiefs defensive coordinator')
  })

  it('rejects malformed files', () => {
    expect(() => validateEditorial({})).toThrow()
    expect(() => validateEditorial({ ...EMPTY_EDITORIAL, coach: { coordinatorIds: [], manual: [{ id: 'a', name: '', role: '' }] } })).toThrow()
    expect(() => validateEditorial({ ...EMPTY_EDITORIAL, coach: { coordinatorIds: [], manual: [{ id: 'a', name: 'A', role: '' }, { id: 'a', name: 'B', role: '' }] } })).toThrow()
  })

  it('gives manual entries unique ids', () => {
    expect(manualId('Sherrone Moore', [])).toBe('manual-sherrone-moore')
    expect(manualId('Sherrone Moore', ['manual-sherrone-moore'])).toBe('manual-sherrone-moore-2')
  })
})

describe('editorial file versions', () => {
  it('accepts files without the newer optional fields', () => {
    expect(() => validateEditorial({ version: 1, coach: { coordinatorIds: [], manual: [] } })).not.toThrow()
  })

  it('rejects bad interest levels and re-sign calls', () => {
    const base = { version: 1, coach: { coordinatorIds: [], manual: [] } }
    expect(() => validateEditorial({ ...base, coach: { ...base.coach, interest: { x: 'definitely' } } })).toThrow()
    expect(() => validateEditorial({ ...base, coach: { ...base.coach, interest: { x: 'likely' } } })).not.toThrow()
    expect(() => validateEditorial({ ...base, colors: { teams: { DAL: { primary: '#003594' } }, fixed: { alert: '#ff0000' } } })).not.toThrow()
    expect(() => validateEditorial({ ...base, colors: { teams: { DAL: { primary: 'blue' } } } })).toThrow()
    expect(() => validateEditorial({ ...base, colors: { neutral: { glow: '#ffffff' } } })).toThrow()
    expect(() => validateEditorial({ ...base, coach: { ...base.coach, levels: { likely: { chance: 1.5 } } } })).toThrow()
    expect(() => validateEditorial({ ...base, coach: { ...base.coach, levels: { someday: { chance: 0.5 } } } })).toThrow()
    expect(() => validateEditorial({ ...base, coach: { ...base.coach, levels: { likely: { chance: 0.9, copy: 'Keen.' } } } })).not.toThrow()
    expect(() => validateEditorial({ ...base, resign: { calls: { x: { call: 'trade', reason: '' } } } })).toThrow()
    expect(() => validateEditorial({ ...base, resign: { calls: { x: { call: 'walk', reason: 'Too old' } } } })).not.toThrow()
    expect(() => validateEditorial({ ...base, inHouse: { calls: { x: { call: 'trade', reason: '' } } } })).toThrow()
    expect(() => validateEditorial({ ...base, inHouse: { calls: { x: { call: 'keep', reason: 'Scheme fit' } } } })).not.toThrow()
    expect(() => validateEditorial({ ...base, market: { calls: { x: { call: 'tagged', reason: '' } } } })).toThrow()
    expect(() => validateEditorial({ ...base, market: { calls: { x: { call: 'stays', reason: '' } } } })).not.toThrow()
    expect(() => validateEditorial({ ...base, playerValues: { x: -5 } })).toThrow()
    expect(() => validateEditorial({ ...base, playerValues: { x: 2400 } })).not.toThrow()
    expect(() => validateEditorial({ ...base, untouchable: 'x' })).toThrow()
    expect(() => validateEditorial({ ...base, untouchable: ['x'] })).not.toThrow()
    expect(() => validateEditorial({ ...base, noFirsts: [3] })).toThrow()
    expect(() => validateEditorial({ ...base, noFirsts: ['x'] })).not.toThrow()
    expect(() => validateEditorial({ ...base, draftAdvice: [{ pos: 'QB', rounds: 9 }] })).toThrow()
    expect(() => validateEditorial({ ...base, draftAdvice: [{ pos: 'QB', rounds: 2 }, { pos: 'K', rounds: 7 }] })).not.toThrow()
    expect(() => validateEditorial({ ...base, inHouse: { calls: {}, rule: { release: true, restructure: true, minSurplus: -1, tightSpace: 0, maxAge: 30 } } })).toThrow()
    expect(() => validateEditorial({ ...base, inHouse: { calls: {}, rule: { release: false, restructure: true, minSurplus: 3e6, tightSpace: 2e7, maxAge: 28 } } })).not.toThrow()
  })
})

describe('editorial: draft board', () => {
  const p = (id: string, rank: number) => ({ id, rank })

  it('ranks by the editor order, slots unlisted prospects at their source rank and drops stale ids', () => {
    const prospects = [p('a', 1), p('b', 2), p('c', 3), p('d', 4)]
    expect(boardOrder(prospects, ['c', 'gone', 'a', 'b']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(boardOrder(prospects, ['d', 'c', 'b']).map((x) => x.id)).toEqual(['a', 'd', 'c', 'b'])
    expect(boardOrder(prospects).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('makes the editor board every prospect’s rank, keeping the source rank, and survives re-attaching', () => {
    const fresh = loadSnapshot()
    const [first, second] = [...fresh.prospects].sort((a, b) => a.rank - b.rank)
    const order = [second.id, first.id, ...[...fresh.prospects].sort((a, b) => a.rank - b.rank).slice(2).map((x) => x.id)]
    const editorial: EditorialData = { ...shipped, draft: { order, notes: { [second.id]: '  Day-one starter  ' } } }
    attachEditorial(fresh, coordinators, editorial)
    expect([second.rank, second.consensusRank, second.note]).toEqual([1, 2, 'Day-one starter'])
    expect([first.rank, first.consensusRank, first.note]).toEqual([2, 1, undefined])
    attachEditorial(fresh, coordinators, shipped)
    expect([first.rank, second.rank, second.note]).toEqual([1, 2, undefined])
  })

  it('validates the draft section', () => {
    const base = { version: 1, coach: { coordinatorIds: [], manual: [] } }
    expect(() => validateEditorial({ ...base, draft: { order: ['a', 'a'] } })).toThrow()
    expect(() => validateEditorial({ ...base, draft: { declare: { a: 'maybe' } } })).toThrow()
    expect(() => validateEditorial({ ...base, draft: { order: ['a', 'b'], notes: { a: 'Fast' }, declare: { b: 'returns' } } })).not.toThrow()
  })
})

describe('editorial: depth chart', () => {
  it('replaces source spots on every copy of the player, takes players off the chart, and resets on re-attach', () => {
    const fresh = loadSnapshot()
    const starter = fresh.roster.find((p) => p.chart?.depth === 1)!
    const unlisted = fresh.roster.find((p) => !p.chart)!
    attachEditorial(fresh, coordinators, { ...shipped, depth: { spots: { [starter.id]: null, [unlisted.id]: { slot: 'LT', depth: 1 } } } })
    expect(starter.chart).toBeUndefined()
    expect(starter.sourceChart?.depth).toBe(1)
    expect(unlisted.chart).toEqual({ team: unlisted.team, slot: 'LT', depth: 1 })
    expect(isStarter(startRun(fresh, { mode: 'genuine', objective: 'balanced', seed: 1 }).roster.find((p) => p.id === unlisted.id)!)).toBe(true)
    attachEditorial(fresh, coordinators, shipped)
    expect(starter.chart?.depth).toBe(1)
    expect(unlisted.chart).toBeUndefined()
  })

  it('validates depth spots', () => {
    const base = { version: 1, coach: { coordinatorIds: [], manual: [] } }
    expect(() => validateEditorial({ ...base, depth: { spots: { a: { slot: 'LT', depth: 0 } } } })).toThrow()
    expect(() => validateEditorial({ ...base, depth: { spots: { a: { slot: '', depth: 1 } } } })).toThrow()
    expect(() => validateEditorial({ ...base, depth: { spots: { a: { slot: 'LT', depth: 2 }, b: null } } })).not.toThrow()
  })
})
