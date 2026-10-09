import { money } from '../engine/format'
import { LINEUP_SPOTS, type Verdict } from '../engine/summary'

/** Everything the card shows; assembled by the summary screen. */
export interface ShareCardData {
  verdict: Verdict
  /** Effective cap space at the end of the offseason. */
  capSpace: number
  moveCount: number
  objective: string
  code: string
  season: number
  /** The team played, e.g. "New York Jets". */
  team: string
  highlights: string[]
}

const W = 1200
const H = 630
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif'
const BODY = '"Barlow", "Segoe UI", sans-serif'
/** The page's colours as they are now, so the card wears the team's (see theme.ts). */
function colors() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  const rgb = (name: string, a = 1) => `rgb(${v(name).split(/\s+/).join(', ')}, ${a})`
  return {
    bg: v('--bg'),
    deep: rgb('--deep-rgb'),
    team: rgb('--team-rgb'),
    accent: rgb('--accent-rgb'),
    stripe: rgb('--accent-rgb', 0.05),
    pop: rgb('--pop-rgb'),
    ink: v('--ink'),
    gold: v('--gold'),
    alert: v('--alert'),
    text: v('--text'),
    muted: v('--muted'),
  }
}

function gradeColor(C: ReturnType<typeof colors>, letter: string): string {
  if (letter.startsWith('A')) return C.pop
  if (letter.startsWith('B')) return C.accent
  if (letter.startsWith('C')) return C.gold
  return C.alert
}

/** Draws a slanted (parallelogram) box like the game's panels. */
function slant(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number) {
  ctx.beginPath()
  ctx.moveTo(x + s, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w - s, y + h)
  ctx.lineTo(x, y + h)
  ctx.closePath()
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

/** Render the share card to a PNG blob. */
export async function renderShareCard(d: ShareCardData): Promise<Blob> {
  // Canvas text only uses fonts that are already loaded.
  await Promise.all([
    document.fonts.load(`italic 800 160px ${DISPLAY}`),
    document.fonts.load(`700 28px ${DISPLAY}`),
    document.fonts.load(`500 22px ${BODY}`),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const C = colors()

  // Ground: the team's deep shade with broadcast stripes.
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, C.deep)
  bg.addColorStop(0.6, C.bg)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = C.stripe
  ctx.lineWidth = 2
  for (let x = -H; x < W; x += 26) {
    ctx.beginPath()
    ctx.moveTo(x, H)
    ctx.lineTo(x + H * 0.58, 0)
    ctx.stroke()
  }

  // Wordmark.
  ctx.font = `italic 800 34px ${DISPLAY}`
  ctx.fillStyle = C.accent
  ctx.fillText('FRONT OFFICE', 56, 72)
  ctx.fillStyle = C.text
  ctx.fillText(`${d.team.toUpperCase()} · ${d.season}`, 56 + ctx.measureText('FRONT OFFICE ').width, 72)
  ctx.font = `700 18px ${DISPLAY}`
  ctx.fillStyle = C.muted
  ctx.fillText(`OBJECTIVE · ${d.objective.toUpperCase()}`, 56, 100)

  // The grade.
  const gc = gradeColor(C, d.verdict.letter)
  slant(ctx, 56, 130, 300, 300, 44)
  ctx.fillStyle = gc
  ctx.fill()
  ctx.fillStyle = C.ink
  ctx.font = `italic 800 ${d.verdict.letter.length > 1 ? 190 : 230}px ${DISPLAY}`
  ctx.textAlign = 'center'
  ctx.fillText(d.verdict.letter, 206, 365)
  ctx.textAlign = 'left'

  // Headline and numbers.
  const x = 400
  ctx.fillStyle = C.text
  ctx.font = `italic 800 40px ${DISPLAY}`
  const words = d.verdict.headline.toUpperCase().split(' ')
  let line = ''
  let y = 160
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > 740 && line) {
      ctx.fillText(line, x, y)
      line = w
      y += 42
    } else line = next
  }
  ctx.fillText(line, x, y)

  const stats: [string, string, string][] = [
    [`PROVEN STARTERS /${LINEUP_SPOTS}`, `${d.verdict.startersBefore} → ${d.verdict.startersAfter}`, C.text],
    ['CAP SPACE', money(d.capSpace), C.pop],
    ['MOVES MADE', String(d.moveCount), C.accent],
  ]
  stats.forEach(([label, value, color], i) => {
    const sx = x + i * 250
    ctx.font = `700 16px ${DISPLAY}`
    ctx.fillStyle = C.muted
    ctx.fillText(label, sx, y + 56)
    ctx.font = `italic 800 52px ${DISPLAY}`
    ctx.fillStyle = color
    ctx.fillText(value, sx, y + 106)
  })

  // Highlights.
  ctx.font = `500 21px ${BODY}`
  d.highlights.slice(0, 4).forEach((h, i) => {
    const hy = y + 160 + i * 34
    ctx.fillStyle = C.pop
    ctx.fillRect(x, hy - 14, 4, 18)
    ctx.fillStyle = C.text
    ctx.fillText(fit(ctx, h, 740), x + 16, hy)
  })

  // Footer band with the challenge code.
  ctx.fillStyle = C.team
  ctx.fillRect(0, H - 72, W, 72)
  ctx.fillStyle = C.pop
  ctx.fillRect(0, H - 72, W, 3)
  ctx.font = `700 22px ${DISPLAY}`
  ctx.fillStyle = C.text
  ctx.fillText('THINK YOU CAN DO BETTER? PLAY THIS EXACT OFFSEASON WITH CODE', 56, H - 28)
  ctx.font = `italic 800 34px ${DISPLAY}`
  ctx.fillStyle = C.pop
  ctx.textAlign = 'right'
  ctx.fillText(d.code, W - 56, H - 25)
  ctx.textAlign = 'left'

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the card'))), 'image/png'))
}
