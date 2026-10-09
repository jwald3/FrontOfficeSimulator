import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState, useRef } from 'react'
import { minimumSalary } from '../engine/contracts'
import { money } from '../engine/format'
import { simulateResignings, type SimDecision } from '../engine/autoresign'
import { canTag, futuresAvailable, table } from '../engine/resign'
import { tagAmount, tenderOptions, type TagKind, type TenderOption } from '../engine/rights'
import type { Expiring, RawMarketPlayer, RunState, Snapshot } from '../engine/types'
import { useGame } from '../game/store'
import { Confirm } from './Game'
import { PHASE_INFO, positionGroup, useHotkeys, useRevealOnPhone } from './lib'
import { NegHero, NegotiationPanel, Patience } from './NegotiationPanel'
import { DepthBadge, PlayerArt } from './parts'
import './inhouse.css'
import './resign.css'

type Tab = 'expiring' | 'rights' | 'futures'
type Pending =
  | { kind: 'advance' }
  | { kind: 'sim' }
  | { kind: 'tag'; p: Expiring; tag: TagKind; amount: number }
  | { kind: 'tender'; p: Expiring; opt: TenderOption }
  | { kind: 'walk'; p: Expiring }

const isRights = (p: Expiring) => p.type === 'RFA' || p.type === 'ERFA'

