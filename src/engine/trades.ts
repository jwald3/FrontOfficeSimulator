import { seasonCapHit } from './cap'
import { futurePickValue, isUntouchable, noFirsts, tradeValue } from './valuation'
import { money, pickName } from './format'
import { withMove, type MoveResult } from './moves'
import { aiRoom } from './market'
import { capRoom } from './resign'
import { roll, rollRange } from './rng'
import type { Contract, Move, RawContractPlayer, RawPick, RunState, Snapshot } from './types'

// ─── Pick value ─────────────────────────────────────────────────────────────

/**
 * Current-year picks use their slot's value. Future picks drop part of a round per
 * season ahead, as teams trade them (see valuation.ts).
 */
export function pickValue(snap: Snapshot, pick: RawPick, season: number): number {
  return pick.year === season ? pick.value : futurePickValue(snap, pick, season)
}

/** "2027 R3 Pick 74 (DAL)": the year, the pick, and whose it was if traded. */
export function pickLabel(pick: RawPick): string {
  const from = pick.originalTeam !== pick.owner ? ` (${pick.originalTeam})` : ''
  return `${pick.year} ${pickName(pick)}${from}`
}

export function ownedPicks(run: RunState, team: string): RawPick[] {
  return run.picks.filter((p) => p.owner === team)
}

/** Greedy package of a team's picks worth close to the target; first-rounders left out when the player isn't worth one. */
function buildPackage(snap: Snapshot, run: RunState, team: string, target: number, noFirst = false): RawPick[] {
  const pool = ownedPicks(run, team)
    .filter((p) => !noFirst || p.round !== 1)
    .map((p) => ({ p, v: pickValue(snap, p, run.season) }))
    .sort((a, b) => b.v - a.v)
  const out: RawPick[] = []
  let left = target
  for (const { p, v } of pool) {
    if (v <= left * 1.1) {
      out.push(p)
      left -= v
    }
    if (left < target * 0.08) break
  }
  return target - left >= target * 0.6 ? out : []
}

export function packageValue(snap: Snapshot, run: RunState, picks: RawPick[]): number {
  return picks.reduce((a, p) => a + pickValue(snap, p, run.season), 0)
}

// ─── Offers for our players ─────────────────────────────────────────────────

export interface TradeOffer {
  id: string
  playerId: string
  team: string
  pickIds: string[]
  value: number
  /** Wave the offer arrived in; offers expire when the clock moves. */
  wave: number
  /** 'block' answers our trade block; 'call' is a team asking about a player we didn't shop. */
  kind?: 'block' | 'call'
  /** The team's pitch, shown on the offer. */
  line?: string
  /** Set once we've pushed back: they sweetened it, or this is their final offer. */
  negotiated?: 'sweetened' | 'firm'
}

export interface OfferLogEntry {
  id: string
  playerId: string
  name: string
  team: string
  outcome: 'accepted' | 'declined' | 'pulled' | 'expired'
  /** What was on the table, e.g. "2027 R3 Pick 74, 2028 R5". */
  picks: string
}

/** Everything teams are offering this wave: answers to our trade block, plus unsolicited calls. */
export function generateOffers(run: RunState, snap: Snapshot, wave: number): TradeOffer[] {
  const block = generateBlockOffers(run, snap, wave)
  return [...block, ...generateCalls(run, snap, wave, new Set(block.map((o) => o.playerId)))]
}

/** What a player fetches in pick-chart points; a rookie we drafted is worth his slot. */
export function playerValue(c: Contract, snap: Snapshot): number {
  return c.rookieValue ?? tradeValue(c, snap)
}

/**
 * Rival interest in everyone on our trade block. Generated when the market
 * opens and again at each wave; earlier offers expire.
 */
