import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState, useRef } from 'react'
import { capSummary, releaseSavings, seasonCapHit, yearsRemaining } from '../engine/cap'
import { money, signedMoney } from '../engine/format'
import { previewRestructure } from '../engine/moves'
import { roleLabel } from '../engine/depth'
import { playerValue } from '../engine/trades'
import { isUntouchable } from '../engine/valuation'
import { simulateInHouse, suggestInHouse, type Suggestion, type SuggestionKind } from '../engine/suggest'
import type { Contract, RunState, Snapshot } from '../engine/types'
import { useGame } from '../game/store'
import { Confirm } from './Game'
import { PHASE_INFO, positionGroup, useHotkeys, useRevealOnPhone } from './lib'
import { MovesLog } from './MovesLog'
import { DepthBadge, Key, PlayerArt } from './parts'
import './inhouse.css'

type Unit = 'all' | 'off' | 'def' | 'st' | 'suggested'
type SortKey = 'name' | 'depth' | 'cap' | 'years' | 'age' | 'dead' | 'savings'
type Dir = 'asc' | 'desc'
type Action = 'release' | 'restructure' | 'block'
type Pending = { kind: Action; player: Contract } | { kind: 'advance' } | { kind: 'sim' }

const UNITS: { id: Unit; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'off', label: 'Offense' },
  { id: 'def', label: 'Defense' },
  { id: 'st', label: 'Specialists' },
  { id: 'suggested', label: 'Suggested' },
]
/**
 * Table columns, in order. Each sortable column starts in its natural direction:
 * names A–Z, starters first on depth, everything else biggest first.
 */
const COLUMNS: { key: SortKey; label: (season: number) => string; first: Dir; right?: boolean }[] = [
  { key: 'name', label: () => 'Player', first: 'asc' },
  { key: 'depth', label: () => 'Depth', first: 'asc' },
  { key: 'cap', label: (season) => `${season} cap hit`, first: 'desc', right: true },
  { key: 'years', label: () => 'Yrs', first: 'desc', right: true },
  { key: 'age', label: () => 'Age', first: 'desc', right: true },
  { key: 'dead', label: () => 'Dead if cut', first: 'desc', right: true },
  { key: 'savings', label: () => 'Cut saves', first: 'desc', right: true },
]