export function ReSign() {
  const run = useGame((s) => s.run!)
  const snap = useGame((s) => s.snap!)
  const outcomeOpen = useGame((s) => !!s.outcome)
  const genuine = run.mode === 'genuine'
  const [tab, setTab] = useState<Tab>('expiring')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  useRevealOnPhone(panelRef, selectedId)
  const [pending, setPending] = useState<Pending | null>(null)
  const act = useGame()

  // Simplified mode has no tenders: restricted players negotiate like anyone else.
  const expiring = run.expiring.filter((p) => !genuine || !isRights(p))
  const rights = genuine ? run.expiring.filter(isRights) : []
  const list = tab === 'rights' ? rights : expiring
  const selected = list.find((p) => p.id === selectedId) ?? list[0]
  const unresolved = run.expiring.filter((p) => p.status === 'open').length

  const confirm = () => {
    if (!pending) return
    if (pending.kind === 'advance') act.advancePhase()
    else if (pending.kind === 'sim') act.simResign()
    else if (pending.kind === 'tag') act.tag(pending.p.id, pending.tag)
    else if (pending.kind === 'tender') act.tender(pending.p.id, pending.opt.level)
    else act.letWalk(pending.p.id)
    setPending(null)
  }

  const idx = selected ? list.indexOf(selected) : -1
  useHotkeys(
    {
      arrowdown: () => list[idx + 1] && setSelectedId(list[idx + 1].id),
      arrowup: () => list[idx - 1] && setSelectedId(list[idx - 1].id),
    },
    !pending && !outcomeOpen && tab !== 'futures',
  )

  return (
    <div className={`inhouse resign ${tab === 'futures' ? 'resign-wide' : ''}`}>
      <section className="board">
        <header className="board-head">
          <div>
            <div className="eyebrow">{PHASE_INFO['re-sign'].n} / {PHASE_INFO['re-sign'].name}</div>
            <h1 className="display board-title">{PHASE_INFO['re-sign'].tagline}</h1>
          </div>
          <div className="board-head-actions">
            <button className="btn ghost" disabled={unresolved === 0} onClick={() => setPending({ kind: 'sim' })}>
              Simulate re-signings
            </button>
            <button className="btn" onClick={() => setPending({ kind: 'advance' })}>
              Continue to Free Agency →
            </button>
          </div>
        </header>

        <div className="board-tools">
          <div className="seg" role="tablist" aria-label="Group">
            <TabBtn on={tab === 'expiring'} onClick={() => setTab('expiring')} label="Expiring" count={expiring.length} />
            {genuine && <TabBtn on={tab === 'rights'} onClick={() => setTab('rights')} label="RFA / ERFA" count={rights.length} />}
            {genuine && <TabBtn on={tab === 'futures'} onClick={() => setTab('futures')} label="Futures" />}
          </div>
          <span className="muted resign-count">{unresolved} decision{unresolved === 1 ? '' : 's'} open</span>
        </div>

        {tab === 'futures' ? (
          <FuturesBoard run={run} snap={snap} />
        ) : (
          <ol className="rows scroll">
            {list.map((p) => (
              <ExpiringRow key={p.id} p={p} run={run} snap={snap} active={p.id === selected?.id} onSelect={() => setSelectedId(p.id)} />
            ))}
          </ol>
        )}
      </section>

      {tab !== 'futures' && (
        <aside className="side" ref={panelRef}>
          <AnimatePresence mode="wait">
            {selected && (
              <motion.div
                key={selected.id}
                className="card negcard"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.2, 0.9, 0.1, 1] }}
              >
                <NegHero p={selected} table={table(run, snap, selected)} sub={selected.type === 'Void' ? 'Void year' : selected.type} />
                {selected.status === 'open' ? (
                  <>
                    {genuine && isRights(selected) && (
                      <TenderPicker p={selected} snap={snap} onPick={(opt) => setPending({ kind: 'tender', p: selected, opt })} />
                    )}
                    {selected.type !== 'ERFA' && (
                      <ResignNegotiation
                        p={selected}
                        run={run}
                        snap={snap}
                        locked={!!pending || outcomeOpen}
                        onTag={(tag, amount) => setPending({ kind: 'tag', p: selected, tag, amount })}
                      />
                    )}
                    <button className="btn ghost walk" onClick={() => setPending({ kind: 'walk', p: selected })}>
                      {isRights(selected) && genuine ? "Don't tender" : 'Let him walk'}
                    </button>
                  </>
                ) : (
                  <Resolved p={selected} run={run} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      )}

      <AnimatePresence>
        {pending && <PendingDialog key="dlg" pending={pending} run={run} snap={snap} onConfirm={confirm} onCancel={() => setPending(null)} />}
      </AnimatePresence>
    </div>
  )
}

function TabBtn({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button role="tab" aria-selected={on} className="seg-btn" onClick={onClick}>
      {label}
      {count != null && <span className="seg-count num">{count}</span>}
    </button>
  )
}

// ─── List ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<Expiring['status'], string> = {
  open: 'Open',
  signed: 'Signed',
  tagged: 'Tagged',
  tendered: 'Tendered',
  walked: 'Talks over',
  declined: 'Moving on',
}

function ExpiringRow({ p, run, snap, active, onSelect }: { p: Expiring; run: RunState; snap: Snapshot; active: boolean; onSelect: () => void }) {
  const { ask } = table(run, snap, p)
  return (
    <li>
      <button className="row xrow sheen" data-active={active} data-status={p.status} onClick={onSelect}>
        <PlayerArt id={p.id} name={p.name} pos={p.pos} size={42} />
        <span className="row-name">
          <strong>{p.name}</strong>
          <span className="row-meta">
            {p.pos} · {p.age} yrs <span className={`flag flag-${p.type.toLowerCase()}`}>{p.type}</span>
          </span>
        </span>
        <DepthBadge chart={p.chart} size="sm" />
        <span className="num r xrow-ask">
          {money(ask.aav)}
          <small> × {ask.years}</small>
        </span>
        <span className="xrow-status" data-status={p.status}>
          {p.status === 'open' ? <Patience left={p.patience} /> : STATUS_LABEL[p.status]}
        </span>
      </button>
    </li>
  )
}

// ─── Negotiation ────────────────────────────────────────────────────────────

