import type { CoachCandidate, CoachState } from './coach'
import type { DeclareCall, EditorialData, MarketCall } from './editorialSchema'
import type { DraftState } from './draft'
import type { MarketState } from './market'
import type { Band } from './negotiation'
import type { TagKind, TenderLevel } from './rights'
import type { OfferLogEntry, TradeOffer } from './trades'
import type { ValuationContext } from './valuation'

// Shapes of the data snapshot (public/data/offseason-2027.json) and of a run in progress.
// Raw* types mirror the snapshot as published; everything else is engine state.

export type Position =
  | 'QB' | 'RB' | 'FB' | 'WR' | 'TE' | 'OT' | 'IOL'
  | 'IDL' | 'EDGE' | 'LB' | 'CB' | 'S' | 'K' | 'P' | 'LS'

export interface ContractYear {
  year: number
  base: number
  /** Prorated signing/option bonus charged this year. */
  bonus: number
  /** Roster, workout and per-game bonuses scheduled this year. */
  other: number
  guaranteedBase: number
  outsideBaseIncluded?: number
}

/** A player's spot on his team's current OurLads depth chart; depth 1 is the starter. */
export interface ChartSpot {
  team: string
  slot: string
  depth: number
}

export interface RawContractPlayer {
  id: string
  name: string
  pos: Position
  team: string
  apy: number
  minimumBase: number
  restructureEligible: boolean
  depth: boolean
  years: ContractYear[]
  releaseDead: number
  tradeDead: number
  reportedCap: number
  age: number
  experience: number
  creditedSeasons: number
  rosterStatus?: string
  sourceUrl?: string
  /** Attached from depth.json at load; absent if he isn't on a depth chart. */
  chart?: ChartSpot
  /** His spot on the source (OurLads) chart; `chart` is the editorial one once editorial.json is attached. */
  sourceChart?: ChartSpot
}

export type MarketPlayerType = 'UFA' | 'RFA' | 'ERFA' | 'Void' | 'Futures' | 'Street' | string

export interface RawMarketPlayer {
  id: string
  name: string
  pos: Position
  age: number
  team: string
  own: boolean
  type: MarketPlayerType
  currentAPY?: number
  marketAAV: number
  preferredYears: number
  minimumBase: number
  experience: number
  creditedSeasons: number
  marketKind?: string
  marketBasis?: string
  marketRange?: { low: number; high: number }
  cfaEligible?: boolean
  tagEligible?: boolean
  priorYearSalary?: number
  priorBase?: number
  originalRound?: number | null
  listedSnapPercent?: number
  sourceUrl?: string
  chart?: ChartSpot
  /** His spot on the source (OurLads) chart; `chart` is the editorial one once editorial.json is attached. */
  sourceChart?: ChartSpot
  /** The editor's call on whether he re-signs at home (editorial.json), attached at load. */
  marketCall?: { call: MarketCall; reason: string }
}

export interface RawProspect {
  id: string
  name: string
  pos: Position
  school: string
  rank: number
  sourceLabel: string
  declaration?: { canReturn: boolean; chance: number }
  /** His spot on the source board; `rank` is the editor's board once editorial.json is attached. */
  consensusRank?: number
  /** The editor's scouting note, attached at load. */
  note?: string
  /** The editor's call on whether he declares, attached at load. */
  declareCall?: DeclareCall
}

export interface RawPick {
  id: string
  year: number
  round: number
  overall: number | null
  /** The source slot and trade value; `overall` and `value` follow the editorial draft order once attached. */
  sourceOverall?: number | null
  sourceValue?: number
  owner: string
  originalTeam: string
  compensatory?: boolean
  value: number
}

/** A team's books as checked against OverTheCap and nflverse by scripts/audit.mjs. */
export interface TeamAudit {
  checked: string
  source: string
  rosterSource: string
  rolloverBasis: string
  deadMoney: number
  voidCharges: number
  /** OTC's own cap space for the season, before rollover: the engine's figure should match it. */
  otcCapSpace: number | null
  released?: string[]
  tradedAway?: string[]
  tradedIn?: string[]
  signed?: string[]
  updated?: string[]
}

export interface RawTeam {
  id: string
  name: string
  fullName: string
  capSpace: number
  activeCap: number
  dead: number
  capLimit: number
  /** Dead and void charges already on the books for the coming season. */
  existingDead?: number
  /** Projected rollover of unused cap from the current season (scripts/audit.mjs). */
  rollover?: number
  /** The team's own adjustment to the league cap, e.g. incentive credits or a prior overage (scripts/audit.mjs). */
  capAdjustment?: number
  /** What scripts/audit.mjs checked and changed for this team. */
  audit?: TeamAudit
  needs: Partial<Record<Position, number>>
  simulationIntent?: string
  qbOutlook?: { replacementChance: number; basis?: string }
}

export interface RookieSlotYear {
  year: number
  base: number
  bonus: number
}

