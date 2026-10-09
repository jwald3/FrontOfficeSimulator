// Builds public/data/headshots.json: player id → NFL.com headshot (Cloudinary asset).
//
// Matches snapshot players to the nflverse players table by OverTheCap id, falling back
// to an exact-name match that is unique among recently active players. NFL.com serves a generic helmet image for players with
// no photo (uploaded separately per player, so it can't be matched by bytes). Every
// candidate is fetched once as a 16px PNG; real photos are cut out on a transparent
// background in colour, the helmet is opaque greyscale, so those are dropped.
//
// Usage: node scripts/headshots.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const SNAPSHOT = 'public/data/offseason-2027.json'
const OUT = 'public/data/headshots.json'
const PLAYERS_CSV = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'
const CDN = 'https://static.www.nfl.com/image'

function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

/** "https://static.www.nfl.com/image/upload/f_auto,q_auto/league/abc" → "upload/league/abc" */
function assetPath(url) {
  const m = url.match(/\/image\/(upload|private)\/(?:[^/]*,[^/]*\/|v\d+\/)*(.+)$/)
  return m ? `${m[1]}/${m[2]}` : null
}

const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
const players = [
  ...snap.roster,
  ...Object.values(snap.otherRosters).flat(),
  ...snap.freeAgents,
  ...snap.rightsPlayers,
  ...snap.depthCandidates,
]

console.log('Downloading nflverse players table…')
const res = await fetch(PLAYERS_CSV)
if (!res.ok) throw new Error(`players.csv: HTTP ${res.status}`)
const table = parseCsv(await res.text())

const byOtc = new Map()
const byName = new Map()
for (const r of table) {
  if (!r.headshot) continue
  if (r.otc_id) byOtc.set(r.otc_id, r)
  if (Number(r.last_season) < snap.season - 3) continue // a retired namesake is not our player
  const key = r.display_name.toLowerCase()
  byName.set(key, byName.has(key) ? null : r) // null marks an ambiguous name
}

const candidates = new Map()
let byId = 0, byNameOnly = 0
for (const p of players) {
  if (candidates.has(p.id)) continue
  const otc = p.id.match(/^otc-(\d+)$/)?.[1]
  let hit = otc && byOtc.get(otc)
  if (hit) byId++
  else if ((hit = byName.get(p.name.toLowerCase()))) byNameOnly++
  const path = hit && assetPath(hit.headshot)
  if (path) candidates.set(p.id, path)
}

console.log(`Checking ${candidates.size} headshots for placeholders…`)
const isPhoto = new Map()
const queue = [...new Set(candidates.values())]
let failed = 0
await Promise.all(Array.from({ length: 16 }, async () => {
  for (let path; (path = queue.pop()); ) {
    const r = await fetch(`${CDN}/${path.replace('/', '/f_png,w_16,h_16,c_fill,g_north/')}`).catch(() => null)
    if (!r?.ok) { failed++; continue }
    isPhoto.set(path, looksLikePhoto(decodePng(Buffer.from(await r.arrayBuffer()))))
  }
}))
const placeholder = (path) => !isPhoto.get(path)

const out = {}
for (const [id, path] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
  if (!placeholder(path)) out[id] = path
}
writeFileSync(OUT, JSON.stringify(out) + '\n')

const unique = new Set(players.map((p) => p.id)).size
console.log(`Matched ${byId} by OTC id, ${byNameOnly} by name; ${failed} failed to load; ` +
  `${candidates.size - Object.keys(out).length} placeholders/missing dropped.`)
console.log(`Wrote ${Object.keys(out).length} of ${unique} players to ${OUT}`)

/** Minimal PNG decoder for 8/16-bit greyscale, RGB, palette and RGBA images → 8-bit RGBA pixels. */
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, depth = 0, type = 0, palette = null, trns = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9] }
    else if (kind === 'PLTE') palette = data
    else if (kind === 'tRNS') trns = data
    else if (kind === 'IDAT') idat.push(data)
    pos += len + 12
  }
  if (depth !== 8 && depth !== 16) throw new Error(`unsupported PNG bit depth ${depth}`)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]
  const bytes = depth / 8, bpp = channels * bytes
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const rows = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= bpp ? rows[y * stride + x - bpp] : 0
      const b = y > 0 ? rows[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? rows[(y - 1) * stride + x - bpp] : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]
      rows[y * stride + x] = (v + pred) & 0xff
    }
  }
  const px = []
  for (let i = 0; i < width * height; i++) {
    const s = (ch) => rows[i * bpp + ch * bytes] // high byte of each sample
    if (type === 6) px.push([s(0), s(1), s(2), s(3)])
    else if (type === 2) px.push([s(0), s(1), s(2), 255])
    else if (type === 0) px.push([s(0), s(0), s(0), 255])
    else if (type === 4) px.push([s(0), s(0), s(0), s(1)])
    else { const k = s(0); px.push([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255]) }
  }
  return px
}

/** Colour anywhere in the visible pixels means a real photo; the helmet placeholder is pure greyscale. */
function looksLikePhoto(px) {
  const chroma = px.filter(([, , , a]) => a > 128).map(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b))
  return chroma.length > 0 && chroma.reduce((s, c) => s + c, 0) / chroma.length > 12
}