function ResignNegotiation({
  p,
  run,
  snap,
  locked,
  onTag,
}: {
  p: Expiring
  run: RunState
  snap: Snapshot
  locked: boolean
  onTag: (tag: TagKind, amount: number) => void
}) {
  const offer = useGame((s) => s.offer)
  const tagBlocked = canTag(run, p)
  return (
    <NegotiationPanel
      p={p}
      table={table(run, snap, p)}
      seed={run.seed}
      season={run.season}
      minBase={(y) => minimumSalary(snap, p.creditedSeasons, y)}
      lastBand={p.lastBand}
      offers={p.offers}
      locked={locked}
      onSubmit={(terms) => offer(p.id, terms)}
    >
      {run.mode === 'genuine' && p.tagEligible && (
        <div className="tags">
          {(['franchise', 'transition'] as const).map((k) => {
            const amount = tagAmount(snap, p, k)
            return (
              <button key={k} className="tagbtn" disabled={!!tagBlocked} onClick={() => onTag(k, amount)} title={tagBlocked ?? ''}>
                <span className="display">{k === 'franchise' ? 'Franchise tag' : 'Transition tag'}</span>
                <span className="num">{money(amount)}</span>
              </button>
            )
          })}
          {tagBlocked && <span className="muted tags-note">{tagBlocked}</span>}
        </div>
      )}
    </NegotiationPanel>
  )
}

function TenderPicker({ p, snap, onPick }: { p: Expiring; snap: Snapshot; onPick: (o: TenderOption) => void }) {
  const opts = tenderOptions(snap, p)
  return (
    <div className="tenders">
      <div className="eyebrow">{p.type === 'ERFA' ? 'Exclusive rights' : 'Restricted free agent'} · tender options</div>
      {opts.map((o) => (
        <button key={o.level} className="tender sheen" onClick={() => onPick(o)}>
          <span className="tender-name display">{o.name}</span>
          <span className="tender-comp muted">{o.compRound ? `Comp: their round ${o.compRound} pick` : o.level === 'erfa' ? 'Cannot negotiate elsewhere' : 'Match rights only'}</span>
          <span className="num tender-amt">{money(o.amount)}</span>
        </button>
      ))}
      {p.type !== 'ERFA' && <div className="muted tenders-or">or negotiate a longer deal below</div>}
    </div>
  )
}

function Resolved({ p, run }: { p: Expiring; run: RunState }) {
  const c = run.roster.find((x) => x.id === p.id)
  return (
    <div className="resolved" data-status={p.status}>
      <div className="display resolved-stamp">{STATUS_LABEL[p.status]}</div>
      {c ? (
        <table className="ledger">
          <thead><tr><th>Year</th><th>Base</th><th>Bonus</th><th>Cap hit</th></tr></thead>
          <tbody>
            {c.years.map((y) => (
              <tr key={y.year} data-now={y.year === run.season}>
                <td className="num">{y.year}</td>
                <td className="num">{money(y.base)}</td>
                <td className="num">{money(y.bonus)}</td>
                <td className="num strong">{money(y.base + y.bonus + y.other)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">{p.status === 'walked' ? 'Talks broke down. He heads to free agency, where other teams can bid.' : 'He heads to free agency.'}</p>
      )}
    </div>
  )
}

// ─── Futures ────────────────────────────────────────────────────────────────

const UNIT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'off', label: 'Offense' },
  { id: 'def', label: 'Defense' },
  { id: 'st', label: 'Specialists' },
] as const

function FuturesBoard({ run, snap }: { run: RunState; snap: Snapshot }) {
  const signFutures = useGame((s) => s.signFutures)
  const [unit, setUnit] = useState<(typeof UNIT_FILTERS)[number]['id']>('all')
  const [query, setQuery] = useState('')
  const signed = useMemo(() => new Set(run.roster.map((p) => p.id)), [run.roster])
  const target = 90
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return snap.depthCandidates
      .filter((c) => unit === 'all' || positionGroup(c.pos) === unit)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.pos.toLowerCase() === q || c.team.toLowerCase() === q)
      .sort((a, b) => Number(b.own) - Number(a.own) || (a.chart?.depth ?? 9) - (b.chart?.depth ?? 9) || b.marketAAV - a.marketAAV)
      .slice(0, 150)
  }, [snap, unit, query])

  return (
    <div className="futures">
      <div className="board-tools">
        <div className="seg">
          {UNIT_FILTERS.map((u) => (
            <button key={u.id} className="seg-btn" aria-selected={unit === u.id} onClick={() => setUnit(u.id)}>{u.label}</button>
          ))}
        </div>
        <input className="search" placeholder="Search name, position or team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="muted">Roster <b className="num">{run.roster.length}</b>/{target}</span>
      </div>
      <ol className="rows scroll">
        {list.map((c) => (
          <FuturesRow key={c.id} c={c} snap={snap} run={run} signed={signed.has(c.id)} onSign={() => signFutures(c.id)} />
        ))}
      </ol>
    </div>
  )
}

