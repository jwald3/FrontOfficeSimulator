// The shape of public/data/editorial.json and its validation. Kept free of imports so
// the dev server's save endpoint (vite.config.ts) can use it directly.
//
// Fields added after the first release are optional, so older files stay valid.

/** A head coach candidate the editor typed in: a college coach, a former head coach… */
export interface ManualCandidate {
  id: string
  name: string
  /** One line on who he is, shown on the hiring board. */
  role: string
}

/** A team's three colours (see ui/theme.ts for what each paints). */
export interface ColorSet {
  primary: string
  accent: string
  pop: string
}
/** The colours with a fixed meaning, the same for every team. */
export interface FixedColors {
  gold: string
  alert: string
  cool: string
  /** Money and value going your way: the green to alert's red. */
  gain: string
}
export interface EditorialColors {
  /** By team id: changes to its colours. */
  teams?: Record<string, Partial<ColorSet>>
  /** The colours shown before a team is picked. */
  neutral?: Partial<ColorSet>
  fixed?: Partial<FixedColors>
}

/** The argument for keeping the head coach, and for firing him. */
export interface CoachCase {
  keep: string
  fire: string
}

/** The keep-or-fire case for a team's coach, reading older files' single case as the home team's. */
export function coachCase(coach: EditorialData['coach'], team: string): CoachCase | undefined {
  return coach.cases?.[team] ?? (team === 'NYJ' ? coach.case : undefined)
}

/** How a candidate answers a job offer: always yes, leaning yes, a coin flip, leaning no, or always no. */
export type Interest = 'yes' | 'likely' | 'maybe' | 'unlikely' | 'no'
export const INTERESTS: Interest[] = ['yes', 'likely', 'maybe', 'unlikely', 'no']

/** What an interest level does: his chance of accepting, and how the offer dialog describes him. */
export interface InterestLevel {
  chance: number
  copy: string
}
export const DEFAULT_INTEREST_LEVELS: Record<Interest, InterestLevel> = {
  yes: { chance: 1, copy: 'He wants this job. Expect a yes.' },
  likely: { chance: 0.75, copy: "He's interested, though he hasn't committed." },
  maybe: { chance: 0.5, copy: 'Could go either way: he has other options.' },
  unlikely: { chance: 0.25, copy: "He's lukewarm. It would take some convincing." },
  no: { chance: 0, copy: "Word is he won't leave his current job." },
}
/** Accepts and Declines are certainties; only the levels between have a chance to tune. */
export const FIXED_INTERESTS: Interest[] = ['yes', 'no']

/** An interest level with the editor's changes over the defaults. */
export function interestLevel(levels: EditorialData['coach']['levels'], i: Interest): InterestLevel {
  const own = levels?.[i]
  return {
    chance: FIXED_INTERESTS.includes(i) ? DEFAULT_INTEREST_LEVELS[i].chance : (own?.chance ?? DEFAULT_INTEREST_LEVELS[i].chance),
    copy: own?.copy ?? DEFAULT_INTEREST_LEVELS[i].copy,
  }
}

/** The editor's call on one of our expiring players. */
export type ResignCall = 're-sign' | 'tender' | 'walk'
export const RESIGN_CALLS: ResignCall[] = ['re-sign', 'tender', 'walk']

/** The editor's call on a player under contract: suggest a move, or keep him off the list. */
export type InHouseCall = 'release' | 'restructure' | 'block' | 'keep'
export const INHOUSE_CALLS: InHouseCall[] = ['release', 'restructure', 'block', 'keep']

/**
 * The rule behind the Suggested tab, for players without an editor call. Each part
 * can be switched off; the thresholds are the editor's to set.
 */
export interface InHouseRule {
  /** Suggest a cut when it saves at least `minSurplus` more than replacing him costs. */
  release: boolean
  minSurplus: number
  /** Suggest restructuring starters `maxAge` or younger once effective space is under `tightSpace`. */
  restructure: boolean
  maxAge: number
  tightSpace: number
}
export const DEFAULT_INHOUSE_RULE: InHouseRule = { release: true, minSurplus: 2_000_000, restructure: true, maxAge: 30, tightSpace: 25_000_000 }

/** How one position is valued: its ceiling in chart points, and how it ages. */
export interface PositionValue {
  /** What a player paid like the position's top five is worth, in chart points (pick 1 = 3000). */
  top: number
  /** The last age at full value; younger players get up to 15% more. */
  prime: number
  /** Share of value lost each year past the prime, 0–1. */
  decline: number
}

