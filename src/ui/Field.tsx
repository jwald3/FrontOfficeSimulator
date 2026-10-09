import { AnimatePresence, motion } from 'framer-motion'
import { useMemo } from 'react'
import { LINEUP, startingLineup } from '../engine/summary'
import type { Position, RawContractPlayer } from '../engine/types'
import './field.css'

/**
 * Where each starting spot lines up, as % of the field (x across, y down).
 * Defense at the top, offense at the bottom, the line of scrimmage between.
 */
const SPOTS: Record<Position, [number, number][]> = {
  QB: [[50, 70]],
  RB: [[50, 84]],
  WR: [[7, 56], [93, 56], [19, 62]],
  TE: [[79, 58]],
  OT: [[31, 57], [69, 57]],
  IOL: [[40.5, 57], [50, 57], [59.5, 57]],
  EDGE: [[27, 42], [73, 42]],
  IDL: [[43, 42], [57, 42]],
  LB: [[39, 29], [61, 29]],
  CB: [[7, 40], [93, 40], [20, 32]],
  S: [[34, 15], [66, 15]],
  K: [],
  P: [],
  FB: [],
  LS: [],
}

interface Chip {
  key: string
  pos: Position
  x: number
  y: number
  player?: RawContractPlayer
}

/** Chip colour from his real depth-chart spot: starter, 2nd string, deeper or unlisted. */
function tier(p?: RawContractPlayer): string {
  if (!p) return 'empty'
  const d = p.chart?.depth
  return d === 1 ? 'elite' : d === 2 ? 'silver' : 'bronze'
}

function chartLabel(p: RawContractPlayer): string {
  return p.chart ? `${p.chart.depth === 1 ? 'Starter' : `Depth ${p.chart.depth}`} (${p.chart.slot}, ${p.chart.team})` : 'not on a depth chart'
}

function lastName(name: string): string {
  const parts = name.split(' ')
  const last = parts.at(-1)!
  return /^(Jr\.?|Sr\.?|II|III|IV)$/.test(last) && parts.length > 2 ? parts.at(-2)! : last
}

export function Field({ roster, fresh, compact }: { roster: RawContractPlayer[]; fresh?: Set<string>; compact?: boolean }) {
  const { chips, specialists } = useMemo(() => {
    const lineup = startingLineup(roster)
    const chips: Chip[] = []
    const used: Partial<Record<Position, number>> = {}
    for (const s of lineup) {
      const i = used[s.pos] ?? 0
      used[s.pos] = i + 1
      const spot = SPOTS[s.pos][i]
      if (spot) chips.push({ key: s.player?.id ?? `empty-${s.pos}-${i}`, pos: s.pos, x: spot[0], y: spot[1], player: s.player })
    }
    const specialists = lineup.filter((s) => !SPOTS[s.pos].length)
    return { chips, specialists }
  }, [roster])

  return (
    <div className={`pitch ${compact ? 'pitch-compact' : ''}`}>
      <div className="turf" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} className="yard" style={{ top: `${(i + 1) * 10}%` }} />
        ))}
        <i className="los" />
        <span className="unit-label display" data-unit="def">Defense</span>
        <span className="unit-label display" data-unit="off">Offense</span>
      </div>
      <AnimatePresence>
        {chips.map((c) => (
          <motion.div
            key={c.key}
            className="chip-player"
            data-unit={c.y < 50 ? 'def' : 'off'}
            data-tier={tier(c.player)}
            data-new={!!c.player && !!fresh?.has(c.player.id)}
            initial={{ opacity: 0, scale: 0.4, left: c.x < 50 ? '-6%' : '106%', top: `${c.y}%` }}
            animate={{ opacity: 1, scale: 1, left: `${c.x}%`, top: `${c.y}%` }}
            exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.25 } }}
            transition={{ type: 'spring', stiffness: 180, damping: 22 }}
            title={c.player ? `${c.player.name} · ${c.pos} · ${chartLabel(c.player)}` : `${c.pos}: empty`}
          >
            <span className="jersey num">{c.player?.chart ? c.player.chart.depth : '—'}</span>
            <span className="chip-name">{c.player ? lastName(c.player.name) : 'Open'}</span>
            <span className="chip-pos">{c.pos}</span>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="specialists">
        {specialists.map((s) => (
          <span key={s.pos} className="spec">
            <b className="display">{s.pos}</b> {s.player ? lastName(s.player.name) : 'Open'}
          </span>
        ))}
      </div>
    </div>
  )
}

const UNITS: { name: string; positions: Position[] }[] = [
  { name: 'Offense', positions: ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL'] },
  { name: 'Defense', positions: ['EDGE', 'IDL', 'LB', 'CB', 'S'] },
  { name: 'Specialists', positions: ['K', 'P'] },
]

/**
 * The depth chart as a table: each lineup position with its starters, then
 * everyone else on the roster at that position, in the same order the lineup
 * uses (real depth-chart spot, then the bigger contract).
 */
export function DepthTable({ roster, fresh }: { roster: RawContractPlayer[]; fresh?: Set<string> }) {
  const rows = useMemo(() => {
    const starters = new Set(startingLineup(roster).map((s) => s.player?.id))
    const rank = (p: RawContractPlayer) => p.chart?.depth ?? 99
    return UNITS.map((u) => ({
      name: u.name,
      rows: u.positions.map((pos) => {
        const count = LINEUP.find((l) => l.pos === pos)?.count ?? 0
        const all = roster.filter((p) => p.pos === pos).sort((a, b) => rank(a) - rank(b) || b.apy - a.apy)
        return { pos, count, starters: all.filter((p) => starters.has(p.id)), backups: all.filter((p) => !starters.has(p.id)) }
      }),
    }))
  }, [roster])

  const name = (p: RawContractPlayer) => (
    <span key={p.id} className="dt-player" data-tier={tier(p)} data-new={!!fresh?.has(p.id)} title={`${p.name} · ${chartLabel(p)}`}>
      <span className="dt-depth num">{p.chart ? p.chart.depth : '—'}</span>
      {p.name}
      <span className="muted dt-age">{p.age}</span>
    </span>
  )

  return (
    <div className="depth-table">
      {rows.map((u) => (
        <section key={u.name} className="dt-unit">
          <div className="eyebrow">{u.name}</div>
          <table>
            <thead>
              <tr>
                <th>Pos</th>
                <th>Starters</th>
                <th>Behind them</th>
              </tr>
            </thead>
            <tbody>
              {u.rows.map((r) => (
                <tr key={r.pos}>
                  <th scope="row" className="display">{r.pos}</th>
                  <td>
                    {r.starters.map(name)}
                    {Array.from({ length: Math.max(0, r.count - r.starters.length) }, (_, i) => (
                      <span key={`open-${i}`} className="dt-player" data-tier="empty">
                        <span className="dt-depth num">—</span>Open
                      </span>
                    ))}
                  </td>
                  <td className="dt-backups">{r.backups.length ? r.backups.map(name) : <span className="muted">Nobody</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