export function generateBlockOffers(run: RunState, snap: Snapshot, wave: number): TradeOffer[] {
  const offers: TradeOffer[] = []
  for (const c of run.roster.filter((x) => x.onTradeBlock && !isUntouchable(snap, x.id))) {
    const hit = seasonCapHit(c, run.season)
    const suitors = snap.teams
      .filter((t) => t.id !== run.team && aiRoom(run, t) > hit)
      .map((t) => ({ t, r: roll(run.seed, `suitor:${c.id}:${t.id}:${wave}`) * ((t.needs[c.pos] ?? 0.5) + 0.3) }))
      .sort((a, b) => b.r - a.r)
    const value = playerValue(c, snap)
    // More valuable players draw more suitors.
    const count = value >= 600 ? 3 : value >= 250 ? 2 : 1
    for (const { t } of suitors.slice(0, count)) {
      const [lo, hi] = snap.valuation?.model.blockRange ?? [0.8, 1.05]
      const target = value * rollRange(run.seed, `offer:${c.id}:${t.id}:${wave}`, lo, hi)
      const picks = buildPackage(snap, run, t.id, target, noFirsts(snap, c.id))
      if (!picks.length) continue
      offers.push({ id: `offer-${c.id}-${t.id}-${wave}`, playerId: c.id, team: t.id, pickIds: picks.map((p) => p.id), value: packageValue(snap, run, picks), wave, kind: 'block' })
    }
  }
  return offers
}

// ─── Unsolicited calls ──────────────────────────────────────────────────────

/** Calls a wave brings in about players we didn't shop. */
const CALLS_PER_WAVE = 2
/** Below this trade value (pick-chart points) nobody picks up the phone. */
const MIN_CALL_VALUE = 80
/** Only teams that need the position call: need runs 0–1, 0.5 being neutral. */
const MIN_CALL_NEED = 0.6

const CALL_LINES = [
  'We think he fits what we are building. Take a look.',
  'We have a hole at {pos} and he fills it.',
  "Our coaches have liked him for a while. Here's what we can do.",
  "You've been busy. We figured you might listen on {name}.",
  'He would start for us on day one. Make it work?',
]

/**
 * Teams calling about players we didn't put on the block: a few per wave, from
 * clubs that need the position and can fit his cap hit. They open below his value
 * (they're asking, not being asked), and nobody calls about a player we just
 * signed or traded for.
 */
export function generateCalls(run: RunState, snap: Snapshot, wave: number, skip = new Set<string>()): TradeOffer[] {
  const recent = new Set([...(run.acquired ?? []), ...run.moves.filter((m) => m.kind === 'sign' || m.kind === 'match').map((m) => m.playerId)])
  const calls = run.roster
    .filter((c) => !c.onTradeBlock && !skip.has(c.id) && !recent.has(c.id) && !isUntouchable(snap, c.id) && playerValue(c, snap) >= MIN_CALL_VALUE)
    .flatMap((c) => {
      const hit = seasonCapHit(c, run.season)
      const suitor = snap.teams
        .filter((t) => t.id !== run.team && (t.needs[c.pos] ?? 0.5) >= MIN_CALL_NEED && aiRoom(run, t) > hit)
        .map((t) => ({ t, r: roll(run.seed, `caller:${c.id}:${t.id}:${wave}`) * (t.needs[c.pos] ?? 0.5) }))
        .sort((a, b) => b.r - a.r)[0]
      if (!suitor) return []
      // Interest: chance, the team's need, and how good he is.
      const interest = roll(run.seed, `call:${c.id}:${wave}`) * suitor.r * Math.sqrt(playerValue(c, snap))
      return [{ c, t: suitor.t, interest }]
    })
    .sort((a, b) => b.interest - a.interest)

  const out: TradeOffer[] = []
  for (const { c, t } of calls) {
    if (out.length >= CALLS_PER_WAVE) break
    const [lo, hi] = snap.valuation?.model.callRange ?? [0.8, 1]
    const target = playerValue(c, snap) * rollRange(run.seed, `call-offer:${c.id}:${t.id}:${wave}`, lo, hi)
    const picks = buildPackage(snap, run, t.id, target, noFirsts(snap, c.id))
    if (!picks.length) continue
    const line = CALL_LINES[Math.floor(roll(run.seed, `call-line:${c.id}:${wave}`) * CALL_LINES.length)]
    out.push({
      id: `call-${c.id}-${t.id}-${wave}`,
      playerId: c.id,
      team: t.id,
      pickIds: picks.map((p) => p.id),
      value: packageValue(snap, run, picks),
      wave,
      kind: 'call',
      line: line.replace('{pos}', c.pos).replace('{name}', c.name),
    })
  }
  return out
}

// ─── Answering offers ───────────────────────────────────────────────────────

function logOffer(run: RunState, o: TradeOffer, outcome: OfferLogEntry['outcome']): RunState {
  const name = run.roster.find((c) => c.id === o.playerId)?.name ?? run.offerLog?.find((e) => e.playerId === o.playerId)?.name ?? o.playerId
  const picks = run.picks.filter((p) => o.pickIds.includes(p.id)).map(pickLabel).join(', ')
  return { ...run, offerLog: [...(run.offerLog ?? []), { id: o.id, playerId: o.playerId, name, team: o.team, outcome, picks }] }
}

