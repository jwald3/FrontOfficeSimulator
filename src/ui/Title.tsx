import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useRef, useState } from 'react'
import { capSummary } from '../engine/cap'
import { money } from '../engine/format'
import { decodeChallenge, encodeChallenge } from '../engine/challenge'
import { createRun } from '../engine/run'
import type { StartingPoint } from '../engine/quickstart'
import type { Mode, Objective, Snapshot } from '../engine/types'
import { useGame } from '../game/store'
import { SoundToggle } from './Game'
import { useEvenSlant, useHotkeys } from './lib'
import { DepthBadge, Key, PlayerArt } from './parts'
import { applyTheme, TEAM_COLORS, type Conference } from './theme'
import './title.css'

// 'switch' is the team picker opened from the menu header: it returns to the menu.
type Stage = 'press' | 'menu' | 'team' | 'switch' | 'setup' | 'about'

const EDITOR = import.meta.env.DEV || new URLSearchParams(location.search).has('editor')

const MODES: { id: Mode; name: string; tag: string; body: string }[] = [
  {
    id: 'genuine',
    name: 'Genuine',
    tag: '90-man roster',
    body: 'The complete front office: tenders, tags, offer sheets, futures and UDFA recruiting, building toward 90.',
  },
  {
    id: 'simplified',
    name: 'Simplified',
    tag: '53-man roster',
    body: 'Roster moves, re-signings, free agency and the draft. No tenders, tags, offer sheets, futures or UDFAs.',
  },
]

const OBJECTIVES: { id: Objective; name: string; body: string }[] = [
  { id: 'balanced', name: 'Balanced', body: 'Improve the roster while protecting cap flexibility and future picks.' },
  { id: 'draft', name: 'Build Through the Draft', body: 'Stockpile picks and youth. Graded on draft capital and age curve.' },
  { id: 'win-now', name: 'Win Now', body: 'Maximise next season. Picks and future cap are currency.' },
  { id: 'cap-room', name: 'Create Cap Room', body: 'Clear long-term money and finish with flexibility to spare.' },
]

const STARTS: { id: StartingPoint; name: string; body: string }[] = [
  { id: 'start', name: 'The beginning', body: 'Every decision is yours, from the head coach on.' },
  { id: 'free-agency', name: 'Free agency', body: 'Coach kept, suggested cuts made, re-signings settled. Go shopping.' },
  { id: 'draft', name: 'The draft', body: 'Everything before simulated, lineup holes filled in free agency. Run the war room.' },
]

export function Title() {
  const snap = useGame((s) => s.snap)!
  const hasSave = useGame((s) => s.hasSave)
  const [stage, setStage] = useState<Stage>('press')

  useHotkeys({ enter: () => setStage('menu'), ' ': () => setStage('menu') }, stage === 'press')

  return (
    <div className="title">
      <AnimatePresence mode="wait">
        {stage === 'press' && <Press key="press" snap={snap} onStart={() => setStage('menu')} />}
        {stage === 'menu' && <Menu key="menu" snap={snap} hasSave={hasSave} go={setStage} />}
        {stage === 'team' && <TeamPicker key="team" onBack={() => setStage('menu')} onPick={() => setStage('setup')} />}
        {stage === 'switch' && <TeamPicker key="switch" eyebrow="Your team" onBack={() => setStage('menu')} onPick={() => setStage('menu')} />}
        {stage === 'setup' && <Setup key="setup" onBack={() => setStage('menu')} onTeam={() => setStage('team')} />}
        {stage === 'about' && <About key="about" snap={snap} onBack={() => setStage('menu')} />}
      </AnimatePresence>
    </div>
  )
}

// ─── Press start ────────────────────────────────────────────────────────────

function Wordmark({ big }: { big?: boolean }) {
  return (
    <div className={`wordmark ${big ? 'wordmark-big' : ''}`}>
      <span className="wm-mark display">Front Office</span>
      <span className="wm-off display">Offseason</span>
    </div>
  )
}

