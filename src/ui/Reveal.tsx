import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { seasonCapHit, yearsRemaining } from '../engine/cap'
import { money } from '../engine/format'
import type { Contract, Move } from '../engine/types'
import { useGame } from '../game/store'
import { Key, PlayerArt } from './parts'
import { play } from './sound'
import './reveal.css'

const STAMP: Partial<Record<Move['kind'], string>> = {
  sign: 'Signed',
  tag: 'Tagged',
  tender: 'Tendered',
  match: 'Matched',
  trade: 'Acquired',
  draft: 'The pick is in',
  udfa: 'Signed',
}

/** Card finish from his real depth-chart spot: starters get the premium foil. */
function tierOf(p: Contract): string {
  const d = p.chart?.depth
  return d === 1 ? 'elite' : d === 2 ? 'silver' : 'bronze'
}

function roleOf(p: Contract): string {
  if (p.chart) return p.chart.depth === 1 ? 'Starter' : `Depth ${p.chart.depth}`
  return p.experience === 0 ? 'Rookie' : 'Reserve'
}

/**
 * The signing moment: the card flips in from the back, catches the light, and
 * the count of proven starters moves underneath it.
 */
export function RevealCard({ move, player, startersDelta, season }: { move: Move; player: Contract; startersDelta: number; season: number }) {
  const team = useGame((s) => s.run?.team ?? '')
  const teamName = useGame((s) => s.run?.teamName ?? '')
  const tier = tierOf(player)
  const starter = player.chart?.depth === 1
  useEffect(() => {
    play('flip')
    const t = setTimeout(() => play(starter || move.kind === 'draft' ? 'crowd' : 'stamp'), 550)
    return () => clearTimeout(t)
  }, [move.id, starter, move.kind])

  return (
    <div className="reveal">
      <motion.div className="reveal-rays" data-tier={tier} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8 }} />
      <motion.div
        className="reveal-stamp display"
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.6, type: 'spring', stiffness: 300, damping: 20 }}
      >
        {STAMP[move.kind]}
      </motion.div>

      <div className="reveal-stage">
        <motion.div
          className="pcard"
          data-tier={tier}
          initial={{ rotateY: 180, scale: 0.7, y: 60 }}
          animate={{ rotateY: 0, scale: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.2, 0.9, 0.1, 1] }}
        >
          <div className="pcard-back">
            <span className="display">{team}</span>
          </div>
          <div className="pcard-front">
            <div className="pcard-top">
              <div className="pcard-role">
                <span className="display">{player.pos}</span>
                <span className="display pcard-pos">{roleOf(player)}</span>
              </div>
              <span className="pcard-brand display">{teamName}</span>
            </div>
            <div className="pcard-art">
              <PlayerArt id={player.id} name={player.name} pos={player.pos} size={170} />
            </div>
            <div className="pcard-name display">{player.name}</div>
            <div className="pcard-meta">
              <span>Age {player.age}</span>
              <span>{yearsRemaining(player, season)} yr{yearsRemaining(player, season) === 1 ? '' : 's'}</span>
              <span>{money(seasonCapHit(player, season))} cap hit</span>
            </div>
            <i className="pcard-foil" />
          </div>
        </motion.div>
      </div>

      <motion.div className="reveal-copy" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
        <div className="display reveal-head">{move.headline}</div>
        <div className="reveal-detail">{move.detail}</div>
        {startersDelta !== 0 && (
          <div className={`reveal-delta num ${startersDelta > 0 ? 'pos' : 'neg'}`}>
            {startersDelta > 0 ? '▲' : '▼'} {Math.abs(startersDelta)} <span>proven starter{Math.abs(startersDelta) === 1 ? '' : 's'} in the lineup</span>
          </div>
        )}
        <div className="muted reveal-hint"><Key>ENTER</Key> Continue</div>
      </motion.div>
    </div>
  )
}
