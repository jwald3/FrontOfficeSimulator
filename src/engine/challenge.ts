import type { Mode, Objective } from './types'

/**
 * A challenge code pins everything random about a run — player personalities,
 * free-agent interest, draft declarations, AI behaviour — so two people with the
 * same code face the same offseason, as the same team.
 * Format: FO-<seed base36>-<mode><objective>-<team>, e.g. FO-1K2J3-GB-DAL.
 */
export interface Challenge {
  seed: number
  mode: Mode
  objective: Objective
  team: string
}

const MODE_CODE: Record<Mode, string> = { genuine: 'G', simplified: 'S' }
const OBJECTIVE_CODE: Record<Objective, string> = { balanced: 'B', draft: 'D', 'win-now': 'W', 'cap-room': 'C' }

const invert = <K extends string>(m: Record<K, string>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, K>

export function encodeChallenge(c: Challenge): string {
  return `FO-${(c.seed >>> 0).toString(36).toUpperCase()}-${MODE_CODE[c.mode]}${OBJECTIVE_CODE[c.objective]}-${c.team}`
}

/** A challenge from its code, or null if it isn't one. `teams` are the valid team ids. */
export function decodeChallenge(code: string, teams?: string[]): Challenge | null {
  const m = /^FO-([0-9A-Z]{1,7})-([GS])([BDWC])-([A-Z]{2,3})$/.exec(code.trim().toUpperCase())
  if (!m) return null
  const [, seed36, mode, objective, team] = m
  if (teams && !teams.includes(team)) return null
  const seed = parseInt(seed36, 36)
  if (!Number.isFinite(seed) || seed > 0xffffffff) return null
  return { seed, mode: invert(MODE_CODE)[mode], objective: invert(OBJECTIVE_CODE)[objective], team }
}
