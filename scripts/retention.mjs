// Measures how often expiring NFL players re-sign with their own team, the source of
// RETENTION_RATE in src/engine/market.ts.
//
// From OverTheCap contract histories (nflverse historical_contracts): for each contract
// whose final season falls in the window, was the player's next contract, signed during
// that final season (an extension) or the offseason after it, with the same team?
// Players who never signed again are left out.
//
// Usage: node scripts/retention.mjs [firstSeason=2021] [lastSeason=2024]

import { gunzipSync } from 'node:zlib'

const URL = 'https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.csv.gz'
const [first = 2021, last = 2024] = process.argv.slice(2).map(Number)

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

const res = await fetch(URL)
if (!res.ok) throw new Error(`historical_contracts: HTTP ${res.status}`)
const contracts = parseCsv(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'))

const byPlayer = new Map()
for (const c of contracts) {
  if (!/^\d+$/.test(c.otc_id) || !/^\d+$/.test(c.year_signed) || !/^\d+$/.test(c.years)) continue
  if (!byPlayer.has(c.otc_id)) byPlayer.set(c.otc_id, [])
  byPlayer.get(c.otc_id).push(c)
}

const tally = { under: [0, 0], over: [0, 0] } // [stayed, total]
for (const deals of byPlayer.values()) {
  deals.sort((a, b) => a.year_signed - b.year_signed)
  for (let i = 0; i + 1 < deals.length; i++) {
    const a = deals[i], b = deals[i + 1]
    const finalSeason = Number(a.year_signed) + Number(a.years) - 1
    if (Number(a.years) < 1 || finalSeason < first || finalSeason > last) continue
    const signed = Number(b.year_signed)
    if (signed !== finalSeason && signed !== finalSeason + 1) continue
    const bucket = Number(a.apy) < 2_000_000 ? tally.under : tally.over
    bucket[1]++
    if (b.team === a.team) bucket[0]++
  }
}

const pct = ([stayed, total]) => `${Math.round((stayed / total) * 100)}% of ${total}`
console.log(`Contracts ending ${first}–${last} with a next deal:`)
console.log(`  under $2M APY: ${pct(tally.under)} stayed`)
console.log(`  $2M+ APY:      ${pct(tally.over)} stayed`)
console.log(`  all:           ${pct([tally.under[0] + tally.over[0], tally.under[1] + tally.over[1]])} stayed`)
