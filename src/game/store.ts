import { useMemo } from 'react'
import { create } from 'zustand'
import { capSummary, type CapSummary } from '../engine/cap'
import { placeOnTradeBlock, release, restructure, type MoveResult } from '../engine/moves'
import type { Terms } from '../engine/contracts'
import { applyTag, applyTender, letWalk, offerExpiring, signFutures, type OfferResult } from '../engine/resign'
import type { TagKind, TenderLevel } from '../engine/rights'
import { acceptTradeDown, counterTradeDown, draftPlayer, proposeTradeUp, signUdfa, simToUser, type DraftCard } from '../engine/draft'
import { declineSheet, matchSheet, offerFreeAgent, type MarketOfferResult } from '../engine/market'
import { advanceClock, advancePhase } from '../engine/phase'
import { simulateResignings } from '../engine/autoresign'
import { simulateInHouse } from '../engine/suggest'
import { fireCoach, keepCoach, offerCoachJob } from '../engine/coach'
import { acceptTradeOffer, counterOffer, declineOffer, negotiateOffer, proposeTrade, type ProposeResult } from '../engine/trades'
import { decodeChallenge, type Challenge } from '../engine/challenge'
import { setSoundEnabled, soundEnabled } from '../ui/sound'
import { newSeed } from '../engine/rng'
import { fastForward, type StartingPoint } from '../engine/quickstart'
import { createRun } from '../engine/run'
import { forTeam, HOME_TEAM } from '../engine/team'
import { applyTheme, setColorEdits } from '../ui/theme'
import { attachDepth, type DepthData } from '../engine/depth'
import { attachEditorial, validateEditorial, type CoordinatorsData, type EditorialData } from '../engine/editorial'
import { provenStarters } from '../engine/summary'
import type { Verdict } from '../engine/reportSchema'
import { buildReport, sendReport } from './reports'
import type { Contract, Mode, Move, Objective, RunState, Snapshot } from '../engine/types'

// Bump when RunState changes shape; older saves are ignored rather than half-loaded.
const SAVE_KEY = 'front-office:run:v8'
/** The last team picked, so the title screen comes back in its colours. */
const TEAM_KEY = 'front-office:team'

type Screen = 'loading' | 'error' | 'title' | 'game' | 'editorial'

/** A resolved decision, shown as a full-screen result card. */
export interface Outcome {
  move: Move
  /** Distinguishes the same move shown twice (e.g. two declines). */
  key: number
  /** The player the move brought in, for the card reveal. */
  player?: Contract
  /** Change in our weighted lineup rating. */
  /** Change in proven starters filling the lineup. */
  startersDelta: number
}

/** Build the result card for a move, measuring what it did to the lineup. */
function outcomeFor(before: RunState, after: RunState, move: Move): Outcome {
  const was = before.roster.find((p) => p.id === move.playerId)
  const now = after.roster.find((p) => p.id === move.playerId)
  return {
    move,
    key: move.id,
    // New to the roster, or a new contract for someone already on it.
    player: now && (!was || was.years !== now.years) ? now : undefined,
    startersDelta: provenStarters(after.roster) - provenStarters(before.roster),
  }
}

interface GameStore {
  screen: Screen
  error?: string
  /** The data as loaded, centred on its home team; `snap` is built from it for the team being played. */
  base?: Snapshot
  /** The team picked for a new offseason (or the saved run's), if any. */
  team?: string
  snap?: Snapshot
  run?: RunState
  outcome?: Outcome
  /** AI selections made since we last picked, for the draft feed. */
  recentPicks: DraftCard[]
  /** A refused action, e.g. not enough cap space. */
  notice?: { text: string; key: number }
  hasSave: boolean
  /** The saved run's team, which Continue resumes whatever team is picked on the menu. */
  savedTeam?: string
  sound: boolean
  /** Trade offers already announced by a phone call this session. */
  seenCalls: string[]
  /** Offers flagged this session, by offer id. */
  flaggedOffers: Record<string, Verdict>
  /** A challenge opened from a ?run= link, waiting on the setup screen. */
  challenge?: Challenge
  /** Editorial content as loaded (or last saved), and the coordinator list it picks from. */
  editorial?: EditorialData
  coordinators?: CoordinatorsData

