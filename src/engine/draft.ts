import { minimumSalary } from './contracts'
import { money, pickName } from './format'
import { withMove, type MoveResult } from './moves'
import { capRoom } from './resign'
import { roll, rollRange } from './rng'
import { counterVerdict, evaluatePackage, MAX_COUNTERS, pickLabel, pickValue, teamNickname, TRADE_REPLY, type CounterVerdict, type TradeBand } from './trades'
import { DEFAULT_DRAFT_ADVICE } from './editorialSchema'
import type { Contract, ContractYear, Move, NewsItem, Position, RawPick, RawProspect, RunState, Snapshot } from './types'

export interface DraftState {
  /** Index into the draft order of the pick currently on the clock. */
  cursor: number
  /** pickId → prospectId */
  selections: Record<string, string>
  /** Undrafted free agents we've signed, with their bonuses. */
  udfa: Record<string, number>
}

export const UDFA_MAX_BONUS = 50_000

// ─── The class and the order ────────────────────────────────────────────────

/** Underclassmen who might return to school decide once per run, unless the editor decided for them. */
export function declared(seed: number, p: RawProspect): boolean {
  if (!p.declaration?.canReturn) return true
  if (p.declareCall) return p.declareCall === 'declares'
  return roll(seed, `declare:${p.id}`) < p.declaration.chance
}

export function draftClass(run: RunState, snap: Snapshot): RawProspect[] {
  return snap.prospects.filter((p) => declared(run.seed, p))
}

/** This season's first-round order by original team, as the source snapshot has it. */
export function sourceTeamOrder(picks: RawPick[], season: number): string[] {
  return picks
    .filter((p) => p.year === season && p.round === 1 && !p.compensatory && (p.sourceOverall ?? p.overall) != null)
    .sort((a, b) => (a.sourceOverall ?? a.overall)! - (b.sourceOverall ?? b.overall)!)
    .map((p) => p.originalTeam)
}

/**
 * Re-slot this season's picks to an editorial team order, in place. Every round
 * follows the same order (the source's tie rotations between rounds are dropped),
 * compensatory picks stay at the end of their round, and each pick takes the trade
 * value of its new slot. Teams the order leaves out keep their source spot; with no
 * order, or the source one, the source slots are restored. Records the source slot
 * and value on first sight.
 */
export function applyDraftOrder(picks: RawPick[], season: number, teams?: string[]): void {
  const current = picks.filter((p) => p.year === season && (p.sourceOverall ?? p.overall) != null)
  for (const p of current) {
    if (p.sourceOverall === undefined) {
      p.sourceOverall = p.overall
      p.sourceValue = p.value
    }
  }
  const source = sourceTeamOrder(picks, season)
  const order = teams?.filter((t) => source.includes(t)) ?? []
  for (const [i, t] of source.entries()) if (!order.includes(t)) order.splice(Math.min(i, order.length), 0, t)

  if (!teams?.length || order.join() === source.join()) {
    for (const p of current) {
      p.overall = p.sourceOverall!
      p.value = p.sourceValue!
    }
    return
  }
  const valueAt = new Map(current.map((p) => [p.sourceOverall!, p.sourceValue!]))
  const rank = new Map(order.map((t, i) => [t, i]))
  let overall = 0
  for (const round of [...new Set(current.map((p) => p.round))].sort((a, b) => a - b)) {
    const inRound = current.filter((p) => p.round === round)
    const regular = inRound.filter((p) => !p.compensatory).sort((a, b) => rank.get(a.originalTeam)! - rank.get(b.originalTeam)!)
    const comp = inRound.filter((p) => p.compensatory).sort((a, b) => a.sourceOverall! - b.sourceOverall!)
    for (const p of [...regular, ...comp]) {
      p.overall = ++overall
      p.value = valueAt.get(overall) ?? p.sourceValue!
    }
  }
}

export function draftOrder(run: RunState): RawPick[] {
  return run.picks.filter((p) => p.year === run.season && p.overall != null).sort((a, b) => a.overall! - b.overall!)
}

