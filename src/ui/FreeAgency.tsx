import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState, useRef } from 'react'
import { capSummary, seasonCapHit, yearsRemaining } from '../engine/cap'
import { minimumSalary } from '../engine/contracts'
import { money } from '../engine/format'
import { entryFor, marketPool, marketTable, pendingSheets, WAVES, type MarketEntry, type OfferSheet } from '../engine/market'
import {
  askingValue,
  packageValue,
  pickLabel,
  pickValue,
  playerValue,
  TRADE_REPLY,
  tradeTargets,
  acceptTradeOffer,
  MAX_COUNTERS,
  teamNickname,
  ownedPicks,
  type OfferLogEntry,
  type TradeTarget,
} from '../engine/trades'
import type { RawMarketPlayer, RunState, Snapshot } from '../engine/types'
import { isUntouchable, noFirsts } from '../engine/valuation'
import { PickChooser } from './PickChooser'
import type { Verdict } from '../engine/reportSchema'
import { useGame } from '../game/store'
import { IncomingCall } from './Broadcast'
import { Confirm } from './Game'
import { PHASE_INFO, positionGroup, useHotkeys, useRevealOnPhone } from './lib'
import { NegHero, NegotiationPanel, Patience, ReadMeter } from './NegotiationPanel'
import { DepthBadge, Key, PlayerArt } from './parts'
import { REPORTING } from '../game/reports'
import './inhouse.css'
import './resign.css'
import './freeagency.css'

type Tab = 'market' | 'inbox' | 'trades'
type Unit = 'all' | 'off' | 'def' | 'st'
type Pending =
  | { kind: 'advance' }
  | { kind: 'clock' }
  | { kind: 'match' | 'decline'; sheet: OfferSheet }

const UNITS: { id: Unit; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'off', label: 'Offense' },
  { id: 'def', label: 'Defense' },
  { id: 'st', label: 'Specialists' },
]

