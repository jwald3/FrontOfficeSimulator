import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import type { CoachCandidate } from '../engine/coach'
import { coachCase, interestLevel } from '../engine/editorial'
import { useGame } from '../game/store'
import { Confirm } from './Game'
import { PHASE_INFO } from './lib'
import './coach.css'

// Editorial: the case for each side, the candidate pool, each candidate's interest
// and notes all come from the editorial screen. See engine/coach.ts.


type Filter = 'all' | 'staff' | 'OC' | 'DC' | 'other'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'staff', label: 'On staff' },
  { id: 'OC', label: 'Offensive coordinators' },
  { id: 'DC', label: 'Defensive coordinators' },
  { id: 'other', label: 'Others' },
]

type Pending = { kind: 'keep' } | { kind: 'fire' } | { kind: 'offer'; c: CoachCandidate } | { kind: 'advance' }

export function Coach() {
  const run = useGame((s) => s.run!)
  const candidates = useGame((s) => s.snap?.coachCandidates ?? [])
  const act = useGame()
  const [pending, setPending] = useState<Pending | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const coach = run.coach
  const kase = useGame((s) => (s.snap?.editorial ? coachCase(s.snap.editorial.coach, run.team) : undefined))
  const teamName = useGame((s) => s.snap?.teams.find((t) => t.id === run.team)?.fullName ?? run.teamName)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates
      .filter((c) => filter === 'all' || (filter === 'staff' ? c.internal : c.kind === filter && !c.internal))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q))
  }, [candidates, filter, query])

  const confirm = () => {
    if (!pending) return
    if (pending.kind === 'keep') act.keepCoach()
    else if (pending.kind === 'fire') act.fireCoach()
    else if (pending.kind === 'offer') act.offerCoachJob(pending.c.id)
    else act.advancePhase()
    setPending(null)
  }

  return (
    <div className="coach">
      <header className="board-head">
        <div>
          <div className="eyebrow">{PHASE_INFO.coach.n} / {PHASE_INFO.coach.name}</div>
          <h1 className="display board-title">{PHASE_INFO.coach.tagline}</h1>
        </div>
        {coach?.status === 'hired' && (
          <button className="btn" onClick={() => setPending({ kind: 'advance' })}>
            Continue to In-House Decisions →
          </button>
        )}
      </header>

      {!coach && (
        <section className="coach-decision slab">
          <div className="eyebrow">{teamName} head coach</div>
          <div className="display coach-name">{run.coachName}</div>
          <p className="muted coach-copy">
            Every offseason starts with the same question. Run it back with {run.coachName}, or make a change and start a search?
          </p>
          {(kase?.keep || kase?.fire) && (
            <div className="coach-case">
              {kase.keep && (
                <div>
                  <div className="eyebrow">The case for keeping him</div>
                  <p>{kase.keep}</p>
                </div>
              )}
              {kase.fire && (
                <div>
                  <div className="eyebrow">The case for a change</div>
                  <p>{kase.fire}</p>
                </div>
              )}
            </div>
          )}
          <div className="coach-actions">
            <button className="btn" onClick={() => setPending({ kind: 'keep' })}>Keep {run.coachName}</button>
            <button className="btn danger" onClick={() => setPending({ kind: 'fire' })}>Fire him</button>
          </div>
        </section>
      )}

      {coach && coach.status !== 'kept' && (
        <section className="coach-search">
          <div className="coach-status">
            {coach.status === 'searching' ? (
              <>
                <div className="eyebrow">Coaching search</div>
                <p className="muted">
                  Promote from the staff, or make a run at an outside candidate. Outside candidates may turn you down.
                </p>
              </>
            ) : (
              <>
                <div className="eyebrow">New head coach</div>
                <div className="display coach-name">{coach.name}</div>
              </>
            )}
          </div>
          <div className="board-tools">
            <div className="seg" role="tablist" aria-label="Candidates">
              {FILTERS.filter((f) => f.id === 'all' || candidates.some((c) => (f.id === 'staff' ? c.internal : c.kind === f.id && !c.internal))).map((f) => (
                <button key={f.id} role="tab" className="seg-btn" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
              ))}
            </div>
            <input className="search" placeholder="Search names or teams…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search candidates" />
          </div>
          <ul className="coach-board">
            <AnimatePresence initial={false}>
              {shown.map((c, i) => {
                const declined = coach.declined.includes(c.id)
                const chosen = coach.status === 'hired' && coach.candidateId === c.id
                return (
                  <motion.li
                    key={c.id}
                    className="coach-card slab"
                    data-declined={declined}
                    data-chosen={chosen}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 12) * 0.03 }}
                  >
                    <div className="eyebrow">{c.internal ? 'On staff' : 'Outside candidate'}</div>
                    <div className="display coach-card-name">{c.name}</div>
                    <div className="muted coach-card-role">{c.role}</div>
                    {c.note && <div className="coach-card-note">{c.note}</div>}
                    {coach.status === 'searching' && !declined && (
                      <button className="btn ghost" onClick={() => setPending({ kind: 'offer', c })}>
                        {c.internal ? 'Promote him' : 'Offer the job'}
                      </button>
                    )}
                    {declined && <div className="coach-card-state">Turned you down</div>}
                    {chosen && <div className="coach-card-state">Hired</div>}
                  </motion.li>
                )
              })}
            </AnimatePresence>
            {shown.length === 0 && <li className="muted coach-empty">No candidates match.</li>}
          </ul>
        </section>
      )}

      <AnimatePresence>
        {pending && <PendingDialog key="dlg" pending={pending} season={run.season} coachName={run.coachName} onConfirm={confirm} onCancel={() => setPending(null)} />}
      </AnimatePresence>
    </div>
  )
}

function PendingDialog({
  pending,
  season,
  coachName,
  onConfirm,
  onCancel,
}: {
  pending: Pending
  season: number
  coachName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const levels = useGame((s) => s.snap?.editorial?.coach.levels)
  if (pending.kind === 'keep') {
    return (
      <Confirm title={`Keep ${coachName}?`} confirmLabel="Keep him" onConfirm={onConfirm} onCancel={onCancel}>
        He leads the team into {season}, and the offseason moves on to in-house decisions.
      </Confirm>
    )
  }
  if (pending.kind === 'fire') {
    return (
      <Confirm title={`Fire ${coachName}?`} confirmLabel="Fire him" danger onConfirm={onConfirm} onCancel={onCancel}>
        There's no going back. You'll need to hire a replacement before the offseason can continue.
      </Confirm>
    )
  }
  if (pending.kind === 'offer') {
    const { c } = pending
    // How the dialog reports his interest, without a number (editorial).
    const copy = interestLevel(levels, c.interest ?? 'maybe').copy
    return (
      <Confirm title={c.internal ? `Promote ${c.name}?` : `Offer the job to ${c.name}?`} confirmLabel="Make the offer" onConfirm={onConfirm} onCancel={onCancel}>
        {c.internal ? `${c.name} is already on staff and will accept.` : `${copy} If he declines, he's off the board.`}
      </Confirm>
    )
  }
  return (
    <Confirm title="Move on to in-house decisions?" confirmLabel="Continue" onConfirm={onConfirm} onCancel={onCancel}>
      Your new head coach is in place.
    </Confirm>
  )
}
