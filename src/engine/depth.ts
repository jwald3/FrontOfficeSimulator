import type { ChartSpot, RawContractPlayer, RawMarketPlayer, Snapshot } from './types'

/** public/data/depth.json, built by scripts/depth.mjs from OurLads depth charts. */
export interface DepthData {
  source: string
  asOf: string
  players: Record<string, ChartSpot>
}

/**
 * Attach each player's depth-chart spot to the snapshot in place, so every copy the
 * engine makes of a player (contracts, market entries, trade targets) carries it.
 */
export function attachDepth(snap: Snapshot, depth: DepthData): Snapshot {
  for (const p of chartPlayers(snap)) p.chart = p.sourceChart = depth.players[p.id]
  snap.depthAsOf = depth.asOf
  return snap
}

/** Every player in the snapshot who can carry a depth-chart spot. A few appear in more than one list. */
export function chartPlayers(snap: Snapshot): (RawContractPlayer | RawMarketPlayer)[] {
  return [...snap.roster, ...Object.values(snap.otherRosters).flat(), ...snap.freeAgents, ...snap.rightsPlayers, ...snap.depthCandidates]
}

/** Listed first at any spot on his team's current depth chart. */
export function isStarter(p: { chart?: ChartSpot }): boolean {
  return p.chart?.depth === 1
}

export function roleLabel(p: { chart?: ChartSpot }): string {
  if (!p.chart) return 'Not on a depth chart'
  return p.chart.depth === 1 ? `Starter · ${p.chart.slot}` : `${ordinal(p.chart.depth)} string · ${p.chart.slot}`
}

function ordinal(n: number): string {
  return n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`
}