function FuturesRow({ c, snap, run, signed, onSign }: { c: RawMarketPlayer; snap: Snapshot; run: RunState; signed: boolean; onSign: () => void }) {
  const available = futuresAvailable(run.seed, c)
  return (
    <li>
      <div className="row frow" data-dim={!available && !signed}>
        <PlayerArt id={c.id} name={c.name} pos={c.pos} size={36} />
        <span className="row-name">
          <strong>{c.name}</strong>
          <span className="row-meta">{c.pos} · {c.age} yrs · {c.own ? <span className="flag">Our practice squad</span> : c.team}</span>
        </span>
        <DepthBadge chart={c.chart} size="sm" />
        <span className="num r">{money(minimumSalary(snap, c.creditedSeasons, run.season))}</span>
        {signed ? (
          <span className="frow-state pos display">Signed</span>
        ) : available ? (
          <button className="btn frow-btn" onClick={onSign}>Sign</button>
        ) : (
          <span className="frow-state muted">Signed elsewhere</span>
        )}
      </div>
    </li>
  )
}

// ─── Dialog copy ────────────────────────────────────────────────────────────

function PendingDialog({ pending, run, snap, onConfirm, onCancel }: { pending: Pending; run: RunState; snap: Snapshot; onConfirm: () => void; onCancel: () => void }) {
  if (pending.kind === 'sim') return <SimDialog run={run} snap={snap} onConfirm={onConfirm} onCancel={onCancel} />
  if (pending.kind === 'advance') {
    const open = run.expiring.filter((p) => p.status === 'open')
    return (
      <Confirm title="Open free agency?" confirmLabel="Open the market" onConfirm={onConfirm} onCancel={onCancel}>
        {open.length > 0 ? (
          <>
            <b>{open.length}</b> of your players are still unsigned and will become free agents: {open.slice(0, 4).map((p) => p.name).join(', ')}
            {open.length > 4 ? ` and ${open.length - 4} more` : ''}. You can still bid on them, against the rest of the league.
          </>
        ) : (
          'Every decision on your own players is made.'
        )}
      </Confirm>
    )
  }
  if (pending.kind === 'tag') {
    const { p, tag, amount } = pending
    return (
      <Confirm title={`${tag === 'franchise' ? 'Franchise' : 'Transition'} tag ${p.name}?`} confirmLabel="Apply tag" onConfirm={onConfirm} onCancel={onCancel}>
        One year at <b>{money(amount)}</b>, fully guaranteed. This uses your only tag this offseason, and players rarely love being tagged.
        {tag === 'transition' && ' Other teams can still sign him to an offer sheet that you can match.'}
      </Confirm>
    )
  }
  if (pending.kind === 'tender') {
    const { p, opt } = pending
    return (
      <Confirm title={`${opt.name}?`} confirmLabel="Tender" onConfirm={onConfirm} onCancel={onCancel}>
        Tender {p.name} a one-year, non-guaranteed <b>{money(opt.amount)}</b>.{' '}
        {opt.level === 'erfa'
          ? 'As an exclusive-rights player he can only sign with you.'
          : opt.compRound
            ? `If another team signs him to an offer sheet and you don't match, you receive their round ${opt.compRound} pick.`
            : 'You can match any offer sheet, but get nothing if you decline.'}
      </Confirm>
    )
  }
  const p = pending.p
  return (
    <Confirm title={isRights(p) && run.mode === 'genuine' ? `Don't tender ${p.name}?` : `Let ${p.name} walk?`} confirmLabel="Move on" danger onConfirm={onConfirm} onCancel={onCancel}>
      He becomes an unrestricted free agent. You could still bid on him in free agency, against everyone else.
      {p.chart?.depth === 1 && <> He's the listed starter at <b>{p.chart.slot}</b> on the current depth chart.</>}
    </Confirm>
  )
}


// ─── Simulated re-signings ──────────────────────────────────────────────────

const SIM_GROUPS: { kind: SimDecision['move']['kind']; label: string }[] = [
  { kind: 'sign', label: 'Re-sign' },
  { kind: 'tender', label: 'Tender' },
  { kind: 'let-walk', label: 'Let walk' },
]

/**
 * Preview of "Simulate re-signings" (see engine/autoresign.ts): editor calls with
 * their reasons, then the rule. Nothing is committed until the player confirms.
 */
function SimDialog({ run, snap, onConfirm, onCancel }: { run: RunState; snap: Snapshot; onConfirm: () => void; onCancel: () => void }) {
  const decisions = useMemo(() => simulateResignings(run, snap).decisions, [run, snap])
  const editorial = decisions.filter((d) => d.editorial).length
  return (
    <Confirm title="Simulate re-signings?" confirmLabel="Simulate & open free agency" onConfirm={onConfirm} onCancel={onCancel}>
      <p className="sim-intro">
        {editorial > 0 && <><b>{editorial}</b> {editorial === 1 ? 'call follows' : 'calls follow'} the editor. </>}
        {editorial < decisions.length && (
          <>
            {editorial > 0 ? 'For the rest, s' : 'S'}tarters 30 or younger re-sign at their ask while $25M of room stays free for free agency;
            rights players who play get the cheapest tender; everyone else walks.
          </>
        )}
      </p>
      <div className="sim-groups scroll">
        {SIM_GROUPS.map(({ kind, label }) => {
          const group = decisions.filter((d) => d.move.kind === kind)
          if (!group.length) return null
          return (
            <section key={kind} className="sim-group" data-kind={kind}>
              <div className="eyebrow">{label} · {group.length}</div>
              {kind === 'let-walk' ? (
                // Compact, so the whole list of departures is visible without scrolling.
                // Editorial departures keep their reason; the rest are a compact list.
                <>
                  <SimList decisions={group.filter((d) => d.editorial)} />
                  <p className="sim-walks">
                    {group.filter((d) => !d.editorial).map((d, i, rest) => (
                      <span key={d.player.id}>
                        {d.player.name} <span className="muted">{d.player.pos}, {d.player.age}</span>
                        {i < rest.length - 1 ? ' · ' : ''}
                      </span>
                    ))}
                  </p>
                </>
              ) : (
                <SimList decisions={group} detail />
              )}
            </section>
          )
        })}
      </div>
    </Confirm>
  )
}

function SimList({ decisions, detail }: { decisions: SimDecision[]; detail?: boolean }) {
  if (!decisions.length) return null
  return (
    <ul>
      {decisions.map((d) => (
        <li key={d.player.id}>
          <b>{d.player.name}</b> <span className="muted">{d.player.pos}, {d.player.age}</span>
          {d.editorial && <span className="flag sim-flag">Editor</span>}
          {detail && <span className="muted sim-detail">{d.move.detail}</span>}
          <span className="sim-reason">{d.reason}</span>
        </li>
      ))}
    </ul>
  )
}