export function InHouse() {
  const run = useGame((s) => s.run!)
  const snap = useGame((s) => s.snap!)
  const outcomeOpen = useGame((s) => !!s.outcome)
  const actions = useGame()
  const [unit, setUnit] = useState<Unit>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'cap', dir: 'desc' })
  // Clicking the active column flips it; a new column starts in its natural direction.
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: COLUMNS.find((c) => c.key === key)!.first }))
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  useRevealOnPhone(panelRef, selectedId)
  const [pending, setPending] = useState<Pending | null>(null)
  const [panel, setPanel] = useState<'player' | 'moves'>('player')

  const suggestions = useMemo(() => suggestInHouse(run, snap), [run, snap])
  const suggestionFor = useMemo(() => new Map(suggestions.map((s) => [s.player.id, s])), [suggestions])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (p: Contract) => !q || p.name.toLowerCase().includes(q) || p.pos.toLowerCase() === q
    // Suggestions keep their own best-first order.
    if (unit === 'suggested') return suggestions.map((s) => s.player).filter(matches)
    const value: Record<Exclude<SortKey, 'name'>, (p: Contract) => number> = {
      // Unlisted players sort as the deepest depth.
      depth: (p) => p.chart?.depth ?? 9,
      cap: (p) => seasonCapHit(p, run.season),
      years: (p) => yearsRemaining(p, run.season),
      age: (p) => p.age,
      dead: (p) => p.releaseDead,
      savings: (p) => releaseSavings(p, run.season),
    }
    const ascending = (a: Contract, b: Contract) =>
      sort.key === 'name' ? a.name.localeCompare(b.name) : value[sort.key](a) - value[sort.key](b)
    return run.roster
      .filter((p) => unit === 'all' || positionGroup(p.pos) === unit)
      .filter(matches)
      // Ties fall back to the bigger cap hit.
      .sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * ascending(a, b) || value.cap(b) - value.cap(a))
  }, [run.roster, run.season, unit, sort, query, suggestions])

  const selected = list.find((p) => p.id === selectedId) ?? list[0]
  const idx = selected ? list.indexOf(selected) : -1

  const confirm = () => {
    if (!pending) return
    if (pending.kind === 'advance') actions.advancePhase()
    else if (pending.kind === 'sim') actions.simInHouse()
    else if (pending.kind === 'release') actions.release(pending.player.id)
    else if (pending.kind === 'restructure') actions.restructure(pending.player.id)
    else actions.tradeBlock(pending.player.id)
    setPending(null)
  }

  const canRestructure = selected ? previewRestructure(run, selected.id).eligible : false
  useHotkeys(
    {
      arrowdown: () => list[idx + 1] && setSelectedId(list[idx + 1].id),
      arrowup: () => list[idx - 1] && setSelectedId(list[idx - 1].id),
      r: () => selected && setPending({ kind: 'release', player: selected }),
      s: () => selected && canRestructure && setPending({ kind: 'restructure', player: selected }),
      b: () => selected && !selected.onTradeBlock && !isUntouchable(snap, selected.id) && setPending({ kind: 'block', player: selected }),
      tab: () => setPanel((p) => (p === 'player' ? 'moves' : 'player')),
    },
    !pending && !outcomeOpen,
  )

  return (
    <div className="inhouse">
      <section className="board">
        <header className="board-head">
          <div>
            <div className="eyebrow">{PHASE_INFO['in-house'].n} / {PHASE_INFO['in-house'].name}</div>
            <h1 className="display board-title">{PHASE_INFO['in-house'].tagline}</h1>
          </div>
          <div className="board-head-actions">
            <button className="btn ghost" onClick={() => setPending({ kind: 'sim' })}>
              Simulate in-house decisions
            </button>
            <button className="btn" onClick={() => setPending({ kind: 'advance' })}>
              Continue to Re-Signing →
            </button>
          </div>
        </header>

        <div className="board-tools">
          <div className="seg" role="tablist" aria-label="Unit">
            {UNITS.map((u) => (
              <button key={u.id} role="tab" aria-selected={unit === u.id} className="seg-btn" onClick={() => setUnit(u.id)}>
                {u.label}
                {u.id === 'suggested' && <span className="seg-count num">{suggestions.length}</span>}
              </button>
            ))}
          </div>
          <input
            className="search"
            placeholder="Search name or position…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search players"
          />
          <label className="sort" hidden={unit === 'suggested'}>
            <span>Sort</span>
            <select value={sort.key} onChange={(e) => sortBy(e.target.value as SortKey)}>
              {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label(run.season)}</option>)}
            </select>
          </label>
        </div>

        <div className="rows-head" hidden={unit === 'suggested'}>
          <span />
          {COLUMNS.map((c) => {
            const active = sort.key === c.key
            return (
              <button
                key={c.key}
                className={`th ${c.right ? 'r' : ''}`}
                data-active={active}
                aria-label={`Sort by ${c.label(run.season)}${active ? `, currently ${sort.dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
                onClick={() => sortBy(c.key)}
              >
                {c.label(run.season)}
                <span className="th-arrow" aria-hidden>{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
              </button>
            )
          })}
        </div>
        <ol className="rows scroll">
          {unit === 'suggested'
            ? list.map((p, i) => (
                <SuggestionRow
                  key={p.id}
                  s={suggestionFor.get(p.id)!}
                  i={i}
                  active={p.id === selected?.id}
                  onSelect={() => { setSelectedId(p.id); setPanel('player') }}
                  onAct={() => setPending({ kind: suggestionFor.get(p.id)!.kind, player: p })}
                />
              ))
            : list.map((p, i) => (
                <Row
                  key={p.id}
                  p={p}
                  season={run.season}
                  i={i}
                  active={p.id === selected?.id}
                  onSelect={() => { setSelectedId(p.id); setPanel('player') }}
                />
              ))}
          {list.length === 0 && (
            <li className="rows-empty muted">
              {unit === 'suggested' && !query.trim()
                ? 'Nothing obvious left. Every contract is earning its keep, so any move from here is a judgment call.'
                : 'No players match.'}
            </li>
          )}
        </ol>
      </section>

      <aside className="side" ref={panelRef}>
        <div className="side-tabs" role="tablist">
          <button role="tab" aria-selected={panel === 'player'} onClick={() => setPanel('player')}>Player card</button>
          <button role="tab" aria-selected={panel === 'moves'} onClick={() => setPanel('moves')}>
            Your moves <span className="num">{run.moves.length}</span>
          </button>
          <Key>TAB</Key>
        </div>
        <AnimatePresence mode="wait">
          {panel === 'player' && selected ? (
            <PlayerCard
              key={selected.id}
              run={run}
              p={selected}
              suggested={suggestionFor.get(selected.id)?.kind}
              onAction={(kind) => setPending({ kind, player: selected })}
            />
          ) : (
            <MovesLog key="moves" run={run} />
          )}
        </AnimatePresence>
      </aside>

      <AnimatePresence>
        {pending && <PendingDialog key="dlg" pending={pending} run={run} snap={snap} onConfirm={confirm} onCancel={() => setPending(null)} />}
      </AnimatePresence>
    </div>
  )
}

// ─── Contract row ───────────────────────────────────────────────────────────

function Row({ p, season, i, active, onSelect }: { p: Contract; season: number; i: number; active: boolean; onSelect: () => void }) {
  const saves = releaseSavings(p, season)
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ delay: Math.min(i, 14) * 0.02, duration: 0.3 }}
    >
      <button className="row sheen" data-active={active} onClick={onSelect}>
        <PlayerArt id={p.id} name={p.name} pos={p.pos} size={42} />
        <span className="row-name">
          <strong>{p.name}</strong>
          <span className="row-meta">
            {p.pos}<span className="meta-age"> · {p.age} yrs</span>
            {p.onTradeBlock && <span className="flag flag-block">Trade block</span>}
            {p.restructured && <span className="flag">Restructured</span>}
          </span>
        </span>
        <DepthBadge chart={p.chart} size="sm" />
        <span className="num r row-cap">{money(seasonCapHit(p, season))}</span>
        <span className="num r">{yearsRemaining(p, season)}</span>
        <span className="num r">{p.age}</span>
        <span className="num r muted">{money(p.releaseDead)}</span>
        <span className={`num r ${tone(saves)}`}>{signedMoney(saves)}</span>
      </button>
    </motion.li>
  )
}

