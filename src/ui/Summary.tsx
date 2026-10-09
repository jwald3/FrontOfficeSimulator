import { motion } from 'framer-motion'
import { useMemo } from 'react'
import { encodeChallenge } from '../engine/challenge'
import { signedMoney } from '../engine/format'
import { CATEGORY_NAME, gradeOffseason, LINEUP_SPOTS, newcomers } from '../engine/summary'
import { capSummary } from '../engine/cap'
import type { Move, Objective } from '../engine/types'
import { useGame } from '../game/store'
import { Field } from './Field'
import { PHASE_INFO } from './lib'
import { SharePanel } from './SeasonShare'
import type { ShareCardData } from './shareCard'
import './summary.css'

const OBJECTIVE_NAME: Record<Objective, string> = {
  balanced: 'Balanced',
  draft: 'Build Through the Draft',
  'win-now': 'Win Now',
  'cap-room': 'Create Cap Room',
}

/** Moves worth a line in the recap; restructure declines and listings are noise here. */
const RECAP_KINDS = new Set(['coach-fire', 'coach-hire', 'release', 'restructure', 'sign', 'tag', 'trade', 'draft', 'match', 'decline-sheet'])

/** How much a move belongs on the share card: big transactions first, then the top pick. */
const CARD_PRIORITY: Partial<Record<Move['kind'], number>> = { 'coach-hire': 6, trade: 5, sign: 4, tag: 4, match: 3, draft: 3, release: 2, restructure: 1 }

function headlineMoves(moves: Move[]): string[] {
  const firstPick = moves.find((m) => m.kind === 'draft')
  return moves
    .filter((m) => CARD_PRIORITY[m.kind] && (m.kind !== 'draft' || m === firstPick))
    .sort((a, b) => CARD_PRIORITY[b.kind]! - CARD_PRIORITY[a.kind]! || Math.abs(b.capDelta) - Math.abs(a.capDelta))
    .slice(0, 4)
    .map((m) => m.headline)
}

export function Summary() {
  const run = useGame((s) => s.run!)
  const snap = useGame((s) => s.snap!)
  const quit = useGame((s) => s.quitToTitle)
  const verdict = useMemo(() => gradeOffseason(run, snap), [run, snap])
  const fresh = useMemo(() => new Set(newcomers(run, snap).map((p) => p.id)), [run, snap])
  const moves = run.moves.filter((m) => RECAP_KINDS.has(m.kind))
  const delta = verdict.startersAfter - verdict.startersBefore
  const capSpace = useMemo(() => capSummary(run, snap.rookieScale.slots, snap.minimumRookieBase).effectiveSpace, [run, snap])
  const card: ShareCardData = useMemo(
    () => ({
      verdict,
      capSpace,
      moveCount: moves.length,
      objective: OBJECTIVE_NAME[run.objective],
      code: encodeChallenge(run),
      season: run.season,
      team: snap.teams.find((t) => t.id === run.team)?.fullName ?? run.teamName,
      highlights: headlineMoves(run.moves),
    }),
    [verdict, capSpace, moves.length, run, snap],
  )

  return (
    <div className="summary scroll">
      <header className="sum-head">
        <div className="eyebrow">{PHASE_INFO.summary.n} / {PHASE_INFO.summary.name} · Objective: {OBJECTIVE_NAME[run.objective]}</div>
        <h1 className="display board-title">{PHASE_INFO.summary.tagline}</h1>
      </header>

      <section className="verdict">
        <motion.div
          className="grade display"
          data-letter={verdict.letter[0]}
          initial={{ scale: 3, opacity: 0, rotate: -18 }}
          animate={{ scale: 1, opacity: 1, rotate: -6 }}
          transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.3 }}
        >
          {verdict.letter}
        </motion.div>
        <div className="verdict-body">
          <motion.p className="verdict-headline display" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
            {verdict.headline}
          </motion.p>
          <div className="starters-move">
            <span className="num">{verdict.startersBefore}</span>
            <span className="muted">→</span>
            <span className={`num ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}`}>{verdict.startersAfter}</span>
            <span className="muted">of {LINEUP_SPOTS} lineup spots held by proven starters</span>
          </div>
          <ul className="cats">
            {verdict.categories.map((c, i) => (
              <li key={c.id}>
                <div className="cat-top">
                  <span className="cat-name">{CATEGORY_NAME[c.id]}</span>
                  <span className="cat-weight">{Math.round(c.weight * 100)}% of grade</span>
                  <span className="num cat-score">{Math.round(c.score)}</span>
                </div>
                <div className="cat-bar">
                  <motion.i
                    data-tone={c.score >= 75 ? 'good' : c.score >= 55 ? 'mid' : 'bad'}
                    initial={{ width: 0 }}
                    animate={{ width: `${c.score}%` }}
                    transition={{ delay: 1 + i * 0.12, duration: 0.7, ease: [0.2, 0.9, 0.1, 1] }}
                  />
                </div>
                <div className="muted cat-detail">{c.detail}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SharePanel data={card} />

      <div className="sum-grid">
        <section className="depth">
          <div className="eyebrow">Starters from real depth charts · newcomers pulse</div>
          <Field roster={run.roster} fresh={fresh} compact />
        </section>

        <section className="recap-moves">
          <div className="eyebrow">Your offseason, move by move</div>
          {moves.length === 0 && <p className="muted">You stood pat. Every single day.</p>}
          <ol>
            {moves.map((m) => (
              <li key={m.id} className="move" data-kind={m.kind}>
                <div className="move-head">{m.headline}</div>
                <div className="muted">{m.detail}</div>
                {m.capDelta !== 0 && <div className="num">{signedMoney(m.capDelta)}</div>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className="sum-foot">
        <button className="btn" onClick={quit}>Main menu</button>
      </footer>
    </div>
  )
}