function Press({ snap, onStart }: { snap: Snapshot; onStart: () => void }) {
  const team = useGame((s) => s.team)
  return (
    <motion.button
      className="press"
      onClick={onStart}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="press-x display"
        initial={{ scale: 1.6, opacity: 0, rotate: -6 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ duration: 0.9, ease: [0.2, 0.9, 0.1, 1] }}
      >
        {team ?? 'FO'}
      </motion.div>
      <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35, duration: 0.6 }}>
        <Wordmark big />
        <div className="press-year display">{snap.season}</div>
      </motion.div>
      <motion.div
        className="press-cta"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.35, 1] }}
        transition={{ delay: 1, duration: 2.4, repeat: Infinity, repeatType: 'reverse' }}
      >
        <span className="pointer-only">Press <Key>ENTER</Key> to start</span>
        <span className="touch-only">Tap to start</span>
      </motion.div>
      <div className="press-foot muted">
        Data as of {snap.asOf} · {snap.prospects.length} prospects · {snap.freeAgents.length} free agents
      </div>
    </motion.button>
  )
}

// ─── Main menu ──────────────────────────────────────────────────────────────

interface MenuItem {
  id: string
  label: string
  sub: string
  act: () => void
}

function Menu({ snap, hasSave, go }: { snap: Snapshot; hasSave: boolean; go: (s: Stage) => void }) {
  const team = useGame((s) => s.team)
  const savedTeam = useGame((s) => snap.teams.find((t) => t.id === s.savedTeam)?.fullName)
  const resume = useGame((s) => s.resume)
  const openEditorial = useGame((s) => s.openEditorial)
  const challenge = useGame((s) => s.challenge)
  const items: MenuItem[] = useMemo(
    () => [
      ...(challenge
        ? [{ id: 'challenge', label: 'Accept Challenge', sub: `Play run ${encodeChallenge(challenge)}: same team, same players, same draft`, act: () => go('setup') }]
        : []),
      ...(hasSave ? [{ id: 'continue', label: 'Continue', sub: savedTeam ? `Pick up your saved ${savedTeam} offseason` : 'Pick up your saved offseason', act: resume }] : []),
      { id: 'new', label: 'New Offseason', sub: 'Pick a team, then a mode, objective and starting point', act: () => go('team') },
      { id: 'about', label: 'Data & Rules', sub: 'Sources, cap rules and assumptions', act: () => go('about') },
      // Editors only: shown on the dev server, or with ?editor in the URL.
      ...(EDITOR ? [{ id: 'editorial', label: 'Editorial', sub: 'Choose the head coach candidates and other content', act: openEditorial }] : []),
    ],
    [hasSave, savedTeam, resume, go, challenge, openEditorial],
  )
  const [focus, setFocus] = useState(0)
  useHotkeys(
    {
      arrowup: () => setFocus((f) => (f + items.length - 1) % items.length),
      arrowdown: () => setFocus((f) => (f + 1) % items.length),
      enter: () => items[focus].act(),
      escape: () => go('press'),
    },
  )

  // The starting position of any run; the seed only affects personalities.
  const cap = useMemo(
    () => capSummary(createRun(snap, { mode: 'genuine', objective: 'balanced', seed: 0 }), snap.rookieScale.slots, snap.minimumRookieBase),
    [snap],
  )
  // The three biggest contracts among our listed starters.
  const stars = useMemo(() => snap.roster.filter((p) => p.chart?.depth === 1).sort((a, b) => b.apy - a.apy).slice(0, 3), [snap])
  const firstRounders = snap.picks.filter((p) => p.owner === snap.team && p.year === snap.season && p.round === 1)
  // Without a first-rounder, the team's earliest pick this year says more than "none".
  const earliest = snap.picks
    .filter((p) => p.owner === snap.team && p.year === snap.season)
    .sort((a, b) => (a.overall ?? 999) - (b.overall ?? 999))[0]
  const picksStat =
    firstRounders.length > 1
      ? { label: '1st-round picks', value: firstRounders.map((p) => `#${p.overall}`).join(' · ') }
      : firstRounders.length === 1
        ? { label: '1st-round pick', value: `#${firstRounders[0].overall}` }
        : { label: 'No 1st · first pick', value: earliest ? `R${earliest.round} · #${earliest.overall}` : 'None' }
  const fullName = snap.teams.find((t) => t.id === snap.team)?.fullName

  return (
    <motion.div className="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -40 }}>
      <header className="menu-head">
        <Wordmark />
        <button className="menu-team" onClick={() => go('switch')} title="Change team">
          <span className="eyebrow">{snap.season} · {team ? fullName : 'Pick a team'}</span>
          <span className="menu-team-change">Change</span>
        </button>
      </header>

      <nav className="menu-list" aria-label="Main menu">
        {items.map((it, i) => (
          <motion.button
            key={it.id}
            className="menu-item sheen"
            data-active={i === focus}
            onMouseEnter={() => setFocus(i)}
            onFocus={() => setFocus(i)}
            onClick={it.act}
            initial={{ x: -60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.08 * i, duration: 0.45, ease: [0.2, 0.9, 0.1, 1] }}
          >
            <span className="menu-label display">{it.label}</span>
            <span className="menu-sub">{it.sub}</span>
          </motion.button>
        ))}
      </nav>

      {team ? <motion.aside
        className="menu-card slab"
        initial={{ x: 80, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.6, ease: [0.2, 0.9, 0.1, 1] }}
      >
        <div className="eyebrow">Front office briefing · {fullName}</div>
        <div className="brief-grid">
          <Stat label="Effective cap space" value={money(cap.effectiveSpace)} tone={cap.effectiveSpace < 0 ? 'neg' : 'pos'} />
          <Stat label="Under contract" value={String(cap.contractCount)} />
          <Stat label={picksStat.label} value={picksStat.value} />
          <Stat label="Projected cap" value={money(cap.adjustedCap)} />
        </div>
        <div className="eyebrow brief-sub">Cornerstones</div>
        <ul className="brief-stars">
          {stars.map((p) => (
            <li key={p.id}>
              <PlayerArt id={p.id} name={p.name} pos={p.pos} size={44} />
              <div>
                <div className="brief-name">{p.name}</div>
                <div className="muted">{p.pos} · Age {p.age}</div>
              </div>
              <DepthBadge chart={p.chart} size="sm" />
            </li>
          ))}
        </ul>
      </motion.aside> : (
        <motion.aside
          className="menu-card slab menu-card-empty"
          initial={{ x: 80, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6, ease: [0.2, 0.9, 0.1, 1] }}
        >
          <div className="eyebrow">Front office briefing</div>
          <p className="display menu-card-pitch">32 teams. One offseason. Yours to run.</p>
          <p className="muted">
            Pick a team under New Offseason to see its cap space, picks and cornerstones. Every page takes on its colours.
          </p>
        </motion.aside>
      )}

      <footer className="hints">
        <span><Key>↑</Key><Key>↓</Key> Move</span>
        <span><Key>ENTER</Key> Select</span>
      </footer>
    </motion.div>
  )
}

