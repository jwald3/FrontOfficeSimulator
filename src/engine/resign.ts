import { capSummary } from './cap'
import { buildContract, minimumSalary, signedContract, type Terms } from './contracts'
import { money } from './format'
import { withMove, type MoveResult } from './moves'
import { askingTerms, evaluateOffer, personality, respond, type Evaluation, type Personality, type Response } from './negotiation'
import { roll } from './rng'
import { tagAmount, tenderOptions, type TagKind, type TenderLevel } from './rights'
import type { Contract, Expiring, Move, RawMarketPlayer, RunState, Snapshot } from './types'

export function findExpiring(run: RunState, id: string): Expiring | undefined {
  return run.expiring.find((p) => p.id === id)
}

function updateExpiring(run: RunState, id: string, patch: Partial<Expiring>): RunState {
  return { ...run, expiring: run.expiring.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
}

/** Cap room available to absorb a new first-year charge. */
export function capRoom(run: RunState, snap: Snapshot): number {
  return capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase).totalSpace
}

// ─── Negotiation ────────────────────────────────────────────────────────────

export interface Table {
  pers: Personality
  ask: Terms
  minimum: number
}

export function table(run: RunState, snap: Snapshot, p: RawMarketPlayer): Table {
  const pers = personality(run.seed, p)
  const minimum = minimumSalary(snap, p.creditedSeasons, snap.season)
  return { pers, ask: askingTerms(p, pers, minimum), minimum }
}

export function previewOffer(run: RunState, snap: Snapshot, p: RawMarketPlayer, terms: Terms) {
  const t = table(run, snap, p)
  const built = buildContract(terms, run.season, (y) => minimumSalary(snap, p.creditedSeasons, y))
  const firstYear = built.years[0]
  const capHit = firstYear.base + firstYear.bonus + firstYear.other
  return { ...t, built, capHit, evaluation: evaluateOffer(t.ask, t.pers, terms) }
}

export type OfferResult =
  | { ok: false; reason: string }
  | { ok: true; run: RunState; response: Response; evaluation: Evaluation; move?: Move }

/**
 * Submit an offer to one of our expiring players. Accepted deals join the
 * roster immediately; a counter costs patience; running out ends talks and he
 * heads to free agency.
 */
export function offerExpiring(run: RunState, snap: Snapshot, id: string, terms: Terms): OfferResult {
  const p = findExpiring(run, id)
  if (!p || p.status !== 'open') return { ok: false, reason: 'Not negotiating with this player.' }
  const pv = previewOffer(run, snap, p, terms)
  if (terms.aav < pv.minimum) return { ok: false, reason: `Below his minimum of ${money(pv.minimum)}.` }
  if (pv.capHit > capRoom(run, snap)) return { ok: false, reason: 'Not enough cap space for the first-year charge.' }

  const response = respond(pv.evaluation, p.patience)
  if (response.kind === 'accept') {
    const contract = signedContract(snap, p, pv.built, terms.aav)
    const next = updateExpiring({ ...run, roster: [...run.roster, contract] }, id, { status: 'signed', offers: p.offers + 1 })
    const { run: out, move } = withMove(
      next,
      'sign',
      id,
      `Re-signed ${p.pos} ${p.name}`,
      `${terms.years} yr${terms.years > 1 ? 's' : ''} · ${money(terms.aav * terms.years)} · ${Math.round(terms.guaranteePct * 100)}% guaranteed`,
      -pv.capHit,
      { tone: 'team', text: `${run.teamName} re-sign ${p.pos} ${p.name}: ${terms.years} years, ${money(terms.aav * terms.years)}` },
    )
    return { ok: true, run: out, response, evaluation: pv.evaluation, move }
  }
  if (response.kind === 'walk') {
    const next = updateExpiring(run, id, { status: 'walked', patience: 0, offers: p.offers + 1, lastBand: pv.evaluation.band })
    const { run: out, move } = withMove(
      next,
      'talks-ended',
      id,
      `${p.name} ended talks`,
      'He will test free agency',
      0,
      { tone: 'alert', text: `${p.pos} ${p.name} breaks off contract talks with the ${run.teamName}` },
    )
    return { ok: true, run: out, response, evaluation: pv.evaluation, move }
  }
  const next = updateExpiring(run, id, { patience: response.patienceLeft, offers: p.offers + 1, lastBand: pv.evaluation.band })
  return { ok: true, run: next, response, evaluation: pv.evaluation }
}

export function letWalk(run: RunState, id: string): MoveResult {
  const p = findExpiring(run, id)
  if (!p || p.status !== 'open') return { ok: false, reason: 'Not available.' }
  const { run: out, move } = withMove(
    updateExpiring(run, id, { status: 'declined' }),
    'let-walk',
    id,
    `Letting ${p.name} walk`,
    p.type === 'RFA' || p.type === 'ERFA' ? 'Not tendered · he becomes an unrestricted free agent' : 'He will hit the open market',
    0,
  )
  return { ok: true, run: out, move }
}

