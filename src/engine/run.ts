import { money } from './format'
import { personality } from './negotiation'
import { nickname } from './team'
import type { Contract, Expiring, Mode, NewsItem, Objective, RunState, Snapshot } from './types'

export interface RunOptions {
  mode: Mode
  objective: Objective
  seed: number
}

export function createRun(snap: Snapshot, opts: RunOptions): RunState {
  const roster: Contract[] = snap.roster.map((p) => ({
    ...p,
    years: p.years.map((y) => ({ ...y })),
    onTradeBlock: false,
    restructured: false,
  }))
  const news: NewsItem[] = [
    { id: 1, tone: 'league', text: `${snap.season} league year opens · projected cap ${money(snap.capLimit)}${snap.capIncludesRollover ? ' with rollover' : ''}` },
    { id: 2, tone: 'team', text: `${nickname(snap, snap.team)} enter the offseason with ${roster.length} players under contract` },
  ]
  return {
    seed: opts.seed,
    team: snap.team,
    teamName: nickname(snap, snap.team),
    coachName: snap.headCoach ?? 'the head coach',
    season: snap.season,
    mode: opts.mode,
    objective: opts.objective,
    phase: 'coach',
    adjustedCap: snap.capLimit,
    roster,
    dead: snap.existingDead
      ? [{ playerId: 'existing', name: 'Existing dead & void charges', amount: snap.existingDead, reason: 'existing' }]
      : [],
    picks: snap.picks.map((p) => ({ ...p })),
    expiring: expiringPlayers(snap, opts.seed),
    tagUsed: null,
    tradeOffers: [],
    moves: [],
    news,
    nextId: news.length + 1,
  }
}

/** Our own expiring and rights players, with the rights detail merged in. */
function expiringPlayers(snap: Snapshot, seed: number): Expiring[] {
  const rights = new Map(snap.rightsPlayers.filter((p) => p.own).map((p) => [p.id, p]))
  return snap.freeAgents
    .filter((p) => p.own)
    .map((p) => {
      return {
        ...p,
        ...rights.get(p.id),
        status: 'open' as const,
        patience: personality(seed, p).patience,
        offers: 0,
      }
    })
}