export function available(run: RunState, snap: Snapshot): RawProspect[] {
  const taken = new Set(Object.values(run.draft?.selections ?? {}))
  return draftClass(run, snap).filter((p) => !taken.has(p.id) && !(run.draft?.udfa[p.id] != null))
}

export function onTheClock(run: RunState): RawPick | undefined {
  return run.draft ? draftOrder(run)[run.draft.cursor] : undefined
}

export function draftDone(run: RunState): boolean {
  return !!run.draft && run.draft.cursor >= draftOrder(run).length
}

/** The consensus big-board rank on a log scale: #1 = 100, #10 ≈ 82, #100 ≈ 63. */
export function boardScore(p: RawProspect): number {
  return 100 - 8 * Math.log(p.rank)
}

// ─── AI selections ──────────────────────────────────────────────────────────

const SPECIALIST = new Set<Position>(['K', 'P', 'LS', 'FB'])

/**
 * How much a team wants a prospect: talent, positional need (which shrinks as
 * the team drafts the position), a nudge from the consensus mock, and a per-run
 * taste so drafts differ between runs.
 */
function appeal(run: RunState, snap: Snapshot, team: string, pick: RawPick, p: RawProspect, drafted: Position[]): number {
  const t = snap.teams.find((x) => x.id === team)
  const already = drafted.filter((x) => x === p.pos).length
  const need = Math.max(0, (t?.needs[p.pos] ?? 0.5) - already * 0.8)
  const mock = snap.draftBoard.mockProjections.find((m) => m.team === team && m.name === p.name)
  // A team looking for a quarterback stops looking once it has drafted one.
  const qb = p.pos === 'QB' && pick.round <= 2 && !drafted.includes('QB') ? (t?.qbOutlook?.replacementChance ?? 0) * 4 : 0
  const specialist = SPECIALIST.has(p.pos) && pick.round < 5 ? -25 : 0
  const taste = rollRange(run.seed, `taste:${team}:${p.id}`, -3.5, 3.5)
  return boardScore(p) + need * 3 + (mock ? (mock.sharePercent / 100) * 3 : 0) + qb + specialist + taste
}

function positionsDrafted(run: RunState, snap: Snapshot, team: string): Position[] {
  const sel = run.draft?.selections ?? {}
  return draftOrder(run)
    .filter((pk) => pk.owner === team && sel[pk.id])
    .map((pk) => snap.prospects.find((p) => p.id === sel[pk.id])!.pos)
}

function aiChoice(run: RunState, snap: Snapshot, pick: RawPick, closed: Set<Position> = new Set()): RawProspect | undefined {
  const pool = available(run, snap)
    .filter((p) => !closed.has(p.pos))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 40)
  const drafted = positionsDrafted(run, snap, pick.owner)
  let best: RawProspect | undefined
  let bestScore = -Infinity
  for (const p of pool) {
    const s = appeal(run, snap, pick.owner, pick, p, drafted)
    if (s > bestScore) {
      bestScore = s
      best = p
    }
  }
  return best
}

export interface DraftCard {
  pick: RawPick
  prospect: RawProspect
}

function select(run: RunState, pick: RawPick, prospect: RawProspect): RunState {
  const d = run.draft!
  return { ...run, draft: { ...d, cursor: d.cursor + 1, selections: { ...d.selections, [pick.id]: prospect.id } } }
}

