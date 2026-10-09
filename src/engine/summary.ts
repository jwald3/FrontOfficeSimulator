import { capSummary, seasonCapHit } from './cap'
import { createRun } from './run'
import { pickValue } from './trades'
import { isStarter } from './depth'
import type { ChartSpot, Contract, Objective, Position, RawContractPlayer, RunState, Snapshot } from './types'

// ─── Starting lineup ────────────────────────────────────────────────────────

/** Offense, defense and specialists: 24 starting spots. */
export const LINEUP: { pos: Position; count: number }[] = [
  { pos: 'QB', count: 1 },
  { pos: 'RB', count: 1 },
  { pos: 'WR', count: 3 },
  { pos: 'TE', count: 1 },
  { pos: 'OT', count: 2 },
  { pos: 'IOL', count: 3 },
  { pos: 'EDGE', count: 2 },
  { pos: 'IDL', count: 2 },
  { pos: 'LB', count: 2 },
  { pos: 'CB', count: 3 },
  { pos: 'S', count: 2 },
  { pos: 'K', count: 1 },
  { pos: 'P', count: 1 },
]

export const LINEUP_SPOTS = LINEUP.reduce((a, l) => a + l.count, 0)

/** Anything that can fill a lineup spot: a contract, a free agent, a rookie. */
export interface Rated {
  pos: Position
  apy: number
  chart?: ChartSpot
}

export interface Starter<T extends Rated = RawContractPlayer> {
  pos: Position
  player?: T
}

/**
 * Who starts at each position: players higher on their team's real depth chart
 * first, then the bigger contract. Rookies and unlisted players fill what's left.
 */
export function startingLineup<T extends Rated>(roster: T[]): Starter<T>[] {
  const rank = (p: T) => p.chart?.depth ?? 99
  return LINEUP.flatMap(({ pos, count }) => {
    const best = roster.filter((p) => p.pos === pos).sort((a, b) => rank(a) - rank(b) || b.apy - a.apy)
    return Array.from({ length: count }, (_, i) => ({ pos, player: best[i] }))
  })
}

/** Lineup spots filled by proven starters: players listed first on a current depth chart. */
export function provenStarters(roster: Rated[]): number {
  return startingLineup(roster).filter((s) => s.player && isStarter(s.player)).length
}

function lineupAge(roster: RawContractPlayer[]): number {
  const s = startingLineup(roster).filter((x) => x.player)
  return s.reduce((a, x) => a + x.player!.age, 0) / Math.max(1, s.length)
}

// ─── Grading ────────────────────────────────────────────────────────────────

export type Category = 'talent' | 'cap' | 'capital' | 'roster' | 'youth'

export const CATEGORY_NAME: Record<Category, string> = {
  talent: 'Roster talent',
  cap: 'Cap health',
  capital: 'Draft capital',
  roster: 'Roster completeness',
  youth: 'Age profile',
}

const WEIGHTS: Record<Objective, Record<Category, number>> = {
  balanced: { talent: 0.35, cap: 0.2, capital: 0.2, roster: 0.15, youth: 0.1 },
  draft: { talent: 0.2, cap: 0.15, capital: 0.35, roster: 0.1, youth: 0.2 },
  'win-now': { talent: 0.55, cap: 0.1, capital: 0.05, roster: 0.2, youth: 0.1 },
  'cap-room': { talent: 0.2, cap: 0.45, capital: 0.15, roster: 0.15, youth: 0.05 },
}

export interface CategoryScore {
  id: Category
  score: number
  weight: number
  detail: string
}