/** A briefing figure; money ones take the money colours (green good, red bad), not the team's. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="stat">
      <div className={`stat-val num ${tone ?? ''}`}>{value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  )
}

// ─── Setup ──────────────────────────────────────────────────────────────────

function Setup({ onBack, onTeam }: { onBack: () => void; onTeam: () => void }) {
  const begin = useGame((s) => s.begin)
  const snap = useGame((s) => s.snap)!
  const team = snap.teams.find((t) => t.id === snap.team)
  const challenge = useGame((s) => s.challenge)
  const setChallenge = useGame((s) => s.setChallenge)
  const [mode, setMode] = useState<Mode>('genuine')
  const [objective, setObjective] = useState<Objective>('balanced')
  const [start, setStart] = useState<StartingPoint>('start')
  const [code, setCode] = useState('')
  // The three rows of cards differ in height; lean them all at one angle so their outer edges line up.
  const setupRef = useRef<HTMLDivElement>(null)
  useEvenSlant(setupRef, '.choice')
  // A challenge fixes the seed, mode and objective so both players face the same offseason.
  const chosenMode = challenge?.mode ?? mode
  const chosenObjective = challenge?.objective ?? objective
  const kickoff = () => begin(chosenMode, chosenObjective, challenge?.seed, start)
  useHotkeys({ escape: onBack, enter: kickoff })
  const typed = code.trim() ? decodeChallenge(code, snap.teams.map((t) => t.id)) : null

  return (
    <motion.div ref={setupRef} className="setup" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
      <header className="setup-head">
        <div className="eyebrow">New offseason · {team?.fullName}</div>
        <h1 className="display setup-title">Set your <em>blueprint.</em></h1>
      </header>

      {challenge ? (
        <div className="challenge-banner slab">
          <span className="display">Challenge {encodeChallenge(challenge)}</span>
          <span className="muted">Same free agents, same draft class, same league as the player who sent it. Beat their grade.</span>
          <button className="btn ghost" onClick={() => setChallenge(undefined)}>Play my own</button>
        </div>
      ) : (
        <div className="challenge-entry">
          <input
            className="search"
            placeholder="Have a challenge code? FO-…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Challenge code"
          />
          <button className="btn ghost" disabled={!typed} onClick={() => typed && setChallenge(typed)}>Load challenge</button>
        </div>
      )}

      <section>
        <h2 className="setup-step display"><span>1</span> Mode</h2>
        <div className="mode-grid">
          {MODES.map((m) => (
            <button key={m.id} className="choice sheen slab" data-on={chosenMode === m.id} disabled={!!challenge && challenge.mode !== m.id} onClick={() => setMode(m.id)}>
              <span className="choice-name display">{m.name}</span>
              <span className="choice-tag">{m.tag}</span>
              <span className="choice-body">{m.body}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="setup-step display"><span>2</span> Objective <small>locks when you begin · shapes your final grade</small></h2>
        <div className="obj-grid">
          {OBJECTIVES.map((o) => (
            <button key={o.id} className="choice sheen slab" data-on={chosenObjective === o.id} disabled={!!challenge && challenge.objective !== o.id} onClick={() => setObjective(o.id)}>
              <span className="choice-name display">{o.name}</span>
              <span className="choice-body">{o.body}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="setup-step display"><span>3</span> Starting point <small>skip ahead · everything before it is simulated</small></h2>
        <div className="start-grid">
          {STARTS.map((s) => (
            <button key={s.id} className="choice choice-compact sheen slab" data-on={start === s.id} onClick={() => setStart(s.id)}>
              <span className="choice-name display">{s.name}</span>
              <span className="choice-body">{s.body}</span>
            </button>
          ))}
        </div>
      </section>

      <footer className="setup-foot">
        <span className="setup-foot-left">
          <button className="btn ghost" onClick={onBack}><Key>ESC</Key> Back</button>
          {!challenge && <button className="btn ghost" onClick={onTeam}>Change team</button>}
        </span>
        <label className="setup-sound muted">
          <SoundToggle /> Sound
        </label>
        <button className="btn kickoff" onClick={kickoff}>Kick off <Key>ENTER</Key></button>
      </footer>
    </motion.div>
  )
}

// ─── Team picker ────────────────────────────────────────────────────────────

const CONFERENCES: Conference[] = ['AFC', 'NFC']
const DIVISIONS = ['East', 'North', 'South', 'West'] as const

/**
 * All 32 teams by division. Hovering a team previews its colours on the whole page;
 * picking one rebuilds the data from its point of view.
 */
