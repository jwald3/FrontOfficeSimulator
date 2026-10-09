// Team colours. Every page is painted from a handful of CSS custom properties (see
// :root in index.css); picking a team rewrites them from three colours:
//
//   primary  the team's main colour: tints the backgrounds and panels, and fills the
//            "team" surfaces (the current pick, the on-the-clock banner)
//   accent   a light tint for buttons, lines and outlines, readable with dark text
//   pop      a bright highlight for what's ours, what's new and what's selected
//
// The rest (background shades, muted text, lines) is derived from the primary's hue,
// so a team only needs these three to look right. The editorial screen can change any
// of them (editorial.json `colors`), along with the three fixed colours.

import type { ColorSet, EditorialColors, FixedColors } from '../engine/editorialSchema'

export type Conference = 'AFC' | 'NFC'

export interface TeamColors extends ColorSet {
  conference: Conference
  division: 'East' | 'North' | 'South' | 'West'
}

export const TEAM_COLORS: Record<string, TeamColors> = {
  BUF: { conference: 'AFC', division: 'East', primary: '#00338D', accent: '#b7cdf7', pop: '#ff5a6a' },
  MIA: { conference: 'AFC', division: 'East', primary: '#008E97', accent: '#a8eef2', pop: '#fc7a3c' },
  NE: { conference: 'AFC', division: 'East', primary: '#002244', accent: '#c2d0e2', pop: '#ff4d5e' },
  NYJ: { conference: 'AFC', division: 'East', primary: '#125740', accent: '#a8f0c6', pop: '#d4ff5a' },
  BAL: { conference: 'AFC', division: 'North', primary: '#241773', accent: '#c9c0f5', pop: '#e8c547' },
  CIN: { conference: 'AFC', division: 'North', primary: '#FB4F14', accent: '#ffc2a8', pop: '#ff7a3d' },
  CLE: { conference: 'AFC', division: 'North', primary: '#311D00', accent: '#ffc7a3', pop: '#ff6a2a' },
  PIT: { conference: 'AFC', division: 'North', primary: '#101820', accent: '#f2e0b0', pop: '#ffb612' },
  HOU: { conference: 'AFC', division: 'South', primary: '#03202F', accent: '#c9d6e6', pop: '#ff4b5c' },
  IND: { conference: 'AFC', division: 'South', primary: '#002C5F', accent: '#c2d3ea', pop: '#8cc2ff' },
  JAX: { conference: 'AFC', division: 'South', primary: '#006778', accent: '#a8e6e6', pop: '#d7a22a' },
  TEN: { conference: 'AFC', division: 'South', primary: '#0C2340', accent: '#c3dbf3', pop: '#6bb6ff' },
  DEN: { conference: 'AFC', division: 'West', primary: '#0A2343', accent: '#ffc2a8', pop: '#ff7a3d' },
  KC: { conference: 'AFC', division: 'West', primary: '#E31837', accent: '#f6e3c3', pop: '#ffb81c' },
  LV: { conference: 'AFC', division: 'West', primary: '#000000', accent: '#d9dde0', pop: '#c4c8cb' },
  LAC: { conference: 'AFC', division: 'West', primary: '#0080C6', accent: '#b3dcf5', pop: '#ffc20e' },
  DAL: { conference: 'NFC', division: 'East', primary: '#003594', accent: '#c4d3ea', pop: '#8fb8ff' },
  NYG: { conference: 'NFC', division: 'East', primary: '#0B2265', accent: '#bfcbef', pop: '#ff4b5c' },
  PHI: { conference: 'NFC', division: 'East', primary: '#004C54', accent: '#a9dde0', pop: '#8fe0c8' },
  WAS: { conference: 'NFC', division: 'East', primary: '#5A1414', accent: '#f5dea6', pop: '#ffb612' },
  CHI: { conference: 'NFC', division: 'North', primary: '#0B162A', accent: '#c3cfe6', pop: '#ff7a33' },
  DET: { conference: 'NFC', division: 'North', primary: '#0076B6', accent: '#b9def3', pop: '#6cd0ff' },
  GB: { conference: 'NFC', division: 'North', primary: '#203731', accent: '#cfe3c6', pop: '#ffc72c' },
  MIN: { conference: 'NFC', division: 'North', primary: '#4F2683', accent: '#d3c2ef', pop: '#ffc62f' },
  ATL: { conference: 'NFC', division: 'South', primary: '#A71930', accent: '#e1e5e8', pop: '#ff6b7d' },
  CAR: { conference: 'NFC', division: 'South', primary: '#0085CA', accent: '#b3e2fa', pop: '#5cd3ff' },
  NO: { conference: 'NFC', division: 'South', primary: '#D3BC8D', accent: '#ecdcbc', pop: '#e3c88f' },
  TB: { conference: 'NFC', division: 'South', primary: '#D50A0A', accent: '#e6dccf', pop: '#ff8a1f' },
  ARI: { conference: 'NFC', division: 'West', primary: '#97233F', accent: '#e6e8ea', pop: '#ffb612' },
  LAR: { conference: 'NFC', division: 'West', primary: '#003594', accent: '#c4d3ea', pop: '#ffd100' },
  SF: { conference: 'NFC', division: 'West', primary: '#AA0000', accent: '#efdcb1', pop: '#e0be7a' },
  SEA: { conference: 'NFC', division: 'West', primary: '#002244', accent: '#c4d6e8', pop: '#78d64b' },
}