export interface Verdict {
  score: number
  letter: string
  categories: CategoryScore[]
  startersBefore: number
  startersAfter: number
  headline: string
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

/** Value of every pick we own, used or not: a used pick became a rookie we kept. */
function capitalValue(snap: Snapshot, picks: RunState['picks'], season: number, team: string): number {
  return picks.filter((p) => p.owner === team).reduce((a, p) => a + pickValue(snap, p, season), 0)
}

export function letterFor(score: number): string {
  const scale: [number, string][] = [
    [93, 'A+'], [87, 'A'], [82, 'A-'], [78, 'B+'], [73, 'B'], [68, 'B-'],
    [63, 'C+'], [58, 'C'], [53, 'C-'], [47, 'D+'], [42, 'D'], [36, 'D-'],
  ]
  return scale.find(([min]) => score >= min)?.[1] ?? 'F'
}

/**
 * Grade the offseason against where the team started, weighted by the
 * objective chosen at kickoff.
 */
export function gradeOffseason(run: RunState, snap: Snapshot): Verdict {
  const start = snap.roster
  const startersBefore = provenStarters(start)
  const startersAfter = provenStarters(run.roster)

  const cap = capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase)
  const committedNext = run.roster.reduce((a, p) => a + seasonCapHit(p, run.season + 1), 0)
  // League cap growth mirrors the snapshot's own projection factor.
  const projectedNextCap = snap.capLimit * snap.rookieScale.capGrowthFactor
  const startRun = createRun(snap, { mode: run.mode, objective: run.objective, seed: 0 })
  const startCap = capSummary(startRun, snap.rookieScale.slots, snap.minimumRookieBase)
  const startNext = startRun.roster.reduce((a, p) => a + seasonCapHit(p, run.season + 1), 0)
  // Where the cap stands: over is a crisis, room beyond ~$30M is just unspent, and
  // next season's commitments matter as much as this season's room.
  const capHealth =
    0.5 * (cap.effectiveSpace < 0 ? 20 + cap.effectiveSpace / 1e6 : 60 + Math.min(30, cap.effectiveSpace / 1e6)) +
    0.5 * (100 - (committedNext / projectedNextCap - 0.55) * 160)
  // What changed since kickoff: future money cleared counts triple this season's.
  const capGain = 60 + ((startNext - committedNext) / 1e6) * 1.5 + ((cap.effectiveSpace - startCap.effectiveSpace) / 1e6) * 0.5
  const capitalBefore = capitalValue(snap, snap.picks, run.season, run.team)
  const capitalAfter = capitalValue(snap, run.picks, run.season, run.team)

  const target = run.mode === 'genuine' ? 90 : 53
  const count = run.roster.length
  const over = run.mode === 'genuine' && count > 90

  const ageBefore = lineupAge(start)
  const ageAfter = lineupAge(run.roster)

  const raw: Record<Category, { score: number; detail: string }> = {
    talent: {
      // Holding serve is a C; every proven starter added to the lineup is worth a lot.
      score: clamp(60 + (startersAfter - startersBefore) * 6),
      detail: `Proven starters in the lineup ${startersBefore} → ${startersAfter} of ${LINEUP_SPOTS}`,
    },
    cap: {
      // Spending well isn't a cap failure — only the Create Cap Room objective
      // judges how much money was cleared.
      score: clamp(run.objective === 'cap-room' ? 0.4 * capHealth + 0.6 * capGain : capHealth),
      detail: `${(cap.effectiveSpace / 1e6).toFixed(1)}M effective space · ${Math.round((committedNext / projectedNextCap) * 100)}% of 2028 committed`,
    },
    capital: {
      score: clamp(60 + ((capitalAfter - capitalBefore) / capitalBefore) * 120),
      detail: `${Math.round(capitalAfter)} pick points vs ${Math.round(capitalBefore)} at the start`,
    },
    roster: {
      score: clamp(over ? 70 - (count - 90) * 5 : 100 - Math.max(0, target - count) * (run.mode === 'genuine' ? 1.5 : 4)),
      detail: over ? `${count} players: ${count - 90} over the 90-man limit` : `${count} of ${target} roster spots filled`,
    },
    youth: {
      score: clamp(60 + (ageBefore - ageAfter) * 25),
      detail: `Starters average ${ageAfter.toFixed(1)} years (was ${ageBefore.toFixed(1)})`,
    },
  }

  const w = WEIGHTS[run.objective]
  const categories = (Object.keys(raw) as Category[]).map((id) => ({ id, weight: w[id], ...raw[id] }))
  const score = categories.reduce((a, c) => a + c.score * c.weight, 0)
  const best = [...categories].sort((a, b) => b.score * b.weight - a.score * a.weight)[0]
  const worst = [...categories].sort((a, b) => a.score - b.score)[0]
  const headline =
    score >= 82
      ? `A franchise-shifting offseason, led by ${CATEGORY_NAME[best.id].toLowerCase()}.`
      : score >= 68
        ? `A strong offseason. ${CATEGORY_NAME[worst.id]} is the one thing holding it back.`
        : score >= 53
          ? `A mixed bag. ${CATEGORY_NAME[worst.id]} needs work before the season.`
          : `A rough offseason. ${CATEGORY_NAME[worst.id]} took the biggest hit.`

  return { score, letter: letterFor(score), categories, startersBefore, startersAfter, headline }
}

/** Contracts we added this offseason, for the recap. */
export function newcomers(run: RunState, snap: Snapshot): Contract[] {
  const original = new Set(snap.roster.map((p) => p.id))
  return run.roster.filter((p) => !original.has(p.id))
}
