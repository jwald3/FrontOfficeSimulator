import { AnimatePresence, motion } from 'framer-motion'
import { useLayoutEffect, useMemo, useState, useRef } from 'react'
import {
  available,
  bestForUs,
  draftDone,
  draftOrder,
  onTheClock,
  tradeDownOffers,
  udfaAcceptChance,
  udfaBudgetLeft,
  UDFA_MAX_BONUS,
  counterablePicks,
  tradeablePicks,
  tradeUpAsk,
  tradeUpCallsLeft,
  tradeUpTargets,
  TRADE_UP_CALLS,
  closedPositions,
  ourNeed,
  type TradeDownOffer,
} from '../engine/draft'
import { money, pickName } from '../engine/format'
import { MAX_COUNTERS, pickLabel, pickValue, teamNickname } from '../engine/trades'
import { PickChooser } from './PickChooser'
import { Patience, ReadMeter } from './NegotiationPanel'
import type { RawPick, RawProspect, RunState, Snapshot } from '../engine/types'
import { useGame } from '../game/store'
import { Confirm } from './Game'
import { PHASE_INFO, positionGroup, useHotkeys, useRevealOnPhone } from './lib'
import { MovesLog } from './MovesLog'
import { Key, PlayerArt, RankBadge } from './parts'
import './inhouse.css'
import './draft.css'

type Unit = 'all' | 'off' | 'def' | 'st'
const UNITS: { id: Unit; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'off', label: 'Offense' },
  { id: 'def', label: 'Defense' },
  { id: 'st', label: 'Specialists' },
]

