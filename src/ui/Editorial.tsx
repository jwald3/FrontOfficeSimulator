import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { boardOrder, coachCase, DEFAULT_DRAFT_ADVICE, DEFAULT_INHOUSE_RULE, DEFAULT_VALUATION, DEFAULT_INTEREST_LEVELS, EMPTY_EDITORIAL, FIXED_INTERESTS, interestLevel, INTERESTS, manualId, type CoachCase as CoachCaseText, type CoordinatorsData, type DeclareCall, type DraftAdviceRule, type EditorialData, type InHouseCall, type InHouseRule, type Interest, type InterestLevel, type MarketCall, type PositionValue, type ResignCall, type ValuationModel } from '../engine/editorial'
import { releaseSavings, seasonCapHit } from '../engine/cap'
import { nickname as teamNickname } from '../engine/team'
import { TeamColorsEditor } from './EditorialColors'
import { money } from '../engine/format'
import { chartPlayers } from '../engine/depth'
import { sourceTeamOrder } from '../engine/draft'
import { retentionRate } from '../engine/market'
import { previewRestructure } from '../engine/moves'
import { createRun } from '../engine/run'
import { suggestInHouse } from '../engine/suggest'
import { pickValue } from '../engine/trades'
import type { OfferReport, ReportAction, Verdict } from '../engine/reportSchema'
import { loadReports, resolveReport } from '../game/reports'
import { modelValue, tradeValue, valuationContext } from '../engine/valuation'
import type { Position, Snapshot } from '../engine/types'
import { useGame } from '../game/store'
import { Confirm } from './Game'
import { useHotkeys } from './lib'
import { DepthBadge, Key } from './parts'
import './editorial.css'

// Editorial controls: the editor's choices about the game's content. Each section
// edits part of public/data/editorial.json; saving writes the file through the
// dev server (see vite.config.ts) so the choices ship with the next build.

