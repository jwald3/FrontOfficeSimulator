import { capRoom } from './resign'
import { buildContract, minimumSalary, signedContract, type Terms } from './contracts'
import { money, pickName } from './format'
import { withMove, type MoveResult } from './moves'
import { askingTerms, evaluateOffer, personality, respond, type Band, type Evaluation, type Personality, type Response } from './negotiation'
import { roll, rollRange } from './rng'
import { tenderOptions } from './rights'
import type { Move, NewsItem, RawMarketPlayer, RawTeam, RunState, Snapshot } from './types'

/** Free agency runs in waves; each advance of the clock lets the league sign players. */
export const WAVES = [
  { name: 'Day 1', blurb: 'The frenzy. Asking prices peak.', askFactor: 1.06, aiPace: 0.55 },
  { name: 'Days 2–3', blurb: 'The top tier is thinning out.', askFactor: 1, aiPace: 0.45 },
  { name: 'Week 2', blurb: 'Second-wave deals. Prices soften.', askFactor: 0.93, aiPace: 0.4 },
  { name: 'Late market', blurb: 'Bargains for whoever is left.', askFactor: 0.86, aiPace: 0.5 },
] as const

export type MarketStatus = 'available' | 'signed' | 'signed-elsewhere' | 'walked' | 'uninterested' | 'retained'

export interface MarketEntry {
  status: MarketStatus
  patience: number
  offers: number
  lastBand?: Band
  /** Who signed him, and for how much, if not us. */
  team?: string
  aav?: number
  years?: number
}

export interface OfferSheet {
  id: string
  playerId: string
  name: string
  pos: string
  team: string
  terms: Terms
  compRound: number | null
  resolved?: 'matched' | 'declined'
}

export interface MarketState {
  wave: number
  /** Only players we've touched or the league has signed; everyone else is available. */
  entries: Record<string, MarketEntry>
  /** Cap each AI team has spent in free agency. */
  spent: Record<string, number>
  offerSheets: OfferSheet[]
}

// ─── Pool ───────────────────────────────────────────────────────────────────

/**
 * Everyone on the open market: the league's free agents, plus our own players
 * we didn't keep. Our own come back without the loyalty discount — we let them go.
 */
export function marketPool(run: RunState, snap: Snapshot): RawMarketPlayer[] {
  const ours = new Map(run.expiring.map((p) => [p.id, p]))
  return snap.freeAgents.flatMap((p) => {
    if (!p.own) return [p]
    const e = ours.get(p.id)
    if (!e || e.status === 'signed' || e.status === 'tagged' || e.status === 'tendered') return []
    return [{ ...p, own: false }]
  })
}

export function entryFor(run: RunState, p: RawMarketPlayer): MarketEntry {
  const existing = run.market?.entries[p.id]
  if (existing) return existing
  const ours = run.expiring.find((e) => e.id === p.id)
  if (ours?.status === 'walked') return { status: 'walked', patience: 0, offers: ours.offers }
  // Our own unsigned players come back as ordinary free agents; only other teams' players re-sign at home.
  if (!ours && retained(run.seed, p)) return { status: 'retained', patience: 0, offers: 0, team: p.team }
  return {
    status: interested(run.seed, p) ? 'available' : 'uninterested',
    patience: personality(run.seed, p).patience,
    offers: 0,
  }
}

/**
 * Share of expiring players whose next contract was with the same team, measured
 * from OverTheCap contract histories (nflverse historical_contracts) for deals
 * whose final season was 2021–2024: 59% of players on deals under $2M a year
 * stayed, 38% of those at $2M or more. scripts/retention.mjs reproduces these.
 * Too few $20M+ players expire to give stars their own rate.
 */
export const RETENTION_RATE = { underTwoMillion: 0.59, twoMillionPlus: 0.38 }

/**
 * Most free agents never reach the market: before it opens, each other team's
 * player re-signs with his current team at the historical rate for his current
 * contract's price. Rolled once per run, so a challenge code sees the same market.
 * An editorial call (editorial.json) settles it instead.
 */
export function retained(seed: number, p: RawMarketPlayer): boolean {
  if (p.marketCall) return p.marketCall.call === 'stays'
  return roll(seed, `retained:${p.id}`) < retentionRate(p)
}

/** The historical chance he re-signs at home, by his current contract's price. */
export function retentionRate(p: RawMarketPlayer): number {
  return (p.currentAPY ?? 0) < 2_000_000 ? RETENTION_RATE.underTwoMillion : RETENTION_RATE.twoMillionPlus
}

/** A $20M+ market price marks a star. */
const STAR_PRICE = 20_000_000
/** Headline-worthy signings. */
const NOTABLE_PRICE = 8_000_000