/**
 * Each team's official colours, by name: offered as one-click swatches on the
 * editorial colour screen, so nobody has to keep hex codes on hand.
 */
export const TEAM_PALETTES: Record<string, [name: string, hex: string][]> = {
  ARI: [['Cardinal red', '#97233F'], ['Black', '#000000'], ['Yellow', '#FFB612']],
  ATL: [['Red', '#A71930'], ['Black', '#000000'], ['Silver', '#A5ACAF']],
  BAL: [['Purple', '#241773'], ['Black', '#000000'], ['Gold', '#9E7C0C']],
  BUF: [['Royal blue', '#00338D'], ['Red', '#C60C30']],
  CAR: [['Panther blue', '#0085CA'], ['Black', '#101820'], ['Silver', '#BFC0BF']],
  CHI: [['Navy', '#0B162A'], ['Orange', '#C83803']],
  CIN: [['Orange', '#FB4F14'], ['Black', '#000000']],
  CLE: [['Brown', '#311D00'], ['Orange', '#FF3C00']],
  DAL: [['Royal blue', '#003594'], ['Navy', '#041E42'], ['Silver', '#869397']],
  DEN: [['Orange', '#FB4F14'], ['Navy', '#002244']],
  DET: [['Honolulu blue', '#0076B6'], ['Silver', '#B0B7BC']],
  GB: [['Green', '#203731'], ['Gold', '#FFB612']],
  HOU: [['Deep steel blue', '#03202F'], ['Battle red', '#A71930']],
  IND: [['Speed blue', '#002C5F'], ['Grey', '#A2AAAD']],
  JAX: [['Teal', '#006778'], ['Gold', '#D7A22A'], ['Black', '#101820']],
  KC: [['Red', '#E31837'], ['Gold', '#FFB81C']],
  LV: [['Silver', '#A5ACAF'], ['Black', '#000000']],
  LAC: [['Powder blue', '#0080C6'], ['Sunshine gold', '#FFC20E']],
  LAR: [['Royal blue', '#003594'], ['Sol', '#FFD100']],
  MIA: [['Aqua', '#008E97'], ['Orange', '#FC4C02'], ['Blue', '#005778']],
  MIN: [['Purple', '#4F2683'], ['Gold', '#FFC62F']],
  NE: [['Navy', '#002244'], ['Red', '#C60C30'], ['Silver', '#B0B7BC']],
  NO: [['Old gold', '#D3BC8D'], ['Black', '#101820']],
  NYG: [['Dark blue', '#0B2265'], ['Red', '#A71930'], ['Grey', '#A5ACAF']],
  NYJ: [['Gotham green', '#125740'], ['Black', '#000000']],
  PHI: [['Midnight green', '#004C54'], ['Silver', '#A5ACAF'], ['Black', '#000000']],
  PIT: [['Black', '#101820'], ['Gold', '#FFB612']],
  SF: [['Red', '#AA0000'], ['Gold', '#B3995D']],
  SEA: [['College navy', '#002244'], ['Action green', '#69BE28'], ['Wolf grey', '#A5ACAF']],
  TB: [['Red', '#D50A0A'], ['Pewter', '#34302B'], ['Orange', '#FF7900']],
  TEN: [['Navy', '#0C2340'], ['Titans blue', '#4B92DB'], ['Red', '#C8102E']],
  WAS: [['Burgundy', '#5A1414'], ['Gold', '#FFB612']],
}