/** Offers still open when the clock moves (or free agency closes) expire into the log. */
export function expireOffers(run: RunState): RunState {
  return run.tradeOffers.reduce<RunState>((r, o) => logOffer(r, o, 'expired'), { ...run, tradeOffers: [] })
}

export function declineOffer(run: RunState, offerId: string): MoveResult {
  const o = run.tradeOffers.find((x) => x.id === offerId)
  if (!o) return { ok: false, reason: 'That offer is no longer on the table.' }
  const next = logOffer({ ...run, tradeOffers: run.tradeOffers.filter((x) => x.id !== offerId) }, o, 'declined')
  return { ok: true, run: next, move: { id: 0, kind: 'trade', playerId: o.playerId, headline: '', detail: '', capDelta: 0 } }
}

export type NegotiateResult =
  | { ok: false; reason: string }
  | { ok: true; run: RunState; outcome: 'sweetened' | 'firm' | 'pulled'; reply: string }

/**
 * Push back on an offer, once. The answer is rolled per offer, so it can't be
 * re-asked: about half the time they add a pick (up to 110% of his value), a third
 * of the time it's their final offer, and otherwise they pull it.
 */
export function negotiateOffer(run: RunState, snap: Snapshot, offerId: string): NegotiateResult {
  const o = run.tradeOffers.find((x) => x.id === offerId)
  const c = o && run.roster.find((x) => x.id === o.playerId)
  if (!o || !c) return { ok: false, reason: 'That offer is no longer on the table.' }
  if (o.negotiated) return { ok: false, reason: 'They have already given you their best.' }
  const team = snap.teams.find((t) => t.id === o.team)
  const r = roll(run.seed, `negotiate:${o.id}`)
  const replace = (next: TradeOffer) => ({ ...run, tradeOffers: run.tradeOffers.map((x) => (x.id === o.id ? next : x)) })

  if (r < 0.5) {
    const cap = playerValue(c, snap) * 1.1 - o.value
    const extra = ownedPicks(run, o.team)
      .filter((p) => !o.pickIds.includes(p.id) && (p.round !== 1 || !noFirsts(snap, c.id)))
      .map((p) => ({ p, v: pickValue(snap, p, run.season) }))
      .filter((x) => x.v <= cap)
      .sort((a, b) => b.v - a.v)[0]
    if (extra) {
      const next = { ...o, pickIds: [...o.pickIds, extra.p.id], value: o.value + extra.v, negotiated: 'sweetened' as const }
      return { ok: true, run: replace(next), outcome: 'sweetened', reply: `${team?.name ?? o.team} add ${pickLabel(extra.p)}. That's as far as they go.` }
    }
  }
  if (r < 0.85) {
    return { ok: true, run: replace({ ...o, negotiated: 'firm' }), outcome: 'firm', reply: `${team?.name ?? o.team} won't move. This is their final offer.` }
  }
  const next = logOffer({ ...run, tradeOffers: run.tradeOffers.filter((x) => x.id !== o.id) }, o, 'pulled')
  return { ok: true, run: next, outcome: 'pulled', reply: `${team?.name ?? o.team} pulled the offer. They've moved on.` }
}

/** Why a first-round pick can't be part of a deal for this player. */
export const NO_FIRST_REPLY = (name: string) => `No first-rounders in a deal for ${name}: he isn't worth one.`

// ─── Countering ─────────────────────────────────────────────────────────────

/** "Saints" from "New Orleans Saints", for replies; the id if the team is unknown. */
export function teamNickname(snap: Pick<Snapshot, 'teams'>, id: string): string {
  return snap.teams.find((t) => t.id === id)?.fullName.split(' ').pop() ?? id
}

/** Counter-offers a team hears on one deal before it stops listening. */
export const MAX_COUNTERS = 2

export type CounterVerdict = 'accept' | 'close' | 'insult'

/**
 * How a team answers a counter asking for `ask` points when it would go as high as
 * `ceiling`: yes at or under it, no (but still talking) up to 20% over, and a
 * hang-up beyond that.
 */
export function counterVerdict(ask: number, ceiling: number): CounterVerdict {
  return ask <= ceiling ? 'accept' : ask <= ceiling * 1.2 ? 'close' : 'insult'
}