/**
 * How coveted a free agent is, 0–1: his market price, with a bump for players who
 * start on their current team. Drives rival interest and how fast he signs.
 */
export function demand(p: RawMarketPlayer): number {
  const price = Math.min(1, Math.max(0, (p.marketAAV / 1e6 - 1) / 15))
  return Math.min(1, price * 0.85 + (p.chart?.depth === 1 ? 0.15 : 0))
}

/** A few players, more often stars, simply don't want to come to New York this year. */
function interested(seed: number, p: RawMarketPlayer): boolean {
  return roll(seed, `interest:${p.id}`) >= (p.marketAAV >= STAR_PRICE ? 0.2 : 0.08)
}

// ─── Opening the market ─────────────────────────────────────────────────────

/** Called when free agency opens: rival offer sheets arrive for our tendered RFAs. */
export function openMarket(run: RunState, snap: Snapshot): RunState {
  const sheets: OfferSheet[] = []
  const news: Omit<NewsItem, 'id'>[] = []
  for (const c of run.roster) {
    if (!c.tender && c.tag !== 'transition') continue
    const p = run.expiring.find((e) => e.id === c.id)
    if (!p) continue
    const interest = demand(p)
    const levelFactor = c.tag === 'transition' ? 0.5 : { first: 0.1, second: 0.3, original: 0.6, refusal: 0.8, erfa: 0 }[c.tender!]
    if (roll(run.seed, `sheet:${p.id}`) >= interest * levelFactor) continue
    const team = pickTeam(run, snap, p, roll(run.seed, `sheet-team:${p.id}`), c.years[0].base * 1.3 * FIRST_YEAR_SHARE)
    if (!team) continue
    const aav = Math.round(Math.max(c.years[0].base * 1.25, p.marketAAV * rollRange(run.seed, `sheet-aav:${p.id}`, 1, 1.2)) / 50_000) * 50_000
    const compRound = c.tag === 'transition' ? null : tenderOptions(snap, p).find((o) => o.level === c.tender)?.compRound ?? null
    sheets.push({
      id: `sheet-${p.id}`,
      playerId: p.id,
      name: p.name,
      pos: p.pos,
      team: team.id,
      terms: { aav, years: Math.max(2, p.preferredYears), guaranteePct: 0.4, structure: 'front-loaded' },
      compRound,
    })
    news.push({ tone: 'alert', text: `${team.fullName} sign ${run.teamName} ${p.type} ${p.pos} ${p.name} to an offer sheet: ${money(aav)} per year` })
  }
  // Report who never reached the market: the count, and the biggest names by price.
  const stayed = snap.freeAgents.filter((p) => !p.own && retained(run.seed, p)).sort((a, b) => b.marketAAV - a.marketAAV)
  if (stayed.length) {
    news.push({ tone: 'league', text: `Before the market opens: ${stayed.length} pending free agents re-sign with their teams` })
    for (const p of stayed.filter((x) => x.marketAAV >= NOTABLE_PRICE).slice(0, 6)) {
      news.push({ tone: 'league', text: `${snap.teams.find((t) => t.id === p.team)?.name ?? p.team} re-sign ${p.pos} ${p.name}` })
    }
  }
  let next: RunState = { ...run, market: { wave: 0, entries: {}, spent: {}, offerSheets: sheets } }
  for (const n of news) next = { ...next, news: [...next.news, { ...n, id: next.nextId }], nextId: next.nextId + 1 }
  return next
}

/**
 * Rival spending room. Teams over the cap still sign players in reality — they
 * cut and restructure to make room — so every club gets modelled flexibility on
 * top of its projected space.
 */
export const AI_FLEXIBILITY = 40_000_000
/** Typical first-year charge of a new deal relative to its AAV (backloaded, prorated bonus). */
export const FIRST_YEAR_SHARE = 0.75

export function aiRoom(run: RunState, t: RawTeam): number {
  return Math.max(0, t.capSpace) + AI_FLEXIBILITY - (run.market?.spent[t.id] ?? 0)
}

/** A rival team with a need at his position and room for his first-year charge. */
function pickTeam(run: RunState, snap: Snapshot, p: RawMarketPlayer, r: number, cost: number): RawTeam | undefined {
  const teams = snap.teams.filter((t) => t.id !== run.team && aiRoom(run, t) > cost)
  const weights = teams.map((t) => (t.needs[p.pos] ?? 0.5) + 0.2)
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  for (let i = 0; i < teams.length; i++) {
    acc += weights[i] / total
    if (r < acc) return teams[i]
  }
  return teams.at(-1)
}

// ─── Negotiating ────────────────────────────────────────────────────────────

export interface MarketTable {
  pers: Personality
  ask: Terms
  minimum: number
}