export interface Snapshot {
  schema: string
  season: number
  version: string
  asOf: string
  title: string
  /** The team being played (see forTeam in team.ts); `roster` and the cap figures are its. */
  team: string
  /** Whether capLimit includes a projected rollover; only the data's home team has one. */
  capIncludesRollover?: boolean
  /** The team's current head coach, attached from coordinators.json at load. */
  headCoach?: string
  capLimit: number
  existingDead: number
  minimumRookieBase: number
  roster: RawContractPlayer[]
  freeAgents: RawMarketPlayer[]
  rightsPlayers: RawMarketPlayer[]
  depthCandidates: RawMarketPlayer[]
  prospects: RawProspect[]
  picks: RawPick[]
  teams: RawTeam[]
  otherRosters: Record<string, RawContractPlayer[]>
  /** When the attached OurLads depth charts were last updated. */
  depthAsOf?: string
  /** The head coach hiring board, attached from editorial.json at load. */
  coachCandidates?: CoachCandidate[]
  /** Everything else the editor chose (editorial.json), attached at load. */
  editorial?: EditorialData
  /** The trade-value model and the league numbers it needs, attached at load. */
  valuation?: ValuationContext
  rookieScale: { slots: Record<string, RookieSlotYear[]>; capGrowthFactor: number }
  futurePickValuation: { firstRoundFactor: number; laterRoundFactor: number; additionalYearFactor: number }
  draftBoard: { summary: string; mockProjections: { pick: number; team: string; name: string; pos: Position; sharePercent: number }[] }
  salaryRules: {
    minimum2027: number[]
    annualMinimumIncrease: number
    rfa2026: { first: number; second: number; original: number; refusal: number }
    rfaGrowth: number
    tagProjections: Record<string, [number, number]>
    udfaBonusPool: number
  }
  notes: string[]
  /** Where each part of the data came from. */
  sources?: { label: string; url: string }[]
}

// ─── Run state ──────────────────────────────────────────────────────────────

export type Mode = 'genuine' | 'simplified'
export type Objective = 'balanced' | 'draft' | 'win-now' | 'cap-room'

export const PHASES = ['coach', 'in-house', 're-sign', 'free-agency', 'draft', 'summary'] as const
export type Phase = (typeof PHASES)[number]

export interface Contract extends RawContractPlayer {
  onTradeBlock: boolean
  restructured: boolean
  /** Trade value of a rookie we signed this run: what his draft slot was worth. */
  rookieValue?: number
  /** Set while an RFA tender is outstanding; offer sheets can still arrive. */
  tender?: TenderLevel
  tag?: TagKind
}

export type ExpiringStatus = 'open' | 'signed' | 'tagged' | 'tendered' | 'walked' | 'declined'

/** One of our own players whose contract is up. */
export interface Expiring extends RawMarketPlayer {
  status: ExpiringStatus
  /** Rounds of talks left before he ends them. */
  patience: number
  offers: number
  lastBand?: Band
}

export interface DeadCharge {
  playerId: string
  name: string
  amount: number
  reason: 'release' | 'trade' | 'existing'
}

export type MoveKind =
  | 'coach-keep'
  | 'coach-fire'
  | 'coach-decline'
  | 'coach-hire'
  | 'release'
  | 'restructure'
  | 'trade-block'
  | 'sign'
  | 'tag'
  | 'tender'
  | 'futures'
  | 'talks-ended'
  | 'let-walk'
  | 'match'
  | 'decline-sheet'
  | 'trade'
  | 'draft'
  | 'udfa'

export interface Move {
  id: number
  kind: MoveKind
  playerId: string
  headline: string
  detail: string
  /** Positive = cap space gained this season. */
  capDelta: number
  /** The phase it was made in. Absent on moves saved before phases were recorded. */
  phase?: Phase
}

export interface NewsItem {
  id: number
  text: string
  tone: 'league' | 'team' | 'alert'
}

export interface RunState {
  seed: number
  /** The team being played, by id, and its nickname for headlines ("Jets"). */
  team: string
  teamName: string
  /** The head coach when the offseason opened: the one you keep or fire. */
  coachName: string
  season: number
  mode: Mode
  objective: Objective
  phase: Phase
  /** Set by the head coach decision that opens the offseason. */
  coach?: CoachState
  adjustedCap: number
  roster: Contract[]
  dead: DeadCharge[]
  picks: RawPick[]
  expiring: Expiring[]
  tagUsed: TagKind | null
  /** Set when free agency opens. */
  market?: MarketState
  tradeOffers: TradeOffer[]
  /** Trade offers that left the inbox, newest last: accepted, declined, pulled or expired. */
  offerLog?: OfferLogEntry[]
  /** Calls made to each team about each trade target (three before they stop answering). */
  tradeTalks?: Record<string, number>
  /** Counter-offers made on each incoming offer, by offer id (two before they stop listening). */
  counters?: Record<string, number>
  /** Draft-day offers whose team hung up after a counter, by offer id. */
  hungUp?: string[]
  /** Players acquired by trade this run. */
  acquired?: string[]
  /** Players we traded away, and where they went. */
  tradedAway?: { id: string; team: string; pos: Position }[]
  /** Set when the draft opens. */
  draft?: DraftState
  /** UDFAs who already turned us down. */
  udfaTries?: Record<string, number>
  moves: Move[]
  news: NewsItem[]
  nextId: number
}
