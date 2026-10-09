import type { OfferReport, ReportAction, ReportsFile, Verdict } from '../engine/reportSchema'
import { pickLabel, type TradeOffer } from '../engine/trades'
import type { RunState, Snapshot } from '../engine/types'
import { modelValue, tradeValue } from '../engine/valuation'

// Where offer reports go. On the dev server they're written to data/reports.json
// (see vite.config.ts). A deployed site needs somewhere to receive them: set
// VITE_REPORTS_URL at build time to an endpoint that accepts the same POST.
const ENDPOINT: string = import.meta.env.VITE_REPORTS_URL || '/__reports'

/** Whether reports have somewhere to go: the dev server, or a configured endpoint. Otherwise the flag button is hidden. */
export const REPORTING = import.meta.env.DEV || !!import.meta.env.VITE_REPORTS_URL

/** The report for one offer, as the player flagged it. Its id is stable per run and offer, so it can't be sent twice. */
export function buildReport(run: RunState, snap: Snapshot, o: TradeOffer, verdict: Verdict, note: string): Omit<OfferReport, 'status' | 'history'> {
  const c = run.roster.find((p) => p.id === o.playerId)!
  return {
    id: `${run.seed}-${o.id}`,
    verdict,
    note: note.trim().slice(0, 1000),
    offer: {
      kind: o.kind ?? 'block',
      team: o.team,
      picks: run.picks.filter((p) => o.pickIds.includes(p.id)).map(pickLabel),
      value: Math.round(o.value),
      wave: o.wave,
    },
    player: { id: c.id, name: c.name, pos: c.pos, age: c.age, value: c.rookieValue ?? tradeValue(c, snap), modelValue: modelValue(c, snap) },
    run: { seed: run.seed, mode: run.mode, season: run.season, dataVersion: snap.version },
  }
}

/** Send a report; resolves to an error message, or undefined once it's received. */
export async function sendReport(report: Omit<OfferReport, 'status' | 'history'>): Promise<string | undefined> {
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) })
    if (res.status === 404 || res.status === 405) return "Reporting isn't connected on this site yet."
    if (res.status === 409) return undefined // already flagged: nothing more to do
    if (!res.ok) return (await res.text()) || 'The report was not accepted.'
    return undefined
  } catch {
    return 'Could not reach the reporting service.'
  }
}

/** The editorial inbox's reports (dev server only). */
export async function loadReports(): Promise<ReportsFile | string> {
  try {
    const res = await fetch('/__reports')
    if (!res.ok) return 'Reports need the dev server (npm run dev).'
    return (await res.json()) as ReportsFile
  } catch {
    return 'Reports need the dev server (npm run dev).'
  }
}

/** Resolve a report (adjusted, ignored, reopened); resolves to the updated file or an error message. */
export async function resolveReport(id: string, action: ReportAction, detail?: string): Promise<ReportsFile | string> {
  try {
    const res = await fetch('/__reports/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, detail }) })
    if (!res.ok) return (await res.text()) || 'Could not update the report.'
    return (await res.json()) as ReportsFile
  } catch {
    return 'Reports need the dev server (npm run dev).'
  }
}
