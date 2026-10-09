import { pickLabel, pickValue } from '../engine/trades'
import type { RawPick, RunState, Snapshot } from '../engine/types'
import './parts.css'

/** Toggle picks into a package, each with its value in chart points, and the package total. */
export function PickChooser({
  run,
  snap,
  picks,
  selected,
  onChange,
  totalLabel,
  against,
}: {
  run: RunState
  snap: Snapshot
  picks: RawPick[]
  selected: string[]
  onChange: (ids: string[]) => void
  /** e.g. "You ask for". */
  totalLabel: string
  /** What the package is measured against, shown as a share. */
  against?: { label: string; value: number }
}) {
  const sorted = [...picks].sort((a, b) => a.year - b.year || (a.overall ?? 99 * a.round) - (b.overall ?? 99 * b.round))
  const total = picks.filter((p) => selected.includes(p.id)).reduce((a, p) => a + pickValue(snap, p, run.season), 0)
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  return (
    <div className="pickchooser">
      <div className="pickgrid">
        {sorted.map((p) => (
          <button key={p.id} className="pick" aria-pressed={selected.includes(p.id)} onClick={() => toggle(p.id)}>
            <span>{pickLabel(p)}</span>
            <span className="num">{pickValue(snap, p, run.season).toLocaleString()}</span>
          </button>
        ))}
        {sorted.length === 0 && <p className="muted">No picks to trade.</p>}
      </div>
      <div className="pickchooser-total">
        <span className="muted">{totalLabel}</span>
        <b className="num">{total.toLocaleString()} pts</b>
        {against && against.value > 0 && (
          <span className="muted">
            {Math.round((total / against.value) * 100)}% of {against.label} ({against.value.toLocaleString()})
          </span>
        )}
      </div>
    </div>
  )
}