  load(): Promise<void>
  /** Pick the team to play: rebuilds the data from its point of view and repaints the page. */
  setTeam(team: string): void
  openEditorial(): void
  /** Save editorial content through the dev server; resolves to an error message on failure. */
  saveEditorial(data: EditorialData): Promise<string | undefined>
  /** Start a new run, fast-forwarded to the starting point (see engine/quickstart.ts). */
  begin(mode: Mode, objective: Objective, seed?: number, start?: StartingPoint): void
  setChallenge(c: Challenge | undefined): void
  toggleSound(): void
  markCallsSeen(ids: string[]): void
  /** Report an offer as too high or too low; resolves to an error message, or undefined once sent. */
  flagOffer(offerId: string, verdict: Verdict, note: string): Promise<string | undefined>
  resume(): void
  quitToTitle(): void
  release(playerId: string): void
  restructure(playerId: string): void
  tradeBlock(playerId: string): void
  offer(playerId: string, terms: Terms): OfferResult | undefined
  tag(playerId: string, kind: TagKind): void
  tender(playerId: string, level: TenderLevel): void
  letWalk(playerId: string): void
  signFutures(playerId: string): void
  offerFreeAgent(playerId: string, terms: Terms): MarketOfferResult | undefined
  advanceClock(): void
  matchSheet(sheetId: string): void
  declineSheet(sheetId: string): void
  acceptTrade(offerId: string): void
  declineTrade(offerId: string): void
  /** Push back on an offer; resolves to the team's reply, or an error message. */
  negotiateTrade(offerId: string): string
  proposeTrade(targetId: string, pickIds: string[]): ProposeResult | undefined
  draftPlayer(prospectId: string): void
  simDraft(): void
  /** Let the team on the clock make its pick (one pick, unless we're up). */
  simNextPick(): void
  tradeDown(offerId: string): void
  /** Counter an offer for one of our players with the picks we want; resolves to the team's reply. */
  counterTrade(offerId: string, pickIds: string[]): { reply: string; done: boolean } | undefined
  /** Counter a draft-day trade-down offer with the picks we want for ours. */
  counterTradeDown(offerId: string, pickIds: string[]): { reply: string; done: boolean } | undefined
  /** Offer our picks to move up to a pick before our next: undefined when it's done, otherwise the reply and any counter. */
  tradeUp(targetId: string, pickIds: string[]): { reply: string; counter?: string[] } | undefined
  signUdfa(prospectId: string, bonus: number): void
  advancePhase(): void
  /** Keep the head coach and move straight on to in-house decisions. */
  keepCoach(): void
  fireCoach(): void
  offerCoachJob(candidateId: string): void
  /** Settle every open re-sign decision with the placeholder policy, then open free agency. */
  simResign(): void
  /** Make the suggested in-house moves and move on to re-signings. */
  simInHouse(): void
  dismissOutcome(): void
  dismissNotice(): void
}

function readSave(): RunState | undefined {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    return raw ? (JSON.parse(raw) as RunState) : undefined
  } catch {
    return undefined
  }
}