/** AI teams pick until we're on the clock or the draft ends, or for at most `limit` picks. */
export function simToUser(run: RunState, snap: Snapshot, limit = Infinity): { run: RunState; made: DraftCard[] } {
  let next = run
  const made: DraftCard[] = []
  for (let pick = onTheClock(next); pick && pick.owner !== run.team && made.length < limit; pick = onTheClock(next)) {
    const p = aiChoice(next, snap, pick)
    if (!p) break
    next = select(next, pick, p)
    made.push({ pick, prospect: p })
  }
  const firsts = made.filter((m) => m.pick.round === 1).slice(-6)
  const news: Omit<NewsItem, 'id'>[] = firsts.map((m) => ({
    tone: 'league',
    text: `${pickName(m.pick)}: ${m.pick.owner} select ${m.prospect.pos} ${m.prospect.name}, ${m.prospect.school}`,
  }))
  for (const n of news) next = { ...next, news: [...next.news, { ...n, id: next.nextId }], nextId: next.nextId + 1 }
  return { run: next, made }
}

// ─── Our selections ─────────────────────────────────────────────────────────

/** Slot contract from the projected rookie scale: four years, signing bonus prorated. */
export function rookieContract(snap: Snapshot, run: RunState, pick: RawPick, p: RawProspect): Contract {
  const slot = snap.rookieScale.slots[String(pick.overall)] ?? []
  const years: ContractYear[] = slot.map((s) => ({
    year: s.year,
    base: s.base,
    bonus: s.bonus,
    other: 0,
    // First-rounders' deals are fully guaranteed.
    guaranteedBase: pick.round === 1 ? s.base : 0,
  }))
  const releaseDead = years.reduce((a, y) => a + y.bonus + y.guaranteedBase, 0)
  const raw = {
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: run.team,
    apy: Math.round(years.reduce((a, y) => a + y.base + y.bonus, 0) / Math.max(1, years.length)),
    minimumBase: snap.minimumRookieBase,
    restructureEligible: false,
    depth: false,
    years,
    releaseDead,
    tradeDead: releaseDead,
    reportedCap: years[0] ? years[0].base + years[0].bonus : 0,
    age: 22,
    experience: 0,
    creditedSeasons: 0,
  }
  return { ...raw, onTradeBlock: false, restructured: false, rookieValue: Math.round(pickValue(snap, pick, run.season) * 0.9) }
}

export function draftPlayer(run: RunState, snap: Snapshot, prospectId: string): MoveResult {
  const pick = onTheClock(run)
  if (!pick || pick.owner !== run.team) return { ok: false, reason: "We're not on the clock." }
  const p = available(run, snap).find((x) => x.id === prospectId)
  if (!p) return { ok: false, reason: 'He is off the board.' }
  const contract = rookieContract(snap, run, pick, p)
  const next = { ...select(run, pick, p), roster: [...run.roster, contract] }
  const { run: out, move } = withMove(
    next,
    'draft',
    p.id,
    `${pickName(pick)}: ${p.pos} ${p.name}`,
    `${p.school} · board rank #${p.rank} · ${money(contract.years[0].base + contract.years[0].bonus)} first-year cap hit`,
    -(contract.years[0].base + contract.years[0].bonus),
    { tone: 'team', text: `With ${pickName(pick)}, the ${run.teamName} select ${p.pos} ${p.name}, ${p.school}` },
  )
  return { ok: true, run: out, move }
}

/** Best available for us, by the same logic the AI uses, skipping positions the editorial advice has closed. */
export function bestForUs(run: RunState, snap: Snapshot): RawProspect | undefined {
  const pick = onTheClock(run)
  return pick && pick.owner === run.team ? aiChoice(run, snap, pick, closedPositions(run, snap)) : undefined
}

/**
 * Positions we've stopped recommending: those an editorial rule closes once we've
 * drafted one in its first N rounds (by default a quarterback in the first three).
 */
export function closedPositions(run: RunState, snap: Snapshot): Set<Position> {
  const rules = snap.editorial?.draftAdvice ?? DEFAULT_DRAFT_ADVICE
  const sel = run.draft?.selections ?? {}
  const ours = draftOrder(run)
    .filter((pk) => pk.owner === run.team && sel[pk.id])
    .map((pk) => ({ round: pk.round, pos: snap.prospects.find((p) => p.id === sel[pk.id])!.pos }))
  return new Set(rules.filter((r) => ours.some((o) => o.pos === r.pos && o.round <= r.rounds)).map((r) => r.pos as Position))
}