/** The trade-value model (engine/valuation.ts). */
export interface ValuationModel {
  positions: Record<string, PositionValue>
  /** Star premium: value follows (APY share of the position's top five) to this power. */
  starPower: number
  /** A listed starter is worth at least this share of his position's top value, 0–1. */
  starterFloor: number
  /** Value kept by depth-chart role below starter. */
  role: { second: number; deeper: number }
  /** Value kept with one or two contract years left (a rental), against three or more. */
  control: { one: number; two: number }
  /** Rounds a future pick drops for each season ahead (0 = no discount). */
  futureRounds: number
  /** Where offers open, as a share of the player's value: unsolicited calls, and answers to the trade block. */
  callRange: [number, number]
  blockRange: [number, number]
}

export const DEFAULT_VALUATION: ValuationModel = {
  positions: {
    QB: { top: 3000, prime: 32, decline: 0.08 },
    EDGE: { top: 2200, prime: 29, decline: 0.1 },
    WR: { top: 2000, prime: 28, decline: 0.1 },
    OT: { top: 1900, prime: 31, decline: 0.08 },
    CB: { top: 1800, prime: 28, decline: 0.12 },
    IDL: { top: 1700, prime: 30, decline: 0.1 },
    IOL: { top: 1100, prime: 31, decline: 0.08 },
    TE: { top: 1000, prime: 29, decline: 0.1 },
    S: { top: 1000, prime: 29, decline: 0.1 },
    LB: { top: 900, prime: 28, decline: 0.1 },
    RB: { top: 800, prime: 26, decline: 0.15 },
    K: { top: 120, prime: 35, decline: 0.05 },
    P: { top: 100, prime: 35, decline: 0.05 },
    FB: { top: 80, prime: 28, decline: 0.1 },
    LS: { top: 40, prime: 35, decline: 0.05 },
  },
  starPower: 1.6,
  starterFloor: 0.2,
  role: { second: 0.6, deeper: 0.35 },
  control: { one: 0.7, two: 0.85 },
  futureRounds: 0.5,
  callRange: [0.8, 1],
  blockRange: [0.8, 1.05],
}

/** Stop recommending a position once we've drafted one in the first `rounds` rounds. */
export interface DraftAdviceRule {
  pos: string
  rounds: number
}
export const DEFAULT_DRAFT_ADVICE: DraftAdviceRule[] = [{ pos: 'QB', rounds: 3 }]

/** The editor's call on another team's pending free agent: re-signs at home, or reaches the market. */
export type MarketCall = 'stays' | 'market'
export const MARKET_CALLS: MarketCall[] = ['stays', 'market']

/** The editor's call on an underclassman who could return to school. */
export type DeclareCall = 'declares' | 'returns'
export const DECLARE_CALLS: DeclareCall[] = ['declares', 'returns']

export interface EditorialData {
  version: 1
  coach: {
    /** Coordinators (by coordinators.json id) offered as head coach candidates. */
    coordinatorIds: string[]
    manual: ManualCandidate[]
    /** The argument for each side of the keep-or-fire decision, by team id. */
    cases?: Record<string, CoachCase>
    /** Older files: the case for the home team (NYJ). Read as cases.NYJ. */
    case?: CoachCase
    /** By candidate id; unset means 'maybe'. The team's own coordinators always accept regardless. */
    interest?: Record<string, Interest>
    /** By candidate id: a line shown on his card on the hiring board. */
    notes?: Record<string, string>
    /** Changes to what each interest level does; unset parts use DEFAULT_INTEREST_LEVELS. */
    levels?: Partial<Record<Interest, Partial<InterestLevel>>>
  }
  resign?: {
    /** By player id: what "Simulate re-signings" does with him, and why. */
    calls: Record<string, { call: ResignCall; reason: string }>
  }
  inHouse?: {
    /** By player id: what the Suggested tab says about him, and why. */
    calls: Record<string, { call: InHouseCall; reason: string }>
    /** The rule for everyone without a call; unset uses DEFAULT_INHOUSE_RULE. */
    rule?: InHouseRule
  }
  market?: {
    /** By free-agent id: whether he re-signs with his team before free agency, and why. Unset rolls the historical rate. */
    calls: Record<string, { call: MarketCall; reason: string }>
  }
  depth?: {
    /**
     * By player id: his depth-chart spot, replacing the OurLads one, or null to take
     * him off the chart. Depth 1 is a starter.
     */
    spots: Record<string, { slot: string; depth: number } | null>
  }
  /** The trade-value model; unset parts use DEFAULT_VALUATION. */
  valuation?: ValuationModel
  /** By player id: his trade value in chart points, replacing the model's. */
  playerValues?: Record<string, number>
  /** Players who can't be traded, either way: no offers or calls for ours, and other teams won't deal theirs. */
  untouchable?: string[]
  /** Players never worth a first-round pick, this year's or future: no first moves in any deal for them. */
  noFirsts?: string[]
  /** Changes to the team colours and the fixed colours; unset parts use the defaults in ui/theme.ts. */
  colors?: EditorialColors
  /** Positions the draft stops recommending once we've taken one early; unset uses DEFAULT_DRAFT_ADVICE. */
  draftAdvice?: DraftAdviceRule[]
  draftOrder?: {
    /** Team ids in this season's draft order, replacing the projected one. Every round follows it. */
    teams: string[]
  }
  draft?: {
    /**
     * Prospect ids in the editor's board order, replacing the consensus ranking.
     * Prospects missing from it (new to the snapshot) keep their consensus spot.
     */
    order?: string[]
    /** By prospect id: a scouting note shown on his card. */
    notes?: Record<string, string>
    /** By prospect id: whether an underclassman declares. Unset rolls his listed chance. */
    declare?: Record<string, DeclareCall>
  }
}

