import { useEffect, useState } from 'react'
import type { ColorSet, EditorialColors, FixedColors } from '../engine/editorialSchema'
import type { Snapshot } from '../engine/types'
import { useGame } from '../game/store'
import { applyTheme, colorsFor, FIXED, fixedColors, NEUTRAL, TEAM_COLORS, TEAM_PALETTES, themeVars } from './theme'

// Editorial: team colours. Each team's three colours (and the neutral ones shown
// before a team is picked) and the three fixed colours, with what each paints. The
// whole page previews the team being edited, so a change shows everywhere at once.

const NEUTRAL_ID = 'neutral'

const SET_FIELDS: { key: keyof ColorSet; label: string; body: string }[] = [
  {
    key: 'primary',
    label: 'Primary',
    body: "The team's main colour. Tints every background and panel, and fills the team surfaces: the pick on the clock in the draft strip, the selected card, the on-the-clock banner, the footer of the share card.",
  },
  {
    key: 'accent',
    label: 'Accent',
    body: 'A light tint for primary buttons, lines, outlines, labels and the cap bar. Dark text sits on it, so keep it light.',
  },
  {
    key: 'pop',
    label: 'Highlight',
    body: "What's yours, new or selected: your picks, the kickoff button, the active phase tab, new players, A grades. Dark text sits on it too, so keep it bright.",
  },
]

const FIXED_FIELDS: { key: keyof FixedColors; label: string; body: string }[] = [
  {
    key: 'gold',
    label: 'Caution',
    body: 'Middling marks and warnings: C grades, "Getting there" on negotiation reads, void years, No 1sts locks, flagged offers.',
  },
  {
    key: 'alert',
    label: 'Alert',
    body: 'Bad news: negative cap space, Fire him and other danger buttons, D and F grades, errors.',
  },
  {
    key: 'gain',
    label: 'Gain',
    body: "Money and value going your way, the green to Alert's red: cut savings, positive cap space, value gained in a trade.",
  },
  {
    key: 'cool',
    label: 'Information',
    body: 'Trade talk and notices: the draft-day phone, trade-block flags, RFA tenders, agent tags.',
  },
]

/** The derived shades, for the swatch strip: what the three colours turn into. */
const DERIVED: { name: string; label: string }[] = [
  { name: '--bg', label: 'Background' },
  { name: '--panel-rgb', label: 'Panel' },
  { name: '--team-rgb', label: 'Team fill' },
  { name: '--team-hi-rgb', label: 'Team fill, lighter' },
  { name: '--muted', label: 'Muted text' },
  { name: '--ink', label: 'Dark text' },
]

const swatch = (v: string) => (v.startsWith('rgb') || v.startsWith('#') ? v : `rgb(${v.split(' ').join(', ')})`)

