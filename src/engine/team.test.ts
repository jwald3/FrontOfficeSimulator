import { describe, expect, it } from 'vitest'
import { capSummary } from './cap'
import { decodeChallenge, encodeChallenge } from './challenge'
import { keepCoach } from './coach'
import { draftOrder, simToUser } from './draft'
import { fastForward } from './quickstart'
import { createRun } from './run'
import { loadSnapshot } from './snapshot.testutil'
import { gradeOffseason } from './summary'
import { HOME_TEAM } from './team'

const home = loadSnapshot()
const dallas = loadSnapshot('DAL')
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason)
  return r as Extract<T, { ok: true }>
}

describe('playing as any team', () => {
  it("re-centres the data on the team: its contracts, its free agents, its cap", () => {
    expect(dallas.team).toBe('DAL')
    expect(dallas.roster.length).toBeGreaterThan(20)
    expect(dallas.roster.every((p) => p.team === 'DAL')).toBe(true)
    expect(dallas.otherRosters.DAL).toBeUndefined()
    expect(dallas.otherRosters[HOME_TEAM].map((p) => p.id)).toEqual(home.roster.map((p) => p.id))
    expect(dallas.freeAgents.filter((p) => p.own).every((p) => p.team === 'DAL')).toBe(true)
    expect(dallas.freeAgents.some((p) => p.own)).toBe(true)
    expect(dallas.capLimit).toBe(dallas.teams.find((t) => t.id === 'DAL')!.capLimit)
    expect(dallas.capIncludesRollover).toBe(false)
    // The home team's view is unchanged, rollover included.
    expect(home.capIncludesRollover).toBe(true)
  })

  it('leaves the base data alone, so switching teams back and forth is clean', () => {
    expect(loadSnapshot('DAL').roster.map((p) => p.id)).toEqual(dallas.roster.map((p) => p.id))
    expect(loadSnapshot().roster.map((p) => p.id)).toEqual(home.roster.map((p) => p.id))
  })

  it("names the team and its coach in the run and the headlines", () => {
    const run = createRun(dallas, { mode: 'genuine', objective: 'balanced', seed: 3 })
    expect(run).toMatchObject({ team: 'DAL', teamName: 'Cowboys' })
    expect(run.coachName).toBe(dallas.headCoach)
    expect(run.coachName).not.toBe('Aaron Glenn')
    expect(run.news.some((n) => n.text.startsWith('Cowboys enter the offseason'))).toBe(true)
    const kept = ok(keepCoach(run)).run
    expect(kept.coach).toEqual({ status: 'kept', name: dallas.headCoach })
    expect(kept.news.at(-1)?.text).toContain('Cowboys confirm')
  })

  it("treats the team's own coordinators as promotions", () => {
    const internal = dallas.coachCandidates!.filter((c) => c.internal)
    expect(internal.every((c) => c.role.startsWith('Dallas Cowboys'))).toBe(true)
    expect(home.coachCandidates!.filter((c) => c.internal).every((c) => c.role.startsWith('New York Jets'))).toBe(true)
  })

  it('drafts with the team’s own picks', () => {
    const run = fastForward(createRun(dallas, { mode: 'genuine', objective: 'balanced', seed: 8 }), dallas, 'draft')
    const atPick = simToUser(run, dallas).run
    const pick = draftOrder(atPick)[atPick.draft!.cursor]
    expect(pick.owner).toBe('DAL')
  })

  it('runs a whole offseason for every team without getting stuck', () => {
    for (const t of home.teams) {
      const snap = loadSnapshot(t.id)
      const run = fastForward(createRun(snap, { mode: 'simplified', objective: 'balanced', seed: 21 }), snap, 'draft')
      expect(run.phase, t.id).toBe('draft')
      expect(Number.isFinite(capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase).effectiveSpace), t.id).toBe(true)
      expect(gradeOffseason(run, snap).letter, t.id).toMatch(/^[A-F]/)
    }
  })
})

describe('challenge codes', () => {
  it('carry the team', () => {
    const code = encodeChallenge({ seed: 123456, mode: 'genuine', objective: 'draft', team: 'DAL' })
    expect(code).toBe('FO-2N9C-GD-DAL')
    expect(decodeChallenge(code, home.teams.map((t) => t.id))).toEqual({ seed: 123456, mode: 'genuine', objective: 'draft', team: 'DAL' })
  })

  it('reject unknown teams and codes without one', () => {
    expect(decodeChallenge('FO-2N9C-GD-XYZ', home.teams.map((t) => t.id))).toBeNull()
    expect(decodeChallenge('FO-2N9C-GD')).toBeNull()
  })
})