export function FreeAgency() {
  const run = useGame((s) => s.run!)
  const snap = useGame((s) => s.snap!)
  const outcomeOpen = useGame((s) => !!s.outcome)
  const act = useGame()
  const [tab, setTab] = useState<Tab>('market')
  const [pending, setPending] = useState<Pending | null>(null)
  /** The trade offer open in the review card. */
  const [review, setReview] = useState<string | null>(null)
  const wave = run.market?.wave ?? 0
  const sheets = pendingSheets(run)
  const lastWave = wave >= WAVES.length - 1

  const confirm = () => {
    if (!pending) return
    if (pending.kind === 'advance') act.advancePhase()
    else if (pending.kind === 'clock') act.advanceClock()
    else if (pending.kind === 'match') act.matchSheet(pending.sheet.id)
    else act.declineSheet(pending.sheet.id)
    setPending(null)
  }
  const locked = !!pending || !!review || outcomeOpen
  const inboxCount = sheets.length + run.tradeOffers.length

  return (
    <div className="fa">
      <header className="board-head fa-head">
        <div>
          <div className="eyebrow">{PHASE_INFO['free-agency'].n} / {PHASE_INFO['free-agency'].name}</div>
          <h1 className="display board-title">{PHASE_INFO['free-agency'].tagline}</h1>
        </div>
        <div className="clock slab">
          <div className="clock-waves">
            {WAVES.map((w, i) => <i key={w.name} data-state={i < wave ? 'done' : i === wave ? 'now' : 'next'} />)}
          </div>
          <div>
            <div className="display clock-name">{WAVES[wave].name}</div>
            <div className="muted clock-blurb">{WAVES[wave].blurb}</div>
          </div>
          <button className="btn ghost" disabled={lastWave} onClick={() => setPending({ kind: 'clock' })}>
            Advance clock ▸
          </button>
        </div>
        <button className="btn" onClick={() => setPending({ kind: 'advance' })}>Continue to the Draft →</button>
      </header>

      <div className="board-tools">
        <div className="seg" role="tablist">
          <button role="tab" className="seg-btn" aria-selected={tab === 'market'} onClick={() => setTab('market')}>Market</button>
          <button role="tab" className="seg-btn" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>
            Inbox {inboxCount > 0 && <span className="badge num">{inboxCount}</span>}
          </button>
          <button role="tab" className="seg-btn" aria-selected={tab === 'trades'} onClick={() => setTab('trades')}>
            Trade finder
          </button>
        </div>
      </div>

      <div className="fa-body">
        {tab === 'market' && <Market run={run} snap={snap} locked={locked} />}
        {tab === 'inbox' && <Inbox run={run} snap={snap} sheets={sheets} onDecide={(kind, sheet) => setPending({ kind, sheet })} onReview={setReview} />}
        {tab === 'trades' && <TradeFinder run={run} snap={snap} />}
      </div>

      {!pending && !review && (
        <IncomingCall
          onTake={(id) => {
            setTab('inbox')
            setReview(id)
          }}
        />
      )}

      <AnimatePresence>
        {review && run.tradeOffers.some((o) => o.id === review) && <OfferReview key="review" offerId={review} onClose={() => setReview(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {pending && <PendingDialog key="dlg" pending={pending} run={run} onConfirm={confirm} onCancel={() => setPending(null)} />}
      </AnimatePresence>
    </div>
  )
}

// ─── Market ─────────────────────────────────────────────────────────────────

const STATUS_TEXT: Record<MarketEntry['status'], string> = {
  available: 'Available',
  signed: 'Signed',
  'signed-elsewhere': 'Signed',
  walked: 'Talks over',
  uninterested: 'Not interested',
  retained: 'Re-signed',
}

function Market({ run, snap, locked }: { run: RunState; snap: Snapshot; locked: boolean }) {
  const offer = useGame((s) => s.offerFreeAgent)
  const [unit, setUnit] = useState<Unit>('all')
  const [query, setQuery] = useState('')
  const [showGone, setShowGone] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  useRevealOnPhone(panelRef, selectedId)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return marketPool(run, snap)
      .map((p) => ({ p, e: entryFor(run, p) }))
      .filter(({ e }) => showGone || e.status === 'available' || e.status === 'signed')
      .filter(({ p }) => unit === 'all' || positionGroup(p.pos) === unit)
      .filter(({ p }) => !q || p.name.toLowerCase().includes(q) || p.pos.toLowerCase() === q || p.team.toLowerCase() === q)
      .sort((a, b) => b.p.marketAAV - a.p.marketAAV)
      .slice(0, 160)
  }, [run, snap, unit, query, showGone])

  const selected = rows.find((r) => r.p.id === selectedId) ?? rows[0]
  const idx = selected ? rows.indexOf(selected) : -1
  useHotkeys(
    {
      arrowdown: () => rows[idx + 1] && setSelectedId(rows[idx + 1].p.id),
      arrowup: () => rows[idx - 1] && setSelectedId(rows[idx - 1].p.id),
    },
    !locked,
  )

  return (
    <div className="fa-split">
      <section className="board">
        <div className="board-tools">
          <div className="seg">
            {UNITS.map((u) => (
              <button key={u.id} className="seg-btn" aria-selected={unit === u.id} onClick={() => setUnit(u.id)}>{u.label}</button>
            ))}
          </div>
          <input className="search" placeholder="Search name, position or last team…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={showGone} onChange={(e) => setShowGone(e.target.checked)} /> Show unavailable
          </label>
        </div>
        <div className="rows-head mrow">
          <span />
          <span>Player</span>
          <span>Depth</span>
          <span className="r">Asking</span>
          <span className="r">Status</span>
        </div>
        <ol className="rows scroll">
          {rows.map(({ p, e }) => (
            <li key={p.id}>
              <button className="row mrow sheen" data-active={p.id === selected?.p.id} data-status={e.status} onClick={() => setSelectedId(p.id)}>
                <PlayerArt id={p.id} name={p.name} pos={p.pos} size={38} />
                <span className="row-name">
                  <strong>{p.name}</strong>
                  <span className="row-meta">{p.pos} · {p.age} yrs · {p.team}{p.type === 'Void' ? ' · void' : ''}</span>
                </span>
                <DepthBadge chart={p.chart} size="sm" />
                <span className="num r">{money(marketTable(run, snap, p).ask.aav)}</span>
                <span className="mrow-status" data-status={e.status}>
                  {e.status === 'available' ? <Patience left={e.patience} /> : e.status === 'signed-elsewhere' ? `${e.team} · ${money(e.aav ?? 0)}` : e.status === 'retained' ? `Stayed · ${e.team}` : STATUS_TEXT[e.status]}
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="rows-empty muted">Nobody matches.</li>}
        </ol>
      </section>

      <aside className="side" ref={panelRef}>
        <AnimatePresence mode="wait">
          {selected && (
            <motion.div
              key={selected.p.id}
              className="card negcard"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
            >
              <NegHero p={selected.p} table={marketTable(run, snap, selected.p)} sub={`${selected.p.type} · ${selected.p.team}`} />
              {selected.e.status === 'available' ? (
                <NegotiationPanel
                  key={`${selected.p.id}-${run.market?.wave}`}
                  p={selected.p}
                  table={marketTable(run, snap, selected.p)}
                  seed={run.seed}
                  season={run.season}
                  minBase={(y) => minimumSalary(snap, selected.p.creditedSeasons, y)}
                  lastBand={selected.e.lastBand}
                  offers={selected.e.offers}
                  locked={locked}
                  onSubmit={(terms) => offer(selected.p.id, terms)}
                />
              ) : (
                <Gone p={selected.p} e={selected.e} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </aside>
    </div>
  )
}

function Gone({ p, e }: { p: RawMarketPlayer; e: MarketEntry }) {
  const team = useGame((s) => s.run!.teamName)
  const city = useGame((s) => {
    const full = s.snap?.teams.find((t) => t.id === s.run?.team)?.fullName ?? ''
    return full.slice(0, full.lastIndexOf(' ')) || 'us'
  })
  const text =
    e.status === 'signed'
      ? `He joins the ${team}.`
      : e.status === 'signed-elsewhere'
        ? `Signed with ${e.team}: ${e.years} yrs, ${money((e.aav ?? 0) * (e.years ?? 1))}.`
        : e.status === 'uninterested'
          ? `${p.name} has told teams he won't consider ${city} this year.`
          : e.status === 'retained'
            ? p.marketCall?.reason.trim()
              ? `He re-signed with ${e.team} before the market opened. ${p.marketCall.reason.trim()}`
              : `He re-signed with ${e.team} before the market opened, as most free agents do.`
          : 'Talks broke down. He is signing elsewhere.'
  return (
    <div className="resolved" data-status={e.status === 'signed' ? 'signed' : 'walked'}>
      <div className="display resolved-stamp">{STATUS_TEXT[e.status]}</div>
      <p className="muted">{text}</p>
    </div>
  )
}

// ─── Inbox ──────────────────────────────────────────────────────────────────

/**
 * Everything waiting on an answer: offer sheets for our restricted players, offers
 * for players on the block, and teams calling about players we didn't shop. Trade
 * offers expire when the clock moves; what we decided stays below as history.
 */
function Inbox({
  run,
  snap,
  sheets,
  onDecide,
  onReview,
}: {
  run: RunState
  snap: Snapshot
  sheets: OfferSheet[]
  onDecide: (k: 'match' | 'decline', s: OfferSheet) => void
  onReview: (offerId: string) => void
}) {
  const decided = run.market?.offerSheets.filter((s) => s.resolved) ?? []
  const log = [...(run.offerLog ?? [])].reverse()
  const teamName = (id: string) => snap.teams.find((t) => t.id === id)?.name ?? id
  const blocked = run.roster.some((p) => p.onTradeBlock)
  const empty = sheets.length === 0 && run.tradeOffers.length === 0

  return (
    <div className="inbox scroll">
      {empty && (
        <p className="muted inbox-empty">
          Nothing needs an answer right now. {blocked ? 'Offers for your trade block' : 'Calls from other teams'} arrive as the clock moves.
        </p>
      )}
      {sheets.map((s) => (
        <motion.article key={s.id} className="sheet slab" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div className="eyebrow sheet-eyebrow">Offer sheet · decision required</div>
          <div className="sheet-body">
            <PlayerArt id={s.playerId} name={s.name} pos={s.pos as RawMarketPlayer['pos']} size={72} />
            <div>
              <div className="display sheet-title">{s.team} want {s.name}</div>
              <div className="sheet-terms num">
                {s.terms.years} yrs · {money(s.terms.aav)}/yr · {money(s.terms.aav * s.terms.years)} total · {Math.round(s.terms.guaranteePct * 100)}% gtd
              </div>
              <div className="muted">
                {s.compRound ? `Decline and you receive their round ${s.compRound} pick.` : 'Decline and he leaves for nothing.'}
              </div>
            </div>
            <div className="sheet-actions">
              <button className="btn" onClick={() => onDecide('match', s)}>Match</button>
              <button className="btn ghost" onClick={() => onDecide('decline', s)}>Decline</button>
            </div>
          </div>
        </motion.article>
      ))}
      {run.tradeOffers.map((o, i) => {
        const c = run.roster.find((x) => x.id === o.playerId)
        if (!c) return null
        const picks = run.picks.filter((p) => o.pickIds.includes(p.id))
        const ratio = o.value / playerValue(c, snap)
        return (
          <motion.article
            key={o.id}
            className="toffer inbox-offer"
            data-kind={o.kind ?? 'block'}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: Math.min(i, 8) * 0.04 }}
          >
            <PlayerArt id={c.id} name={c.name} pos={c.pos} size={56} />
            <div className="inbox-offer-body">
              <div className="eyebrow inbox-offer-kind">
                {o.kind === 'call' ? 'Incoming call' : 'Trade block offer'}
                {o.negotiated === 'sweetened' ? ' · sweetened' : o.negotiated === 'firm' ? ' · final offer' : ''} · expires when the clock moves
              </div>
              <div className="display inbox-offer-title">
                {teamName(o.team)} {o.kind === 'call' ? 'is calling about' : 'make an offer for'} {c.name}
              </div>
              <ul className="toffer-picks">{picks.map((p) => <li key={p.id} className="chip">{pickLabel(p)}</li>)}</ul>
            </div>
            <div className="inbox-offer-side">
              <span className={`num ${ratio >= 1 ? 'pos' : ratio < 0.8 ? 'neg' : ''}`}>{Math.round(ratio * 100)}% of his value</span>
              <button className="btn" onClick={() => onReview(o.id)}>Review offer</button>
            </div>
          </motion.article>
        )
      })}

      {(log.length > 0 || decided.length > 0) && (
        <section className="inbox-history">
          <div className="eyebrow">History</div>
          {log.map((e) => (
            <div key={e.id} className="inbox-past" data-outcome={e.outcome}>
              <span className="inbox-past-what">{teamName(e.team)} for {e.name}</span>
              <span className="muted">{e.picks}</span>
              <span className="inbox-past-outcome">{OUTCOME_TEXT[e.outcome]}</span>
            </div>
          ))}
          {decided.map((s) => (
            <div key={s.id} className="inbox-past" data-outcome={s.resolved === 'matched' ? 'accepted' : 'declined'}>
              <span className="inbox-past-what">Offer sheet from {s.team} for {s.name}</span>
              <span className="muted">{s.terms.years} yrs · {money(s.terms.aav)}/yr</span>
              <span className="inbox-past-outcome">{s.resolved === 'matched' ? 'Matched' : 'Let him go'}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

const OUTCOME_TEXT: Record<OfferLogEntry['outcome'], string> = { accepted: 'Accepted', declined: 'Declined', pulled: 'They pulled it', expired: 'Expired' }

/**
 * One trade offer, in full: what goes each way, what it does to the cap if we
 * accept, and the three answers. Negotiating is one push-back; the reply shows here.
 */
function OfferReview({ offerId, onClose }: { offerId: string; onClose: () => void }) {
  const run = useGame((s) => s.run!)
  const snap = useGame((s) => s.snap!)
  const act = useGame()
  const [reply, setReply] = useState<string | null>(null)
  const [countering, setCountering] = useState(false)
  const [ask, setAsk] = useState<string[] | null>(null)
  const o = run.tradeOffers.find((x) => x.id === offerId)
  const c = o && run.roster.find((x) => x.id === o.playerId)
  useHotkeys({ escape: onClose })
  if (!o || !c) return null

  const team = snap.teams.find((t) => t.id === o.team)
  const picks = run.picks.filter((p) => o.pickIds.includes(p.id))
  const countersLeft = MAX_COUNTERS - (run.counters?.[o.id] ?? 0)
  const capped = noFirsts(snap, c.id)
  const before = capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase)
  const accepted = acceptTradeOffer(run, snap, o.id)
  const after = accepted.ok ? capSummary(accepted.run, snap.rookieScale.slots, snap.minimumRookieBase) : undefined
  const delta = after ? after.effectiveSpace - before.effectiveSpace : 0
  const row = (label: string, a: number, b: number) => (
    <div className="review-cap-row">
      <span>{label}</span>
      <span className="num">
        {money(a)} → <b>{money(b)}</b>
      </span>
    </div>
  )

  return (
    <motion.div className="confirm-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="confirm review slab"
        role="dialog"
        aria-modal
        aria-label={`${team?.name ?? o.team} offer for ${c.name}`}
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.2, 0.9, 0.1, 1] }}
      >
        <div className="eyebrow review-eyebrow">
          {o.team} · {o.kind === 'call' ? 'Incoming call' : 'Trade block offer'}
        </div>
        <div className="display confirm-title">
          {team?.name ?? o.team} {o.kind === 'call' ? 'is calling about' : 'make an offer for'} {c.name}
        </div>
        <p className="review-line">
          {o.line ? <>&ldquo;{o.line}&rdquo; </> : null}
          This is an offer, not a done deal.
        </p>

        <div className="review-sides">
          <div>
            <div className="eyebrow">{run.teamName} send</div>
            <div className="review-asset">{c.pos} {c.name}</div>
          </div>
          <div>
            <div className="eyebrow">{run.teamName} receive</div>
            {picks.map((p) => (
              <div key={p.id} className="review-asset">{pickLabel(p)}</div>
            ))}
          </div>
        </div>

        <div className="review-cap">
          <div className="eyebrow">{run.teamName} salary cap · if accepted</div>
          <div className={`display review-cap-head ${delta >= 0 ? 'pos' : 'neg'}`}>
            {delta >= 0 ? 'Frees' : 'Costs'} {money(Math.abs(delta))}
          </div>
          <div className="muted review-cap-sub">of effective cap space, after the draft reserve</div>
          {after && (
            <>
              {row('Total cap space', before.totalSpace, after.totalSpace)}
              {row('Draft reserve', before.draftReserve, after.draftReserve)}
              {row('Effective cap space', before.effectiveSpace, after.effectiveSpace)}
              <div className="review-cap-row">
                <span>Added dead money</span>
                <span className="num">{money(c.tradeDead)}</span>
              </div>
            </>
          )}
          {!accepted.ok && <p className="neg">{accepted.reason}</p>}
        </div>

        {countering && (
          <div className="counter-panel">
            <div className="eyebrow">Counter · ask the {team?.name ?? o.team} for these picks</div>
            {capped && <p className="muted counter-note">{c.name} isn't worth a first, so no first-rounders are on the table.</p>}
            <PickChooser
              run={run}
              snap={snap}
              picks={ownedPicks(run, o.team).filter((p) => p.round !== 1 || !capped)}
              selected={ask ?? o.pickIds}
              onChange={setAsk}
              totalLabel="You ask for"
              against={{ label: 'his value', value: playerValue(c, snap) }}
            />
            <div className="counter-actions">
              <span className="muted">{countersLeft} {countersLeft === 1 ? 'counter' : 'counters'} left</span>
              <button className="btn ghost" onClick={() => setCountering(false)}>Cancel</button>
              <button
                className="btn"
                disabled={!(ask ?? o.pickIds).length}
                onClick={() => {
                  const res = act.counterTrade(o.id, ask ?? o.pickIds)
                  if (!res) return
                  setReply(res.reply)
                  if (res.done) onClose()
                }}
              >
                Send counter
              </button>
            </div>
          </div>
        )}

        {reply && (
          <p className="review-reply" role="status">
            {reply}
          </p>
        )}
        <p className="muted review-note">
          {Math.round((o.value / playerValue(c, snap)) * 100)}% of his trade value. Offers expire when the clock moves.
          {o.negotiated ? ' They have given you their best.' : ' You can push back once.'}
        </p>

        {REPORTING && <FlagOffer offerId={o.id} />}

        <div className="confirm-actions review-actions">
          <button
            className="btn ghost"
            onClick={() => {
              act.declineTrade(o.id)
              onClose()
            }}
          >
            Decline offer
          </button>
          <button className="btn ghost" disabled={!!o.negotiated} onClick={() => setReply(act.negotiateTrade(o.id))}>
            Negotiate
          </button>
          <button className="btn ghost" disabled={countering || countersLeft === 0} onClick={() => setCountering(true)}>
            Counter
          </button>
          <button
            className="btn"
            disabled={!accepted.ok}
            onClick={() => {
              act.acceptTrade(o.id)
              onClose()
            }}
          >
            Accept these terms
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

const VERDICT_LABEL: Record<Verdict, string> = { 'too-high': 'Too high', 'too-low': 'Too low' }

/**
 * Report an offer that doesn't look right: too high or too low, with an optional
 * note. It goes to the editors' Feedback inbox, where they can adjust the player's
 * value or ignore it.
 */
function FlagOffer({ offerId }: { offerId: string }) {
  const flagged = useGame((s) => s.flaggedOffers[offerId])
  const flag = useGame((s) => s.flagOffer)
  const [open, setOpen] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (flagged) {
    return (
      <p className="flag-done" role="status">
        Flagged as {VERDICT_LABEL[flagged].toLowerCase()}. Thanks, the editors will take a look.
      </p>
    )
  }
  if (!open) {
    return (
      <button className="flag-open" onClick={() => setOpen(true)}>
        <span aria-hidden>⚑</span> Flag this offer
      </button>
    )
  }
  const send = async () => {
    if (!verdict) return
    setSending(true)
    setError((await flag(offerId, verdict, note)) ?? null)
    setSending(false)
  }
  return (
    <div className="flag-panel">
      <div className="eyebrow">Does this offer look wrong?</div>
      <div className="seg" role="radiogroup" aria-label="Your verdict">
        {(['too-low', 'too-high'] as const).map((v) => (
          <button key={v} role="radio" className="seg-btn" aria-checked={verdict === v} aria-selected={verdict === v} onClick={() => setVerdict(v)}>
            {VERDICT_LABEL[v]}
          </button>
        ))}
      </div>
      <textarea rows={2} maxLength={1000} placeholder="What would you expect? (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for the editors" />
      {error && <p className="neg flag-error">{error}</p>}
      <div className="flag-actions">
        <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn" disabled={!verdict || sending} onClick={send}>{sending ? 'Sending…' : 'Send to editors'}</button>
      </div>
    </div>
  )
}

// ─── Trade finder ───────────────────────────────────────────────────────────

function TradeFinder({ run, snap }: { run: RunState; snap: Snapshot }) {
  const propose = useGame((s) => s.proposeTrade)
  const [query, setQuery] = useState('')
  const [unit, setUnit] = useState<Unit>('all')
  const [targetId, setTargetId] = useState<string | null>(null)
  const dealRef = useRef<HTMLDivElement>(null)
  useRevealOnPhone(dealRef, targetId)
  const [pickIds, setPickIds] = useState<string[]>([])
  const [reply, setReply] = useState<string | null>(null)

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tradeTargets(run, snap)
      .filter((t) => unit === 'all' || positionGroup(t.pos) === unit)
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.pos.toLowerCase() === q || t.team.toLowerCase() === q)
      // Listed starters first, then the biggest contracts.
      .sort((a, b) => (a.chart?.depth ?? 9) - (b.chart?.depth ?? 9) || b.apy - a.apy)
      .slice(0, 80)
  }, [run, snap, unit, query])
  const target = targets.find((t) => t.id === targetId)
  const locked = !!target && isUntouchable(snap, target.id)
  const capped = !!target && noFirsts(snap, target.id)
  const ours = run.picks.filter((p) => p.owner === run.team).sort((a, b) => a.year - b.year || a.round - b.round || (a.overall ?? 0) - (b.overall ?? 0))
  const offered = run.picks.filter((p) => pickIds.includes(p.id))
  const toggle = (id: string) => setPickIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const choose = (t: TradeTarget) => {
    setTargetId(t.id)
    setPickIds([])
    setReply(null)
  }
  const submit = () => {
    if (!target) return
    const res = propose(target.id, pickIds)
    if (res && !res.ok && res.band && res.band !== 'deal') setReply(TRADE_REPLY[res.band])
    if (res?.ok) {
      setTargetId(null)
      setPickIds([])
    }
  }

  return (
    <section className="finder">
      <div className="eyebrow">Trade finder</div>
      <div className="board-tools">
        <div className="seg">
          {UNITS.map((u) => (
            <button key={u.id} className="seg-btn" aria-selected={unit === u.id} onClick={() => setUnit(u.id)}>{u.label}</button>
          ))}
        </div>
        <input className="search" placeholder="Search players, positions or teams…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="finder-split">
        <ol className="rows scroll">
          {targets.map((t) => (
            <li key={t.id}>
              <button className="row trow sheen" data-active={t.id === targetId} onClick={() => choose(t)}>
                <PlayerArt id={t.id} name={t.name} pos={t.pos} size={34} />
                <span className="row-name">
                  <strong>{t.name}</strong>
                  <span className="row-meta">{t.pos} · {t.age} yrs · {t.team}</span>
                </span>
                <DepthBadge chart={t.chart} size="sm" />
                <span className="num r">{money(seasonCapHit(t, run.season))}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="finder-deal" ref={dealRef}>
          {target ? (
            <>
              <div className="deal-head">
                <div>
                  <div className="display deal-name">{target.name}</div>
                  {locked && <div className="deal-locked">Untouchable · the {teamNickname(snap, target.team)} won't trade him</div>}
                  {capped && !locked && <div className="deal-locked deal-capped">Not worth a first · no first-rounders in this deal</div>}
                  <div className="muted">
                    {target.pos} · {target.team} · {money(seasonCapHit(target, run.season))} cap hit · {yearsRemaining(target, run.season)} yrs left
                  </div>
                </div>
                <DepthBadge chart={target.chart} size="md" />
              </div>
              <div className="eyebrow">Your picks</div>
              <div className="pickgrid">
                {ours.map((p) => (
                  <button key={p.id} className="pick" aria-pressed={pickIds.includes(p.id)} disabled={capped && p.round === 1} onClick={() => toggle(p.id)}>
                    <span>{pickLabel(p)}</span>
                    <span className="num">{pickValue(snap, p, run.season)}</span>
                  </button>
                ))}
              </div>
              <TradeMeter run={run} target={target} offered={offered.length ? packageValue(snap, run, offered) : 0} />
              {reply && (
                <div className="agent">
                  <span className="agent-tag display">{target.team}</span>
                  <span>{reply}</span>
                </div>
              )}
              <div className="deal-actions">
                <span className="muted">Calls left <Patience left={Math.max(0, 3 - (run.tradeTalks?.[target.id] ?? 0))} /></span>
                <button className="btn submit" disabled={!pickIds.length || locked} onClick={submit}>Propose trade <Key>↵</Key></button>
              </div>
            </>
          ) : (
            <p className="muted finder-empty">Pick a player to build an offer from your draft capital.</p>
          )}
        </div>
      </div>
    </section>
  )
}

/** A rough read on how the package compares to what they want, fuzzed like the agent read. */
function TradeMeter({ run, target, offered }: { run: RunState; target: TradeTarget; offered: number }) {
  const snap = useGame((s) => s.snap!)
  return <ReadMeter ask={askingValue(run, snap, target)} offered={offered} />
}

// ─── Dialog copy ────────────────────────────────────────────────────────────

function PendingDialog({ pending, run, onConfirm, onCancel }: { pending: Pending; run: RunState; onConfirm: () => void; onCancel: () => void }) {
  if (pending.kind === 'advance') {
    return (
      <Confirm title="Head to the draft?" confirmLabel="On the clock" onConfirm={onConfirm} onCancel={onCancel}>
        Free agency closes for you. Anyone still unsigned stays unsigned, and trade offers on the table expire.
      </Confirm>
    )
  }
  if (pending.kind === 'clock') {
    const next = WAVES[(run.market?.wave ?? 0) + 1]
    return (
      <Confirm title={`Advance to ${next.name}?`} confirmLabel="Run the clock" onConfirm={onConfirm} onCancel={onCancel}>
        Rival teams will sign players they need. Prices drop, but the best players go first. Current trade offers expire.
      </Confirm>
    )
  }
  const s = pending.sheet
  return pending.kind === 'match' ? (
    <Confirm title={`Match for ${s.name}?`} confirmLabel="Match" onConfirm={onConfirm} onCancel={onCancel}>
      He stays on {s.team}'s terms: {s.terms.years} years, {money(s.terms.aav * s.terms.years)}.
    </Confirm>
  ) : (
    <Confirm title={`Let ${s.name} go?`} confirmLabel="Decline" danger onConfirm={onConfirm} onCancel={onCancel}>
      He signs with {s.team}. {s.compRound ? `You receive their round ${s.compRound} pick.` : 'You receive nothing.'}
    </Confirm>
  )
}