/** How much we still need a position: the team's need, less each one we've drafted, or none once advice closes it. */
export function ourNeed(run: RunState, snap: Snapshot, pos: Position): number {
  if (closedPositions(run, snap).has(pos)) return 0
  const already = positionsDrafted(run, snap, run.team).filter((x) => x === pos).length
  return Math.max(0, (snap.teams.find((t) => t.id === run.team)?.needs[pos] ?? 0) - already * 0.8)
}

// ─── Trading down ───────────────────────────────────────────────────────────

export interface TradeDownOffer {
  id: string
  team: string
  /** Their picks coming to us; the first is their pick in this draft. */
  pickIds: string[]
  value: number
}

/**
 * Teams below us call when we're on the clock: their next pick in this draft
 * plus enough extra capital to make it worth our while.
 */
export function tradeDownOffers(run: RunState, snap: Snapshot): TradeDownOffer[] {
  const ours = onTheClock(run)
  if (!ours || ours.owner !== run.team) return []
  const ourValue = pickValue(snap, ours, run.season)
  const order = draftOrder(run)
  const later = order.slice(run.draft!.cursor + 1, run.draft!.cursor + 16).filter((p) => p.owner !== run.team)
  const offers: TradeDownOffer[] = []
  for (const theirs of later) {
    if (offers.length >= 2 || offers.some((o) => o.team === theirs.owner)) continue
    if (run.hungUp?.includes(`down-${ours.id}-${theirs.owner}`)) continue
    if (roll(run.seed, `tradedown:${ours.id}:${theirs.owner}`) > 0.35) continue
    const premium = ourValue * rollRange(run.seed, `tradedown-p:${ours.id}:${theirs.owner}`, 1.02, 1.15)
    let need = premium - pickValue(snap, theirs, run.season)
    const extras = tradeablePicks(run, theirs.owner, theirs)
      .filter((p) => p.id !== theirs.id)
      .map((p) => ({ p, v: pickValue(snap, p, run.season) }))
      .sort((a, b) => b.v - a.v)
    const add: RawPick[] = []
    for (const { p, v } of extras) {
      if (need <= 0) break
      if (v <= need * 1.25) {
        add.push(p)
        need -= v
      }
    }
    if (need > ourValue * 0.05) continue
    const pickIds = [theirs.id, ...add.map((p) => p.id)]
    offers.push({ id: `down-${ours.id}-${theirs.owner}`, team: theirs.owner, pickIds, value: pickValue(snap, theirs, run.season) + add.reduce((a, p) => a + pickValue(snap, p, run.season), 0) })
  }
  return offers
}

/**
 * A team's picks it can still trade during the draft: future picks, and this
 * year's picks from `from` on that haven't been used.
 */
export function tradeablePicks(run: RunState, team: string, from?: RawPick): RawPick[] {
  return run.picks.filter(
    (p) => p.owner === team && !run.draft?.selections[p.id] && (p.year > run.season || (p.overall != null && (!from || p.overall >= from.overall!) && draftOrder(run).indexOf(p) >= (run.draft?.cursor ?? 0))),
  )
}

/** The picks we could ask a team for when countering its trade-down offer: its pick ahead of ours' successor and anything after. */
export function counterablePicks(run: RunState, o: TradeDownOffer): RawPick[] {
  const theirs = run.picks.find((p) => p.id === o.pickIds[0])
  return tradeablePicks(run, o.team, theirs)
}

export type DraftCounterResult =
  | { ok: false; reason: string }
  | { ok: true; run: RunState; verdict: CounterVerdict; reply: string; move?: Move }

/**
 * Counter a trade-down offer by naming the picks we want for ours. The team's
 * ceiling is fixed per offer (110–130% of our pick's value): at or under it they
 * agree and the trade happens; a little over and they say no (two counters); far
 * over and they hang up for this pick.
 */