export type CounterResult =
  | { ok: false; reason: string }
  | { ok: true; run: RunState; verdict: CounterVerdict; reply: string; move?: Move }

/**
 * Counter an offer for one of our players by naming the picks we want from that
 * team. Each team has a ceiling for him, fixed per offer (95–115% of his value). At
 * or under it they agree and the trade goes through on our terms; a little over
 * and they say no (two counters per offer); far over and they pull the offer.
 */
export function counterOffer(run: RunState, snap: Snapshot, offerId: string, pickIds: string[]): CounterResult {
  const o = run.tradeOffers.find((x) => x.id === offerId)
  const c = o && run.roster.find((x) => x.id === o.playerId)
  if (!o || !c) return { ok: false, reason: 'That offer is no longer on the table.' }
  if (isUntouchable(snap, c.id)) return { ok: false, reason: `${c.name} is untouchable. He isn't going anywhere.` }
  const used = run.counters?.[o.id] ?? 0
  if (used >= MAX_COUNTERS) return { ok: false, reason: "They've heard enough counters. Take the offer or leave it." }
  const picks = run.picks.filter((p) => pickIds.includes(p.id) && p.owner === o.team)
  if (!picks.length || picks.length !== pickIds.length) return { ok: false, reason: `Ask only for picks the ${o.team} own.` }
  if (noFirsts(snap, c.id) && picks.some((p) => p.round === 1)) return { ok: false, reason: NO_FIRST_REPLY(c.name) }

  const team = `The ${teamNickname(snap, o.team)}`
  const ask = packageValue(snap, run, picks)
  // Never below what they already offered: a team always takes its own offer back.
  const ceiling = Math.max(o.value, playerValue(c, snap) * rollRange(run.seed, `ceiling:${o.id}`, 0.95, 1.15))
  const verdict = counterVerdict(ask, ceiling)
  const counted: RunState = { ...run, counters: { ...run.counters, [o.id]: used + 1 } }

  if (verdict === 'accept') {
    const agreed: RunState = { ...counted, tradeOffers: counted.tradeOffers.map((x) => (x.id === o.id ? { ...x, pickIds: picks.map((p) => p.id), value: ask } : x)) }
    const done = acceptTradeOffer(agreed, snap, o.id)
    if (!done.ok) return done
    return { ok: true, run: done.run, verdict, reply: `${team} agree. Deal done.`, move: done.move }
  }
  if (verdict === 'close') {
    const left = MAX_COUNTERS - used - 1
    return { ok: true, run: counted, verdict, reply: left ? `${team} won't go that high, but they're still listening.` : `${team} won't go that high, and they're done countering. Their offer stands.` }
  }
  const pulled = logOffer({ ...counted, tradeOffers: counted.tradeOffers.filter((x) => x.id !== o.id) }, o, 'pulled')
  return { ok: true, run: pulled, verdict, reply: `${team} hung up. That ask wasn't close.` }
}

export function acceptTradeOffer(run: RunState, snap: Snapshot, offerId: string): MoveResult {
  const o = run.tradeOffers.find((x) => x.id === offerId)
  const c = o && run.roster.find((x) => x.id === o.playerId)
  if (!o || !c) return { ok: false, reason: 'That offer is no longer on the table.' }
  if (isUntouchable(snap, c.id)) return { ok: false, reason: `${c.name} is untouchable. He isn't going anywhere.` }
  const team = snap.teams.find((t) => t.id === o.team)!
  const received = run.picks.filter((p) => o.pickIds.includes(p.id) && p.owner === o.team)
  if (received.length !== o.pickIds.length) return { ok: false, reason: `${team.name} no longer own those picks.` }
  const saved = seasonCapHit(c, run.season) - c.tradeDead
  const next: RunState = {
    ...logOffer(run, o, 'accepted'),
    roster: run.roster.filter((x) => x.id !== c.id),
    dead: c.tradeDead > 0 ? [...run.dead, { playerId: c.id, name: c.name, amount: c.tradeDead, reason: 'trade' }] : run.dead,
    picks: run.picks.map((p) => (o.pickIds.includes(p.id) ? { ...p, owner: run.team } : p)),
    tradeOffers: run.tradeOffers.filter((x) => x.playerId !== c.id),
    tradedAway: [...(run.tradedAway ?? []), { id: c.id, team: o.team, pos: c.pos }],
  }
  const { run: out, move } = withMove(
    next,
    'trade',
    c.id,
    `Traded ${c.pos} ${c.name} to ${team.name}`,
    `For ${received.map(pickLabel).join(', ')}`,
    saved,
    { tone: 'team', text: `TRADE: ${run.teamName} send ${c.pos} ${c.name} to the ${team.fullName} for ${received.map(pickLabel).join(', ')}` },
  )
  return { ok: true, run: out, move }
}