/** Before a team is picked: league navy with a gold highlight. */
export const NEUTRAL: ColorSet = { primary: '#1f3b57', accent: '#bcd3ea', pop: '#f2c94c' }

/** Colours with a fixed meaning, the same for every team. */
export const FIXED: FixedColors = { gold: '#f2c94c', alert: '#ff5b3a', cool: '#66c7ff', gain: '#4fd18b' }

let edits: EditorialColors | undefined

/** Use the editor's colour changes from now on (call applyTheme to repaint). */
export function setColorEdits(colors: EditorialColors | undefined): void {
  edits = colors
}

/** A team's colours (or the neutral ones) with the editor's changes over the defaults. */
export function colorsFor(team: string | undefined, colors: EditorialColors | undefined = edits): ColorSet {
  const base = (team && TEAM_COLORS[team]) || NEUTRAL
  const own = team && TEAM_COLORS[team] ? colors?.teams?.[team] : colors?.neutral
  return { primary: own?.primary ?? base.primary, accent: own?.accent ?? base.accent, pop: own?.pop ?? base.pop }
}

export function fixedColors(colors: EditorialColors | undefined = edits): FixedColors {
  return { ...FIXED, ...colors?.fixed }
}

type Rgb = [number, number, number]

function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbHsl([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s * 100, l * 100]
}

function hslRgb(h: number, s: number, l: number): Rgb {
  const S = s / 100
  const L = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const triplet = (c: Rgb) => c.join(' ')
const rgb = (c: Rgb) => `rgb(${c.join(', ')})`

/** The CSS custom properties for a team's colours (see index.css for what each paints). */
export function themeVars(colors: ColorSet, fixed: FixedColors = FIXED): Record<string, string> {
  const primary = rgbHsl(hexRgb(colors.primary))
  // Black and grey teams take their tint from the highlight, faintly.
  const grey = primary[1] < 12 || primary[2] < 4
  const h = grey ? rgbHsl(hexRgb(colors.pop))[0] : primary[0]
  const s = grey ? 8 : 30
  // The team colour as a fill: dark enough for light text, saturated enough to read as the team.
  const teamS = grey ? 6 : Math.max(primary[1], 45)
  const teamL = Math.min(28, Math.max(18, primary[2]))
  const team = hslRgb(h, teamS, teamL)
  const teamHi = hslRgb(h, teamS, teamL + 9)
  const accent = hexRgb(colors.accent)
  const pop = hexRgb(colors.pop)
  const panel = hslRgb(h, s, 7.8)
  const panelHi = hslRgb(h, s - 2, 12)
  return {
    '--bg': rgb(hslRgb(h, s, 3.2)),
    '--bg-2': rgb(hslRgb(h, s, 5.5)),
    '--panel-rgb': triplet(panel),
    '--panel-hi-rgb': triplet(panelHi),
    '--shade-rgb': triplet(hslRgb(h, s, 2)),
    '--deep-rgb': triplet(hslRgb(h, grey ? 8 : 50, 7.5)),
    '--text': rgb(hslRgb(h, 25, 95)),
    '--text-soft': rgb(hslRgb(h, 20, 87)),
    '--muted': rgb(hslRgb(h, grey ? 6 : 14, 60)),
    '--dim': rgb(hslRgb(h, grey ? 5 : 11, 37)),
    '--team-rgb': triplet(team),
    '--team-hi-rgb': triplet(teamHi),
    '--accent-rgb': triplet(accent),
    '--pop-rgb': triplet(pop),
    '--ink': rgb(hslRgb(h, grey ? 10 : 60, 5)),
    '--gold': fixed.gold,
    '--alert': fixed.alert,
    '--cool': fixed.cool,
    '--gain': fixed.gain,
  }
}

/**
 * Paint the page in a team's colours, or the neutral league colours. `colors` previews
 * unsaved editorial changes; otherwise the saved ones apply.
 */
export function applyTheme(team: string | undefined, colors?: EditorialColors): void {
  const vars = themeVars(colorsFor(team, colors ?? edits), fixedColors(colors ?? edits))
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  if (team) root.dataset.team = team
  else delete root.dataset.team
}