export function counterTradeDown(run: RunState, snap: Snapshot, offerId: string, pickIds: string[]): DraftCounterResult {
  const ours = onTheClock(run)
  const o = tradeDownOffers(run, snap).find((x) => x.id === offerId)
  if (!ours || !o) return { ok: false, reason: 'That offer is gone.' }
  const used = run.counters?.[o.id] ?? 0
  if (used >= MAX_COUNTERS) return { ok: false, reason: "They've heard enough counters. Take the offer or leave it." }
  const allowed = new Set(counterablePicks(run, o).map((p) => p.id))
  if (!pickIds.length || !pickIds.every((id) => allowed.has(id))) return { ok: false, reason: `Ask only for picks the ${o.team} can still trade.` }

  const picks = run.picks.filter((p) => pickIds.includes(p.id))
  const ask = picks.reduce((a, p) => a + pickValue(snap, p, run.season), 0)
  // Never below what they already offered: a team always takes its own offer back.
  const ceiling = Math.max(o.value, pickValue(snap, ours, run.season) * rollRange(run.seed, `ceiling:${o.id}`, 1.1, 1.3))
  const verdict = counterVerdict(ask, ceiling)
  const counted: RunState = { ...run, counters: { ...run.counters, [o.id]: used + 1 } }
  const team = `The ${teamNickname(snap, o.team)}`

  if (verdict === 'accept') {
    const done = swapForOurPick(counted, ours, o.team, picks)
    return { ok: true, run: done.run, verdict, reply: `${team} agree. Deal done.`, move: done.move }
  }
  if (verdict === 'close') {
    const left = MAX_COUNTERS - used - 1
    return { ok: true, run: counted, verdict, reply: left ? `${team} won't go that high, but they're still listening.` : `${team} won't go that high, and they're done countering. Their offer stands.` }
  }
  return { ok: true, run: { ...counted, hungUp: [...(counted.hungUp ?? []), o.id] }, verdict, reply: `${team} hung up. That ask wasn't close.` }
}

/** Send our pick on the clock to `team` for `received`. */
function swapForOurPick(run: RunState, ours: RawPick, team: string, received: RawPick[]): { run: RunState; move: Move } {
  const ids = new Set(received.map((p) => p.id))
  const next: RunState = { ...run, picks: run.picks.map((p) => (p.id === ours.id ? { ...p, owner: team } : ids.has(p.id) ? { ...p, owner: run.team } : p)) }
  return withMove(
    next,
    'trade',
    ours.id,
    `Traded down with ${team}`,
    `${pickName(ours)} for ${received.map(pickLabel).join(', ')}`,
    0,
    { tone: 'team', text: `TRADE: ${run.teamName} move down, sending ${pickName(ours)} to ${team} for ${received.map(pickLabel).join(', ')}` },
  )
}

// ─── Trading up ─────────────────────────────────────────────────────────────

/** Calls about one pick before its owner stops answering. */
export const TRADE_UP_CALLS = 3

/** Calls left about a pick: each failed call uses one, a lowball two. */
export function tradeUpCallsLeft(run: RunState, target: RawPick): number {
  return Math.max(0, TRADE_UP_CALLS - (run.tradeTalks?.[`up:${target.id}`] ?? 0))
}

/**
 * The team's counter to a package that fell short: ours, plus the fewest and
 * smallest extra picks of ours that reach their ask. Undefined if nothing we own
 * gets there.
 */
export function tradeUpCounter(run: RunState, snap: Snapshot, target: RawPick, pickIds: string[]): string[] | undefined {
  const ask = tradeUpAsk(run, snap, target)
  const value = (p: RawPick) => pickValue(snap, p, run.season)
  let total = run.picks.filter((p) => pickIds.includes(p.id)).reduce((a, p) => a + value(p), 0)
  const pool = tradeablePicks(run, run.team)
    .filter((p) => !pickIds.includes(p.id))
    .map((p) => ({ p, v: value(p) }))
    .sort((a, b) => a.v - b.v)
  const added: string[] = []
  while (total < ask) {
    const need = ask - total
    // The smallest single pick that covers what's missing, else our biggest and go again.
    const i = pool.findIndex((x) => x.v >= need)
    const next = i >= 0 ? pool.splice(i, 1)[0] : pool.pop()
    if (!next) return undefined
    added.push(next.p.id)
    total += next.v
  }
  return [...pickIds, ...added]
}

