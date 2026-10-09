import type { Snapshot } from './types'

// The snapshot is built around one team (the data's home team): its contracts are
// `roster`, everyone else's are `otherRosters`, and the cap figures, free agents'
// `own` flags and rights players are from its point of view. forTeam re-centres a
// copy on any team, so the engine can run the offseason as whoever the player picks.

/** The team the snapshot data is centred on, when it doesn't say. */
export const HOME_TEAM = 'NYJ'

/**
 * A copy of the snapshot from `team`'s point of view: its contracts become the
 * roster, the home team's join the other rosters, its own free agents and rights
 * players are flagged `own`, and its cap figures replace the home team's.
 *
 * Only the home team's cap carries a projected rollover; every other team starts
 * from the league cap and its own dead money.
 */
export function forTeam(base: Snapshot, team: string): Snapshot {
  const snap = structuredClone(base)
  const home = base.team ?? HOME_TEAM
  snap.team = team
  if (team === home) {
    snap.capIncludesRollover = true
    return snap
  }
  const entry = base.teams.find((t) => t.id === team)
  if (!entry) throw new Error(`Unknown team: ${team}`)
  const { [team]: ours = [], ...others } = snap.otherRosters
  snap.otherRosters = { ...others, [home]: snap.roster }
  snap.roster = ours
  for (const p of snap.freeAgents) p.own = p.team === team
  for (const p of snap.rightsPlayers) p.own = p.team === team
  snap.capLimit = entry.capLimit
  snap.existingDead = entry.existingDead ?? 0
  snap.capIncludesRollover = false
  snap.title = `${base.season} ${entry.fullName} Offseason`
  return snap
}

/** "New York Jets" → "Jets". */
export function nickname(snap: Pick<Snapshot, 'teams'>, id: string): string {
  return snap.teams.find((t) => t.id === id)?.fullName.split(' ').pop() ?? id
}