// ─── Tags ───────────────────────────────────────────────────────────────────

export function canTag(run: RunState, p: Expiring): string | null {
  if (run.mode !== 'genuine') return 'Tags are part of Genuine mode'
  if (!p.tagEligible) return 'Not tag-eligible'
  if (p.status !== 'open') return 'Already resolved'
  if (run.tagUsed) return `${run.tagUsed === 'franchise' ? 'Franchise' : 'Transition'} tag already used`
  return null
}

export function applyTag(run: RunState, snap: Snapshot, id: string, kind: TagKind): MoveResult {
  const p = findExpiring(run, id)
  if (!p) return { ok: false, reason: 'Not available.' }
  const blocked = canTag(run, p)
  if (blocked) return { ok: false, reason: blocked }
  const amount = tagAmount(snap, p, kind)
  if (amount > capRoom(run, snap)) return { ok: false, reason: 'Not enough cap space for the tag.' }
  const years = [{ year: run.season, base: amount, bonus: 0, other: 0, guaranteedBase: amount }]
  const contract = signedContract(snap, p, { years, releaseDead: amount }, amount, { tag: kind })
  const label = kind === 'franchise' ? 'Franchise tag' : 'Transition tag'
  const { run: out, move } = withMove(
    updateExpiring({ ...run, roster: [...run.roster, contract], tagUsed: kind }, id, { status: 'tagged' }),
    'tag',
    id,
    `${label}: ${p.pos} ${p.name}`,
    `One year, fully guaranteed${kind === 'transition' ? ' · we can match any offer sheet' : ''}`,
    -amount,
    { tone: 'team', text: `${run.teamName} place the ${label.toLowerCase()} on ${p.pos} ${p.name} (${money(amount)})` },
  )
  return { ok: true, run: out, move }
}

// ─── Tenders ────────────────────────────────────────────────────────────────

export function applyTender(run: RunState, snap: Snapshot, id: string, level: TenderLevel): MoveResult {
  const p = findExpiring(run, id)
  if (!p || p.status !== 'open') return { ok: false, reason: 'Not available.' }
  if (run.mode !== 'genuine') return { ok: false, reason: 'Tenders are part of Genuine mode.' }
  const opt = tenderOptions(snap, p).find((o) => o.level === level)
  if (!opt) return { ok: false, reason: 'That tender does not apply.' }
  if (opt.amount > capRoom(run, snap)) return { ok: false, reason: 'Not enough cap space for the tender.' }
  // Tenders are one-year, non-guaranteed offers.
  const years = [{ year: run.season, base: opt.amount, bonus: 0, other: 0, guaranteedBase: 0 }]
  const contract: Contract = signedContract(snap, p, { years, releaseDead: 0 }, opt.amount, {
    tender: level === 'erfa' ? undefined : level,
  })
  const { run: out, move } = withMove(
    updateExpiring({ ...run, roster: [...run.roster, contract] }, id, { status: 'tendered' }),
    'tender',
    id,
    `${opt.name}: ${p.pos} ${p.name}`,
    level === 'erfa'
      ? 'Exclusive rights · he can only sign with us'
      : opt.compRound
        ? `Another team signing him owes us their round ${opt.compRound} pick`
        : 'We can match any offer sheet; no compensation if we decline',
    -opt.amount,
    { tone: 'team', text: `${run.teamName} tender ${p.type} ${p.pos} ${p.name} at ${money(opt.amount)}` },
  )
  return { ok: true, run: out, move }
}

// ─── Reserve / futures ──────────────────────────────────────────────────────

/** Futures availability is rolled once per run: some have already signed elsewhere. */
export function futuresAvailable(seed: number, c: RawMarketPlayer): boolean {
  return roll(seed, `futures:${c.id}`) < (c.own ? 0.85 : 0.6)
}

export function signFutures(run: RunState, snap: Snapshot, id: string): MoveResult {
  if (run.mode !== 'genuine') return { ok: false, reason: 'Futures contracts are part of Genuine mode.' }
  const c = snap.depthCandidates.find((d) => d.id === id)
  if (!c) return { ok: false, reason: 'Unknown player.' }
  if (run.roster.some((p) => p.id === id)) return { ok: false, reason: 'Already signed.' }
  if (!futuresAvailable(run.seed, c)) return { ok: false, reason: 'He has already signed elsewhere.' }
  const base = minimumSalary(snap, c.creditedSeasons, run.season)
  if (base > capRoom(run, snap)) return { ok: false, reason: 'Not enough cap space.' }
  const years = [{ year: run.season, base, bonus: 0, other: 0, guaranteedBase: 0 }]
  const contract = { ...signedContract(snap, c, { years, releaseDead: 0 }, base), depth: true }
  const { run: out, move } = withMove(
    { ...run, roster: [...run.roster, contract] },
    'futures',
    id,
    `Futures deal: ${c.pos} ${c.name}`,
    `One year at the ${money(base)} minimum · non-guaranteed`,
    -base,
  )
  return { ok: true, run: out, move }
}
