import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { money } from '../engine/format'
import { pickLabel } from '../engine/trades'
import type { Move, RunState } from '../engine/types'
import { useGame } from '../game/store'
import { play } from './sound'
import './broadcast.css'

// ─── Incoming call ──────────────────────────────────────────────────────────

/**
 * New trade offers ring in like a phone call. Taking the call opens that offer in
 * the inbox; voicemail just files them there.
 */
export function IncomingCall({ onTake }: { onTake: (offerId: string) => void }) {
  const run = useGame((s) => s.run!)
  const snap = useGame((s) => s.snap!)
  const seen = useGame((s) => s.seenCalls)
  const markSeen = useGame((s) => s.markCallsSeen)
  const busy = useGame((s) => !!s.outcome)
  const fresh = run.tradeOffers.filter((o) => !seen.includes(o.id))
  const call = !busy ? fresh[0] : undefined
  const callId = call?.id

  useEffect(() => {
    if (callId) play('ring')
  }, [callId])

  if (!call) return null
  const team = snap.teams.find((t) => t.id === call.team)
  const player = run.roster.find((p) => p.id === call.playerId)
  const picks = run.picks.filter((p) => call.pickIds.includes(p.id))
  const voicemail = () => markSeen(fresh.map((o) => o.id))

  return (
    <AnimatePresence>
      <motion.div key={call.id} className="call-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className="call" initial={{ y: 80, rotate: -2, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 20 }}>
          <div className="call-ring" aria-hidden>
            <i /><i /><i />
            <svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" /></svg>
          </div>
          <div className="eyebrow call-eyebrow">Incoming call{fresh.length > 1 ? ` · ${fresh.length} on hold` : ''}</div>
          <div className="display call-who">{team?.fullName ?? call.team}</div>
          <div className="call-about">{call.kind === 'call' ? 'Calling about' : 'Offer for'} {player ? `${player.pos} ${player.name}` : 'your player'}</div>
          <div className="call-line">
            &ldquo;{call.line ?? `We like ${player?.name ?? 'your guy'}. Here's what we can do.`}&rdquo;
          </div>
          <div className="call-picks">{picks.map((p) => <span key={p.id} className="chip">{pickLabel(p)}</span>)}</div>
          <div className="call-actions">
            <button className="btn ghost" onClick={voicemail}>Send to voicemail</button>
            <button
              className="btn call-take"
              onClick={() => {
                voicemail()
                onTake(call.id)
              }}
            >
              Take the call
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ─── Breaking news ──────────────────────────────────────────────────────────

interface Bulletin {
  id: string
  tag: string
  text: string
  sub?: string
}

/** Which of our moves are big enough to break into the broadcast. */
function bulletinFor(m: Move): Bulletin | null {
  const id = `m${m.id}`
  if (m.kind === 'trade') return { id, tag: 'Trade', text: m.headline, sub: m.detail }
  if (m.kind === 'coach-fire' || m.kind === 'coach-hire') return { id, tag: 'Breaking', text: m.headline, sub: m.detail }
  if (m.kind === 'tag') return { id, tag: 'Breaking', text: m.headline, sub: m.detail }
  if (m.kind === 'match') return { id, tag: 'Breaking', text: m.headline, sub: m.detail }
  if (m.kind === 'sign' && m.capDelta <= -8_000_000) return { id, tag: 'Breaking', text: m.headline, sub: `${m.detail} · ${money(-m.capDelta)} this season` }
  if (m.kind === 'release' && m.capDelta >= 8_000_000) return { id, tag: 'Breaking', text: m.headline, sub: m.detail }
  return null
}

/**
 * A broadcast lower-third for big moves and league alerts. Queued, one at a
 * time, and held back while a result card is on screen.
 */
export function BreakingNews() {
  const run = useGame((s) => s.run as RunState)
  const busy = useGame((s) => !!s.outcome)
  // Only moves and alerts after this screen mounted are news.
  const [baseline] = useState(() => ({ move: run.moves.at(-1)?.id ?? 0, news: run.news.at(-1)?.id ?? 0 }))
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set())

  const bulletins = useMemo<Bulletin[]>(
    () => [
      ...run.moves.filter((m) => m.id > baseline.move).map(bulletinFor).filter((b): b is Bulletin => !!b),
      ...run.news
        .filter((n) => n.id > baseline.news && n.tone === 'alert' && !/^BREAKING/.test(n.text))
        .map((n) => ({ id: `n${n.id}`, tag: 'Alert', text: n.text })),
    ],
    [run.moves, run.news, baseline],
  )
  const current = busy ? undefined : bulletins.find((b) => !shown.has(b.id))
  const done = (id: string) => setShown((s) => new Set(s).add(id))

  useEffect(() => {
    if (!current) return
    play('whoosh')
    const t = setTimeout(() => setShown((s) => new Set(s).add(current.id)), 4200)
    return () => clearTimeout(t)
  }, [current])

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          className="bulletin"
          data-tag={current.tag}
          onClick={() => done(current.id)}
          initial={{ x: '-110%' }}
          animate={{ x: 0 }}
          exit={{ x: '110%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 26 }}
        >
          <span className="bulletin-tag display">{current.tag}</span>
          <div className="bulletin-body">
            <div className="display bulletin-text">{current.text}</div>
            {current.sub && <div className="bulletin-sub">{current.sub}</div>}
          </div>
          <motion.i className="bulletin-timer" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 4.2, ease: 'linear' }} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