// ─── Trading for other teams' players ───────────────────────────────────────

export interface TradeTarget extends RawContractPlayer {
  team: string
}

export function tradeTargets(run: RunState, snap: Snapshot): TradeTarget[] {
  const acquired = new Set(run.roster.map((p) => p.id))
  return Object.entries(snap.otherRosters).flatMap(([team, players]) =>
    players.filter((p) => !acquired.has(p.id) && !(run.acquired ?? []).includes(p.id)).map((p) => ({ ...p, team })),
  )
}

/** What a team wants for one of its players: his value plus a per-run reluctance. */
export function askingValue(run: RunState, snap: Snapshot, t: TradeTarget): number {
  return Math.round(tradeValue(t, snap) * rollRange(run.seed, `reluctance:${t.id}`, 1, 1.3))
}

export type TradeBand = 'insulting' | 'short' | 'close' | 'deal'

export function evaluatePackage(ask: number, offered: number): TradeBand {
  const r = offered / ask
  if (r >= 1) return 'deal'
  if (r >= 0.92) return 'close'
  if (r >= 0.75) return 'short'
  return 'insulting'
}

/** A rejected package still counts against the three calls a team will take. */
export type ProposeResult =
  | { ok: true; run: RunState; move: Move }
  | { ok: false; reason: string; band?: TradeBand; run?: RunState }

export function proposeTrade(run: RunState, snap: Snapshot, targetId: string, pickIds: string[]): ProposeResult {
  const t = tradeTargets(run, snap).find((x) => x.id === targetId)
  if (!t) return { ok: false, reason: 'He is not available.' }
  if (isUntouchable(snap, t.id)) return { ok: false, reason: `The ${teamNickname(snap, t.team)} won't trade ${t.name}. He's untouchable.` }
  if (noFirsts(snap, t.id) && run.picks.some((p) => pickIds.includes(p.id) && p.round === 1)) return { ok: false, reason: NO_FIRST_REPLY(t.name) }
  const picks = run.picks.filter((p) => pickIds.includes(p.id) && p.owner === run.team)
  if (!picks.length) return { ok: false, reason: 'Add at least one pick to the offer.' }
  const tries = run.tradeTalks?.[t.id] ?? 0
  if (tries >= 3) return { ok: false, reason: `The ${t.team} have stopped taking calls about ${t.name}.` }
  const band = evaluatePackage(askingValue(run, snap, t), packageValue(snap, run, picks))
  if (band !== 'deal') {
    const next = { ...run, tradeTalks: { ...(run.tradeTalks ?? {}), [t.id]: tries + (band === 'insulting' ? 2 : 1) } }
    return { ok: false, reason: TRADE_REPLY[band], band, run: next }
  }
  const hit = seasonCapHit(t, run.season)
  if (hit > capRoom(run, snap)) return { ok: false, reason: `Not enough cap space to take on his ${money(hit)} cap hit.` }
  const contract: Contract = {
    ...t,
    team: run.team,
    years: t.years.map((y) => ({ ...y })),
    onTradeBlock: false,
    restructured: false,
  }
  const next: RunState = {
    ...run,
    roster: [...run.roster, contract],
    picks: run.picks.map((p) => (pickIds.includes(p.id) ? { ...p, owner: t.team } : p)),
    acquired: [...(run.acquired ?? []), t.id],
  }
  const { run: out, move } = withMove(
    next,
    'trade',
    t.id,
    `Acquired ${t.pos} ${t.name} from ${t.team}`,
    `For ${picks.map(pickLabel).join(', ')}`,
    -hit,
    { tone: 'team', text: `TRADE: ${run.teamName} acquire ${t.pos} ${t.name} from ${t.team} for ${picks.map(pickLabel).join(', ')}` },
  )
  return { ok: true, run: out, move }
}

export const TRADE_REPLY: Record<Exclude<TradeBand, 'deal'>, string> = {
  insulting: "They hung up. That's not in the ballpark.",
  short: "They're listening, but it'll take more than that.",
  close: 'Close. One more piece probably gets it done.',
}