/** Picks we can trade up to: from the one on the clock to just before our next. */
export function tradeUpTargets(run: RunState): RawPick[] {
  const order = draftOrder(run)
  const cursor = run.draft?.cursor ?? 0
  const next = order.findIndex((p, i) => i >= cursor && p.owner === run.team)
  return order.slice(cursor, next < 0 ? order.length : next).filter((p) => p.owner !== run.team)
}

/** What a team wants to move down from a pick: its value plus a premium (5–20%), fixed per pick and run. */
export function tradeUpAsk(run: RunState, snap: Snapshot, target: RawPick): number {
  return Math.round(pickValue(snap, target, run.season) * rollRange(run.seed, `up-ask:${target.id}`, 1.05, 1.2))
}

export type TradeUpResult =
  | { ok: true; run: RunState; move: Move }
  | { ok: false; reason: string; band?: TradeBand; run?: RunState; counter?: string[] }

/**
 * Offer a package of our picks for a pick before our next one. The team takes it
 * when the package meets its ask; three calls about a pick before it stops
 * answering (a lowball counts twice). If the pick is on the clock, we're up.
 * A package that's in range (short or close) draws a counter while the team
 * still has patience: ours plus what it would take (see tradeUpCounter).
 */
export function proposeTradeUp(run: RunState, snap: Snapshot, targetId: string, pickIds: string[]): TradeUpResult {
  if (!run.draft || draftDone(run)) return { ok: false, reason: 'The draft is over.' }
  const target = tradeUpTargets(run).find((p) => p.id === targetId)
  if (!target) return { ok: false, reason: 'That pick is no longer available to move up to.' }
  const ours = tradeablePicks(run, run.team).filter((p) => pickIds.includes(p.id))
  if (!ours.length || ours.length !== pickIds.length) return { ok: false, reason: 'Offer picks you still own.' }
  const key = `up:${target.id}`
  const tries = run.tradeTalks?.[key] ?? 0
  const team = teamNickname(snap, target.owner)
  if (tries >= TRADE_UP_CALLS) return { ok: false, reason: `The ${team} have stopped taking calls about ${pickName(target)}.` }

  const offered = ours.reduce((a, p) => a + pickValue(snap, p, run.season), 0)
  const band = evaluatePackage(tradeUpAsk(run, snap, target), offered)
  if (band !== 'deal') {
    const next = { ...run, tradeTalks: { ...run.tradeTalks, [key]: tries + (band === 'insulting' ? 2 : 1) } }
    const counter = band !== 'insulting' && tradeUpCallsLeft(next, target) > 0 ? tradeUpCounter(run, snap, target, pickIds) : undefined
    if (counter) {
      const extra = run.picks.filter((p) => counter.includes(p.id) && !pickIds.includes(p.id))
      return { ok: false, reason: `The ${team} counter: add ${extra.map(pickLabel).join(' and ')} and the pick is yours.`, band, run: next, counter }
    }
    return { ok: false, reason: TRADE_REPLY[band], band, run: next }
  }
  const sent = new Set(ours.map((p) => p.id))
  const next: RunState = {
    ...run,
    picks: run.picks.map((p) => (p.id === target.id ? { ...p, owner: run.team } : sent.has(p.id) ? { ...p, owner: target.owner } : p)),
  }
  const { run: out, move } = withMove(
    next,
    'trade',
    target.id,
    `Moved up to ${pickName(target)}`,
    `From the ${team} for ${ours.map(pickLabel).join(', ')}`,
    0,
    { tone: 'team', text: `TRADE: ${run.teamName} move up to ${pickName(target)}, sending ${ours.map(pickLabel).join(', ')} to the ${team}` },
  )
  return { ok: true, run: out, move }
}

