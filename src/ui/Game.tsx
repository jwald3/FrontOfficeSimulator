import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { signedMoney } from '../engine/format'
import { LINEUP_SPOTS, newcomers } from '../engine/summary'
import { PHASES, type MoveKind, type Phase } from '../engine/types'
import { useCap, useGame, useStarters } from '../game/store'
import { Coach } from './Coach'
import { InHouse } from './InHouse'
import { Draft } from './Draft'
import { BreakingNews } from './Broadcast'
import { DepthTable, Field } from './Field'
import { FreeAgency } from './FreeAgency'
import { ReSign } from './ReSign'
import { Summary } from './Summary'
import { isReveal, PHASE_INFO, useHotkeys } from './lib'
import { Key, MoneyCount } from './parts'
import { RevealCard } from './Reveal'
import { play, type Cue } from './sound'
import './game.css'

export function Game() {
  const phase = useGame((s) => s.run!.phase)
  // Every phase opens with a title card until it has been seen.
  const [introSeen, setIntroSeen] = useState<Phase | null>(null)
  const closeIntro = useCallback(() => setIntroSeen(phase), [phase])
  const introFor = introSeen === phase ? null : phase
  const [depthOpen, setDepthOpen] = useState(false)
  const outcomeOpen = useGame((s) => !!s.outcome)
  useHotkeys({ d: () => setDepthOpen((o) => !o) }, !outcomeOpen && !introFor)

  return (
    <div className="game">
      <TopBar onDepth={() => setDepthOpen(true)} />
      <CapBug />
      <main className="stage">
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            className="stage-inner"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            transition={{ duration: 0.35, ease: [0.2, 0.9, 0.1, 1] }}
          >
            {phase === 'coach' ? <Coach /> : phase === 'in-house' ? <InHouse /> : phase === 're-sign' ? <ReSign /> : phase === 'free-agency' ? <FreeAgency /> : phase === 'draft' ? <Draft /> : <Summary />}
          </motion.div>
        </AnimatePresence>
      </main>
      <Ticker />
      <AnimatePresence>
        {introFor && <PhaseIntro key={introFor} phase={introFor} onDone={closeIntro} />}
      </AnimatePresence>
      <AnimatePresence>{depthOpen && <DepthChart key="depth" onClose={() => setDepthOpen(false)} />}</AnimatePresence>
      <BreakingNews />
      <OutcomeCard />
      <Notice />
    </div>
  )
}

// ─── Top bar & phase tabs ───────────────────────────────────────────────────

function TopBar({ onDepth }: { onDepth: () => void }) {
  const phase = useGame((s) => s.run!.phase)
  const mode = useGame((s) => s.run!.mode)
  const teamName = useGame((s) => s.run!.teamName)
  const quit = useGame((s) => s.quitToTitle)
  const current = PHASES.indexOf(phase)
  return (
    <header className="topbar">
      <button className="tb-brand" onClick={quit} title="Main menu">
        <span className="display tb-team">{teamName}</span>
        <span className="display">Front Office</span>
      </button>
      <nav className="phase-tabs" aria-label="Offseason phases">
        {PHASES.map((p, i) => (
          <div key={p} className="phase-tab" data-state={i < current ? 'done' : i === current ? 'now' : 'next'}>
            <span className="pt-n num">{PHASE_INFO[p].n}</span>
            <span className="pt-name pt-full">{PHASE_INFO[p].name}</span>
            <span className="pt-name pt-short">{PHASE_INFO[p].short}</span>
            {i === current && <motion.span layoutId="phase-underline" className="pt-line" />}
          </div>
        ))}
      </nav>
      <button className="tb-depth" onClick={onDepth} title="Depth chart (D)">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M3 5h18v14H3zM12 5v14M3 12h18" /></svg>
        <span>Depth chart</span>
      </button>
      <span className="tb-mode">{mode === 'genuine' ? 'Genuine · 90' : 'Simplified · 53'}</span>
      <SoundToggle />
    </header>
  )
}

