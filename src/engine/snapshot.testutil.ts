import { readFileSync } from 'node:fs'
import { keepCoach } from './coach'
import { attachDepth } from './depth'
import { attachEditorial } from './editorial'
import { createRun, type RunOptions } from './run'
import { forTeam, HOME_TEAM } from './team'
import type { RunState, Snapshot } from './types'

const read = (file: string) => JSON.parse(readFileSync(`public/data/${file}`, 'utf8'))
let base: Snapshot | undefined

/** The real data snapshot with depth charts attached, from `team`'s point of view, as the app loads it. */
export function loadSnapshot(team = HOME_TEAM): Snapshot {
  base ??= attachDepth({ ...read('offseason-2027.json'), team: HOME_TEAM }, read('depth.json'))
  return attachEditorial(forTeam(base, team), read('coordinators.json'), read('editorial.json'))
}

/** A new run past the head coach decision (coach kept), at the in-house phase. */
export function startRun(snap: Snapshot, opts: RunOptions): RunState {
  const kept = keepCoach(createRun(snap, opts))
  if (!kept.ok) throw new Error(kept.reason)
  return { ...kept.run, phase: 'in-house' }
}