export function marketTable(run: RunState, snap: Snapshot, p: RawMarketPlayer): MarketTable {
  const pers = personality(run.seed, p)
  const minimum = minimumSalary(snap, p.creditedSeasons, snap.season)
  const base = askingTerms(p, pers, minimum)
  const factor = WAVES[run.market?.wave ?? 0].askFactor
  return { pers, minimum, ask: { ...base, aav: Math.max(minimum, Math.round((base.aav * factor) / 50_000) * 50_000) } }
}

export function previewMarketOffer(run: RunState, snap: Snapshot, p: RawMarketPlayer, terms: Terms) {
  const t = marketTable(run, snap, p)
  const built = buildContract(terms, run.season, (y) => minimumSalary(snap, p.creditedSeasons, y))
  const y0 = built.years[0]
  return { ...t, built, capHit: y0.base + y0.bonus + y0.other, evaluation: evaluateOffer(t.ask, t.pers, terms) }
}

export type MarketOfferResult =
  | { ok: false; reason: string }
  | { ok: true; run: RunState; response: Response; evaluation: Evaluation; move?: Move }

function setEntry(run: RunState, id: string, entry: MarketEntry): RunState {
  const m = run.market!
  return { ...run, market: { ...m, entries: { ...m.entries, [id]: entry } } }
}

export function offerFreeAgent(run: RunState, snap: Snapshot, id: string, terms: Terms): MarketOfferResult {
  if (!run.market) return { ok: false, reason: 'Free agency is not open.' }
  const p = marketPool(run, snap).find((x) => x.id === id)
  if (!p) return { ok: false, reason: 'Not a free agent.' }
  const entry = entryFor(run, p)
  if (entry.status === 'uninterested') return { ok: false, reason: `${p.name} isn't interested in the ${run.teamName}.` }
  if (entry.status === 'retained') return { ok: false, reason: `${p.name} re-signed with ${entry.team} before the market opened.` }
  if (entry.status !== 'available') return { ok: false, reason: `${p.name} is no longer available.` }
  const pv = previewMarketOffer(run, snap, p, terms)
  if (terms.aav < pv.minimum) return { ok: false, reason: `Below his minimum of ${money(pv.minimum)}.` }
  if (pv.capHit > capRoom(run, snap)) return { ok: false, reason: 'Not enough cap space for the first-year charge.' }

  const response = respond(pv.evaluation, entry.patience)
  if (response.kind === 'accept') {
    const contract = signedContract(snap, p, pv.built, terms.aav)
    const next = setEntry({ ...run, roster: [...run.roster, contract] }, id, { ...entry, status: 'signed', offers: entry.offers + 1 })
    const { run: out, move } = withMove(
      next,
      'sign',
      id,
      `Signed ${p.pos} ${p.name}`,
      `${terms.years} yr${terms.years > 1 ? 's' : ''} · ${money(terms.aav * terms.years)} · ${Math.round(terms.guaranteePct * 100)}% guaranteed`,
      -pv.capHit,
      { tone: 'team', text: `${run.teamName} sign ${p.pos} ${p.name}: ${terms.years} years, ${money(terms.aav * terms.years)}` },
    )
    return { ok: true, run: out, response, evaluation: pv.evaluation, move }
  }
  if (response.kind === 'walk') {
    const next = setEntry(run, id, { ...entry, status: 'walked', patience: 0, offers: entry.offers + 1, lastBand: pv.evaluation.band })
    const { run: out, move } = withMove(next, 'talks-ended', id, `${p.name} ended talks`, 'He will sign elsewhere', 0)
    return { ok: true, run: out, response, evaluation: pv.evaluation, move }
  }
  const next = setEntry(run, id, { ...entry, patience: response.patienceLeft, offers: entry.offers + 1, lastBand: pv.evaluation.band })
  return { ok: true, run: next, response, evaluation: pv.evaluation }
}

// ─── The clock ──────────────────────────────────────────────────────────────

/** Chance the league signs a player this wave: the best go first. */
function signChance(p: RawMarketPlayer, wave: number): number {
  const quality = Math.max(0.05, Math.min(0.95, demand(p)))
  return quality * WAVES[wave].aiPace
}

/**
 * Advance to the next wave. Rival teams sign players they need and can afford;
 * notable signings hit the wire.
 */