const SECTIONS = [
  { id: 'feedback', label: 'Feedback' },
  { id: 'case', label: 'Head coach decision' },
  { id: 'coach', label: 'Head coach candidates' },
  { id: 'resign', label: 'Re-sign calls' },
  { id: 'inhouse', label: 'Suggested moves' },
  { id: 'depth', label: 'Depth chart' },
  { id: 'market', label: 'Free agency' },
  { id: 'values', label: 'Trade values' },
  { id: 'order', label: 'Draft order' },
  { id: 'draft', label: 'Draft board' },
  { id: 'colors', label: 'Team colours' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function Editorial() {
  const snap = useGame((s) => s.snap!)
  const saved = useGame((s) => s.editorial!)
  const coordinators = useGame((s) => s.coordinators!)
  const save = useGame((s) => s.saveEditorial)
  const quit = useGame((s) => s.quitToTitle)
  const [draft, setDraft] = useState<EditorialData>(saved)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [section, setSection] = useState<SectionId>('case')
  // Offer reports from the game, loaded from the dev server.
  const [reports, setReports] = useState<OfferReport[] | null>(null)
  const [reportsError, setReportsError] = useState<string | null>(null)
  useEffect(() => {
    void loadReports().then((r) => (typeof r === 'string' ? setReportsError(r) : setReports(r.reports)))
  }, [])
  const onResolve = async (id: string, action: ReportAction, detail?: string) => {
    const r = await resolveReport(id, action, detail)
    if (typeof r === 'string') return r
    setReports(r.reports)
    return undefined
  }
  const openReports = reports?.filter((r) => r.status === 'open').length ?? 0
  const update = (next: EditorialData) => {
    setDraft(next)
    setStatus(null)
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const onSave = async () => {
    setSaving(true)
    const error = await save(draft)
    setSaving(false)
    setStatus(error ? { tone: 'error', text: error } : { tone: 'ok', text: 'Saved to public/data/editorial.json' })
  }
  const onBack = () => (dirty ? setLeaving(true) : quit())
  useHotkeys({ escape: onBack }, !leaving)

  return (
    <div className="editorial">
      <header className="ed-head">
        <div>
          <div className="eyebrow">Editorial</div>
          <h1 className="display ed-title">Content controls</h1>
        </div>
        <div className="ed-actions">
          {status && <span className="ed-status" data-tone={status.tone} role="status">{status.text}</span>}
          {dirty && !status && <span className="ed-status muted">Unsaved changes</span>}
          <button className="btn ghost" onClick={onBack}><Key>ESC</Key> Back</button>
          <button className="btn" disabled={!dirty || saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </header>

      <div className="ed-body">
        <nav className="ed-nav" aria-label="Editorial sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className="ed-nav-item" aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
              {s.label}
              {s.id === 'feedback' && openReports > 0 && <span className="badge num ed-nav-badge">{openReports}</span>}
            </button>
          ))}
          <p className="muted ed-nav-note">More sections will live here as other content becomes editorial.</p>
        </nav>
        {section === 'case' && <CoachCases snap={snap} coordinators={coordinators} value={draft.coach} onChange={(coach) => update({ ...draft, coach })} />}
        {section === 'coach' && (
          <CoachCandidates snap={snap} coordinators={coordinators} value={draft.coach} onChange={(coach) => update({ ...draft, coach })} />
        )}
        {section === 'resign' && <ResignCalls snap={snap} value={draft.resign?.calls ?? {}} onChange={(calls) => update({ ...draft, resign: { calls } })} />}
        {section === 'depth' && (
          <DepthChart snap={snap} value={draft.depth?.spots ?? {}} onChange={(spots) => update({ ...draft, depth: Object.keys(spots).length ? { spots } : undefined })} />
        )}
        {section === 'feedback' && (
          <Feedback
            snap={snap}
            reports={reports}
            error={reportsError}
            players={draft.playerValues ?? {}}
            onPlayers={(playerValues) => update({ ...draft, playerValues: Object.keys(playerValues).length ? playerValues : undefined })}
            onResolve={onResolve}
            onOpenValues={() => setSection('values')}
          />
        )}
        {section === 'values' && (
          <TradeValues
            snap={snap}
            value={draft.valuation}
            players={draft.playerValues ?? {}}
            locked={draft.untouchable ?? []}
            noFirsts={draft.noFirsts ?? []}
            onNoFirsts={(noFirsts) => update({ ...draft, noFirsts: noFirsts.length ? noFirsts : undefined })}
            onChange={(valuation) => update({ ...draft, valuation })}
            onPlayers={(playerValues) => update({ ...draft, playerValues: Object.keys(playerValues).length ? playerValues : undefined })}
            onLocked={(untouchable) => update({ ...draft, untouchable: untouchable.length ? untouchable : undefined })}
          />
        )}
        {section === 'order' && (
          <DraftOrder snap={snap} value={draft.draftOrder?.teams} onChange={(teams) => update({ ...draft, draftOrder: teams ? { teams } : undefined })} />
        )}
        {section === 'draft' && (
          <DraftBoard
            snap={snap}
            value={draft.draft ?? {}}
            onChange={(d) => update({ ...draft, draft: d })}
            advice={draft.draftAdvice}
            onAdvice={(draftAdvice) => update({ ...draft, draftAdvice })}
          />
        )}
        {section === 'market' && (
          <MarketCalls
            snap={snap}
            value={draft.market?.calls ?? {}}
            onChange={(calls) => update({ ...draft, market: Object.keys(calls).length ? { calls } : undefined })}
          />
        )}
        {section === 'colors' && (
          <TeamColorsEditor snap={snap} value={draft.colors} onChange={(colors) => update({ ...draft, colors })} />
        )}
        {section === 'inhouse' && (
          <InHouseCalls snap={snap} value={draft.inHouse} onChange={(inHouse) => update({ ...draft, inHouse })} />
        )}
      </div>

      <AnimatePresence>
        {leaving && (
          <Confirm key="leave" title="Leave without saving?" confirmLabel="Discard changes" danger onConfirm={quit} onCancel={() => setLeaving(false)}>
            Your changes to the editorial content haven't been saved.
          </Confirm>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Head coach decision ────────────────────────────────────────────────────

/**
 * The argument for keeping or firing each team's head coach, one team at a time.
 * Older files' single case is the Jets'; saving moves it into `cases`.
 */
function CoachCases({
  snap,
  coordinators,
  value,
  onChange,
}: {
  snap: Snapshot
  coordinators: CoordinatorsData
  value: EditorialData['coach']
  onChange: (coach: EditorialData['coach']) => void
}) {
  const [team, setTeam] = useState(snap.team)
  const teams = useMemo(() => [...snap.teams].sort((a, b) => a.fullName.localeCompare(b.fullName)), [snap])
  const coachName = coordinators.headCoaches?.[team] ?? 'the head coach'
  const kase = coachCase(value, team) ?? { keep: '', fire: '' }
  const set = (side: 'keep' | 'fire', text: string) => {
    const next = { ...kase, [side]: text }
    const cases: Record<string, CoachCaseText> = { ...(value.case && !value.cases?.NYJ ? { NYJ: value.case } : {}), ...value.cases }
    if (next.keep.trim() || next.fire.trim()) cases[team] = next
    else delete cases[team]
    const { case: _legacy, ...rest } = value
    onChange({ ...rest, cases: Object.keys(cases).length ? cases : undefined })
  }
  const written = new Set([...Object.keys(value.cases ?? {}), ...(value.case ? ['NYJ'] : [])])
  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Head coach decision</h2>
        <p className="muted">
          The argument on each side, shown under the head coach's name when the offseason opens. Leave both empty to show the decision on its own.
        </p>
      </header>
      <label className="ed-field">
        <span className="eyebrow">Team · {coachName}</span>
        <select className="ed-select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.fullName}{written.has(t.id) ? ' · written' : ''}</option>
          ))}
        </select>
      </label>
      <label className="ed-field">
        <span className="eyebrow">The case for keeping him</span>
        <textarea rows={5} value={kase.keep} onChange={(e) => set('keep', e.target.value)} placeholder="What's working, and why stability matters…" />
      </label>
      <label className="ed-field">
        <span className="eyebrow">The case for a change</span>
        <textarea rows={5} value={kase.fire} onChange={(e) => set('fire', e.target.value)} placeholder="What isn't working, and what a new voice would fix…" />
      </label>
    </section>
  )
}

// ─── Head coach candidates ──────────────────────────────────────────────────

const INTEREST_LABEL: Record<Interest, string> = {
  yes: 'Accepts',
  likely: 'Leans accept',
  maybe: 'Either way',
  unlikely: 'Leans decline',
  no: 'Declines',
}

/** What each interest level means, for the levels panel. */
const INTEREST_MEANING: Record<Interest, string> = {
  yes: 'He wants the job. Always says yes.',
  likely: 'Interested, and more likely than not to take it.',
  maybe: 'The default for anyone not marked.',
  unlikely: 'Lukewarm. Usually turns it down.',
  no: 'Not leaving his job. Always says no.',
}

type Role = 'all' | 'OC' | 'DC'

function CoachCandidates({
  snap,
  coordinators,
  value,
  onChange,
}: {
  snap: Snapshot
  coordinators: CoordinatorsData
  value: EditorialData['coach']
  onChange: (coach: EditorialData['coach']) => void
}) {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Role>('all')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const chosen = useMemo(() => new Set(value.coordinatorIds), [value.coordinatorIds])

  const q = query.trim().toLowerCase()
  const teams = useMemo(
    () =>
      [...snap.teams]
        .sort((a, b) => Number(b.id === snap.team) - Number(a.id === snap.team) || a.fullName.localeCompare(b.fullName))
        .map((t) => ({
          team: t,
          staff: (['OC', 'DC'] as const)
            .filter((r) => role === 'all' || r === role)
            .map((r) => ({ role: r, coach: coordinators.coordinators.find((c) => c.team === t.id && c.role === r) })),
        }))
        .filter(({ team, staff }) => !q || team.fullName.toLowerCase().includes(q) || staff.some((s) => s.coach?.name.toLowerCase().includes(q))),
    [snap.teams, snap.team, coordinators, role, q],
  )
  const visible = teams.flatMap((t) => t.staff.flatMap((s) => (s.coach ? [s.coach.id] : [])))

  const setChosen = (ids: Set<string>) => onChange({ ...value, coordinatorIds: coordinators.coordinators.filter((c) => ids.has(c.id)).map((c) => c.id) })
  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }
  const addManual = () => {
    if (!name.trim()) return
    const id = manualId(name, value.manual.map((m) => m.id))
    onChange({ ...value, manual: [...value.manual, { id, name: name.trim(), role: desc.trim() }] })
    setName('')
    setDesc('')
  }

  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Head coach candidates</h2>
        <p className="muted">
          Who's on the hiring board if you fire the head coach.{' '}
          <b className="num">{value.coordinatorIds.length + value.manual.length}</b> candidates: {value.coordinatorIds.length} coordinators and{' '}
          {value.manual.length} added by hand. The team's own coordinators are promotions and always accept.
        </p>
      </header>

      <div className="ed-tools">
        <input className="search" placeholder="Search coaches or teams…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search coordinators" />
        <div className="seg" role="tablist" aria-label="Role">
          {(['all', 'OC', 'DC'] as const).map((r) => (
            <button key={r} role="tab" className="seg-btn" aria-selected={role === r} onClick={() => setRole(r)}>
              {r === 'all' ? 'All' : r === 'OC' ? 'Offensive' : 'Defensive'}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={() => setChosen(new Set([...chosen, ...visible]))}>Select shown</button>
        <button className="btn ghost" onClick={() => setChosen(new Set([...chosen].filter((id) => !visible.includes(id))))}>Clear shown</button>
      </div>

      <ul className="ed-teams">
        {teams.map(({ team, staff }) => (
          <li key={team.id} className="ed-team" data-ours={team.id === snap.team}>
            <div className="eyebrow">{team.fullName}</div>
            {staff.map(({ role: r, coach }) =>
              coach ? (
                <label key={r} className="ed-check" data-on={chosen.has(coach.id)}>
                  <input type="checkbox" checked={chosen.has(coach.id)} onChange={() => toggle(coach.id)} />
                  <span className="ed-check-role">{r}</span>
                  <span>{coach.name}</span>
                </label>
              ) : (
                <div key={r} className="ed-check ed-none">
                  <span className="ed-check-role">{r}</span>
                  <span className="muted">None listed</span>
                </div>
              ),
            )}
          </li>
        ))}
        {teams.length === 0 && <li className="muted ed-empty">No coaches match.</li>}
      </ul>
      <p className="muted ed-source">Coordinators: {coordinators.source}, as of {coordinators.asOf}. Rebuild with <code>node scripts/coordinators.mjs</code>.</p>

      <div className="ed-manual">
        <h3 className="display ed-subtitle">Add someone else</h3>
        <form
          className="ed-manual-form"
          onSubmit={(e) => {
            e.preventDefault()
            addManual()
          }}
        >
          <input className="search" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Candidate name" />
          <input className="search" placeholder="Who he is, e.g. Michigan head coach" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Candidate description" />
          <button className="btn" type="submit" disabled={!name.trim()}>Add</button>
        </form>
        <ul className="ed-manual-list">
          <AnimatePresence initial={false}>
            {value.manual.map((m) => (
              <motion.li key={m.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <b>{m.name}</b>
                <span className="muted">{m.role || 'No description'}</span>
                <button className="btn ghost" onClick={() => onChange({ ...value, manual: value.manual.filter((x) => x.id !== m.id) })}>
                  Remove
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
          {value.manual.length === 0 && <li className="muted">Nobody added yet.</li>}
        </ul>
      </div>

      <InterestLevels value={value.levels} onChange={(levels) => onChange({ ...value, levels })} />
      <CandidateDetails snap={snap} coordinators={coordinators} value={value} onChange={onChange} />
    </section>
  )
}

/**
 * Interest and a note for everyone on the board; what each interest level does is
 * set in InterestLevels. Unset fields are left out of the file.
 */
function CandidateDetails({
  snap,
  coordinators,
  value,
  onChange,
}: {
  snap: Snapshot
  coordinators: CoordinatorsData
  value: EditorialData['coach']
  onChange: (coach: EditorialData['coach']) => void
}) {
  const [query, setQuery] = useState('')
  const teamName = (id: string) => snap.teams.find((t) => t.id === id)?.fullName ?? id
  const board = [
    ...coordinators.coordinators
      .filter((c) => value.coordinatorIds.includes(c.id))
      .map((c) => ({ id: c.id, name: c.name, role: `${teamName(c.team)} ${c.role}`, internal: c.team === snap.team })),
    ...value.manual.map((m) => ({ id: m.id, name: m.name, role: m.role, internal: false })),
  ]
  const q = query.trim().toLowerCase()
  const shown = board.filter((c) => !q || c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q))
  const setInterest = (id: string, interest: Interest) => {
    const next = { ...value.interest }
    if (interest === 'maybe') delete next[id]
    else next[id] = interest
    onChange({ ...value, interest: Object.keys(next).length ? next : undefined })
  }
  const setNote = (id: string, note: string) => {
    const next = { ...value.notes }
    if (note.trim()) next[id] = note
    else delete next[id]
    onChange({ ...value, notes: Object.keys(next).length ? next : undefined })
  }
  const marked = Object.keys(value.interest ?? {}).length + Object.keys(value.notes ?? {}).length

  return (
    <div className="ed-manual">
      <h3 className="display ed-subtitle">Interest and notes</h3>
      <p className="muted ed-help">
        How each candidate answers an offer (Interest levels, above, sets what each one does), and a line for his card. A team's own
        coordinators are promotions and always accept.
        {marked > 0 && <> {marked} detail{marked === 1 ? '' : 's'} set.</>}
      </p>
      <input className="search" placeholder="Search the board…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search candidate details" />
      <ul className="ed-details">
        {shown.map((c) => (
          <li key={c.id}>
            <div className="ed-detail-who">
              <b>{c.name}</b>
              <span className="muted">{c.role}</span>
            </div>
            {c.internal ? (
              <span className="muted ed-detail-fixed">Promotion: always accepts</span>
            ) : (
              <select value={value.interest?.[c.id] ?? 'maybe'} onChange={(e) => setInterest(c.id, e.target.value as Interest)} aria-label={`${c.name}'s interest`}>
                {INTERESTS.map((i) => <option key={i} value={i}>{INTEREST_LABEL[i]}</option>)}
              </select>
            )}
            <input className="search" placeholder="Note for his card (optional)" value={value.notes?.[c.id] ?? ''} onChange={(e) => setNote(c.id, e.target.value)} aria-label={`Note on ${c.name}`} />
          </li>
        ))}
        {shown.length === 0 && <li className="muted">Nobody matches.</li>}
      </ul>
    </div>
  )
}

// ─── Re-sign calls ──────────────────────────────────────────────────────────

const CALL_LABEL: Record<ResignCall, string> = { 're-sign': 'Re-sign', tender: 'Tender', walk: 'Let walk' }

/**
 * The editor's call on each of our expiring players, used by "Simulate
 * re-signings". Players left on "No call" fall back to the rule.
 */
function ResignCalls({
  snap,
  value,
  onChange,
}: {
  snap: Snapshot
  value: NonNullable<EditorialData['resign']>['calls']
  onChange: (calls: NonNullable<EditorialData['resign']>['calls']) => void
}) {
  // The expiring list a Genuine run starts with, rights players included.
  const players = useMemo(
    () => [...createRun(snap, { mode: 'genuine', objective: 'balanced', seed: 0 }).expiring].sort((a, b) => b.marketAAV - a.marketAAV),
    [snap],
  )
  const set = (id: string, call: ResignCall | '', reason: string) => {
    const next = { ...value }
    if (call) next[id] = { call, reason }
    else delete next[id]
    onChange(next)
  }
  const count = Object.keys(value).length

  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Re-sign calls</h2>
        <p className="muted">
          What "Simulate re-signings" does with each of our expiring players, and why; the reason shows in its preview. Players left on
          "No call" follow the rule: starters 30 or younger re-sign, rights players who play get the cheapest tender, everyone else walks.
          A tender call re-signs him instead in Simplified mode, which has no tenders. {count > 0 && <b>{count} set.</b>}
        </p>
      </header>
      <ul className="ed-details ed-calls">
        {players.map((p) => {
          const c = value[p.id]
          const rights = p.type === 'RFA' || p.type === 'ERFA'
          return (
            <li key={p.id} data-set={!!c}>
              <DepthBadge chart={p.chart} size="sm" />
              <div className="ed-detail-who">
                <b>{p.name}</b>
                <span className="muted">{p.pos} · Age {p.age} · {p.type}</span>
              </div>
              <Stats items={[{ value: money(p.marketAAV, 1), label: 'Market' }]} />
              <select value={c?.call ?? ''} onChange={(e) => set(p.id, e.target.value as ResignCall | '', c?.reason ?? '')} aria-label={`Call on ${p.name}`}>
                <option value="">No call</option>
                {(['re-sign', 'tender', 'walk'] as const).filter((k) => k !== 'tender' || rights).map((k) => <option key={k} value={k}>{CALL_LABEL[k]}</option>)}
              </select>
              <input
                className="search"
                placeholder={c ? 'Why? Shown in the preview' : 'Pick a call first'}
                disabled={!c}
                value={c?.reason ?? ''}
                onChange={(e) => c && set(p.id, c.call, e.target.value)}
                aria-label={`Reason for ${p.name}`}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── Suggested moves ────────────────────────────────────────────────────────

const INHOUSE_LABEL: Record<InHouseCall, string> = { release: 'Release', restructure: 'Restructure', block: 'Trade block', keep: "Don't suggest" }

/**
 * The editor's call on each player under contract, shown on the Suggested tab of
 * in-house decisions. Players left on "No call" follow the rule, whose current
 * pick is shown beside each name.
 */
function InHouseCalls({
  snap,
  value,
  onChange,
}: {
  snap: Snapshot
  value: EditorialData['inHouse']
  onChange: (inHouse: EditorialData['inHouse']) => void
}) {
  const calls = useMemo(() => value?.calls ?? {}, [value])
  const rule = useMemo(() => ({ ...DEFAULT_INHOUSE_RULE, ...value?.rule }), [value])
  // The roster a Genuine run starts with, and what the rule (as set here) suggests on its own.
  const run = useMemo(() => createRun(snap, { mode: 'genuine', objective: 'balanced', seed: 0 }), [snap])
  const players = useMemo(() => [...run.roster].sort((a, b) => seasonCapHit(b, run.season) - seasonCapHit(a, run.season)), [run])
  const byRule = useMemo(() => {
    const withRule = { ...snap, editorial: { ...(snap.editorial ?? EMPTY_EDITORIAL), inHouse: { calls: {}, rule } } }
    return new Map(suggestInHouse(run, withRule).map((s) => [s.player.id, s.kind]))
  }, [snap, run, rule])

  // Leave defaults and empty maps out of the file.
  const save = (nextCalls: typeof calls, nextRule: InHouseRule) => {
    const isDefault = (Object.keys(DEFAULT_INHOUSE_RULE) as (keyof InHouseRule)[]).every((k) => nextRule[k] === DEFAULT_INHOUSE_RULE[k])
    onChange(Object.keys(nextCalls).length || !isDefault ? { calls: nextCalls, ...(!isDefault && { rule: nextRule }) } : undefined)
  }
  const set = (id: string, call: InHouseCall | '', reason: string) => {
    const next = { ...calls }
    if (call) next[id] = { call, reason }
    else delete next[id]
    save(next, rule)
  }
  const setRule = (patch: Partial<InHouseRule>) => save(calls, { ...rule, ...patch })
  const count = Object.keys(calls).length
  const ruleCount = byRule.size
  const custom = !!value?.rule

  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Suggested moves</h2>
        <p className="muted">
          What the Suggested tab of in-house decisions recommends, and why. Set the rule for everyone, then override any player: your call and
          its reason show on his row, above the rule's picks. "Don't suggest" keeps him off the list.{' '}
          {count > 0 && <b>{count} set.</b>}
        </p>
      </header>

      <div className="ed-rule-panel" data-custom={custom}>
        <div className="ed-rule-head">
          <span className="eyebrow">The default rule · {ruleCount} {ruleCount === 1 ? 'suggestion' : 'suggestions'} on the opening roster</span>
          <button className="btn ghost" disabled={!custom} onClick={() => save(calls, DEFAULT_INHOUSE_RULE)}>Reset rule</button>
        </div>
        <label className="ed-rule-line" data-off={!rule.release}>
          <input type="checkbox" checked={rule.release} onChange={(e) => setRule({ release: e.target.checked })} />
          <span>
            <b>Suggest releases</b> when cutting a player saves at least{' '}
            <MillionsInput value={rule.minSurplus} disabled={!rule.release} onChange={(minSurplus) => setRule({ minSurplus })} label="Minimum saving" />{' '}
            more than replacing him costs (a proven starter at his position, or nothing for a backup).
          </span>
        </label>
        <label className="ed-rule-line" data-off={!rule.restructure}>
          <input type="checkbox" checked={rule.restructure} onChange={(e) => setRule({ restructure: e.target.checked })} />
          <span>
            <b>Suggest restructures</b> for starters{' '}
            <input
              className="search num ed-rule-num"
              type="number"
              min={20}
              max={45}
              value={rule.maxAge}
              disabled={!rule.restructure}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value))
                if (n >= 20 && n <= 45) setRule({ maxAge: n })
              }}
              aria-label="Oldest age to restructure"
            />{' '}
            or younger, once effective cap space is under{' '}
            <MillionsInput value={rule.tightSpace} disabled={!rule.restructure} onChange={(tightSpace) => setRule({ tightSpace })} label="Tight cap space" />{' '}
            (never when the objective is creating cap room).
          </span>
        </label>
      </div>
      <ul className="ed-details ed-calls ed-moves">
        {players.map((p) => {
          const c = calls[p.id]
          const ruled = byRule.get(p.id)
          const canRestructure = previewRestructure(run, p.id).eligible
          const saves = releaseSavings(p, run.season)
          return (
            <li key={p.id} data-set={!!c}>
              <DepthBadge chart={p.chart} size="sm" />
              <div className="ed-detail-who">
                <b>{p.name}</b>
                <span className="muted">{p.pos} · Age {p.age}</span>
              </div>
              <Stats
                items={[
                  { value: money(seasonCapHit(p, run.season), 1), label: 'Cap hit' },
                  { value: money(saves, 1), label: 'Cut saves', tone: saves < 0 ? 'neg' : saves > 0 ? 'pos' : undefined },
                ]}
              />
              <select
                value={c?.call ?? ''}
                data-default={!c && ruled ? ruled : undefined}
                onChange={(e) => set(p.id, e.target.value as InHouseCall | '', c?.reason ?? '')}
                aria-label={`Call on ${p.name}`}
              >
                <option value="">{ruled ? `Default: ${INHOUSE_LABEL[ruled]}` : 'Default: nothing'}</option>
                {(['release', 'restructure', 'block', 'keep'] as const)
                  .filter((k) => k !== 'restructure' || canRestructure || c?.call === k)
                  .map((k) => <option key={k} value={k}>{INHOUSE_LABEL[k]}</option>)}
              </select>
              <input
                className="search"
                placeholder={c ? (c.call === 'keep' ? 'Why? (editor-only note)' : 'Why? Shown on his row') : 'Pick a call first'}
                disabled={!c}
                value={c?.reason ?? ''}
                onChange={(e) => c && set(p.id, c.call, e.target.value)}
                aria-label={`Reason for ${p.name}`}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── Free agency ────────────────────────────────────────────────────────────

const MARKET_LABEL: Record<MarketCall | '', string> = { '': 'Roll', stays: 'Stays', market: 'Hits market' }
type MarketFilter = 'all' | 'set' | MarketCall
/** Rows shown before "Show more"; the list is long. */
const PAGE = 60

/**
 * Whether each other team's pending free agent re-signs at home before the market
 * opens. "Stays" takes him off the board for everyone; "Hits market" guarantees
 * he's there. Left on "Roll", he stays at the historical rate for his contract.
 */
function MarketCalls({
  snap,
  value,
  onChange,
}: {
  snap: Snapshot
  value: NonNullable<EditorialData['market']>['calls']
  onChange: (calls: NonNullable<EditorialData['market']>['calls']) => void
}) {
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState('')
  const [filter, setFilter] = useState<MarketFilter>('all')
  const [limit, setLimit] = useState(PAGE)
  // Our own expiring players are settled on the re-sign screen, not here.
  const players = useMemo(() => snap.freeAgents.filter((p) => !p.own).sort((a, b) => b.marketAAV - a.marketAAV), [snap])
  const positions = useMemo(() => [...new Set(players.map((p) => p.pos))].sort(), [players])
  // "Los Angeles Rams" → "Rams": the city adds length, not information, on a row this busy.
  const teamName = (id: string) => snap.teams.find((t) => t.id === id)?.fullName.split(' ').pop() ?? id
  const narrow = (fn: () => void) => {
    fn()
    setLimit(PAGE)
  }

  const q = query.trim().toLowerCase()
  const shown = players.filter((p) => {
    const c = value[p.id]?.call
    if (filter === 'set' ? !c : filter !== 'all' && c !== filter) return false
    return (!pos || p.pos === pos) && (!q || p.name.toLowerCase().includes(q) || (snap.teams.find((t) => t.id === p.team)?.fullName ?? '').toLowerCase().includes(q) || p.team.toLowerCase() === q)
  })
  const set = (id: string, call: MarketCall | '', reason: string) => {
    const next = { ...value }
    if (call) next[id] = { call, reason }
    else delete next[id]
    onChange(next)
  }
  const stays = Object.values(value).filter((c) => c.call === 'stays').length
  const count = Object.keys(value).length

  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Free agency</h2>
        <p className="muted">
          Before the market opens, each other team's pending free agent re-signs at home at the historical rate (59% on deals under $2M a
          year, 38% above). Mark a player <b>Stays</b> to keep him off the market for everyone, or <b>Hits market</b> to make sure he's
          there. The reason shows on his card once he's gone. {count > 0 && <b>{stays} staying, {count - stays} on the market.</b>}
        </p>
      </header>

      <div className="ed-tools">
        <input className="search" placeholder="Search players or teams…" value={query} onChange={(e) => narrow(() => setQuery(e.target.value))} aria-label="Search free agents" />
        <select className="ed-select" value={pos} onChange={(e) => narrow(() => setPos(e.target.value))} aria-label="Position">
          <option value="">All positions</option>
          {positions.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <div className="seg" role="tablist" aria-label="Show">
          {(['all', 'set', 'stays', 'market'] as const).map((f) => (
            <button key={f} role="tab" className="seg-btn" aria-selected={filter === f} onClick={() => narrow(() => setFilter(f))}>
              {f === 'all' ? 'All' : f === 'set' ? 'Marked' : MARKET_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      <ul className="ed-details ed-calls ed-market">
        {shown.slice(0, limit).map((p) => {
          const c = value[p.id]
          return (
            <li key={p.id} data-set={!!c} data-call={c?.call}>
              <DepthBadge chart={p.chart} size="sm" />
              <div className="ed-detail-who">
                <b>{p.name}</b>
                <span className="muted">{p.pos} · Age {p.age} · {teamName(p.team)}</span>
              </div>
              <Stats
                items={[
                  { value: money(p.marketAAV, 1), label: 'Market' },
                  { value: c ? (c.call === 'stays' ? '100%' : '0%') : `${Math.round(retentionRate(p) * 100)}%`, label: 'Stays home' },
                ]}
              />
              <div className="seg ed-market-seg" role="radiogroup" aria-label={`${p.name} before free agency`}>
                {(['', 'stays', 'market'] as const).map((k) => (
                  <button key={k} role="radio" className="seg-btn" aria-checked={(c?.call ?? '') === k} aria-selected={(c?.call ?? '') === k} onClick={() => set(p.id, k, c?.reason ?? '')}>
                    {MARKET_LABEL[k]}
                  </button>
                ))}
              </div>
              <input
                className="search"
                placeholder={c ? 'Why? (optional)' : 'Mark him first'}
                disabled={!c}
                value={c?.reason ?? ''}
                onChange={(e) => c && set(p.id, c.call, e.target.value)}
                aria-label={`Reason for ${p.name}`}
              />
            </li>
          )
        })}
        {shown.length === 0 && <li className="muted ed-empty">Nobody matches.</li>}
      </ul>
      {shown.length > limit && (
        <button className="btn ghost ed-more" onClick={() => setLimit(limit + PAGE * 2)}>
          Show more ({shown.length - limit} left)
        </button>
      )}
    </section>
  )
}

/** A row's numbers as label-over-value cells, so they scan as columns down the list. */
function Stats({ items }: { items: { value: string; label: string; tone?: 'pos' | 'neg' }[] }) {
  return (
    <dl className="ed-stats">
      {items.map((s) => (
        <div key={s.label} className="ed-stat">
          <dt>{s.label}</dt>
          <dd className="num" data-tone={s.tone}>{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ─── Draft board ────────────────────────────────────────────────────────────

type DraftEditorial = NonNullable<EditorialData['draft']>
type BoardFilter = 'all' | 'moved' | 'notes' | 'underclass'
const DECLARE_LABEL: Record<DeclareCall, string> = { declares: 'Declares', returns: 'Returns' }

/**
 * The editor's big board: the order every prospect is ranked in (the draft screen,
 * AI teams and projected rounds all read it), a scouting note for his card, and
 * whether each underclassman declares. Unmoved prospects keep their source rank.
 */
function DraftBoard({
  snap,
  value,
  onChange,
  advice,
  onAdvice,
}: {
  snap: Snapshot
  value: DraftEditorial
  onChange: (v: DraftEditorial | undefined) => void
  advice: DraftAdviceRule[] | undefined
  onAdvice: (rules: DraftAdviceRule[] | undefined) => void
}) {
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState('')
  const [filter, setFilter] = useState<BoardFilter>('all')
  const [limit, setLimit] = useState(PAGE)
  // Copies, so ordering for the editor never touches the live snapshot.
  const board = useMemo(() => boardOrder(snap.prospects.map((p) => ({ ...p })), value.order), [snap, value.order])
  const consensusIds = useMemo(() => boardOrder(snap.prospects.map((p) => ({ ...p }))).map((p) => p.id), [snap])
  const positions = useMemo(() => [...new Set(snap.prospects.map((p) => p.pos))].sort(), [snap])
  const narrow = (fn: () => void) => {
    fn()
    setLimit(PAGE)
  }

  const save = (next: DraftEditorial) => {
    const clean: DraftEditorial = {
      ...(next.order && { order: next.order }),
      ...(next.notes && Object.keys(next.notes).length && { notes: next.notes }),
      ...(next.declare && Object.keys(next.declare).length && { declare: next.declare }),
    }
    onChange(Object.keys(clean).length ? clean : undefined)
  }
  const moveTo = (id: string, rank: number) => {
    const ids = board.map((p) => p.id)
    ids.splice(ids.indexOf(id), 1)
    ids.splice(Math.max(0, Math.min(ids.length, rank - 1)), 0, id)
    save({ ...value, order: ids.join() === consensusIds.join() ? undefined : ids })
  }
  const setNote = (id: string, note: string) => {
    const notes = { ...value.notes }
    if (note.trim()) notes[id] = note
    else delete notes[id]
    save({ ...value, notes })
  }
  const setDeclare = (id: string, call: DeclareCall | '') => {
    const declare = { ...value.declare }
    if (call) declare[id] = call
    else delete declare[id]
    save({ ...value, declare })
  }

  const q = query.trim().toLowerCase()
  const shown = board
    .map((p, i) => ({ p, rank: i + 1 }))
    .filter(({ p, rank }) => {
      if (filter === 'moved' && rank === p.consensusRank) return false
      if (filter === 'notes' && !value.notes?.[p.id]) return false
      if (filter === 'underclass' && !p.declaration?.canReturn) return false
      return (!pos || p.pos === pos) && (!q || p.name.toLowerCase().includes(q) || p.school.toLowerCase().includes(q))
    })
  const moved = board.filter((p, i) => i + 1 !== p.consensusRank).length
  const notes = Object.keys(value.notes ?? {}).length
  const calls = Object.keys(value.declare ?? {}).length

  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Draft board</h2>
        <p className="muted">
          Our big board, which sets every prospect's rank: on the draft screen, for AI teams and for projected rounds. Type a rank or nudge a
          prospect; anyone you don't touch keeps his source spot. Notes show on his card, and underclassmen can be set to declare or return.{' '}
          {(moved > 0 || notes > 0 || calls > 0) && <b>{moved} moved, {notes} {notes === 1 ? 'note' : 'notes'}, {calls} declaration {calls === 1 ? 'call' : 'calls'}.</b>}
        </p>
      </header>

      <DraftAdvicePanel positions={positions} value={advice} onChange={onAdvice} />

      <div className="ed-tools">
        <input className="search" placeholder="Search prospects or schools…" value={query} onChange={(e) => narrow(() => setQuery(e.target.value))} aria-label="Search prospects" />
        <select className="ed-select" value={pos} onChange={(e) => narrow(() => setPos(e.target.value))} aria-label="Position">
          <option value="">All positions</option>
          {positions.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <div className="seg" role="tablist" aria-label="Show">
          {(['all', 'moved', 'notes', 'underclass'] as const).map((f) => (
            <button key={f} role="tab" className="seg-btn" aria-selected={filter === f} onClick={() => narrow(() => setFilter(f))}>
              {{ all: 'All', moved: 'Moved', notes: 'Notes', underclass: 'Underclassmen' }[f]}
            </button>
          ))}
        </div>
        <button className="btn ghost" disabled={!value.order} onClick={() => save({ ...value, order: undefined })}>Reset order</button>
      </div>

      <ul className="ed-details ed-calls ed-board">
        {shown.slice(0, limit).map(({ p, rank }) => {
          const delta = (p.consensusRank ?? rank) - rank
          const call = value.declare?.[p.id]
          return (
            <li key={p.id} data-set={delta !== 0 || !!value.notes?.[p.id] || !!call}>
              <RankInput rank={rank} max={board.length} onCommit={(r) => moveTo(p.id, r)} label={`${p.name}'s board rank`} />
              <div className="ed-nudge">
                <button className="ed-nudge-btn" disabled={rank === 1} onClick={() => moveTo(p.id, rank - 1)} aria-label={`Move ${p.name} up`}>▲</button>
                <button className="ed-nudge-btn" disabled={rank === board.length} onClick={() => moveTo(p.id, rank + 1)} aria-label={`Move ${p.name} down`}>▼</button>
              </div>
              <div className="ed-detail-who">
                <span className="ed-move-name">
                  <b>{p.name}</b>
                  {delta !== 0 && (
                    <span className="ed-delta num" data-tone={delta > 0 ? 'pos' : 'neg'} title={`Moved from #${p.consensusRank}`}>
                      {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
                    </span>
                  )}
                </span>
                <span className="muted">{p.pos} · {p.school}</span>
              </div>
              <Stats items={[{ value: `#${p.consensusRank}`, label: 'Source' }]} />
              {p.declaration?.canReturn ? (
                <div className="seg ed-market-seg" role="radiogroup" aria-label={`Does ${p.name} declare?`}>
                  {(['', 'declares', 'returns'] as const).map((k) => (
                    <button key={k} role="radio" className="seg-btn" aria-checked={(call ?? '') === k} aria-selected={(call ?? '') === k} onClick={() => setDeclare(p.id, k)}>
                      {k ? DECLARE_LABEL[k] : `Roll ${Math.round(p.declaration!.chance * 100)}%`}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="muted ed-board-declared">Declared</span>
              )}
              <input className="search" placeholder="Scouting note (optional)" value={value.notes?.[p.id] ?? ''} onChange={(e) => setNote(p.id, e.target.value)} aria-label={`Note on ${p.name}`} />
            </li>
          )
        })}
        {shown.length === 0 && <li className="muted ed-empty">Nobody matches.</li>}
      </ul>
      {shown.length > limit && (
        <button className="btn ghost ed-more" onClick={() => setLimit(limit + PAGE * 2)}>
          Show more ({shown.length - limit} left)
        </button>
      )}
    </section>
  )
}

/** A rank you can type over; it moves the prospect on Enter or when you leave the field. */
function RankInput({ rank, max, label, onCommit }: { rank: number; max: number; label: string; onCommit: (rank: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    const n = Number(text)
    if (text !== null && Number.isInteger(n) && n >= 1 && n <= max && n !== rank) onCommit(n)
    setText(null)
  }
  return (
    <input
      className="search num ed-rank"
      inputMode="numeric"
      value={text ?? String(rank)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setText(null)
          e.stopPropagation()
        }
      }}
      aria-label={label}
    />
  )
}

// ─── Depth chart ────────────────────────────────────────────────────────────

type Spots = NonNullable<EditorialData['depth']>['spots']
type Spot = { slot: string; depth: number }
type ChartPlayer = ReturnType<typeof chartPlayers>[number]
const POS_ORDER: Position[] = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'K', 'P', 'LS']
const DEPTHS = [1, 2, 3, 4] as const
const MIN_SLOT_USES = 5
const depthLabel = (d: number) => (d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : `${d}th`)
const spotLabel = (s?: Spot | null) => (s ? `${s.slot} · ${depthLabel(s.depth)}` : 'Off chart')

/**
 * Each player's role: his slot and string on the depth chart, replacing the OurLads
 * chart. Starters (1st string) drive the lineup, the roster-talent grade, trade
 * value and free-agent demand, so a change here moves all of them.
 */
function DepthChart({ snap, value, onChange }: { snap: Snapshot; value: Spots; onChange: (spots: Spots) => void }) {
  const [team, setTeam] = useState(snap.team)
  const [query, setQuery] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const narrow = (fn: () => void) => {
    fn()
    setLimit(PAGE)
  }

  // One entry per player (a few appear in two lists), with the slots seen at his position.
  const { players, slotsByPos } = useMemo(() => {
    const byId = new Map<string, ChartPlayer>()
    for (const p of chartPlayers(snap)) if (!byId.has(p.id)) byId.set(p.id, p)
    const slots = new Map<Position, Map<string, number>>()
    for (const p of byId.values()) {
      if (!p.sourceChart) continue
      const m = slots.get(p.pos) ?? new Map<string, number>()
      m.set(p.sourceChart.slot, (m.get(p.sourceChart.slot) ?? 0) + 1)
      slots.set(p.pos, m)
    }
    // Most common slot first: it's the default when a player is put on the chart. Slots
    // seen fewer than five times at a position are OurLads one-offs (an RB listed at "CE").
    const slotsByPos = new Map(
      [...slots].map(([pos, m]) => [pos, [...m].filter(([, n]) => n >= MIN_SLOT_USES).sort((a, b) => b[1] - a[1]).map(([s]) => s)]),
    )
    return { players: [...byId.values()], slotsByPos }
  }, [snap])
  const teams = useMemo(() => [...snap.teams].sort((a, b) => Number(b.id === snap.team) - Number(a.id === snap.team) || a.fullName.localeCompare(b.fullName)), [snap])

  const q = query.trim().toLowerCase()
  const shown = players
    .filter((p) => (q ? p.name.toLowerCase().includes(q) : p.team === team))
    .filter((p) => !changedOnly || p.id in value)
    .sort((a, b) => {
      const spot = (p: ChartPlayer) => (p.id in value ? value[p.id] : p.sourceChart)
      return POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos) || (spot(a)?.depth ?? 99) - (spot(b)?.depth ?? 99) || a.name.localeCompare(b.name)
    })

  const set = (p: ChartPlayer, spot: Spot | null) => {
    const next = { ...value }
    const src = p.sourceChart
    const same = spot === null ? !src : !!src && src.slot === spot.slot && src.depth === spot.depth
    if (same) delete next[p.id]
    else next[p.id] = spot
    onChange(next)
  }
  const count = Object.keys(value).length
  const teamCount = Object.keys(value).filter((id) => players.find((p) => p.id === id)?.team === team).length

  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Depth chart</h2>
        <p className="muted">
          Each player's role, replacing the OurLads chart (as of {snap.depthAsOf ?? 'the last refresh'}). A 1st-string player is a proven starter: he fills the
          lineup, counts toward the roster-talent grade, holds more trade value and draws more interest in free agency. Pick a team, or search the league.{' '}
          {count > 0 && <b>{count} changed{teamCount > 0 && teamCount < count ? `, ${teamCount} on this team` : ''}.</b>}
        </p>
      </header>

      <div className="ed-tools">
        <select className="ed-select" value={team} onChange={(e) => narrow(() => setTeam(e.target.value))} aria-label="Team" disabled={!!q}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
        </select>
        <input className="search" placeholder="Search every team's players…" value={query} onChange={(e) => narrow(() => setQuery(e.target.value))} aria-label="Search players" />
        <div className="seg" role="tablist" aria-label="Show">
          {([false, true] as const).map((c) => (
            <button key={String(c)} role="tab" className="seg-btn" aria-selected={changedOnly === c} onClick={() => narrow(() => setChangedOnly(c))}>
              {c ? 'Changed' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <ul className="ed-details ed-calls ed-depth">
        {shown.slice(0, limit).map((p) => {
          const edited = p.id in value
          const spot = edited ? value[p.id] : p.sourceChart
          const slots = [...new Set([...(spot ? [spot.slot] : []), ...(slotsByPos.get(p.pos) ?? [])])]
          return (
            <li key={p.id} data-set={edited}>
              <DepthBadge chart={spot ? { team: p.team, ...spot } : undefined} size="sm" />
              <div className="ed-detail-who">
                <b>{p.name}</b>
                <span className="muted">
                  {p.pos}{'age' in p && p.age ? ` · Age ${p.age}` : ''} · {q ? `${p.team} · ` : ''}{'type' in p ? p.type : 'Under contract'}
                </span>
              </div>
              <Stats items={[{ value: spotLabel(p.sourceChart), label: 'OurLads' }]} />
              <select
                value={spot?.slot ?? ''}
                disabled={!spot}
                onChange={(e) => spot && set(p, { slot: e.target.value, depth: spot.depth })}
                aria-label={`${p.name}'s slot`}
              >
                {!spot && <option value="">—</option>}
                {slots.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="seg ed-depth-seg" role="radiogroup" aria-label={`${p.name}'s string`}>
                {DEPTHS.map((d) => (
                  <button
                    key={d}
                    role="radio"
                    className="seg-btn"
                    aria-checked={spot?.depth === d}
                    aria-selected={spot?.depth === d}
                    onClick={() => set(p, { slot: spot?.slot ?? slots[0] ?? p.pos, depth: d })}
                  >
                    {depthLabel(d)}
                  </button>
                ))}
                <button role="radio" className="seg-btn" aria-checked={!spot} aria-selected={!spot} onClick={() => set(p, null)}>
                  Off
                </button>
              </div>
              <button className="ed-nudge-btn ed-reset" disabled={!edited} onClick={() => { const next = { ...value }; delete next[p.id]; onChange(next) }} aria-label={`Reset ${p.name} to OurLads`} title="Back to the OurLads spot">
                ↺
              </button>
            </li>
          )
        })}
        {shown.length === 0 && <li className="muted ed-empty">Nobody matches.</li>}
      </ul>
      {shown.length > limit && (
        <button className="btn ghost ed-more" onClick={() => setLimit(limit + PAGE * 2)}>
          Show more ({shown.length - limit} left)
        </button>
      )}
    </section>
  )
}

// ─── Draft order ────────────────────────────────────────────────────────────

/**
 * This season's draft order by team, replacing the projected one. Every round
 * follows it; compensatory picks stay at the end of their rounds. Each pick takes
 * the trade value and rookie contract of its new slot.
 */
function DraftOrder({ snap, value, onChange }: { snap: Snapshot; value: string[] | undefined; onChange: (teams: string[] | undefined) => void }) {
  const source = useMemo(() => sourceTeamOrder(snap.picks, snap.season), [snap])
  const order = useMemo(() => {
    const o = value?.filter((t) => source.includes(t)) ?? []
    for (const [i, t] of source.entries()) if (!o.includes(t)) o.splice(Math.min(i, o.length), 0, t)
    return o
  }, [value, source])
  const firstRound = useMemo(
    () => new Map(snap.picks.filter((p) => p.year === snap.season && p.round === 1 && !p.compensatory).map((p) => [p.originalTeam, p])),
    [snap],
  )
  const team = (id: string) => snap.teams.find((t) => t.id === id)

  const moveTo = (id: string, slot: number) => {
    const next = order.filter((t) => t !== id)
    next.splice(Math.max(0, Math.min(next.length, slot - 1)), 0, id)
    onChange(next.join() === source.join() ? undefined : next)
  }
  const moved = order.filter((t, i) => source[i] !== t).length

  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Draft order</h2>
        <p className="muted">
          The {snap.season} order, replacing the projection. Every round follows it, compensatory picks stay at the end of their rounds, and each
          pick takes the trade value and rookie contract of its new slot, so moving your team also moves its draft reserve. Traded picks
          follow the team they came from.{' '}
          {moved > 0 && <b>{moved} teams off their projected slot.</b>}
        </p>
      </header>

      <div className="ed-tools">
        <button className="btn ghost" disabled={!value} onClick={() => onChange(undefined)}>Reset order</button>
      </div>

      <ul className="ed-details ed-calls ed-order">
        {order.map((id, i) => {
          const slot = i + 1
          const delta = source.indexOf(id) + 1 - slot
          const pick = firstRound.get(id)
          const ours = pick?.owner === snap.team
          return (
            <li key={id} data-set={delta !== 0} data-ours={ours}>
              <RankInput rank={slot} max={order.length} onCommit={(r) => moveTo(id, r)} label={`${team(id)?.fullName ?? id}'s draft slot`} />
              <div className="ed-nudge">
                <button className="ed-nudge-btn" disabled={slot === 1} onClick={() => moveTo(id, slot - 1)} aria-label={`Move ${id} up`}>▲</button>
                <button className="ed-nudge-btn" disabled={slot === order.length} onClick={() => moveTo(id, slot + 1)} aria-label={`Move ${id} down`}>▼</button>
              </div>
              <div className="ed-detail-who">
                <span className="ed-move-name">
                  <b>{team(id)?.fullName ?? id}</b>
                  {delta !== 0 && (
                    <span className="ed-delta num" data-tone={delta > 0 ? 'pos' : 'neg'} title={`Projected #${source.indexOf(id) + 1}`}>
                      {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
                    </span>
                  )}
                </span>
                <span className="muted">{pick && pick.owner !== id ? `First-round pick owned by ${team(pick.owner)?.fullName ?? pick.owner}${ours ? ' (your team)' : ''}` : 'Owns its first-round pick'}</span>
              </div>
              <Stats
                items={[
                  { value: `#${source.indexOf(id) + 1}`, label: 'Projected' },
                  { value: (snap.picks.find((p) => p.year === snap.season && p.sourceOverall === slot)?.sourceValue ?? 0).toLocaleString(), label: 'Slot value' },
                ]}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A dollar amount typed in millions ("2" or "2.5"); commits on Enter or leaving the field. */
function MillionsInput({ value, disabled, label, onChange }: { value: number; disabled?: boolean; label: string; onChange: (dollars: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    const n = Number(text)
    if (text !== null && text.trim() !== '' && Number.isFinite(n) && n >= 0) onChange(Math.round(n * 1e6 / 50_000) * 50_000)
    setText(null)
  }
  return (
    <span className="ed-rule-money">
      $
      <input
        className="search num ed-rule-num"
        inputMode="decimal"
        value={text ?? String(value / 1e6)}
        disabled={disabled}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(null)
            e.stopPropagation()
          }
        }}
        aria-label={`${label}, in millions`}
      />
      M
    </span>
  )
}

// ─── Trade values ───────────────────────────────────────────────────────────

const POSITION_ORDER = ['QB', 'EDGE', 'WR', 'OT', 'CB', 'IDL', 'IOL', 'TE', 'S', 'LB', 'RB', 'K', 'P', 'FB', 'LS']

/**
 * The trade-value model behind every offer, call and asking price: per-position
 * ceilings and aging, the star premium, role and contract-control factors, how far
 * future picks drop, and where offers open. A live preview shows what the settings
 * make of the current team's roster and of future picks.
 */
function TradeValues({
  snap,
  value,
  players,
  locked,
  noFirsts,
  onChange,
  onPlayers,
  onLocked,
  onNoFirsts,
}: {
  snap: Snapshot
  value: ValuationModel | undefined
  players: Record<string, number>
  locked: string[]
  noFirsts: string[]
  onNoFirsts: (ids: string[]) => void
  onChange: (v: ValuationModel | undefined) => void
  onPlayers: (p: Record<string, number>) => void
  onLocked: (ids: string[]) => void
}) {
  const model = useMemo(() => ({ ...DEFAULT_VALUATION, ...value }), [value])
  const custom = !!value
  const save = (next: ValuationModel) => onChange(JSON.stringify(next) === JSON.stringify(DEFAULT_VALUATION) ? undefined : next)
  const set = (patch: Partial<ValuationModel>) => save({ ...model, ...patch })
  const setPos = (pos: string, patch: Partial<PositionValue>) => set({ positions: { ...model.positions, [pos]: { ...model.positions[pos], ...patch } } })

  // Values under the settings being edited, not the saved ones.
  const preview = useMemo(() => {
    const withModel: Snapshot = { ...snap, valuation: valuationContext(snap, model, players) }
    const ours = [...snap.roster]
      .map((p) => ({ p, v: tradeValue(p, withModel) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 12)
    const future = [1, 2, 3].flatMap((round) =>
      [snap.season + 1, snap.season + 2].map((year) => {
        const pick = snap.picks.find((p) => p.year === year && p.round === round && p.originalTeam === snap.team)
        return { label: `${year} R${round}`, v: pick ? pickValue(withModel, pick, snap.season) : 0 }
      }),
    )
    const slot = (v: number) => {
      const s = withModel.valuation!.chart.findIndex((c, i) => i > 0 && c <= v)
      return s > 0 ? `≈ pick ${s}` : 'more than pick 1'
    }
    return { ours, future, slot, withModel }
  }, [snap, model, players])

  const pct = (n: number) => Math.round(n * 100)
  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Trade values</h2>
        <p className="muted">
          What players and picks are worth in trades, in draft-chart points (this year's pick 1 = 3,000). A player is worth his position's ceiling,
          scaled by his APY against the position's five best-paid (raised to the star premium), his age against the position's prime, his depth-chart
          role and the years left on his deal. Offers, calls and asking prices all follow it.
        </p>
      </header>

      <div className="ed-rule-panel ed-values" data-custom={custom}>
        <div className="ed-rule-head">
          <span className="eyebrow">The model</span>
          <button className="btn ghost" disabled={!custom} onClick={() => onChange(undefined)}>Reset to defaults</button>
        </div>
        <div className="ed-values-grid">
          <NumField label="Star premium" hint="1 = straight line; higher widens the gap between stars and starters" value={model.starPower} step={0.1} min={0.2} max={5} onChange={(starPower) => set({ starPower })} />
          <NumField label="Starter floor" hint="a listed starter on a cheap deal is worth at least this share of the ceiling" value={pct(model.starterFloor)} suffix="%" min={0} max={100} onChange={(n) => set({ starterFloor: n / 100 })} />
          <NumField label="Second string" hint="value kept by a backup" value={pct(model.role.second)} suffix="%" min={0} max={100} onChange={(n) => set({ role: { ...model.role, second: n / 100 } })} />
          <NumField label="Deeper / unlisted" value={pct(model.role.deeper)} suffix="%" min={0} max={100} onChange={(n) => set({ role: { ...model.role, deeper: n / 100 } })} />
          <NumField label="One year left" hint="a rental" value={pct(model.control.one)} suffix="%" min={0} max={100} onChange={(n) => set({ control: { ...model.control, one: n / 100 } })} />
          <NumField label="Two years left" value={pct(model.control.two)} suffix="%" min={0} max={100} onChange={(n) => set({ control: { ...model.control, two: n / 100 } })} />
          <NumField label="Future picks drop" hint="rounds per season ahead; 1 is the usual NFL rule of thumb" value={model.futureRounds} step={0.25} suffix="rounds" min={0} max={3} onChange={(futureRounds) => set({ futureRounds })} />
          <RangeField label="Calls open at" hint="unsolicited offers, as a share of his value" value={model.callRange} onChange={(callRange) => set({ callRange })} />
          <RangeField label="Block offers at" hint="answers to the trade block" value={model.blockRange} onChange={(blockRange) => set({ blockRange })} />
        </div>
      </div>

      <div className="ed-values-split">
        <table className="ed-pos-table">
          <thead>
            <tr>
              <th>Position</th>
              <th title="Worth of a player paid like the position's top five, in chart points">Ceiling</th>
              <th title="Last age at full value">Prime through</th>
              <th title="Value lost each year past the prime">Decline / yr</th>
            </tr>
          </thead>
          <tbody>
            {POSITION_ORDER.filter((pos) => model.positions[pos]).map((pos) => (
              <tr key={pos}>
                <th scope="row">{pos}</th>
                <td><NumField bare label={`${pos} ceiling`} value={model.positions[pos].top} step={50} min={0} max={6000} onChange={(top) => setPos(pos, { top })} /></td>
                <td><NumField bare label={`${pos} prime`} value={model.positions[pos].prime} min={18} max={45} onChange={(prime) => setPos(pos, { prime })} /></td>
                <td><NumField bare label={`${pos} decline`} value={pct(model.positions[pos].decline)} suffix="%" min={0} max={100} onChange={(n) => setPos(pos, { decline: n / 100 })} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        <aside className="ed-values-preview">
          <div className="eyebrow">{teamNickname(snap, snap.team)}, most valuable</div>
          <ul>
            {preview.ours.map(({ p, v }) => (
              <li key={p.id}>
                <span><b>{p.name}</b> <span className="muted">{p.pos} · {p.age}</span></span>
                <span className="num">{v.toLocaleString()}</span>
                <span className="muted ed-values-slot">{preview.slot(v)}</span>
              </li>
            ))}
          </ul>
          <div className="eyebrow">Future picks</div>
          <ul>
            {preview.future.map((f) => (
              <li key={f.label}>
                <span><b>{f.label}</b></span>
                <span className="num">{f.v.toLocaleString()}</span>
                <span className="muted ed-values-slot">{preview.slot(f.v)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <PlayerValues
        snap={snap}
        withModel={preview.withModel}
        slot={preview.slot}
        value={players}
        locked={locked}
        noFirsts={noFirsts}
        onChange={onPlayers}
        onLocked={onLocked}
        onNoFirsts={onNoFirsts}
      />
    </section>
  )
}

type ValueFilter = 'set' | 'ours' | 'all'

/**
 * Values for individual players, replacing the model's for them everywhere: offers,
 * calls, negotiation and asking prices. Clear the box to hand him back to the model.
 */
function PlayerValues({
  snap,
  withModel,
  slot,
  value,
  locked,
  noFirsts,
  onChange,
  onLocked,
  onNoFirsts,
}: {
  snap: Snapshot
  withModel: Snapshot
  slot: (v: number) => string
  value: Record<string, number>
  locked: string[]
  noFirsts: string[]
  onChange: (v: Record<string, number>) => void
  onLocked: (ids: string[]) => void
  onNoFirsts: (ids: string[]) => void
}) {
  const lockedSet = new Set(locked)
  const capped = new Set(noFirsts)
  const count = new Set([...Object.keys(value), ...locked, ...noFirsts]).size
  const [filter, setFilter] = useState<ValueFilter>(count ? 'set' : 'ours')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const league = useMemo(() => {
    const seen = new Set<string>()
    return [...snap.roster, ...Object.values(snap.otherRosters).flat()].filter((p) => !seen.has(p.id) && seen.add(p.id))
  }, [snap])
  const teamName = (id: string) => snap.teams.find((t) => t.id === id)?.fullName.split(' ').pop() ?? id

  const q = query.trim().toLowerCase()
  const rows = league
    .filter((p) => (q ? p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q : filter === 'all' || (filter === 'set' ? p.id in value || lockedSet.has(p.id) || capped.has(p.id) : p.team === snap.team)))
    .map((p) => ({ p, model: modelValue(p, withModel) }))
    .sort((a, b) => (value[b.p.id] ?? b.model) - (value[a.p.id] ?? a.model))
  const set = (id: string, v: number | undefined) => {
    const next = { ...value }
    if (v === undefined) delete next[id]
    else next[id] = v
    onChange(next)
  }

  return (
    <div className="ed-manual ed-player-values">
      <h3 className="display ed-subtitle">Player values</h3>
      <p className="muted ed-help">
        Set a value for any player in the league and it replaces the model's for him everywhere: offers for him, calls about him and what his team
        asks for him. Clear the box to go back to the model. Lock a player to make him untouchable: nobody trades him, ours or theirs. Mark him
        No 1sts and no first-round pick, this year's or future, moves in any deal for him.{' '}
        {count > 0 && <b>{count} set.</b>}
      </p>
      <div className="ed-tools">
        <input className="search" placeholder="Search any player, or a team (e.g. DAL)…" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }} aria-label="Search players" />
        <div className="seg" role="tablist" aria-label="Show">
          {(['set', 'ours', 'all'] as const).map((f) => (
            <button key={f} role="tab" className="seg-btn" aria-selected={!q && filter === f} disabled={!!q} onClick={() => { setFilter(f); setLimit(PAGE) }}>
              {{ set: 'Set', ours: teamNickname(snap, snap.team), all: 'League' }[f]}
            </button>
          ))}
        </div>
      </div>
      <ul className="ed-details ed-calls ed-pvalues">
        {rows.slice(0, limit).map(({ p, model }) => {
          const own = value[p.id]
          const isLocked = lockedSet.has(p.id)
          const isCapped = capped.has(p.id)
          return (
            <li key={p.id} data-set={own !== undefined || isLocked || isCapped} data-locked={isLocked}>
              <DepthBadge chart={p.chart} size="sm" />
              <div className="ed-detail-who">
                <b>{p.name}</b>
                <span className="muted">{p.pos} · Age {p.age} · {teamName(p.team)} · {money(p.apy, 1)}</span>
              </div>
              <Stats items={[{ value: model.toLocaleString(), label: 'Model' }]} />
              <OverrideField label={`${p.name}'s value`} value={own} placeholder={String(model)} onChange={(v) => set(p.id, v)} />
              <span className="muted ed-values-slot">{slot(own ?? model)}</span>
              <button
                className="ed-lock"
                aria-pressed={isLocked}
                onClick={() => onLocked(isLocked ? locked.filter((id) => id !== p.id) : [...locked, p.id])}
                title={isLocked ? 'Untouchable: nobody trades him. Click to allow trades.' : 'Make him untouchable'}
              >
                {isLocked ? 'Untouchable' : 'Tradable'}
              </button>
              <button
                className="ed-lock ed-nofirst"
                aria-pressed={isCapped}
                onClick={() => onNoFirsts(isCapped ? noFirsts.filter((id) => id !== p.id) : [...noFirsts, p.id])}
                title={isCapped ? 'Never worth a first: no first-round pick moves in a deal for him. Click to allow.' : 'Mark him as never worth a first-round pick'}
              >
                {isCapped ? 'No 1sts' : '1sts OK'}
              </button>
              <button className="ed-nudge-btn ed-reset" disabled={own === undefined} onClick={() => set(p.id, undefined)} aria-label={`Clear ${p.name}'s value`} title="Back to the model">
                ↺
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="muted ed-empty">{filter === 'set' && !q ? 'No player values set yet. Search for a player, or show your team or the league.' : 'Nobody matches.'}</li>}
      </ul>
      {rows.length > limit && (
        <button className="btn ghost ed-more" onClick={() => setLimit(limit + PAGE * 2)}>
          Show more ({rows.length - limit} left)
        </button>
      )}
    </div>
  )
}

/** A value that can be left empty: empty means "use the model". */
function OverrideField({ label, value, placeholder, onChange }: { label: string; value: number | undefined; placeholder: string; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text !== null) {
      const n = Number(text)
      if (text.trim() === '') onChange(undefined)
      else if (Number.isFinite(n) && n >= 0 && n <= 6000) onChange(Math.round(n))
    }
    setText(null)
  }
  return (
    <input
      className="search num ed-rule-num ed-override"
      inputMode="numeric"
      value={text ?? (value === undefined ? '' : String(value))}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setText(null)
          e.stopPropagation()
        }
      }}
      aria-label={label}
    />
  )
}

/** A number you can type over; it applies on Enter or when you leave the field. */
function NumField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  bare,
}: {
  label: string
  hint?: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
  bare?: boolean
}) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    const n = Number(text)
    if (text !== null && text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n / step) * step)
    setText(null)
  }
  const input = (
    <span className="ed-num">
      <input
        className="search num ed-rule-num"
        inputMode="decimal"
        value={text ?? String(Math.round(value * 1000) / 1000)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(null)
            e.stopPropagation()
          }
        }}
        aria-label={label}
      />
      {suffix && <span className="muted">{suffix}</span>}
    </span>
  )
  if (bare) return input
  return (
    <label className="ed-values-field">
      <span className="eyebrow">{label}</span>
      {input}
      {hint && <span className="muted ed-values-hint">{hint}</span>}
    </label>
  )
}

/** A low–high share, edited as two percentages. */
function RangeField({ label, hint, value, onChange }: { label: string; hint?: string; value: [number, number]; onChange: (v: [number, number]) => void }) {
  const [lo, hi] = value
  return (
    <div className="ed-values-field">
      <span className="eyebrow">{label}</span>
      <span className="ed-num">
        <NumField bare label={`${label} low`} value={Math.round(lo * 100)} min={0} max={300} onChange={(n) => onChange([n / 100, Math.max(n / 100, hi)])} />
        <span className="muted">to</span>
        <NumField bare label={`${label} high`} value={Math.round(hi * 100)} min={0} max={300} onChange={(n) => onChange([Math.min(lo, n / 100), n / 100])} />
        <span className="muted">%</span>
      </span>
      {hint && <span className="muted ed-values-hint">{hint}</span>}
    </div>
  )
}

// ─── Feedback ───────────────────────────────────────────────────────────────

const VERDICT_TEXT: Record<Verdict, string> = { 'too-high': 'Too high', 'too-low': 'Too low' }
const ACTION_TEXT: Record<ReportAction, string> = { flagged: 'Flagged', adjusted: 'Adjusted', ignored: 'Ignored', reopened: 'Reopened' }
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Offers players flagged as too high or too low. Adjust the player's value here (it
 * goes into Player values, like any edit, and ships when saved), open the trade-value
 * model, or ignore the report. Every step stays in the report's history.
 */
function Feedback({
  snap,
  reports,
  error,
  players,
  onPlayers,
  onResolve,
  onOpenValues,
}: {
  snap: Snapshot
  reports: OfferReport[] | null
  error: string | null
  players: Record<string, number>
  onPlayers: (p: Record<string, number>) => void
  onResolve: (id: string, action: ReportAction, detail?: string) => Promise<string | undefined>
  onOpenValues: () => void
}) {
  const [showResolved, setShowResolved] = useState(false)
  const league = useMemo(() => new Map([...snap.roster, ...Object.values(snap.otherRosters).flat()].map((p) => [p.id, p])), [snap])
  const newest = (a: OfferReport, b: OfferReport) => b.history[b.history.length - 1].at.localeCompare(a.history[a.history.length - 1].at)
  const open = (reports ?? []).filter((r) => r.status === 'open').sort(newest)
  const resolved = (reports ?? []).filter((r) => r.status !== 'open').sort(newest)
  const shown = showResolved ? resolved : open

  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Feedback</h2>
        <p className="muted">
          Trade offers players flagged as too high or too low. Set the player's value right here (it lands in Player values and ships when you
          save), open the trade-value model, or ignore the report. Each report keeps its history.
        </p>
      </header>
      {error && <p className="neg">{error}</p>}
      {reports && (
        <div className="seg" role="tablist" aria-label="Show">
          <button role="tab" className="seg-btn" aria-selected={!showResolved} onClick={() => setShowResolved(false)}>Open · {open.length}</button>
          <button role="tab" className="seg-btn" aria-selected={showResolved} onClick={() => setShowResolved(true)}>Resolved · {resolved.length}</button>
        </div>
      )}
      <div className="ed-reports">
        {shown.map((r) => (
          <ReportCard key={r.id} snap={snap} report={r} player={league.get(r.player.id)} players={players} onPlayers={onPlayers} onResolve={onResolve} onOpenValues={onOpenValues} />
        ))}
        {reports && shown.length === 0 && <p className="muted ed-empty">{showResolved ? 'Nothing resolved yet.' : 'No open reports. Flags from the game land here.'}</p>}
      </div>
    </section>
  )
}

function ReportCard({
  snap,
  report: r,
  player,
  players,
  onPlayers,
  onResolve,
  onOpenValues,
}: {
  snap: Snapshot
  report: OfferReport
  player: Snapshot['roster'][number] | undefined
  players: Record<string, number>
  onPlayers: (p: Record<string, number>) => void
  onResolve: (id: string, action: ReportAction, detail?: string) => Promise<string | undefined>
  onOpenValues: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const model = player ? modelValue(player, snap) : r.player.modelValue
  const current = players[r.player.id] ?? model
  const [value, setValue] = useState<number>(current)
  const team = snap.teams.find((t) => t.id === r.offer.team)
  const ratio = r.player.value ? Math.round((r.offer.value / r.player.value) * 100) : 0
  const act = async (action: ReportAction, detail?: string) => {
    setBusy(true)
    setProblem((await onResolve(r.id, action, detail)) ?? null)
    setBusy(false)
  }
  const apply = () => {
    const next = { ...players }
    if (value === model) delete next[r.player.id]
    else next[r.player.id] = value
    onPlayers(next)
    void act('adjusted', `Value ${current.toLocaleString()} → ${value.toLocaleString()}${value === model ? ' (the model)' : ''}`)
  }

  return (
    <article className="ed-report" data-verdict={r.verdict} data-status={r.status}>
      <header className="ed-report-head">
        <span className="ed-report-verdict">{VERDICT_TEXT[r.verdict]}</span>
        <b>
          {team?.name ?? r.offer.team} {r.offer.kind === 'call' ? 'call about' : 'offer for'} {r.player.name}
        </b>
        <span className="muted">{r.player.pos} · Age {r.player.age}</span>
        {r.status !== 'open' && <span className="ed-report-status">{r.status === 'adjusted' ? 'Adjusted' : 'Ignored'}</span>}
      </header>
      <div className="ed-report-offer">
        <span className="muted">Offered</span>
        <span>{r.offer.picks.join(', ') || 'no picks'}</span>
        <span className="num">
          {r.offer.value.toLocaleString()} pts · {ratio}% of his {r.player.value.toLocaleString()}
          {r.player.value !== r.player.modelValue && <span className="muted"> (model {r.player.modelValue.toLocaleString()})</span>}
        </span>
      </div>
      {r.note && <blockquote className="ed-report-note">{r.note}</blockquote>}

      {r.status === 'open' ? (
        <div className="ed-report-actions">
          <label className="ed-num">
            <span className="muted">His value</span>
            <OverrideField label={`${r.player.name}'s value`} value={value} placeholder={String(model)} onChange={(v) => setValue(v ?? model)} />
            <span className="muted">now {current.toLocaleString()}{current === model ? ' (model)' : ''}</span>
          </label>
          <button className="btn" disabled={busy || value === current} onClick={apply}>Apply</button>
          <button className="btn ghost" onClick={onOpenValues}>Trade values</button>
          <button className="btn ghost" disabled={busy} onClick={() => act('ignored')}>Ignore</button>
        </div>
      ) : (
        <div className="ed-report-actions">
          <button className="btn ghost" disabled={busy} onClick={() => act('reopened')}>Reopen</button>
        </div>
      )}
      {problem && <p className="neg">{problem}</p>}

      <ol className="ed-report-history" aria-label="History">
        {r.history.map((e, i) => (
          <li key={i} data-action={e.action}>
            <span className="ed-report-when">{when(e.at)}</span>
            <span>{ACTION_TEXT[e.action]}{e.detail ? `: ${e.detail}` : ''}</span>
          </li>
        ))}
      </ol>
      <p className="muted ed-report-meta">
        {r.run.mode === 'genuine' ? 'Genuine' : 'Simplified'} run · seed {r.run.seed} · wave {r.offer.wave + 1} · data {r.run.dataVersion}
      </p>
    </article>
  )
}

/**
 * Positions the draft screen stops recommending once we've taken one early, so a
 * second quarterback isn't suggested right after the first. The Fit column shows
 * them as filled.
 */
function DraftAdvicePanel({
  positions,
  value,
  onChange,
}: {
  positions: string[]
  value: DraftAdviceRule[] | undefined
  onChange: (rules: DraftAdviceRule[] | undefined) => void
}) {
  const rules = value ?? DEFAULT_DRAFT_ADVICE
  const save = (next: DraftAdviceRule[]) => onChange(JSON.stringify(next) === JSON.stringify(DEFAULT_DRAFT_ADVICE) ? undefined : next)
  const unused = positions.filter((p) => !rules.some((r) => r.pos === p))
  return (
    <div className="ed-rule-panel" data-custom={value !== undefined}>
      <div className="ed-rule-head">
        <span className="eyebrow">Recommendations · stop suggesting a position once we've drafted one early</span>
        <button className="btn ghost" disabled={value === undefined} onClick={() => onChange(undefined)}>Reset</button>
      </div>
      <ul className="ed-advice">
        {rules.map((r, i) => (
          <li key={r.pos}>
            <span>Once we draft a</span>
            <select className="ed-select" value={r.pos} onChange={(e) => save(rules.map((x, k) => (k === i ? { ...x, pos: e.target.value } : x)))} aria-label="Position">
              {[r.pos, ...unused].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <span>in the first</span>
            <select className="ed-select" value={r.rounds} onChange={(e) => save(rules.map((x, k) => (k === i ? { ...x, rounds: Number(e.target.value) } : x)))} aria-label="Rounds">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>{r.rounds === 1 ? 'round' : 'rounds'}, stop recommending {r.pos}s.</span>
            <button className="ed-nudge-btn ed-reset" onClick={() => save(rules.filter((_, k) => k !== i))} aria-label={`Remove the ${r.pos} rule`} title="Remove">×</button>
          </li>
        ))}
        {rules.length === 0 && <li className="muted">No rules: the draft recommends by board and need alone.</li>}
      </ul>
      {unused.length > 0 && (
        <button className="btn ghost ed-advice-add" onClick={() => save([...rules, { pos: unused[0], rounds: 3 }])}>Add a rule</button>
      )}
    </div>
  )
}

/**
 * The reference for the interest levels: what each means, its chance of a yes, and
 * the line the offer dialog shows (it never shows the number). The chances between
 * Accepts and Declines and every line can be tuned; only changes over the defaults
 * are saved.
 */
function InterestLevels({
  value,
  onChange,
}: {
  value: EditorialData['coach']['levels']
  onChange: (levels: EditorialData['coach']['levels']) => void
}) {
  const set = (i: Interest, patch: Partial<InterestLevel>) => {
    const own: Partial<InterestLevel> = { ...value?.[i], ...patch }
    const def = DEFAULT_INTEREST_LEVELS[i]
    if (own.chance === def.chance) delete own.chance
    if (own.copy === undefined || own.copy.trim() === '' || own.copy === def.copy) delete own.copy
    const next = { ...value, [i]: own }
    if (!Object.keys(own).length) delete next[i]
    onChange(Object.keys(next).length ? next : undefined)
  }
  return (
    <div className="ed-manual">
      <div className="ed-rule-panel" data-custom={value !== undefined}>
        <div className="ed-rule-head">
          <span className="eyebrow">Interest levels · what each one does when we offer the job</span>
          <button className="btn ghost" disabled={value === undefined} onClick={() => onChange(undefined)}>Reset</button>
        </div>
        <table className="ed-levels">
          <thead>
            <tr>
              <th>Level</th>
              <th>Chance of a yes</th>
              <th>The offer dialog says</th>
            </tr>
          </thead>
          <tbody>
            {INTERESTS.map((i) => {
              const level = interestLevel(value, i)
              return (
                <tr key={i} data-custom={value?.[i] !== undefined}>
                  <th scope="row">
                    <b>{INTEREST_LABEL[i]}</b>
                    <span className="muted">{INTEREST_MEANING[i]}</span>
                  </th>
                  <td>
                    {FIXED_INTERESTS.includes(i) ? (
                      <span className="num ed-level-fixed">{Math.round(level.chance * 100)}%</span>
                    ) : (
                      <NumField
                        label={`${INTEREST_LABEL[i]}: chance of a yes`}
                        value={Math.round(level.chance * 100)}
                        onChange={(n) => set(i, { chance: n / 100 })}
                        min={0}
                        max={100}
                        suffix="%"
                        bare
                      />
                    )}
                  </td>
                  <td>
                    <input
                      className="search"
                      value={value?.[i]?.copy ?? level.copy}
                      onChange={(e) => set(i, { copy: e.target.value })}
                      aria-label={`What the offer dialog says for ${INTEREST_LABEL[i]}`}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="muted ed-help">
          The dialog never shows the number. Staff promotions always accept, whatever their level, and each save rolls once per
          candidate, so asking again gets the same answer.
        </p>
      </div>
    </div>
  )
}
