// Offer reports: a player flags a trade offer as too high or too low, and the report
// lands in the editorial Feedback inbox, where the editor adjusts the player's value
// or ignores it. Every step is kept in the report's history. Kept free of imports so
// the dev server's endpoints (vite.config.ts) can use it directly.

export type Verdict = 'too-high' | 'too-low'
export const VERDICTS: Verdict[] = ['too-high', 'too-low']

export type ReportStatus = 'open' | 'adjusted' | 'ignored'
export type ReportAction = 'flagged' | 'adjusted' | 'ignored' | 'reopened'
export const RESOLUTIONS: ReportAction[] = ['adjusted', 'ignored', 'reopened']

export interface ReportEvent {
  /** ISO timestamp. */
  at: string
  action: ReportAction
  /** What changed, e.g. "Value 1,636 → 1,800". */
  detail?: string
}

export interface OfferReport {
  id: string
  verdict: Verdict
  note: string
  offer: {
    kind: 'call' | 'block'
    /** The offering team's id. */
    team: string
    /** The picks offered, as labels ("2028 R1 Pick 32 (PHI)"). */
    picks: string[]
    /** What the package is worth, in chart points. */
    value: number
    /** The free-agency wave it arrived in. */
    wave: number
  }
  player: {
    id: string
    name: string
    pos: string
    age: number
    /** His trade value when flagged (an editorial value if one was set), and the model's. */
    value: number
    modelValue: number
  }
  run: { seed: number; mode: string; season: number; dataVersion: string }
  status: ReportStatus
  history: ReportEvent[]
}

export interface ReportsFile {
  version: 1
  reports: OfferReport[]
}

export const EMPTY_REPORTS: ReportsFile = { version: 1, reports: [] }

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x)
const isStr = (x: unknown) => typeof x === 'string'

/** Throws unless this is a well-formed new report from the game; returns it typed. */
export function validateNewReport(data: unknown): Omit<OfferReport, 'status' | 'history'> {
  const r = data as OfferReport
  if (!isRecord(r) || !isStr(r.id) || !r.id || !VERDICTS.includes(r.verdict) || !isStr(r.note) || r.note.length > 1000) {
    throw new Error('A report needs an id, a verdict (too-high or too-low) and a note of up to 1,000 characters.')
  }
  const o = r.offer
  if (!isRecord(o) || !['call', 'block'].includes(o.kind as string) || !isStr(o.team) || !Array.isArray(o.picks) || !o.picks.every(isStr) || !isNum(o.value) || !isNum(o.wave)) {
    throw new Error('A report needs the offer: kind, team, picks, value and wave.')
  }
  const p = r.player
  if (!isRecord(p) || !isStr(p.id) || !isStr(p.name) || !isStr(p.pos) || !isNum(p.age) || !isNum(p.value) || !isNum(p.modelValue)) {
    throw new Error('A report needs the player: id, name, position, age and values.')
  }
  const run = r.run
  if (!isRecord(run) || !isNum(run.seed) || !isStr(run.mode) || !isNum(run.season) || !isStr(run.dataVersion)) {
    throw new Error('A report needs the run: seed, mode, season and data version.')
  }
  return r
}

/** Apply a resolution to a report: its status follows the action, and the step joins its history. */
export function resolveReport(report: OfferReport, action: ReportAction, detail: string | undefined, at: string): OfferReport {
  const status: ReportStatus = action === 'adjusted' ? 'adjusted' : action === 'ignored' ? 'ignored' : 'open'
  return { ...report, status, history: [...report.history, { at, action, ...(detail ? { detail } : {}) }] }
}