export function acceptTradeDown(run: RunState, snap: Snapshot, offerId: string): MoveResult {
  const ours = onTheClock(run)
  const o = tradeDownOffers(run, snap).find((x) => x.id === offerId)
  if (!ours || !o) return { ok: false, reason: 'That offer is gone.' }
  const { run: out, move } = swapForOurPick(run, ours, o.team, run.picks.filter((p) => o.pickIds.includes(p.id)))
  return { ok: true, run: out, move }
}

// ─── Undrafted free agents ──────────────────────────────────────────────────

/** Total UDFA signing bonuses we can hand out (modelled planning limit). */
export function udfaBudgetLeft(run: RunState, snap: Snapshot): number {
  const spent = Object.values(run.draft?.udfa ?? {}).reduce((a, b) => a + b, 0)
  return snap.salaryRules.udfaBonusPool - spent
}

/** Better undrafted players want more money and have more suitors. */
export function udfaAcceptChance(p: RawProspect, bonus: number): number {
  const demand = Math.max(0, (boardScore(p) - 25) / 30)
  return Math.max(0.05, Math.min(0.95, 0.75 - demand * 0.45 + (bonus / UDFA_MAX_BONUS) * 0.45))
}

export function signUdfa(run: RunState, snap: Snapshot, prospectId: string, bonus: number): MoveResult {
  if (run.mode !== 'genuine') return { ok: false, reason: 'UDFA recruiting is part of Genuine mode.' }
  if (!draftDone(run)) return { ok: false, reason: 'The draft is not over yet.' }
  const p = available(run, snap).find((x) => x.id === prospectId)
  if (!p) return { ok: false, reason: 'He has signed elsewhere.' }
  if (bonus > udfaBudgetLeft(run, snap)) return { ok: false, reason: 'That would exceed the UDFA bonus pool.' }
  const tries = run.udfaTries?.[p.id] ?? 0
  if (tries > 0) return { ok: false, reason: `${p.name} already chose another team.` }
  const base = minimumSalary(snap, 0, run.season)
  if (base > capRoom(run, snap)) return { ok: false, reason: 'Not enough cap space.' }
  const yes = roll(run.seed, `udfa:${p.id}`) < udfaAcceptChance(p, bonus)
  if (!yes) {
    const { run: out, move } = withMove(
      { ...run, udfaTries: { ...(run.udfaTries ?? {}), [p.id]: 1 } },
      'talks-ended',
      p.id,
      `${p.name} signed elsewhere`,
      'Another team offered more',
      0,
    )
    return { ok: true, run: out, move }
  }
  const proration = Math.round(bonus / 3)
  const years: ContractYear[] = [0, 1, 2].map((i) => ({
    year: run.season + i,
    base: minimumSalary(snap, i, run.season + i),
    bonus: proration,
    other: 0,
    guaranteedBase: 0,
  }))
  const raw = {
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: run.team,
    apy: years[0].base,
    minimumBase: years[0].base,
    restructureEligible: false,
    depth: true,
    years,
    releaseDead: bonus,
    tradeDead: bonus,
    reportedCap: years[0].base + proration,
    age: 22,
    experience: 0,
    creditedSeasons: 0,
  }
  const contract: Contract = { ...raw, onTradeBlock: false, restructured: false, rookieValue: 20 }
  const d = run.draft!
  const { run: out, move } = withMove(
    { ...run, roster: [...run.roster, contract], draft: { ...d, udfa: { ...d.udfa, [p.id]: bonus } } },
    'udfa',
    p.id,
    `UDFA: ${p.pos} ${p.name}`,
    `${p.school} · ${money(bonus)} signing bonus`,
    -(years[0].base + proration),
  )
  return { ok: true, run: out, move }
}