export function Draft() {
  const run = useGame((s) => s.run!)
  const snap = useGame((s) => s.snap!)
  const [pending, setPending] = useState<'advance' | null>(null)
  const advance = useGame((s) => s.advancePhase)
  const done = draftDone(run)
  const [udfaTab, setUdfaTab] = useState(false)

  return (
    <div className="draft">
      <header className="board-head">
        <div>
          <div className="eyebrow">{PHASE_INFO.draft.n} / {PHASE_INFO.draft.name}</div>
          <h1 className="display board-title">{draftHeadline(run, snap)}</h1>
        </div>
        {done && run.mode === 'genuine' && (
          <div className="seg">
            <button className="seg-btn" aria-selected={!udfaTab} onClick={() => setUdfaTab(false)}>Your class</button>
            <button className="seg-btn" aria-selected={udfaTab} onClick={() => setUdfaTab(true)}>Undrafted free agents</button>
          </div>
        )}
        <button className="btn" disabled={!done} onClick={() => setPending('advance')}>Continue to Your Offseason →</button>
      </header>

      {!done && <OrderStrip run={run} />}

      {done ? (udfaTab ? <UdfaBoard run={run} snap={snap} /> : <ClassRecap run={run} snap={snap} />) : <WarRoom run={run} snap={snap} />}

      <AnimatePresence>
        {pending && (
          <Confirm title="Wrap up the offseason?" confirmLabel="See the verdict" onConfirm={() => { advance(); setPending(null) }} onCancel={() => setPending(null)}>
            Your roster is set. Next: the grade for your offseason, measured against your objective.
          </Confirm>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The headline follows the draft: our pick on the clock, the player we just took,
 * or whichever team is picking now.
 */
function draftHeadline(run: RunState, snap: Snapshot): string {
  if (draftDone(run)) return 'The class is in.'
  const order = draftOrder(run)
  const cursor = run.draft?.cursor ?? 0
  const now = order[cursor]
  if (!now || now.owner === run.team) return PHASE_INFO.draft.tagline
  const last = order[cursor - 1]
  const taken = last?.owner === run.team && snap.prospects.find((p) => p.id === run.draft?.selections[last.id])
  if (taken) return `${taken.name} joins the ${run.teamName}.`
  return `The ${snap.teams.find((t) => t.id === now.owner)?.fullName.split(' ').pop() ?? now.owner} are on the clock.`
}

// ─── Draft order strip ──────────────────────────────────────────────────────

/** The narrowest a strip pick gets: its 70px minimum plus the 4px gap. */
const STRIP_PICK_WIDTH = 74

function OrderStrip({ run }: { run: RunState }) {
  const order = draftOrder(run)
  const cursor = run.draft?.cursor ?? 0
  // As many picks as fill the strip's width, plus a couple to run out under the fade.
  const strip = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(16)
  useLayoutEffect(() => {
    const el = strip.current
    if (!el) return
    const measure = () => setFits(Math.ceil(el.clientWidth / STRIP_PICK_WIDTH) + 2)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const start = Math.max(0, cursor - 2)
  const slice = order.slice(start, start + fits)
  return (
    <div className="strip" ref={strip}>
      {slice.map((p) => {
        const state = order.indexOf(p) < cursor ? 'done' : order.indexOf(p) === cursor ? 'now' : 'next'
        return (
          <motion.div layout key={p.id} className="strip-pick" data-state={state} data-ours={p.owner === run.team}>
            <span className="num strip-n">{p.overall}</span>
            <span className="display strip-team">{p.owner}</span>
            <span className="strip-r">R{p.round}{p.compensatory ? 'c' : ''}</span>
          </motion.div>
        )
      })}
    </div>
  )
}

// ─── War room ───────────────────────────────────────────────────────────────

function WarRoom({ run, snap }: { run: RunState; snap: Snapshot }) {
  const act = useGame()
  const outcomeOpen = useGame((s) => !!s.outcome)
  const [unit, setUnit] = useState<Unit>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [side, setSide] = useState<'feed' | 'ours' | 'moves'>('feed')
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [tradingUp, setTradingUp] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  useRevealOnPhone(panelRef, selectedId)
  const [confirmPick, setConfirmPick] = useState<RawProspect | null>(null)
  const pick = onTheClock(run)
  const ours = pick?.owner === run.team

  const board = useMemo(() => {
    const q = query.trim().toLowerCase()
    return available(run, snap)
      .filter((p) => unit === 'all' || positionGroup(p.pos) === unit)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.pos.toLowerCase() === q || p.school.toLowerCase().includes(q))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 120)
  }, [run, snap, unit, query])

  const suggestion = ours ? bestForUs(run, snap) : undefined
  const closed = useMemo(() => closedPositions(run, snap), [run, snap])
  const selected = board.find((p) => p.id === selectedId) ?? suggestion ?? board[0]
  const nextOurs = draftOrder(run).slice(run.draft?.cursor ?? 0).find((p) => p.owner === run.team)
  const offers = ours ? tradeDownOffers(run, snap) : []

  const idx = selected ? board.indexOf(selected) : -1
  useHotkeys(
    {
      arrowdown: () => board[idx + 1] && setSelectedId(board[idx + 1].id),
      arrowup: () => board[idx - 1] && setSelectedId(board[idx - 1].id),
      enter: () => (ours ? selected && setConfirmPick(selected) : act.simDraft()),
      n: () => !ours && act.simNextPick(),
    },
    !confirmPick && !outcomeOpen && !phoneOpen && !tradingUp,
  )

  return (
    <div className="warroom">
      <section className="board">
        <div className="board-tools">
          <div className="seg">
            {UNITS.map((u) => (
              <button key={u.id} className="seg-btn" aria-selected={unit === u.id} onClick={() => setUnit(u.id)}>{u.label}</button>
            ))}
          </div>
          <input className="search" placeholder="Search prospects, positions or schools…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="rows-head brow">
          <span className="r">Rank</span>
          <span />
          <span>Prospect</span>
          <span>Proj.</span>
          <span>Fit</span>
        </div>
        <ol className="rows scroll">
          {board.map((p) => {
            const need = ourNeed(run, snap, p.pos)
            const filled = closed.has(p.pos)
            return (
              <li key={p.id}>
                <button className="row brow sheen" data-active={p.id === selected?.id} onClick={() => setSelectedId(p.id)}>
                  <span className="num r brow-rank">{p.rank}</span>
                  <PlayerArt id={p.id} name={p.name} pos={p.pos} size={34} />
                  <span className="row-name">
                    <strong>{p.name}</strong>
                    <span className="row-meta">{p.pos} · {p.school}</span>
                  </span>
                  <span className="proj-round muted">Proj. Rd {Math.min(7, Math.ceil(p.rank / 32))}</span>
                  <span className="fit" data-fit={filled ? 'filled' : need >= 1 ? 'high' : need >= 0.5 ? 'mid' : 'low'}>
                    {filled ? 'Filled' : need >= 1 ? 'Need' : need >= 0.5 ? 'Depth' : '—'}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>

      <aside className="clockside" ref={panelRef}>
        {ours && pick ? (
          <motion.div className="otc" initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <div className="otc-banner display">
              <span>On the clock</span>
              <span className="num">{pickName(pick)}</span>
            </div>
            {selected && (
              <div className="prospect">
                <div className="prospect-hero">
                  <PlayerArt id={selected.id} name={selected.name} pos={selected.pos} size={96} />
                  <div>
                    <div className="eyebrow">{selected.pos} · {selected.school}</div>
                    <div className="display prospect-name">{selected.name}</div>
                    <div className="muted">
                      Board rank #{selected.rank} ·{' '}
                      {selected.consensusRank && selected.consensusRank !== selected.rank ? `${selected.sourceLabel} #${selected.consensusRank}` : selected.sourceLabel}
                    </div>
                  </div>
                  <RankBadge rank={selected.rank} />
                </div>
                {selected.note && <p className="prospect-note">{selected.note}</p>}
                {suggestion && suggestion.id !== selected.id && (
                  <button className="hint" onClick={() => setSelectedId(suggestion.id)}>
                    Scouts like <b>{suggestion.name}</b> ({suggestion.pos}) here
                  </button>
                )}
                <button className="btn draftbtn" onClick={() => setConfirmPick(selected)}>
                  Draft {selected.name.split(' ').slice(-1)[0]} <Key>ENTER</Key>
                </button>
              </div>
            )}
            {offers.length > 0 && (
              <button className="phone-btn" onClick={() => setPhoneOpen(true)}>
                <span className="phone-icon" aria-hidden>
                  <svg viewBox="0 0 24 24"><path d={PHONE_PATH} /></svg>
                </span>
                <span className="phone-text">
                  <b className="display">The phone is ringing</b>
                  <span className="muted">
                    {offers.length} {offers.length === 1 ? 'team wants' : 'teams want'} to move up to {pickName(pick)}
                  </span>
                </span>
                <span className="phone-open">View offers</span>
              </button>
            )}
          </motion.div>
        ) : (
          <div className="waiting">
            <div className="eyebrow">{pick ? `${pickName(pick)} · ${pick.owner} on the clock` : 'Draft complete'}</div>
            <div className="display waiting-title">{nextOurs ? `Next up: ${pickName(nextOurs)}` : 'No more picks'}</div>
            <div className="waiting-actions">
              <button className="btn" onClick={act.simDraft}>{nextOurs ? 'Sim to our pick' : 'Sim to the end'} <Key>ENTER</Key></button>
              <button className="btn ghost" onClick={act.simNextPick}>Next pick <Key>N</Key></button>
              {tradeUpTargets(run).length > 0 && (
                <button className="btn ghost" onClick={() => setTradingUp(true)}>Trade up</button>
              )}
            </div>
          </div>
        )}
        <div className="side-tabs" role="tablist">
          <button role="tab" aria-selected={side === 'feed'} onClick={() => setSide('feed')}>Pick feed</button>
          <button role="tab" aria-selected={side === 'ours'} onClick={() => setSide('ours')}>
            Your picks <span className="num">{draftOrder(run).filter((p) => p.owner === run.team).length}</span>
          </button>
          <button role="tab" aria-selected={side === 'moves'} onClick={() => setSide('moves')}>
            Your moves <span className="num">{run.moves.length}</span>
          </button>
        </div>
        {side === 'feed' ? <Feed run={run} snap={snap} /> : side === 'ours' ? <OurPicks run={run} snap={snap} /> : <MovesLog run={run} />}
      </aside>

      <AnimatePresence>
        {tradingUp && <TradeUp key="up" run={run} snap={snap} onClose={() => setTradingUp(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {phoneOpen && ours && pick && offers.length > 0 && (
          <PhoneOffers
            key="phone"
            run={run}
            snap={snap}
            pick={pick}
            offers={offers}
            onTradeDown={(id) => {
              act.tradeDown(id)
              setPhoneOpen(false)
            }}
            onClose={() => setPhoneOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmPick && pick && (
          <Confirm
            title={`Select ${confirmPick.name}?`}
            confirmLabel="Turn in the card"
            onConfirm={() => {
              act.draftPlayer(confirmPick.id)
              setConfirmPick(null)
              setSelectedId(null)
            }}
            onCancel={() => setConfirmPick(null)}
          >
            {confirmPick.pos}, {confirmPick.school}, with {pickName(pick)}. Board rank #{confirmPick.rank}.
          </Confirm>
        )}
      </AnimatePresence>
    </div>
  )
}

function Feed({ run, snap }: { run: RunState; snap: Snapshot }) {
  const order = draftOrder(run)
  const recent = order
    .slice(0, run.draft?.cursor ?? 0)
    .slice(-14)
    .reverse()
  return (
    <ol className="feed scroll">
      <AnimatePresence initial={false}>
        {recent.map((pk, i) => {
          const p = snap.prospects.find((x) => x.id === run.draft!.selections[pk.id])!
          return (
            <motion.li
              key={pk.id}
              className="feed-item"
              data-ours={pk.owner === run.team}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.04 }}
            >
              <span className="num feed-n">{pk.overall}</span>
              <span className="display feed-team">{pk.owner}</span>
              <span className="feed-name">{p.name}</span>
              <span className="muted feed-pos">{p.pos}</span>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ol>
  )
}

const PHONE_PATH =
  'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z'

/** Teams calling to move up into our pick: what each offers, against what our pick is worth. */
function PhoneOffers({
  run,
  snap,
  pick,
  offers,
  onTradeDown,
  onClose,
}: {
  run: RunState
  snap: Snapshot
  pick: RawPick
  offers: TradeDownOffer[]
  onTradeDown: (id: string) => void
  onClose: () => void
}) {
  useHotkeys({ escape: onClose })
  const counter = useGame((s) => s.counterTradeDown)
  const [countering, setCountering] = useState<string | null>(null)
  const [ask, setAsk] = useState<string[]>([])
  const [reply, setReply] = useState<string | null>(null)
  const ours = pickValue(snap, pick, run.season)
  return (
    <motion.div className="confirm-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="confirm phone-dialog slab"
        role="dialog"
        aria-modal
        aria-label="Trade-down offers"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.2, 0.9, 0.1, 1] }}
      >
        <div className="eyebrow phone-eyebrow">The phone is ringing · {pickName(pick)} ({ours.toLocaleString()} pts)</div>
        <div className="display confirm-title">Move down?</div>
        <div className="downs">
          {offers.map((o) => {
            const picks = run.picks.filter((p) => o.pickIds.includes(p.id))
            const gain = o.value - ours
            return (
              <div key={o.id} className="down">
                <div>
                  <div className="display down-team">{snap.teams.find((t) => t.id === o.team)?.fullName ?? o.team} want to move up</div>
                  <div className="down-picks">{picks.map((p) => <span key={p.id} className="chip">{pickLabel(p)}</span>)}</div>
                  <div className="muted down-val">
                    {o.value.toLocaleString()} pts for our {ours.toLocaleString()} ·{' '}
                    <span className={gain >= 0 ? 'pos' : 'neg'}>{gain >= 0 ? '+' : ''}{gain.toLocaleString()}</span>
                  </div>
                </div>
                <div className="down-buttons">
                  <button className="btn" onClick={() => onTradeDown(o.id)}>Trade down</button>
                  <button
                    className="btn ghost"
                    disabled={(run.counters?.[o.id] ?? 0) >= MAX_COUNTERS}
                    onClick={() => {
                      setCountering(o.id)
                      setAsk(o.pickIds)
                      setReply(null)
                    }}
                  >
                    Counter
                  </button>
                </div>
                {countering === o.id && (
                  <div className="counter-panel down-counter">
                    <div className="eyebrow">Counter · ask the {snap.teams.find((t) => t.id === o.team)?.name ?? o.team} for these picks</div>
                    <PickChooser
                      run={run}
                      snap={snap}
                      picks={counterablePicks(run, o)}
                      selected={ask}
                      onChange={setAsk}
                      totalLabel="You ask for"
                      against={{ label: `our ${pickName(pick)}`, value: ours }}
                    />
                    <div className="counter-actions">
                      <span className="muted">{MAX_COUNTERS - (run.counters?.[o.id] ?? 0)} left</span>
                      <button className="btn ghost" onClick={() => setCountering(null)}>Cancel</button>
                      <button
                        className="btn"
                        disabled={!ask.length}
                        onClick={() => {
                          const res = counter(o.id, ask)
                          if (!res) return
                          setReply(res.reply)
                          if (res.done) setCountering(null)
                        }}
                      >
                        Send counter
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {reply && <p className="review-reply" role="status">{reply}</p>}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onClose}><Key>ESC</Key> Stay put</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/**
 * Call a team about moving up to its pick, anywhere before our next one. Teams
 * want a premium to move down; three calls about a pick before they stop answering.
 */
function TradeUp({ run, snap, onClose }: { run: RunState; snap: Snapshot; onClose: () => void }) {
  useHotkeys({ escape: onClose })
  const tradeUp = useGame((s) => s.tradeUp)
  const targets = tradeUpTargets(run)
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '')
  const [offer, setOffer] = useState<string[]>([])
  const [reply, setReply] = useState<string | null>(null)
  // Their counter: our offer plus what it would take, ready to accept.
  const [counter, setCounter] = useState<string[] | null>(null)
  const target = targets.find((p) => p.id === targetId)
  const callsLeft = target ? tradeUpCallsLeft(run, target) : 0
  const offered = run.picks.filter((p) => offer.includes(p.id)).reduce((a, p) => a + pickValue(snap, p, run.season), 0)
  const call = (ids: string[]) => {
    const res = tradeUp(targetId, ids)
    if (!res) return onClose()
    setReply(res.reply)
    setCounter(res.counter ?? null)
  }
  const teamName = (id: string) => teamNickname(snap, id)

  return (
    <motion.div className="confirm-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="confirm phone-dialog slab"
        role="dialog"
        aria-modal
        aria-label="Trade up"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.2, 0.9, 0.1, 1] }}
      >
        <div className="eyebrow phone-eyebrow">Trade up · teams want a premium to move down</div>
        <div className="display confirm-title">Move up?</div>
        <label className="tradeup-target">
          <span className="eyebrow">Their pick</span>
          <select className="ed-select" value={targetId} onChange={(e) => { setTargetId(e.target.value); setReply(null); setCounter(null) }}>
            {targets.map((p) => (
              <option key={p.id} value={p.id}>
                {pickName(p)} · {teamName(p.owner)} · {pickValue(snap, p, run.season).toLocaleString()} pts
              </option>
            ))}
          </select>
        </label>
        <div className="eyebrow">Your offer</div>
        <PickChooser
          run={run}
          snap={snap}
          picks={tradeablePicks(run, run.team)}
          selected={offer}
          onChange={(ids) => {
            setOffer(ids)
            setCounter(null)
          }}
          totalLabel="You offer"
          against={target ? { label: `${pickName(target)}`, value: pickValue(snap, target, run.season) } : undefined}
        />
        {target && (
          <div className="tradeup-gauges">
            <ReadMeter ask={tradeUpAsk(run, snap, target)} offered={offered} />
            <div className="tradeup-patience">
              <span className="eyebrow">Patience</span>
              <Patience left={callsLeft} of={TRADE_UP_CALLS} />
              <span className="muted">{callsLeft ? `${callsLeft} ${callsLeft === 1 ? 'call' : 'calls'} left with the ${teamName(target.owner)}` : `The ${teamName(target.owner)} have stopped answering`}</span>
            </div>
          </div>
        )}
        {reply && <p className="review-reply" role="status">{reply}</p>}
        {counter && target && (
          <div className="counter-panel tradeup-counter">
            <div className="eyebrow">Their counter · {pickName(target)} for</div>
            <div className="down-picks">
              {run.picks
                .filter((p) => counter.includes(p.id))
                .map((p) => (
                  <span key={p.id} className="chip" data-new={!offer.includes(p.id)}>{pickLabel(p)}</span>
                ))}
            </div>
            <div className="counter-actions">
              <span className="muted">
                {run.picks.filter((p) => counter.includes(p.id)).reduce((a, p) => a + pickValue(snap, p, run.season), 0).toLocaleString()} pts
              </span>
              <button className="btn" onClick={() => call(counter)}>Accept their counter</button>
            </div>
          </div>
        )}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onClose}><Key>ESC</Key> Close</button>
          <button className="btn" disabled={!target || !offer.length || callsLeft === 0} onClick={() => call(offer)}>
            Make the call
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/** Every pick we hold in this draft: who we took, who's on the clock, and how far off the rest are. */
function OurPicks({ run, snap }: { run: RunState; snap: Snapshot }) {
  const order = draftOrder(run)
  const cursor = run.draft?.cursor ?? 0
  const ours = order.filter((p) => p.owner === run.team)
  return (
    <ol className="feed ourpicks scroll">
      {ours.map((pk) => {
        const at = order.indexOf(pk)
        const state = at < cursor ? 'done' : at === cursor ? 'now' : 'next'
        const p = snap.prospects.find((x) => x.id === run.draft?.selections[pk.id])
        return (
          <li key={pk.id} className="feed-item ourpick" data-state={state}>
            <span className="num ourpick-pick">{pickName(pk)}</span>
            {p ? (
              <span className="ourpick-who">
                <span className="feed-name">{p.name}</span>
                <span className="muted feed-pos">{p.pos} · {p.school}</span>
              </span>
            ) : (
              <span className="muted ourpick-who">
                {state === 'now' ? 'On the clock' : `${at - cursor} pick${at - cursor === 1 ? '' : 's'} away`}
                {pk.originalTeam !== run.team ? ` · from ${pk.originalTeam}` : ''}
              </span>
            )}
          </li>
        )
      })}
      {ours.length === 0 && <li className="muted ourpick-none">We hold no picks in this draft.</li>}
    </ol>
  )
}

// ─── After the draft ────────────────────────────────────────────────────────

function ClassRecap({ run, snap }: { run: RunState; snap: Snapshot }) {
  const ours = draftOrder(run).filter((p) => p.owner === run.team)
  return (
    <div className="recap">
      {ours.length === 0 && <p className="muted">You traded out of this draft entirely.</p>}
      {ours.map((pk, i) => {
        const p = snap.prospects.find((x) => x.id === run.draft!.selections[pk.id])!
        const value = pk.overall! - p.rank
        return (
          <motion.article
            key={pk.id}
            className="classcard slab"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: i * 0.06 }}
          >
            <span className="num classcard-pick">{pickName(pk)}</span>
            <PlayerArt id={p.id} name={p.name} pos={p.pos} size={72} />
            <div className="classcard-body">
              <div className="display classcard-name">{p.name}</div>
              <div className="muted">{p.pos} · {p.school} · board #{p.rank}</div>
              <div className={`classcard-value ${value > 10 ? 'pos' : value < -10 ? 'neg' : ''}`}>
                {value > 10 ? `Value: ${value} spots of slide` : value < -10 ? `Reach: ${-value} spots early` : 'Right on the board'}
              </div>
            </div>
            <RankBadge rank={p.rank} />
          </motion.article>
        )
      })}
    </div>
  )
}

function UdfaBoard({ run, snap }: { run: RunState; snap: Snapshot }) {
  const sign = useGame((s) => s.signUdfa)
  const [bonus, setBonus] = useState(25_000)
  const left = udfaBudgetLeft(run, snap)
  const signed = run.draft?.udfa ?? {}
  const pool = useMemo(() => {
    const signedIds = Object.keys(run.draft?.udfa ?? {})
    const signedPlayers = snap.prospects.filter((p) => signedIds.includes(p.id))
    return [...signedPlayers, ...available(run, snap).sort((a, b) => a.rank - b.rank).slice(0, 100)]
  }, [run, snap])

  return (
    <div className="udfa">
      <div className="board-tools">
        <span className="muted">Bonus pool left <b className="num">{money(left)}</b> of {money(snap.salaryRules.udfaBonusPool)}</span>
        <label className="udfa-bonus">
          <span>Bonus offer</span>
          <input type="range" min={0} max={UDFA_MAX_BONUS} step={5_000} value={bonus} onChange={(e) => setBonus(Number(e.target.value))} />
          <b className="num">{money(bonus)}</b>
        </label>
        <span className="muted">Roster <b className="num">{run.roster.length}</b>/90</span>
      </div>
      <ol className="rows scroll">
        {pool.map((p) => {
          const isSigned = signed[p.id] != null
          const refused = !!run.udfaTries?.[p.id]
          const chance = udfaAcceptChance(p, bonus)
          return (
            <li key={p.id}>
              <div className="row urow" data-dim={refused}>
                <span className="num r brow-rank">{p.rank}</span>
                <PlayerArt id={p.id} name={p.name} pos={p.pos} size={34} />
                <span className="row-name">
                  <strong>{p.name}</strong>
                  <span className="row-meta">{p.pos} · {p.school}</span>
                </span>
                <span className="muted">{isSigned ? '' : refused ? '' : chance > 0.7 ? 'Likely' : chance > 0.4 ? 'Maybe' : 'Long shot'}</span>
                {isSigned ? (
                  <span className="pos display urow-state">Signed · {money(signed[p.id])}</span>
                ) : refused ? (
                  <span className="muted urow-state">Signed elsewhere</span>
                ) : (
                  <button className="btn frow-btn" disabled={bonus > left} onClick={() => sign(p.id, bonus)}>Offer</button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