/** Speaker toggle; sound starts off and the choice is remembered. */
export function SoundToggle() {
  const sound = useGame((s) => s.sound)
  const toggle = useGame((s) => s.toggleSound)
  return (
    <button className="sound-toggle" onClick={toggle} aria-pressed={sound} aria-label={sound ? 'Mute sound' : 'Turn sound on'} title={sound ? 'Sound on' : 'Sound off'}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 9h4l5-4v14l-5-4H4z" />
        {sound ? <path className="wave" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" /> : <path className="wave" d="M16 9l5 6M21 9l-5 6" />}
      </svg>
    </button>
  )
}

// ─── Depth chart ────────────────────────────────────────────────────────────

/** Remembers whether the depth chart opens on the field or the table. */
const DEPTH_VIEW_KEY = 'front-office:depth-view'

function DepthChart({ onClose }: { onClose: () => void }) {
  const run = useGame((s) => s.run!)
  const snap = useGame((s) => s.snap!)
  const starters = useStarters()
  const fresh = useMemo(() => new Set(newcomers(run, snap).map((p) => p.id)), [run, snap])
  const [view, setView] = useState<'field' | 'table'>(() => {
    try {
      return localStorage.getItem(DEPTH_VIEW_KEY) === 'table' ? 'table' : 'field'
    } catch {
      return 'field'
    }
  })
  const choose = (v: 'field' | 'table') => {
    setView(v)
    try {
      localStorage.setItem(DEPTH_VIEW_KEY, v)
    } catch {
      // Remembering the view is a convenience.
    }
  }
  useHotkeys({ escape: onClose })
  return (
    <motion.div className="depth-overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="depth-panel" onClick={(e) => e.stopPropagation()} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div className="depth-head">
          <div>
            <div className="eyebrow">Starters from real depth charts · newcomers pulse</div>
            <div className="display depth-title">Depth chart</div>
          </div>
          {starters != null && (
            <div className="depth-rating">
              <div className="num">{starters}<small>/{LINEUP_SPOTS}</small></div>
              <div className="muted">lineup spots held by players who start on a current depth chart</div>
            </div>
          )}
        </div>
        {view === 'field' ? <Field roster={run.roster} fresh={fresh} /> : <DepthTable roster={run.roster} fresh={fresh} />}
        <div className="depth-foot">
          <button className="btn ghost" onClick={onClose}><Key>ESC</Key> Close</button>
          <div className="seg" role="tablist" aria-label="View">
            {(['field', 'table'] as const).map((v) => (
              <button key={v} role="tab" className="seg-btn" aria-selected={view === v} onClick={() => choose(v)}>
                {v === 'field' ? 'Field' : 'Table'}
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Cap scorebug ───────────────────────────────────────────────────────────

function CapBug() {
  const cap = useCap()!
  const starters = useStarters()
  const target = useGame((s) => (s.run!.mode === 'genuine' ? 90 : 53))
  return (
    <section className="capbug" aria-label="Cap room">
      <div className="cb-main">
        <span className="cb-lbl">Effective cap space</span>
        <MoneyCount value={cap.effectiveSpace} className={`cb-big num ${cap.effectiveSpace < 0 ? 'neg' : ''}`} />
      </div>
      <CbCell label="Adjusted cap" value={cap.adjustedCap} />
      <CbCell label="Committed" value={cap.committed} />
      <CbCell label="Dead money" value={cap.dead} />
      <CbCell label="Total space" value={cap.totalSpace} />
      <CbCell label="Draft reserve" value={cap.draftReserve} />
      {starters != null && (
        <div className="cb-cell cb-team" title="Lineup spots held by players who start on a current depth chart">
          <span className="cb-lbl">Proven starters</span>
          <span className="cb-val num">{starters}<small>/{LINEUP_SPOTS}</small></span>
        </div>
      )}
      <div className="cb-cell">
        <span className="cb-lbl">Roster</span>
        <span className="cb-val num">{cap.contractCount}<small>/{target}</small></span>
      </div>
    </section>
  )
}

function CbCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="cb-cell">
      <span className="cb-lbl">{label}</span>
      <MoneyCount value={value} className="cb-val num" />
    </div>
  )
}

// ─── News ticker ────────────────────────────────────────────────────────────

function Ticker() {
  const news = useGame((s) => s.run!.news)
  const items = [...news].reverse().slice(0, 12)
  return (
    <footer className="ticker">
      <span className="ticker-tag display">League Wire</span>
      <div className="ticker-track">
        <div className="ticker-roll" key={news.length}>
          {[...items, ...items].map((n, i) => (
            <span key={`${n.id}-${i}`} className="ticker-item" data-tone={n.tone}>
              {n.text}
            </span>
          ))}
        </div>
      </div>
    </footer>
  )
}

// ─── Phase title card ───────────────────────────────────────────────────────

function PhaseIntro({ phase, onDone }: { phase: Phase; onDone: () => void }) {
  const info = PHASE_INFO[phase]
  useEffect(() => play('whoosh'), [phase])
  useEffect(() => {
    const t = setTimeout(onDone, 2100)
    return () => clearTimeout(t)
  }, [onDone])
  useHotkeys({ enter: onDone, escape: onDone, ' ': onDone })
  return (
    <motion.div
      className="intro"
      onClick={onDone}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
    >
      <motion.div
        className="intro-band"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        exit={{ scaleX: 0, originX: 1 }}
        transition={{ duration: 0.45, ease: [0.2, 0.9, 0.1, 1] }}
      />
      <div className="intro-text">
        <motion.div
          className="intro-n display"
          initial={{ x: -120, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5, ease: [0.2, 0.9, 0.1, 1] }}
        >
          Phase {info.n}
        </motion.div>
        <motion.div
          className="intro-name display"
          initial={{ x: 160, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.28, duration: 0.55, ease: [0.2, 0.9, 0.1, 1] }}
        >
          {info.name}
        </motion.div>
        <motion.div className="intro-tag" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
          {info.tagline}
        </motion.div>
      </div>
    </motion.div>
  )
}

// ─── Result card ────────────────────────────────────────────────────────────

const OUTCOME_STAMP: Record<MoveKind, string> = {
  'coach-keep': 'Staying',
  'coach-fire': 'Fired',
  'coach-decline': 'Declined',
  'coach-hire': 'Hired',
  release: 'Released',
  restructure: 'Restructured',
  'trade-block': 'On the block',
  sign: 'Signed',
  tag: 'Tagged',
  tender: 'Tendered',
  futures: 'Futures deal',
  'talks-ended': 'Talks over',
  'let-walk': 'Moving on',
  match: 'Matched',
  'decline-sheet': 'Not matched',
  trade: 'Trade',
  draft: 'The pick is in',
  udfa: 'Signed',
}

const OUTCOME_CUE: Partial<Record<MoveKind, Cue>> = {
  'coach-fire': 'stamp',
  'coach-decline': 'buzz',
  'coach-hire': 'horn',
  release: 'stamp',
  restructure: 'cash',
  'talks-ended': 'buzz',
  'trade-block': 'whoosh',
  trade: 'horn',
  'decline-sheet': 'stamp',
}

const BAD_OUTCOMES = new Set<MoveKind>(['talks-ended', 'coach-decline'])

function OutcomeCard() {
  const outcome = useGame((s) => s.outcome)
  const season = useGame((s) => s.run?.season ?? 0)
  const dismiss = useGame((s) => s.dismissOutcome)
  useHotkeys({ enter: dismiss, escape: dismiss, ' ': dismiss }, !!outcome)
  const bad = outcome && BAD_OUTCOMES.has(outcome.move.kind)
  const reveal = outcome && isReveal(outcome.move, outcome.player)

  // Cards play their own sounds; everything else gets a cue by result.
  useEffect(() => {
    if (!outcome || reveal) return
    play(OUTCOME_CUE[outcome.move.kind] ?? 'stamp')
  }, [outcome, reveal])

  return (
    <AnimatePresence>
      {outcome && (
        <motion.div
          key={outcome.key}
          className="outcome"
          data-bad={bad}
          data-reveal={!!reveal}
          onClick={dismiss}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {reveal ? (
            <RevealCard move={outcome.move} player={outcome.player!} startersDelta={outcome.startersDelta} season={season} />
          ) : (
            <motion.div
              className="outcome-card"
              initial={{ y: 40, scale: 0.94, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.2, 0.9, 0.1, 1] }}
            >
              <div className="outcome-plate slab" aria-hidden />
              <motion.div
                className="outcome-stamp display"
                initial={{ scale: 2.4, opacity: 0, rotate: -14 }}
                animate={{ scale: 1, opacity: 1, rotate: -6 }}
                transition={{ delay: 0.15, type: 'spring', stiffness: 380, damping: 18 }}
              >
                {OUTCOME_STAMP[outcome.move.kind]}
              </motion.div>
              <div className="outcome-head display">{outcome.move.headline}</div>
              <div className="outcome-detail">{outcome.move.detail}</div>
              {outcome.move.capDelta !== 0 && (
                <div className="outcome-delta num" data-spend={outcome.move.capDelta < 0}>
                  {signedMoney(outcome.move.capDelta)} <span>cap space</span>
                </div>
              )}
              <div className="outcome-hint muted"><Key>ENTER</Key> Continue</div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Notice toast ───────────────────────────────────────────────────────────

function Notice() {
  const notice = useGame((s) => s.notice)
  const dismiss = useGame((s) => s.dismissNotice)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(dismiss, 3200)
    return () => clearTimeout(t)
  }, [notice, dismiss])
  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          key={notice.key}
          className="notice"
          role="status"
          onClick={dismiss}
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
        >
          <span className="notice-flag display">Flag</span>
          {notice.text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Confirm dialog ─────────────────────────────────────────────────────────

export function Confirm({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useHotkeys({ enter: onConfirm, escape: onCancel })
  return (
    <motion.div className="confirm-scrim" onClick={onCancel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="confirm slab"
        role="dialog"
        aria-modal
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.2, 0.9, 0.1, 1] }}
      >
        <div className="display confirm-title">{title}</div>
        <div className="confirm-body">{children}</div>
        <div className="confirm-note muted">Submitted decisions are final for this run.</div>
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onCancel}><Key>ESC</Key> Cancel</button>
          <button className={`btn ${danger ? 'danger' : ''}`} onClick={onConfirm} autoFocus>
            {confirmLabel} <Key>ENTER</Key>
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