// ─── Suggestion row ─────────────────────────────────────────────────────────

const ACTION_LABEL: Record<SuggestionKind, string> = { release: 'Release', restructure: 'Restructure', block: 'Trade block' }

function SuggestionRow({ s, i, active, onSelect, onAct }: { s: Suggestion; i: number; active: boolean; onSelect: () => void; onAct: () => void }) {
  const p = s.player
  return (
    <motion.li
      layout
      className="srow-item"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ delay: Math.min(i, 14) * 0.03, duration: 0.3 }}
    >
      <button className="row srow sheen" data-active={active} onClick={onSelect}>
        <PlayerArt id={p.id} name={p.name} pos={p.pos} size={42} />
        <span className="row-name">
          <strong>{p.name}</strong>
          <span className="row-meta">
            {p.pos} · {p.age} yrs
            <span className="flag" data-kind={s.kind}>{ACTION_LABEL[s.kind]}</span>
            {s.editorial && <span className="flag srow-editor">Editor</span>}
          </span>
          <span className="srow-reason">{s.reason}</span>
        </span>
        <DepthBadge chart={p.chart} size="sm" />
      </button>
      <button className="btn srow-act" data-kind={s.kind} onClick={onAct}>
        {ACTION_LABEL[s.kind]}
      </button>
    </motion.li>
  )
}

