import { animate, useMotionValue, useTransform, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { money } from '../engine/format'
import type { ChartSpot, Position } from '../engine/types'
import { useHeadshot } from './headshots'
import { positionGroup } from './lib'
import './parts.css'

// ─── Depth chart badge ──────────────────────────────────────────────────────

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th']

/** His spot on his team's current OurLads depth chart: string and position slot. */
export function DepthBadge({ chart, size = 'md' }: { chart?: ChartSpot; size?: 'sm' | 'md' | 'lg' }) {
  const label = chart ? `${ORDINAL[chart.depth] ?? `${chart.depth}th`} string, ${chart.slot}` : 'Not on a depth chart'
  return (
    <div className={`dbadge dbadge-${size}`} data-depth={chart ? Math.min(chart.depth, 3) : 0} aria-label={label} title={label}>
      <span className="dbadge-num">{chart ? (ORDINAL[chart.depth] ?? `${chart.depth}th`) : '—'}</span>
      <span className="dbadge-lbl">{chart?.slot ?? 'None'}</span>
    </div>
  )
}

/** A prospect's consensus big-board rank, in the same slot the depth badge uses. */
export function RankBadge({ rank, size = 'md' }: { rank: number; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`dbadge dbadge-${size}`} data-depth={rank <= 32 ? 1 : rank <= 100 ? 2 : 3} aria-label={`Consensus board rank ${rank}`}>
      <span className="dbadge-num">#{rank}</span>
      <span className="dbadge-lbl">Board</span>
    </div>
  )
}

// ─── Animated numbers ───────────────────────────────────────────────────────

/** Counts to a new money value like a scoreboard instead of snapping. */
export function MoneyCount({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => money(v))
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: [0.2, 0.9, 0.1, 1] })
    return c.stop
  }, [mv, value])
  return <motion.span className={className}>{text}</motion.span>
}

// ─── Player art ─────────────────────────────────────────────────────────────

/**
 * Card art: the player's headshot on a unit-tinted plate. Players without a photo (and
 * every player until it loads) get a silhouette with their initials as a jersey mark.
 */
export function PlayerArt({ id, name, pos, size = 64 }: { id?: string; name: string; pos: Position; size?: number }) {
  const src = useHeadshot(id, size)
  const [loaded, setLoaded] = useState<string>()
  const [failed, setFailed] = useState<string>()
  const showPhoto = src && failed !== src
  const initials = name.replace(/[^A-Za-z .'-]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('')
  return (
    <div className="art" data-unit={positionGroup(pos)} data-photo={showPhoto && loaded === src} style={{ width: size, height: size, fontSize: size }}>
      <span className="art-initials display">{initials}</span>
      <svg viewBox="0 0 64 64" aria-hidden>
        <circle className="art-body" cx="32" cy="24" r="11" />
        <path className="art-body" d="M8 64c1-14 10-22 24-22s23 8 24 22z" />
      </svg>
      {showPhoto && (
        <img
          className="art-photo"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
        />
      )}
    </div>
  )
}

/** Arrow keys drawn as icons: the display font has no arrow glyphs, and the fallback is a colour emoji font. */
const ARROWS: Record<string, string> = {
  '↑': 'M6 10V2M2.5 5.5 6 2l3.5 3.5',
  '↓': 'M6 2v8M2.5 6.5 6 10l3.5-3.5',
  '←': 'M10 6H2M5.5 2.5 2 6l3.5 3.5',
  '→': 'M2 6h8M6.5 2.5 10 6l-3.5 3.5',
  '↵': 'M10 2.5V6.5H2.5M5.5 3.5 2.5 6.5l3 3',
}

export function Key({ children }: { children: string }) {
  const arrow = ARROWS[children]
  return (
    <kbd className="key" aria-label={arrow ? children : undefined}>
      {arrow ? (
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
          <path d={arrow} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        children
      )}
    </kbd>
  )
}
