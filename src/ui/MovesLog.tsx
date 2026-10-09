import { motion } from 'framer-motion'
import { signedMoney } from '../engine/format'
import { PHASES, type Move, type Phase, type RunState } from '../engine/types'
import { PHASE_INFO } from './lib'
import './inhouse.css'

/**
 * Every move this offseason, grouped by the phase it was made in, newest phase and
 * newest move first. Moves saved before phases were recorded fall under "Earlier".
 */
export function MovesLog({ run }: { run: RunState }) {
  const groups: { phase: Phase | undefined; moves: Move[] }[] = [...PHASES, undefined]
    .map((phase) => ({ phase, moves: run.moves.filter((m) => m.phase === phase).reverse() }))
    .filter((g) => g.moves.length)
    .reverse()
  // Without recorded phases there's nothing to group by; skip the lone heading.
  const headed = groups.length > 1 || groups[0]?.phase !== undefined

  return (
    <motion.div className="moves scroll" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {run.moves.length === 0 && <p className="muted moves-empty">Your first decision starts the story.</p>}
      {groups.map((g) => (
        <section key={g.phase ?? 'earlier'} className="moves-group">
          {headed && <div className="eyebrow moves-phase">{g.phase ? PHASE_INFO[g.phase].name : 'Earlier'}</div>}
          <ol>
            {g.moves.map((m) => (
              <li key={m.id} className="move" data-kind={m.kind}>
                <div className="move-head">{m.headline}</div>
                <div className="muted">{m.detail}</div>
                {m.capDelta !== 0 && <div className="num pos">{signedMoney(m.capDelta)}</div>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </motion.div>
  )
}