export function TeamColorsEditor({
  snap,
  value,
  onChange,
}: {
  snap: Snapshot
  value: EditorialColors | undefined
  onChange: (colors: EditorialColors | undefined) => void
}) {
  const playing = useGame((s) => s.team)
  const [team, setTeam] = useState<string>(playing ?? NEUTRAL_ID)
  const id = team === NEUTRAL_ID ? undefined : team
  // Preview the team being edited, with unsaved changes, on the whole page; put the
  // saved colours of the team being played back on the way out.
  useEffect(() => applyTheme(id, value), [id, value])
  useEffect(() => () => applyTheme(useGame.getState().team), [])

  const colors = colorsFor(id, value)
  const defaults = id ? TEAM_COLORS[id] : NEUTRAL
  const fixed = fixedColors(value)
  // The colours as last saved, so a change can always be taken back without knowing its code.
  const savedEdits = useGame((s) => s.editorial?.colors)
  const saved = colorsFor(id, savedEdits)
  const savedFixed = fixedColors(savedEdits)
  // One-click choices: the default, the saved colour, then the team's official colours.
  const official: Choice[] = [...(id ? (TEAM_PALETTES[id] ?? []) : []).map(([label, hex]) => ({ label, hex })), { label: 'White', hex: '#ffffff' }]
  const choices = (fallback: string, kept: string, extra: Choice[] = []): Choice[] => {
    const all = [{ label: 'Default', hex: fallback }, ...(kept.toLowerCase() !== fallback.toLowerCase() ? [{ label: 'Saved', hex: kept }] : []), ...extra]
    return all.filter((c, i) => all.findIndex((x) => x.hex.toLowerCase() === c.hex.toLowerCase()) === i)
  }
  const vars = themeVars(colors, fixed)

  const tidy = (next: EditorialColors): EditorialColors | undefined => {
    const teams = Object.fromEntries(Object.entries(next.teams ?? {}).filter(([, c]) => Object.keys(c).length))
    const out: EditorialColors = {
      ...(Object.keys(teams).length ? { teams } : {}),
      ...(next.neutral && Object.keys(next.neutral).length ? { neutral: next.neutral } : {}),
      ...(next.fixed && Object.keys(next.fixed).length ? { fixed: next.fixed } : {}),
    }
    return Object.keys(out).length ? out : undefined
  }
  const setColor = (key: keyof ColorSet, hex: string | undefined) => {
    const own: Partial<ColorSet> = { ...(id ? value?.teams?.[id] : value?.neutral) }
    if (hex === undefined || hex.toLowerCase() === defaults[key].toLowerCase()) delete own[key]
    else own[key] = hex
    onChange(tidy(id ? { ...value, teams: { ...value?.teams, [id]: own } } : { ...value, neutral: own }))
  }
  const setFixed = (key: keyof FixedColors, hex: string | undefined) => {
    const own: Partial<FixedColors> = { ...value?.fixed }
    if (hex === undefined || hex.toLowerCase() === FIXED[key].toLowerCase()) delete own[key]
    else own[key] = hex
    onChange(tidy({ ...value, fixed: own }))
  }
  const edited = (t: string) => (t === NEUTRAL_ID ? !!value?.neutral : !!value?.teams?.[t])
  const teams = [...snap.teams].sort((a, b) => a.fullName.localeCompare(b.fullName))

  return (
    <section className="ed-section">
      <header className="ed-section-head">
        <h2 className="display ed-section-title">Team colours</h2>
        <p className="muted">
          Every screen is painted from three colours per team. Backgrounds, panels, lines and muted text are worked out from the
          primary's hue, so these three are all a team needs. The page previews the team you're editing; saving keeps the changes,
          and only colours that differ from the defaults are written to the file.
        </p>
      </header>

      <label className="ed-field">
        <span className="eyebrow">Team</span>
        <select className="ed-select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          <option value={NEUTRAL_ID}>Neutral · before a team is picked{edited(NEUTRAL_ID) ? ' · edited' : ''}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.fullName}{edited(t.id) ? ' · edited' : ''}</option>
          ))}
        </select>
      </label>

      <ul className="ed-colors">
        {SET_FIELDS.map((f) => (
          <ColorRow
            key={f.key}
            label={f.label}
            body={f.body}
            value={colors[f.key]}
            choices={choices(defaults[f.key], saved[f.key], official)}
            onChange={(hex) => setColor(f.key, hex)}
          />
        ))}
      </ul>

      <div className="ed-color-preview" aria-label="Preview">
        <div className="eyebrow">What they make</div>
        <div className="ed-swatches">
          {DERIVED.map((d) => (
            <span key={d.name} className="ed-swatch">
              <i style={{ background: swatch(vars[d.name]) }} />
              {d.label}
            </span>
          ))}
        </div>
        <div className="ed-samples">
          <button className="btn" tabIndex={-1}>Primary</button>
          <button className="btn ghost" tabIndex={-1}>Ghost</button>
          <button className="btn kickoff" tabIndex={-1}>Kick off</button>
          <span className="chip">2027 R1 Pick 6</span>
          <span className="ed-sample-team display">On the clock</span>
          <span className="ed-sample-pop display">Yours</span>
        </div>
      </div>

      <h3 className="display ed-subtitle">Fixed colours</h3>
      <p className="muted ed-help">The same for every team: each one means something, whichever team you play.</p>
      <ul className="ed-colors">
        {FIXED_FIELDS.map((f) => (
          <ColorRow
            key={f.key}
            label={f.label}
            body={f.body}
            value={fixed[f.key]}
            choices={choices(FIXED[f.key], savedFixed[f.key])}
            onChange={(hex) => setFixed(f.key, hex)}
          />
        ))}
      </ul>
    </section>
  )
}

interface Choice {
  label: string
  hex: string
}

/**
 * One colour: named swatches to click (the default, the saved colour, the team's
 * official colours), a picker for anything else, and its code for those who have one.
 */
function ColorRow({
  label,
  body,
  value,
  choices,
  onChange,
}: {
  label: string
  body: string
  value: string
  choices: Choice[]
  onChange: (hex: string | undefined) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const changed = value.toLowerCase() !== choices[0].hex.toLowerCase()
  const commit = () => {
    const hex = text?.trim().replace(/^#?/, '#')
    if (hex && /^#[0-9a-f]{6}$/i.test(hex)) onChange(hex.toLowerCase())
    setText(null)
  }
  return (
    <li data-set={changed}>
      <div className="ed-detail-who">
        <b>{label}</b>
        <span className="muted">{body}</span>
      </div>
      <input type="color" className="ed-color-pick" value={value.toLowerCase()} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: pick any colour`} />
      <input
        className="search num ed-color-hex"
        value={text ?? value.toLowerCase()}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(null)
            e.stopPropagation()
          }
        }}
        aria-label={`${label} colour code`}
      />
      <div className="ed-color-choices">
        {choices.map((c) => (
          <button
            key={c.label}
            className="ed-color-choice"
            aria-pressed={c.hex.toLowerCase() === value.toLowerCase()}
            onClick={() => onChange(c.label === 'Default' ? undefined : c.hex.toLowerCase())}
            title={c.hex.toLowerCase()}
          >
            <i style={{ background: c.hex }} />
            {c.label}
          </button>
        ))}
      </div>
    </li>
  )
}