export const EMPTY_EDITORIAL: EditorialData = { version: 1, coach: { coordinatorIds: [], manual: [] } }

/** Throws if the data isn't a well-formed editorial file; returns it typed. */
export function validateEditorial(data: unknown): EditorialData {
  const d = data as EditorialData
  const isString = (x: unknown) => typeof x === 'string' && x.trim().length > 0
  const isRecord = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x)
  if (!d || d.version !== 1 || !d.coach) throw new Error('Not an editorial file (version 1).')
  if (!Array.isArray(d.coach.coordinatorIds) || !d.coach.coordinatorIds.every(isString)) throw new Error('coach.coordinatorIds must be a list of ids.')
  if (!Array.isArray(d.coach.manual) || !d.coach.manual.every((m) => isString(m?.id) && isString(m?.name) && typeof m?.role === 'string')) {
    throw new Error('coach.manual entries need an id, a name and a role.')
  }
  const ids = [...d.coach.manual.map((m) => m.id)]
  if (new Set(ids).size !== ids.length) throw new Error('Manual candidate ids must be unique.')

  const { case: kase, cases, interest, notes } = d.coach
  const isCase = (c: CoachCase | undefined) => typeof c?.keep === 'string' && typeof c?.fire === 'string'
  if (kase !== undefined && !isCase(kase)) throw new Error('coach.case needs keep and fire text.')
  if (cases !== undefined && (!isRecord(cases) || !Object.values(cases).every(isCase))) throw new Error('coach.cases needs keep and fire text for each team.')
  if (interest !== undefined && (!isRecord(interest) || !Object.values(interest).every((v) => INTERESTS.includes(v)))) {
    throw new Error(`coach.interest values must be one of: ${INTERESTS.join(', ')}.`)
  }
  if (notes !== undefined && (!isRecord(notes) || !Object.values(notes).every((v) => typeof v === 'string'))) throw new Error('coach.notes values must be text.')
  const { levels } = d.coach
  if (
    levels !== undefined &&
    (!isRecord(levels) ||
      !Object.entries(levels).every(
        ([k, v]) =>
          INTERESTS.includes(k as Interest) &&
          isRecord(v) &&
          (v.chance === undefined || (typeof v.chance === 'number' && v.chance >= 0 && v.chance <= 1)) &&
          (v.copy === undefined || typeof v.copy === 'string'),
      ))
  ) {
    throw new Error('coach.levels maps interest levels to { chance from 0 to 1, copy }.')
  }

  if (d.resign !== undefined) {
    if (!isRecord(d.resign) || !isRecord(d.resign.calls)) throw new Error('resign.calls must map player ids to calls.')
    for (const c of Object.values(d.resign.calls)) {
      if (!RESIGN_CALLS.includes(c?.call) || typeof c?.reason !== 'string') throw new Error(`Each re-sign call needs a call (${RESIGN_CALLS.join(', ')}) and a reason.`)
    }
  }
  if (d.inHouse !== undefined) {
    if (!isRecord(d.inHouse) || !isRecord(d.inHouse.calls)) throw new Error('inHouse.calls must map player ids to calls.')
    for (const c of Object.values(d.inHouse.calls)) {
      if (!INHOUSE_CALLS.includes(c?.call) || typeof c?.reason !== 'string') throw new Error(`Each in-house call needs a call (${INHOUSE_CALLS.join(', ')}) and a reason.`)
    }
    const r = d.inHouse.rule
    const amount = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
    if (
      r !== undefined &&
      (!isRecord(r) || typeof r.release !== 'boolean' || typeof r.restructure !== 'boolean' || !amount(r.minSurplus) || !amount(r.tightSpace) || !Number.isInteger(r.maxAge) || r.maxAge < 20 || r.maxAge > 45)
    ) {
      throw new Error('inHouse.rule needs release and restructure switches, dollar thresholds and a max age from 20 to 45.')
    }
  }
  if (d.market !== undefined) {
    if (!isRecord(d.market) || !isRecord(d.market.calls)) throw new Error('market.calls must map player ids to calls.')
    for (const c of Object.values(d.market.calls)) {
      if (!MARKET_CALLS.includes(c?.call) || typeof c?.reason !== 'string') throw new Error(`Each free-agency call needs a call (${MARKET_CALLS.join(', ')}) and a reason.`)
    }
  }
  if (d.depth !== undefined) {
    if (!isRecord(d.depth) || !isRecord(d.depth.spots)) throw new Error('depth.spots must map player ids to spots.')
    for (const s of Object.values(d.depth.spots)) {
      if (s !== null && (!isString(s?.slot) || !Number.isInteger(s?.depth) || s.depth < 1 || s.depth > 9)) {
        throw new Error('Each depth spot needs a slot and a depth from 1 to 9, or null for off the chart.')
      }
    }
  }
  if (d.valuation !== undefined) {
    const v = d.valuation
    const num = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi
    const range = (r: unknown) => Array.isArray(r) && r.length === 2 && num(r[0], 0, 3) && num(r[1], 0, 3) && r[0] <= r[1]
    const ok =
      isRecord(v) &&
      isRecord(v.positions) &&
      Object.values(v.positions).every((p) => num(p?.top, 0, 6000) && num(p?.prime, 18, 45) && num(p?.decline, 0, 1)) &&
      num(v.starPower, 0.2, 5) &&
      num(v.starterFloor, 0, 1) &&
      num(v.role?.second, 0, 1) &&
      num(v.role?.deeper, 0, 1) &&
      num(v.control?.one, 0, 1) &&
      num(v.control?.two, 0, 1) &&
      num(v.futureRounds, 0, 3) &&
      range(v.callRange) &&
      range(v.blockRange)
    if (!ok) throw new Error('valuation needs position values, a star power, starter floor, role and control factors, a future-pick discount and offer ranges.')
  }
  if (d.playerValues !== undefined) {
    const ok = isRecord(d.playerValues) && Object.values(d.playerValues).every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 6000)
    if (!ok) throw new Error('playerValues must map player ids to values from 0 to 6000 points.')
  }
  if (d.untouchable !== undefined && (!Array.isArray(d.untouchable) || !d.untouchable.every(isString))) {
    throw new Error('untouchable must be a list of player ids.')
  }
  if (d.noFirsts !== undefined && (!Array.isArray(d.noFirsts) || !d.noFirsts.every(isString))) {
    throw new Error('noFirsts must be a list of player ids.')
  }
  if (d.colors !== undefined) {
    const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
    const set = (c: unknown, keys: string[]) => isRecord(c) && Object.entries(c as Record<string, unknown>).every(([k, v]) => keys.includes(k) && hex(v))
    const { teams, neutral, fixed } = d.colors as EditorialColors
    const ok =
      isRecord(d.colors) &&
      (teams === undefined || (isRecord(teams) && Object.values(teams).every((c) => set(c, ['primary', 'accent', 'pop'])))) &&
      (neutral === undefined || set(neutral, ['primary', 'accent', 'pop'])) &&
      (fixed === undefined || set(fixed, ['gold', 'alert', 'cool', 'gain']))
    if (!ok) throw new Error('colors must be #rrggbb values for primary, accent and pop (teams, neutral) or gold, alert, cool and gain (fixed).')
  }
  if (
    d.draftAdvice !== undefined &&
    (!Array.isArray(d.draftAdvice) || !d.draftAdvice.every((r) => isString(r?.pos) && Number.isInteger(r?.rounds) && r.rounds >= 1 && r.rounds <= 7))
  ) {
    throw new Error('draftAdvice must be a list of { pos, rounds } with rounds from 1 to 7.')
  }
  if (d.draftOrder !== undefined) {
    const teams = d.draftOrder?.teams
    if (!Array.isArray(teams) || !teams.every(isString) || new Set(teams).size !== teams.length) throw new Error('draftOrder.teams must be a list of unique team ids.')
  }
  if (d.draft !== undefined) {
    const { order, notes: draftNotes, declare } = d.draft ?? {}
    if (!isRecord(d.draft)) throw new Error('draft must be an object.')
    if (order !== undefined && (!Array.isArray(order) || !order.every(isString) || new Set(order).size !== order.length)) {
      throw new Error('draft.order must be a list of unique prospect ids.')
    }
    if (draftNotes !== undefined && (!isRecord(draftNotes) || !Object.values(draftNotes).every((v) => typeof v === 'string'))) throw new Error('draft.notes values must be text.')
    if (declare !== undefined && (!isRecord(declare) || !Object.values(declare).every((v) => DECLARE_CALLS.includes(v)))) {
      throw new Error(`draft.declare values must be one of: ${DECLARE_CALLS.join(', ')}.`)
    }
  }
  return d
}