export function advanceWave(run: RunState, snap: Snapshot): RunState {
  const m = run.market
  if (!m || m.wave >= WAVES.length - 1) return run
  let next = run
  const spent = { ...m.spent }
  const entries = { ...m.entries }
  let quiet = 0
  const headlines: string[] = []
  // Best players first: stars come off the board before teams spend on depth.
  for (const p of [...marketPool(run, snap)].sort((a, b) => b.marketAAV - a.marketAAV)) {
    const e = entryFor(next, p)
    if (e.status === 'signed' || e.status === 'signed-elsewhere' || e.status === 'retained') continue
    if (roll(run.seed, `ai-sign:${p.id}:${m.wave}`) >= signChance(p, m.wave)) continue
    const aav = Math.round((p.marketAAV * rollRange(run.seed, `ai-aav:${p.id}`, 0.92, 1.12)) / 50_000) * 50_000
    const firstYear = aav * FIRST_YEAR_SHARE
    const team = pickTeam({ ...next, market: { ...m, spent } }, snap, p, roll(run.seed, `ai-team:${p.id}:${m.wave}`), firstYear)
    if (!team) continue
    spent[team.id] = (spent[team.id] ?? 0) + firstYear
    entries[p.id] = { ...e, status: 'signed-elsewhere', team: team.id, aav, years: p.preferredYears }
    if (aav >= NOTABLE_PRICE) headlines.push(`${team.name} sign ${p.pos} ${p.name}: ${p.preferredYears} yrs, ${money(aav * p.preferredYears)}`)
    else quiet++
  }
  const wave = m.wave + 1
  next = { ...next, market: { ...m, wave, spent, entries } }
  const items: Omit<NewsItem, 'id'>[] = [
    { tone: 'league', text: `Free agency · ${WAVES[wave].name}: ${headlines.length + quiet} signings around the league` },
    ...headlines.slice(0, 10).map((text) => ({ tone: 'league' as const, text })),
  ]
  for (const n of items) next = { ...next, news: [...next.news, { ...n, id: next.nextId }], nextId: next.nextId + 1 }
  return next
}

// ─── Offer sheets ───────────────────────────────────────────────────────────

export function pendingSheets(run: RunState): OfferSheet[] {
  return run.market?.offerSheets.filter((s) => !s.resolved) ?? []
}

function resolveSheet(run: RunState, id: string, resolved: OfferSheet['resolved']): RunState {
  const m = run.market!
  return { ...run, market: { ...m, offerSheets: m.offerSheets.map((s) => (s.id === id ? { ...s, resolved } : s)) } }
}

/** Match: he stays, on the rival's terms. */
export function matchSheet(run: RunState, snap: Snapshot, sheetId: string): MoveResult {
  const s = pendingSheets(run).find((x) => x.id === sheetId)
  const current = s && run.roster.find((c) => c.id === s.playerId)
  if (!s || !current) return { ok: false, reason: 'Nothing to match.' }
  const p = run.expiring.find((e) => e.id === s.playerId)!
  const built = buildContract(s.terms, run.season, (y) => minimumSalary(snap, p.creditedSeasons, y))
  const newHit = built.years[0].base + built.years[0].bonus
  const oldHit = current.years[0].base + current.years[0].bonus + current.years[0].other
  if (newHit - oldHit > capRoom(run, snap)) return { ok: false, reason: 'Not enough cap space to match.' }
  const contract = signedContract(snap, p, built, s.terms.aav)
  const next = resolveSheet({ ...run, roster: run.roster.map((c) => (c.id === p.id ? contract : c)) }, sheetId, 'matched')
  const { run: out, move } = withMove(
    next,
    'match',
    p.id,
    `Matched the offer sheet for ${p.name}`,
    `${s.terms.years} yrs · ${money(s.terms.aav * s.terms.years)}`,
    oldHit - newHit,
    { tone: 'team', text: `${run.teamName} match the offer sheet and keep ${p.pos} ${p.name}` },
  )
  return { ok: true, run: out, move }
}

/** Decline: he leaves; if the tender carried compensation, the signing team's pick comes back. */
export function declineSheet(run: RunState, sheetId: string): MoveResult {
  const s = pendingSheets(run).find((x) => x.id === sheetId)
  if (!s) return { ok: false, reason: 'Nothing to decline.' }
  const current = run.roster.find((c) => c.id === s.playerId)
  const comp = s.compRound
    ? run.picks.find((pk) => pk.owner === s.team && pk.year === run.season && pk.round === s.compRound && !pk.compensatory)
    : undefined
  const picks = comp ? run.picks.map((pk) => (pk.id === comp.id ? { ...pk, owner: run.team } : pk)) : run.picks
  const hit = current ? current.years[0].base + current.years[0].bonus + current.years[0].other : 0
  const next = resolveSheet({ ...run, roster: run.roster.filter((c) => c.id !== s.playerId), picks }, sheetId, 'declined')
  const { run: out, move } = withMove(
    next,
    'decline-sheet',
    s.playerId,
    `${s.name} leaves for ${s.team}`,
    comp ? `We receive ${pickName(comp)}` : 'No compensation',
    hit,
    { tone: 'team', text: `${run.teamName} decline to match ${s.name}${comp ? `, receive ${s.team}'s round ${comp.round} pick` : ''}` },
  )
  return { ok: true, run: out, move }
}