function readTeam(): string | undefined {
  try {
    return localStorage.getItem(TEAM_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function writeTeam(team: string) {
  try {
    localStorage.setItem(TEAM_KEY, team)
  } catch {
    // Remembering the team is a convenience.
  }
}

function writeSave(run: RunState | undefined) {
  try {
    if (run) localStorage.setItem(SAVE_KEY, JSON.stringify(run))
    else localStorage.removeItem(SAVE_KEY)
  } catch {
    // Saving is a convenience; the run continues without it.
  }
}

export const useGame = create<GameStore>((set, get) => {
  /** The snapshot from `team`'s point of view, with editorial content attached. */
  const snapFor = (team: string): Snapshot | undefined => {
    const { base, coordinators, editorial } = get()
    if (!base || !coordinators || !editorial) return undefined
    return attachEditorial(forTeam(base, team), coordinators, editorial)
  }
  /** Switch the data and the colours to `team`, unless they're already its. */
  const switchTeam = (team: string) => {
    applyTheme(team)
    if (get().snap?.team === team && get().team === team) return get().snap
    const snap = snapFor(team)
    set({ team, snap })
    return snap
  }

  /** Run an engine move; quiet moves skip the full-screen result card. */
  const apply = (fn: (run: RunState) => MoveResult, quiet = false) => {
    const { run } = get()
    if (!run) return
    const res = fn(run)
    if (!res.ok) return notify(res.reason)
    writeSave(res.run)
    set({ run: res.run, outcome: quiet ? undefined : outcomeFor(run, res.run, res.move) })
  }

  const notify = (text: string) => set({ notice: { text, key: Date.now() } })

  return {
    screen: 'loading',
    hasSave: false,
    recentPicks: [],
    sound: soundEnabled(),
    seenCalls: [],
    flaggedOffers: {},

    async flagOffer(offerId, verdict, note) {
      const { run, snap } = get()
      const o = run?.tradeOffers.find((x) => x.id === offerId)
      if (!run || !snap || !o) return 'That offer is no longer on the table.'
      const error = await sendReport(buildReport(run, snap, o, verdict, note))
      if (!error) set({ flaggedOffers: { ...get().flaggedOffers, [offerId]: verdict } })
      return error
    },

    markCallsSeen(ids) {
      set({ seenCalls: [...new Set([...get().seenCalls, ...ids])] })
    },

    toggleSound() {
      const on = !get().sound
      setSoundEnabled(on)
      set({ sound: on })
    },

    async load() {
      try {
        const fetchData = async <T,>(file: string): Promise<T> => {
          const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { cache: 'no-cache' })
          if (!res.ok) throw new Error(`${file} request failed (${res.status})`)
          return res.json() as Promise<T>
        }
        const [raw, depth, coordinators, editorial] = await Promise.all([
          fetchData<Snapshot>('offseason-2027.json'),
          fetchData<DepthData>('depth.json'),
          fetchData<CoordinatorsData>('coordinators.json'),
          fetchData<unknown>('editorial.json').then(validateEditorial),
        ])
        const base = attachDepth({ ...raw, team: raw.team ?? HOME_TEAM }, depth)
        const save = readSave()
        const code = new URLSearchParams(location.search).get('run')
        const challenge = (code && decodeChallenge(code, raw.teams.map((t) => t.id))) || undefined
        // The title screen opens on the team you last picked, else the saved run's; until then it's neutral.
        const team = challenge?.team ?? readTeam() ?? (save?.season === base.season ? save.team : undefined)
        set({ base, editorial, coordinators })
        const snap = snapFor(team ?? HOME_TEAM)!
        setColorEdits(editorial.colors)
        applyTheme(team)
        set({ snap, team, screen: 'title', hasSave: save?.season === snap.season, savedTeam: save?.team, challenge })
      } catch (e) {
        set({ screen: 'error', error: e instanceof Error ? e.message : String(e) })
      }
    },

    setTeam(team) {
      writeTeam(team)
      switchTeam(team)
    },

    openEditorial() {
      set({ screen: 'editorial' })
    },

    async saveEditorial(data) {
      const { snap, coordinators, base } = get()
      if (!snap || !coordinators || !base) return 'Data is not loaded.'
      try {
        const res = await fetch('/__editorial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        if (res.status === 404 || res.status === 405) return 'Saving needs the dev server (npm run dev).'
        if (!res.ok) return (await res.text()) || `Save failed (${res.status})`
      } catch {
        return 'Could not reach the dev server.'
      }
      // Apply right away, so a game started now uses the new choices.
      set({ editorial: data, snap: attachEditorial(forTeam(base, snap.team), coordinators, data) })
      setColorEdits(data.colors)
      applyTheme(get().team)
      return undefined
    },

    begin(mode, objective, seed = newSeed(), start = 'start') {
      const { team } = get()
      if (!team) return
      const snap = switchTeam(team)
      if (!snap) return
      const run = fastForward(createRun(snap, { mode, objective, seed }), snap, start)
      writeSave(run)
      set({ run, screen: 'game', hasSave: true, savedTeam: run.team, outcome: undefined, challenge: undefined, recentPicks: [] })
    },

    setChallenge(challenge) {
      set({ challenge })
      // A challenge is played as the team that set it.
      if (challenge) switchTeam(challenge.team)
    },

    resume() {
      const run = readSave()
      if (!run) return
      switchTeam(run.team)
      set({ run, screen: 'game' })
    },

    quitToTitle() {
      set({ screen: 'title', outcome: undefined })
    },

    release: (id) => apply((run) => release(run, id)),
    restructure: (id) => apply((run) => restructure(run, id)),
    tradeBlock: (id) => apply((run) => placeOnTradeBlock(run, id, get().snap)),
    tag: (id, kind) => apply((run) => applyTag(run, get().snap!, id, kind)),
    tender: (id, level) => apply((run) => applyTender(run, get().snap!, id, level)),
    letWalk: (id) => apply((run) => letWalk(run, id)),
    signFutures: (id) => apply((run) => signFutures(run, get().snap!, id), true),

    offer(id, terms) {
      const { run, snap } = get()
      if (!run || !snap) return undefined
      const res = offerExpiring(run, snap, id, terms)
      if (!res.ok) {
        notify(res.reason)
        return res
      }
      writeSave(res.run)
      set({ run: res.run, outcome: res.move ? outcomeFor(run, res.run, res.move) : undefined })
      return res
    },

    advancePhase() {
      const { run, snap } = get()
      if (!run || !snap) return
      const res = advancePhase(run, snap)
      if (!res.ok) return notify(res.reason)
      writeSave(res.run)
      set({ run: res.run })
    },

    keepCoach() {
      const { run, snap } = get()
      if (!run || !snap) return
      const kept = keepCoach(run)
      if (!kept.ok) return notify(kept.reason)
      const res = advancePhase(kept.run, snap)
      if (!res.ok) return notify(res.reason)
      writeSave(res.run)
      set({ run: res.run })
    },
    fireCoach: () => apply((run) => fireCoach(run)),
    offerCoachJob: (id) => apply((run) => offerCoachJob(run, get().snap!, id)),

    simInHouse() {
      const { run, snap } = get()
      if (!run || !snap || run.phase !== 'in-house') return
      const res = advancePhase(simulateInHouse(run, snap).run, snap)
      if (!res.ok) return notify(res.reason)
      writeSave(res.run)
      set({ run: res.run })
    },

    simResign() {
      const { run, snap } = get()
      if (!run || !snap || run.phase !== 're-sign') return
      const res = advancePhase(simulateResignings(run, snap).run, snap)
      if (!res.ok) return notify(res.reason)
      writeSave(res.run)
      set({ run: res.run })
    },

    advanceClock() {
      const { run, snap } = get()
      if (!run || !snap) return
      const res = advanceClock(run, snap)
      if (!res.ok) return notify(res.reason)
      writeSave(res.run)
      set({ run: res.run })
    },

    offerFreeAgent(id, terms) {
      const { run, snap } = get()
      if (!run || !snap) return undefined
      const res = offerFreeAgent(run, snap, id, terms)
      if (!res.ok) {
        notify(res.reason)
        return res
      }
      writeSave(res.run)
      set({ run: res.run, outcome: res.move ? outcomeFor(run, res.run, res.move) : undefined })
      return res
    },

    draftPlayer: (id) => apply((run) => draftPlayer(run, get().snap!, id)),
    signUdfa: (id, bonus) => apply((run) => signUdfa(run, get().snap!, id, bonus), true),

    tradeDown(id) {
      apply((run) => acceptTradeDown(run, get().snap!, id))
      get().simDraft()
    },

    counterTrade(id, pickIds) {
      const { run, snap } = get()
      if (!run || !snap) return undefined
      const res = counterOffer(run, snap, id, pickIds)
      if (!res.ok) return { reply: res.reason, done: false }
      writeSave(res.run)
      set({ run: res.run, outcome: res.move ? outcomeFor(run, res.run, res.move) : undefined })
      return { reply: res.reply, done: res.verdict !== 'close' }
    },

    counterTradeDown(id, pickIds) {
      const { run, snap } = get()
      if (!run || !snap) return undefined
      const res = counterTradeDown(run, snap, id, pickIds)
      if (!res.ok) return { reply: res.reason, done: false }
      writeSave(res.run)
      set({ run: res.run, outcome: res.move ? outcomeFor(run, res.run, res.move) : undefined })
      // Traded down: the AI picks until we're up again.
      if (res.move) get().simDraft()
      return { reply: res.reply, done: res.verdict !== 'close' }
    },

    tradeUp(targetId, pickIds) {
      const { run, snap } = get()
      if (!run || !snap) return undefined
      const res = proposeTradeUp(run, snap, targetId, pickIds)
      if (!res.ok) {
        if (res.run) {
          writeSave(res.run)
          set({ run: res.run })
        }
        return { reply: res.reason, counter: res.counter }
      }
      writeSave(res.run)
      set({ run: res.run, outcome: outcomeFor(run, res.run, res.move) })
      return undefined
    },

    simNextPick() {
      const { run, snap } = get()
      if (!run || !snap || run.phase !== 'draft') return
      const { run: next, made } = simToUser(run, snap, 1)
      writeSave(next)
      set({ run: next, recentPicks: made })
    },

    simDraft() {
      const { run, snap } = get()
      if (!run || !snap || run.phase !== 'draft') return
      const { run: next, made } = simToUser(run, snap)
      writeSave(next)
      set({ run: next, recentPicks: made })
    },

    matchSheet: (id) => apply((run) => matchSheet(run, get().snap!, id)),
    declineSheet: (id) => apply((run) => declineSheet(run, id)),
    acceptTrade: (id) => apply((run) => acceptTradeOffer(run, get().snap!, id)),
    declineTrade: (id) => apply((run) => declineOffer(run, id), true),
    negotiateTrade(id) {
      const { run, snap } = get()
      if (!run || !snap) return ''
      const res = negotiateOffer(run, snap, id)
      if (!res.ok) return res.reason
      writeSave(res.run)
      set({ run: res.run })
      return res.reply
    },

    proposeTrade(targetId, pickIds) {
      const { run, snap } = get()
      if (!run || !snap) return undefined
      const res = proposeTrade(run, snap, targetId, pickIds)
      // A rejected package still updates how many calls the team will take.
      const next = res.run
      if (next) {
        writeSave(next)
        set({ run: next, outcome: res.ok ? outcomeFor(run, next, res.move) : undefined })
      }
      if (!res.ok && !res.band) notify(res.reason)
      return res
    },

    dismissOutcome() {
      set({ outcome: undefined })
    },

    dismissNotice() {
      set({ notice: undefined })
    },
  }
})

/** Cap summary for the current run, recomputed from state. */
export function useCap(): CapSummary | undefined {
  const run = useGame((s) => s.run)
  const snap = useGame((s) => s.snap)
  if (!run || !snap) return undefined
  return capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase)
}

/** Lineup spots filled by proven starters, after every move. */
export function useStarters(): number | undefined {
  const run = useGame((s) => s.run)
  return useMemo(() => (run ? provenStarters(run.roster) : undefined), [run])
}