// ─── Player card ────────────────────────────────────────────────────────────

function PlayerCard({ run, p, suggested, onAction }: { run: RunState; p: Contract; suggested?: SuggestionKind; onAction: (k: Action) => void }) {
  const snap = useGame((s) => s.snap!)
  const untouchable = isUntouchable(snap, p.id)
  const saves = releaseSavings(p, run.season)
  const rs = previewRestructure(run, p.id)
  const years = p.years.filter((y) => y.year >= run.season)
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.28, ease: [0.2, 0.9, 0.1, 1] }}
    >
      <div className="card-hero">
        <PlayerArt id={p.id} name={p.name} pos={p.pos} size={112} />
        <div className="card-id">
          <div className="eyebrow">{p.pos} · Age {p.age} · {p.experience} yr exp</div>
          <div className="display card-name">{p.name}</div>
          <div className="card-role muted">{roleLabel(p)}{p.chart && p.chart.team !== p.team ? ` (${p.chart.team})` : ''}</div>
        </div>
        <DepthBadge chart={p.chart} size="lg" />
      </div>

      <table className="ledger">
        <thead>
          <tr><th>Year</th><th>Base</th><th>Bonus</th><th>Other</th><th>Cap hit</th></tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year} data-now={y.year === run.season}>
              <td className="num">{y.year}</td>
              <td className="num">{money(y.base)}</td>
              <td className="num">{money(y.bonus)}</td>
              <td className="num">{money(y.other)}</td>
              <td className="num strong">{money(y.base + y.bonus + y.other)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="acts">
        <button className="act sheen" data-suggested={suggested === 'release'} onClick={() => onAction('release')}>
          <span className="act-top"><span className="display">Release</span><Key>R</Key></span>
          <span className={`act-val num ${tone(saves)}`}>{signedMoney(saves)}</span>
          <span className="act-sub">{money(p.releaseDead)} dead money</span>
        </button>
        <button className="act sheen" data-suggested={suggested === 'restructure'} disabled={!rs.eligible} onClick={() => onAction('restructure')}>
          <span className="act-top"><span className="display">Restructure</span><Key>S</Key></span>
          <span className="act-val num pos">{rs.eligible ? signedMoney(rs.savings) : '—'}</span>
          <span className="act-sub">
            {rs.eligible ? `Converts ${money(rs.converted)} into a bonus over ${rs.prorationYears} years` : rs.reason}
          </span>
        </button>
        <button className="act sheen" data-suggested={suggested === 'block'} disabled={p.onTradeBlock || untouchable} onClick={() => onAction('block')}>
          <span className="act-top"><span className="display">Trade block</span><Key>B</Key></span>
          <span className="act-val num">{playerValue(p, snap)} pts</span>
          <span className="act-sub">{untouchable ? 'Untouchable: not for trade' : p.onTradeBlock ? 'Listed · offers arrive in the inbox' : `${money(p.tradeDead)} dead if traded`}</span>
        </button>
      </div>
    </motion.div>
  )
}

// ─── Confirmation copy ──────────────────────────────────────────────────────

