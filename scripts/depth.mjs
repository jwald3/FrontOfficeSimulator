// Builds public/data/depth.json: each snapshot player's spot on his team's current
// OurLads depth chart (ourlads.com/nfldepthcharts). Depth 1 is the listed starter.
//
// Players are matched by name and team, falling back to a name unique league-wide.
// Players not on any depth chart (unsigned, practice squad, injured reserve) are left out.
//
// Usage: node scripts/depth.mjs

import { readFileSync, writeFileSync } from 'node:fs'

const SNAPSHOT = 'public/data/offseason-2027.json'
const OUT = 'public/data/depth.json'
const BASE = 'https://www.ourlads.com/nfldepthcharts/depthchart'

/** OurLads team codes that differ from ours. */
const OURLADS_TEAM = { ARI: 'ARZ', LAR: 'RAM' }
/** Kick/punt return, holder and kickoff rows describe roles, not positions. */
const SKIP_SLOTS = new Set(['H', 'PR', 'KR', 'KO', 'PS', 'IR', 'PS/IR', 'SUS', 'NFI', 'PUP', 'RES', 'IA'])

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g
export function normalName(name) {
  return name.toLowerCase().replace(/\./g, '').replace(/[’']/g, '').replace(SUFFIX, '').replace(/[^a-z]+/g, ' ').trim()
}

/** "Austin III, Calvin" / "ROBERTSON-HARRIS, ROY" → normalized "calvin austin" */
function fromOurLads(text) {
  const [last, first = ''] = text.split(',').map((s) => s.trim())
  return normalName(`${first} ${last}`)
}

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim()

function parseTeam(html) {
  const asOf = html.match(/Updated:\s*([\d/]+)/)?.[1]
  const entries = []
  for (const [, tr] of html.matchAll(/<tr class='row-dc-[a-z]+'>(.*?)<\/tr>/gs)) {
    const cells = [...tr.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1])
    const slot = strip(cells[0] ?? '')
    if (!slot || SKIP_SLOTS.has(slot)) continue
    // After the slot: alternating jersey number / player cells, in depth order.
    cells.slice(2).filter((_, i) => i % 2 === 0).forEach((cell, i) => {
      const name = cell.match(/<a [^>]*>(.*?)<\/a>/s)?.[1]
      if (name && strip(name)) entries.push({ name: fromOurLads(strip(name)), slot, depth: i + 1 })
    })
  }
  return { asOf, entries }
}

const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
const players = [
  ...snap.roster,
  ...Object.values(snap.otherRosters).flat(),
  ...snap.freeAgents,
  ...snap.rightsPlayers,
  ...snap.depthCandidates,
]

const charts = new Map() // our team code → [{ name, slot, depth }]
const dates = new Set()
for (const team of snap.teams.map((t) => t.id)) {
  const res = await fetch(`${BASE}/${OURLADS_TEAM[team] ?? team}`, { headers: { 'User-Agent': 'Mozilla/5.0 (offseason-sim data build)' } })
  if (!res.ok) throw new Error(`${team}: HTTP ${res.status}`)
  const { asOf, entries } = parseTeam(await res.text())
  if (entries.length < 40) throw new Error(`${team}: only ${entries.length} depth chart entries; page layout may have changed`)
  charts.set(team, entries)
  if (asOf) dates.add(asOf)
  await new Promise((r) => setTimeout(r, 400)) // be polite
}

// A player listed twice (e.g. LDE and RDE) keeps his best spot.
const byTeamName = new Map()
const byName = new Map()
for (const [team, entries] of charts) {
  for (const e of entries) {
    const key = `${team}|${e.name}`
    const prev = byTeamName.get(key)
    if (!prev || e.depth < prev.depth) byTeamName.set(key, { team, slot: e.slot, depth: e.depth })
  }
}
for (const [key, v] of byTeamName) {
  const name = key.split('|')[1]
  byName.set(name, byName.has(name) && byName.get(name).team !== v.team ? null : v)
}

const out = {}
let byTeam = 0, nameOnly = 0
for (const p of players) {
  if (out[p.id]) continue
  const name = normalName(p.name)
  const team = p.team ?? p.lastTeam
  let hit = team && byTeamName.get(`${team}|${name}`)
  if (hit) byTeam++
  else if ((hit = byName.get(name))) nameOnly++
  if (hit) out[p.id] = hit
}

const unique = new Set(players.map((p) => p.id)).size
writeFileSync(OUT, JSON.stringify({
  source: 'OurLads NFL depth charts (ourlads.com/nfldepthcharts)',
  asOf: [...dates].sort().at(-1),
  players: out,
}) + '\n')
console.log(`Matched ${byTeam} by team, ${nameOnly} by name only.`)
console.log(`Wrote ${Object.keys(out).length} of ${unique} players to ${OUT} (charts updated ${[...dates].sort().join(', ')})`)