function TeamPicker({ onBack, onPick, eyebrow = 'New offseason' }: { onBack: () => void; onPick: () => void; eyebrow?: string }) {
  const snap = useGame((s) => s.snap)!
  const chosen = useGame((s) => s.team)
  const setTeam = useGame((s) => s.setTeam)
  const [focus, setFocus] = useState<string | undefined>(chosen)
  const pick = (id: string) => {
    setTeam(id)
    onPick()
  }
  // Leave the page in the chosen team's colours (or neutral) after a hover preview.
  const preview = (id: string | undefined) => applyTheme(id ?? useGame.getState().team)
  useHotkeys({ escape: onBack, enter: () => focus && pick(focus) })
  const byId = new Map(snap.teams.map((t) => [t.id, t]))

  return (
    <motion.div className="setup teams" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
      <header className="setup-head">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="display setup-title">Pick your <em>team.</em></h1>
      </header>
      <div className="team-confs" onMouseLeave={() => preview(undefined)}>
        {CONFERENCES.map((conf) => (
          <section key={conf} className="team-conf">
            <h2 className="setup-step display">{conf}</h2>
            <div className="team-divs">
              {DIVISIONS.map((div) => (
                <div key={div} className="team-div">
                  <div className="eyebrow">{conf} {div}</div>
                  {Object.entries(TEAM_COLORS)
                    .filter(([, c]) => c.conference === conf && c.division === div)
                    .map(([id, c]) => {
                      const t = byId.get(id)
                      if (!t) return null
                      const [city, nick] = [t.fullName.slice(0, t.fullName.lastIndexOf(' ')), t.fullName.split(' ').pop()]
                      return (
                        <button
                          key={id}
                          className="team-tile"
                          data-on={chosen === id}
                          style={{ '--tc': c.primary, '--tp': c.pop } as React.CSSProperties}
                          onMouseEnter={() => {
                            setFocus(id)
                            preview(id)
                          }}
                          onFocus={() => {
                            setFocus(id)
                            preview(id)
                          }}
                          onClick={() => pick(id)}
                        >
                          <span className="team-swatch" aria-hidden />
                          <span className="team-text">
                            <span className="team-city">{city}</span>
                            <span className="display team-nick">{nick}</span>
                          </span>
                          <span className="num team-cap" title="Cap space before the offseason (OverTheCap)">{money(t.capSpace)}</span>
                        </button>
                      )
                    })}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <footer className="setup-foot">
        <button className="btn ghost" onClick={onBack}><Key>ESC</Key> Back</button>
        <span className="muted team-hint">{snap.season} cap space per OverTheCap, before rollover and the rookie reserve.</span>
      </footer>
    </motion.div>
  )
}

// ─── About ──────────────────────────────────────────────────────────────────

function About({ snap, onBack }: { snap: Snapshot; onBack: () => void }) {
  useHotkeys({ escape: onBack })
  return (
    <motion.div className="about" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <header className="setup-head">
        <div className="eyebrow">Data version {snap.version}</div>
        <h1 className="display setup-title">Data &amp; <em>rules.</em></h1>
      </header>
      <div className="about-body scroll">
        <ul className="about-notes">
          {snap.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
        <h2 className="setup-step display">Sources</h2>
        <p className="muted about-credit">
          A fan project, not affiliated with or endorsed by the NFL or any team. Contracts and cap tables from OverTheCap, depth charts from
          OurLads, headshots from NFL.com via nflverse, coaching staffs from Wikipedia.
        </p>
        <p className="muted about-credit">
          Front Office is open source (MIT). Fork it, change it, make it yours:{' '}
          <a className="about-link" href="https://github.com/jwald3/FrontOfficeSimulator" target="_blank" rel="noreferrer">
            github.com/jwald3/FrontOfficeSimulator
          </a>
        </p>
        <ul className="about-notes about-sources">
          {(snap.sources ?? []).map((s) => (
            <li key={s.url + s.label}>
              <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
            </li>
          ))}
        </ul>
      </div>
      <footer className="setup-foot">
        <button className="btn ghost" onClick={onBack}><Key>ESC</Key> Back</button>
      </footer>
    </motion.div>
  )
}