function PendingDialog({ pending, run, snap, onConfirm, onCancel }: { pending: Pending; run: RunState; snap: Snapshot; onConfirm: () => void; onCancel: () => void }) {
  if (pending.kind === 'sim') return <SimDialog run={run} snap={snap} onConfirm={onConfirm} onCancel={onCancel} />
  if (pending.kind === 'advance') {
    return (
      <Confirm title="Advance to Re-Signing?" confirmLabel="Advance" onConfirm={onConfirm} onCancel={onCancel}>
        Releases and restructures lock once you move on. Offers for players on the trade block arrive in the free agency inbox.
      </Confirm>
    )
  }
  const p = pending.player
  if (pending.kind === 'release') {
    const saves = releaseSavings(p, run.season)
    return (
      <Confirm title={`Release ${p.name}?`} confirmLabel="Release" danger onConfirm={onConfirm} onCancel={onCancel}>
        Pre-June 1 release. Clears <b className="pos">{money(seasonCapHit(p, run.season))}</b> and accelerates{' '}
        <b className="neg">{money(p.releaseDead)}</b> in dead money, for a net <b>{signedMoney(saves)}</b> in {run.season} space.
      </Confirm>
    )
  }
  if (pending.kind === 'restructure') {
    const rs = previewRestructure(run, p.id)
    return (
      <Confirm title={`Restructure ${p.name}?`} confirmLabel="Make the call" onConfirm={onConfirm} onCancel={onCancel}>
        Convert <b>{money(rs.converted)}</b> of base salary into a bonus prorated over {rs.prorationYears} years, saving{' '}
        <b className="pos">{money(rs.savings)}</b> this season. His cash is unchanged; later years carry the
        proration, and the converted money becomes dead money if he's cut.
      </Confirm>
    )
  }
  return (
    <Confirm title={`Shop ${p.name}?`} confirmLabel="List him" onConfirm={onConfirm} onCancel={onCancel}>
      Word gets out. He'll be available to all 31 teams, and offers arrive in your inbox once free agency opens.
    </Confirm>
  )
}

function tone(n: number): string {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : ''
}

// ─── Simulated in-house decisions ───────────────────────────────────────────

const SIM_GROUPS: { kind: SuggestionKind; label: string }[] = [
  { kind: 'release', label: 'Release' },
  { kind: 'restructure', label: 'Restructure' },
  { kind: 'block', label: 'Trade block' },
]

/**
 * Preview of "Simulate in-house decisions": the Suggested moves the front office
 * would make, in order, with each one's reason. Nothing is committed until the
 * player confirms.
 */
function SimDialog({ run, snap, onConfirm, onCancel }: { run: RunState; snap: Snapshot; onConfirm: () => void; onCancel: () => void }) {
  const { made, freed } = useMemo(() => {
    const sim = simulateInHouse(run, snap)
    const space = (r: RunState) => capSummary(r, snap.rookieScale.slots, snap.minimumRookieBase).effectiveSpace
    return { made: sim.made, freed: space(sim.run) - space(run) }
  }, [run, snap])
  const editorial = made.filter((s) => s.editorial).length
  return (
    <Confirm title="Simulate in-house decisions?" confirmLabel="Simulate & go to re-signings" onConfirm={onConfirm} onCancel={onCancel}>
      <p className="sim-intro">
        {made.length === 0 ? (
          <>No moves are suggested: every contract is earning its keep. You'll head straight to re-signings.</>
        ) : (
          <>
            The front office makes the Suggested moves, best first{editorial > 0 && <>, starting with <b>{editorial}</b> {editorial === 1 ? 'editor call' : 'editor calls'}</>}.
            {freed > 0 && <> Effective cap space goes up <b className="num">{money(freed)}</b>.</>}
          </>
        )}
      </p>
      {made.length > 0 && (
        <div className="sim-groups scroll">
          {SIM_GROUPS.map(({ kind, label }) => {
            const group = made.filter((s) => s.kind === kind)
            if (!group.length) return null
            return (
              <section key={kind} className="sim-group" data-kind={kind}>
                <div className="eyebrow">{label} · {group.length}</div>
                <ul>
                  {group.map((s) => (
                    <li key={s.player.id}>
                      <b>{s.player.name}</b> <span className="muted">{s.player.pos}, {s.player.age}</span>
                      {s.editorial && <span className="flag sim-flag">Editor</span>}
                      <span className="sim-reason">{s.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </Confirm>
  )
}
