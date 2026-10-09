// Builds public/data/coordinators.json: every NFL team's current head coach and
// offensive and defensive coordinators, from each team's staff template on Wikipedia
// ("Template:<Team> staff"). The head coach is the one you keep or fire when the
// offseason opens; the editorial screen offers the coordinators as candidates.
//
// Usage: node scripts/coordinators.mjs

import { readFileSync, writeFileSync } from 'node:fs'

const SNAPSHOT = 'public/data/offseason-2027.json'
const OUT = 'public/data/coordinators.json'
const API = 'https://en.wikipedia.org/w/api.php'

/** "[[Frank Reich]]" / "[[Joe Smith (American football)|Joe Smith]]" → "Frank Reich" */
function plain(wikitext) {
  return wikitext
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'''?/g, '')
    .trim()
}

const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
const coordinators = []
const headCoaches = {}
const problems = []

/** Fetch with one polite retry if Wikipedia asks us to slow down. */
async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'offseason-sim/1.0 (data build script)' } })
    if (res.status !== 429) {
      if (!res.ok) throw new Error(`Wikipedia API: HTTP ${res.status}`)
      return res.json()
    }
    const wait = Number(res.headers.get('retry-after') ?? 30)
    console.log(`Rate limited; retrying in ${wait}s…`)
    await new Promise((r) => setTimeout(r, wait * 1000))
  }
  throw new Error('Wikipedia API kept rate limiting')
}

// All 32 templates in one request (the API takes up to 50 titles), following redirects.
const titles = snap.teams.map((t) => `Template:${t.fullName} staff`)
const data = await get(`${API}?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(titles.join('|'))}`)
const redirect = new Map((data.query.redirects ?? []).map((r) => [r.from, r.to]))
const normal = new Map((data.query.normalized ?? []).map((n) => [n.from, n.to]))
const pages = new Map(data.query.pages.map((p) => [p.title, p.revisions?.[0]?.slots?.main?.content]))

for (const team of snap.teams) {
  const asked = `Template:${team.fullName} staff`
  const title = redirect.get(normal.get(asked) ?? asked) ?? normal.get(asked) ?? asked
  const wikitext = pages.get(title)
  if (!wikitext) {
    problems.push(`${team.id}: no staff template (${asked})`)
    continue
  }
  // "Head coach – X" (not "Assistant head coach").
  const head = wikitext
    .split('\n')
    .map(plain)
    .find((l) => /^\*+\s*head coach\s*[–—-]/i.test(l))
  const headName = head?.split(/[–—]| - /).slice(1).join('–').trim()
  if (headName) headCoaches[team.id] = headName
  else problems.push(`${team.id}: no head coach listed`)

  for (const [role, label] of [['OC', 'offensive coordinator'], ['DC', 'defensive coordinator']]) {
    // A bullet whose title includes the role, e.g. "Offensive coordinator – X" or
    // "Assistant head coach/defensive coordinator – X". Pass-game and run-game
    // coordinators are a different job and don't match.
    const line = wikitext
      .split('\n')
      // Some teams link the job title itself ("[[Offensive coordinator]] – X").
      .map(plain)
      .find((l) => /^\*/.test(l) && new RegExp(`(^|[*/\\s])${label}\\s*[–—-]`, 'i').test(l) && !/(pass|run)[- ]game/i.test(l))
    const names = line ? line.split(/[–—]| - /).slice(1).join('–').trim().split(/\s*(?:,|&| and )\s*/).filter(Boolean) : []
    if (!names.length) problems.push(`${team.id}: no ${label} listed`)
    for (const name of names) coordinators.push({ id: `${team.id}-${role}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, team: team.id, role })
  }
}

writeFileSync(OUT, JSON.stringify({
  source: 'Wikipedia NFL team staff templates',
  asOf: new Date().toISOString().slice(0, 10),
  headCoaches,
  coordinators,
}, null, 2) + '\n')
console.log(`Wrote ${Object.keys(headCoaches).length} head coaches and ${coordinators.length} coordinators to ${OUT}`)
for (const p of problems) console.log(`  check: ${p}`)
