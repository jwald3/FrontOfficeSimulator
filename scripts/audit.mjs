// Audits every team's contracts against OverTheCap's live team cap pages and
// nflverse's current rosters, the checks the home team's books got by hand, and
// applies what changed to public/data/offseason-2027.json:
//
//   - released players come off the books (their dead money is in OTC's total)
//   - traded players move to their new team, rebuilt from its page
//   - new contracts and extensions are added, and the player leaves the free-agent list
//   - contracts whose cap number changed are rebuilt from OTC's year-by-year table
//   - dead money is OTC's 2027 dead-money total plus 2027 void-year charges
//   - the projected rollover is the team's unused 2026 cap space (only positive space rolls)
//   - every contract gets its current roster status from nflverse
//
// The home team (snapshot.team, else NYJ) was audited by hand and is left alone.
// Each team records what changed under `audit`.
//
// Usage: node scripts/audit.mjs            (fetches; OTC pages are cached in .cache/otc for a day)
//        node scripts/audit.mjs --dry-run  (reports without writing)

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const SNAPSHOT = 'public/data/offseason-2027.json'
const CACHE = '.cache/otc'
const PLAYERS_CSV = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'
const DRY = process.argv.includes('--dry-run')
const HOME = 'NYJ'
const today = new Date().toISOString().slice(0, 10)

const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
const home = snap.team ?? HOME
const season = snap.season
const rosterCsv = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season - 1}.csv`
const mins = snap.salaryRules.minimum2027

// ─── Fetching ───────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'front-office data audit (github.com/jwald3/FrontOfficeSimulator)' } })
    if (res.ok) return res.text()
    if (res.status !== 429 && res.status < 500) throw new Error(`${url}: HTTP ${res.status}`)
    await sleep(5000 * (attempt + 1))
  }
  throw new Error(`${url}: gave up after retries`)
}

/** A team's OTC cap page, cached for a day so re-runs don't hammer the site. */
async function otcPage(team) {
  mkdirSync(CACHE, { recursive: true })
  const file = `${CACHE}/${team.id}.html`
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 86_400_000) return readFileSync(file, 'utf8')
  const slug = team.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const page = await get(`https://overthecap.com/salary-cap/${slug}`)
  writeFileSync(file, page)
  await sleep(2000)
  return page
}

/** A small CSV parser: quoted fields with commas and doubled quotes. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const endField = () => {
    row.push(field.replace(/\r$/, ''))
    field = ''
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') endField()
    else if (c === '\n') {
      endField()
      rows.push(row)
      row = []
    } else field += c
  }
  if (field || row.length) {
    endField()
    rows.push(row)
  }
  const [head, ...body] = rows
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

// ─── OTC page parsing ───────────────────────────────────────────────────────

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim()

/** "$1,250,000" → 1250000, "($870,000)" → -870000, anything else → null. */
function money(s) {
  const m = /^(\()?\$?([\d,]+)\)?$/.exec((s ?? '').trim())
  if (!m) return null
  const v = Number(m[2].replace(/,/g, ''))
  return m[1] ? -v : v
}
const moneyList = (s) => [...(s ?? '').matchAll(/\(?\$[\d,]+\)?/g)].map((m) => money(m[0]))

function yearBlock(page, year) {
  const a = page.indexOf(`id="y${year}"`)
  if (a < 0) return ''
  const b = page.indexOf('id="y', a + 10)
  return page.slice(a, b < 0 ? page.length : b)
}

/** Contracted players in a year: OTC id → cells (name, base, prorated, roster, …, cap, dead, savings). */
function contracted(page, year) {
  const out = new Map()
  for (const [, table] of yearBlock(page, year).matchAll(/<table[^>]*class="salary-cap-table contracted-players"([\s\S]*?)<\/table>/g)) {
    for (const [, row] of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const id = /href="\/player\/[^"]*\/(\d+)\/"/.exec(row)?.[1]
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1]))
      if (id && cells.length > 13) out.set(`otc-${id}`, { url: `https://overthecap.com${/href="(\/player\/[^"]+)"/.exec(row)[1]}`, cells })
    }
  }
  return out
}

/**
 * Players on a reserve list (injured reserve, PUP, suspended…) for the year: still
 * under contract and on the cap, but listed with only a cap number. Returned as
 * contract rows with the cap as base salary and no dead-money detail.
 */
function reserve(page, year) {
  const out = new Map()
  const block = yearBlock(page, year)
  for (const m of block.matchAll(/<table[^>]*class="salary-cap-table non-active"([\s\S]*?)<\/table>/g)) {
    const title = decode(block.slice(Math.max(0, m.index - 300), m.index).replace(/<\/[^>]+>/g, ' ')).replace(/\s+/g, ' ')
    if (/Dead Money\s*$/.test(title)) continue
    for (const [, row] of m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const id = /href="\/player\/[^"]*\/(\d+)\/"/.exec(row)?.[1]
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1]))
      if (!id || cells.length < 2) continue
      const cap = cells[cells.length - 1]
      out.set(`otc-${id}`, {
        url: `https://overthecap.com${/href="(\/player\/[^"]+)"/.exec(row)[1]}`,
        cells: [cells[0], cap, '$0', '$0', '$0', '$0', '$0', '$0', '', '$0', '', cap, '', '$0$0$0$0$0$0', ''],
        reserve: /Injured Reserve|Physically Unable to Perform|Non-Football Injury|Suspended|Exempt|Reserve/.exec(title)?.[0] ?? 'Reserve',
      })
    }
  }
  return out
}

/** The year's dead-money total, from its non-active "Dead Money" table. */
function deadMoney(page, year) {
  for (const [, table] of yearBlock(page, year).matchAll(/<table[^>]*class="salary-cap-table non-active"([\s\S]*?)<\/table>/g)) {
    const text = decode(table.replace(/<\/t[dh]>/g, ' ')).replace(/\s+/g, ' ')
    if (!/Name Cap Number/.test(text) || /Reserve|Practice|Physically|Non-Football|Suspended|Exempt/i.test(text.slice(0, 60))) continue
    const total = /TOTAL \$([\d,]+)/.exec(text)
    if (total) return Number(total[1].replace(/,/g, ''))
  }
  return 0
}

function summaryFigure(page, year, label) {
  const text = decode(yearBlock(page, year).replace(/<\/[^>]+>/g, ' ')).replace(/\s+/g, ' ')
  const m = new RegExp(`${label}: (\\(?\\$[\\d,]+\\)?)`).exec(text)
  return m ? money(m[1]) : null
}
const teamCapSpace = (page, year) => summaryFigure(page, year, 'Team Cap Space')

/** One season of a contract from OTC's row: the shape ContractYear uses. */
function contractYear(year, c) {
  const base = money(c[1]) ?? 0
  const bonus = (money(c[2]) ?? 0) + (money(c[3]) ?? 0)
  const cap = money(c[11]) ?? 0
  const guaranteed = money(c[9]) ?? 0
  return { year, base, bonus, other: cap - base - bonus, guaranteedBase: Math.min(base, guaranteed), outsideBaseIncluded: 0 }
}

// ─── Players ────────────────────────────────────────────────────────────────

const POSITION = { T: 'OT', OT: 'OT', G: 'IOL', C: 'IOL', OL: 'IOL', DE: 'EDGE', OLB: 'EDGE', DT: 'IDL', NT: 'IDL', DL: 'IDL', ILB: 'LB', MLB: 'LB', LB: 'LB', SAF: 'S', FS: 'S', SS: 'S', S: 'S', DB: 'CB', CB: 'CB' }
/** nflverse team codes that differ from ours. */
const NFLVERSE_TEAM = { LA: 'LAR' }
const STATUS = { ACT: 'Active', RES: 'Reserve', DEV: 'Practice squad', INA: 'Inactive', EXE: 'Exempt', CUT: 'Released', RET: 'Retired', TRD: 'Traded', TRT: 'Traded' }

function ageOn(birth, on) {
  const b = new Date(birth)
  const d = new Date(on)
  return d.getUTCFullYear() - b.getUTCFullYear() - (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate()) ? 1 : 0)
}

// ─── Run ────────────────────────────────────────────────────────────────────

console.log('Downloading nflverse players and rosters…')
const players = new Map(parseCsv(await get(PLAYERS_CSV)).filter((p) => p.otc_id).map((p) => [`otc-${p.otc_id}`, p]))
const latest = new Map()
for (const r of parseCsv(await get(rosterCsv))) {
  const prev = latest.get(r.gsis_id)
  if (!prev || Number(r.week) >= Number(prev.week)) latest.set(r.gsis_id, r)
}

const others = snap.teams.filter((t) => t.id !== home)
const pages = new Map()
for (const t of others) {
  process.stdout.write(`\rOverTheCap: ${t.id}   `)
  pages.set(t.id, await otcPage(t))
}
console.log()

// Who holds a real (non-void) 2027 contract where, per OTC.
const live = new Map()
const holder = new Map()
for (const t of others) {
  const rows = new Map([...contracted(pages.get(t.id), season), ...reserve(pages.get(t.id), season)])
  live.set(t.id, rows)
  for (const [id, row] of rows) if (row.cells[1] !== 'Void') holder.set(id, t.id)
}
const existing = new Map([...snap.roster, ...Object.values(snap.otherRosters).flat()].map((p) => [p.id, p]))
const pending = new Map([...snap.freeAgents, ...snap.rightsPlayers].map((p) => [p.id, p]))
const signedOff = new Set()
const report = []

/** A contract built from OTC's rows for this player on this team, keeping anything authored. */
function build(teamId, id, prior) {
  const page = pages.get(teamId)
  const years = []
  for (let y = season; y < season + 6; y++) {
    const row = y === season ? live.get(teamId).get(id) : contracted(page, y).get(id)
    if (!row || row.cells[1] === 'Void') break
    years.push(contractYear(y, row.cells))
  }
  const now = live.get(teamId).get(id)
  const dead = moneyList(now.cells[13])
  const nfl = players.get(id)
  const fa = pending.get(id)
  const experience = prior?.experience ?? fa?.experience ?? (nfl?.years_of_experience ? Number(nfl.years_of_experience) : 0)
  const credited = prior?.creditedSeasons ?? experience
  const minimumBase = mins[Math.min(credited, mins.length - 1)]
  const total = years.reduce((a, y) => a + y.base + y.bonus + y.other, 0)
  return {
    ...prior,
    id,
    name: prior?.name ?? fa?.name ?? now.cells[0],
    pos: prior?.pos ?? fa?.pos ?? POSITION[nfl?.position] ?? nfl?.position ?? 'LB',
    team: teamId,
    apy: prior && prior.team === teamId ? prior.apy : Math.round(total / Math.max(1, years.length)),
    sourceUrl: now.url,
    minimumBase,
    restructureEligible: years.length >= 2 && years[0].base - minimumBase >= 1_000_000,
    depth: prior?.depth ?? false,
    years,
    releaseDead: dead[0] ?? 0,
    tradeDead: dead[2] ?? 0,
    reportedCap: money(now.cells[11]) ?? 0,
    grade: prior?.grade ?? fa?.grade ?? 68,
    age: prior?.age ?? fa?.age ?? (nfl?.birth_date ? ageOn(nfl.birth_date, `${season}-09-01`) : 26),
    experience,
    creditedSeasons: credited,
    capBasis: `OverTheCap team cap page, audited ${today}`,
  }
}

for (const t of others) {
  const rows = live.get(t.id)
  const ours = snap.otherRosters[t.id] ?? []
  const ourIds = new Set(ours.map((p) => p.id))
  const changes = { released: [], tradedAway: [], tradedIn: [], signed: [], updated: [], conflicts: [] }
  const kept = []
  for (const p of ours) {
    const row = rows.get(p.id)
    if (!row || row.cells[1] === 'Void') {
      const to = holder.get(p.id)
      if (to) changes.tradedAway.push(`${p.name} (to ${to})`)
      else changes.released.push(p.name)
      continue
    }
    if ((money(row.cells[11]) ?? 0) !== p.reportedCap) {
      changes.updated.push(`${p.name}: ${(p.reportedCap / 1e6).toFixed(2)}M → ${((money(row.cells[11]) ?? 0) / 1e6).toFixed(2)}M`)
      kept.push(build(t.id, p.id, p))
    } else kept.push(p)
  }
  let voids = 0
  for (const [id, row] of rows) {
    if (row.cells[1] === 'Void') {
      voids += money(row.cells[11]) ?? 0
      continue
    }
    if (ourIds.has(id)) continue
    const prior = existing.get(id)
    const contract = build(t.id, id, prior)
    kept.push(contract)
    if (prior) changes.tradedIn.push(`${contract.name} (from ${prior.team})`)
    else {
      changes.signed.push(`${contract.name}${pending.has(id) ? ` (was a pending ${pending.get(id).type})` : ''}${row.reserve ? ` (on ${row.reserve})` : ''}`)
      if (pending.has(id)) signedOff.add(id)
    }
  }
  // Roster status from nflverse's latest week.
  for (const p of kept) {
    const r = latest.get(players.get(p.id)?.gsis_id)
    if (r) {
      const team = NFLVERSE_TEAM[r.team] ?? r.team
      const status = STATUS[r.status] ?? r.status
      p.rosterStatus = team === t.id ? status : `${status} (listed with ${team})`
      p.rosterSource = rosterCsv
      p.rosterChecked = today
      // OTC's contract stands, but a person should look at why the roster disagrees.
      if (team !== t.id || ['CUT', 'RET', 'TRD', 'TRT'].includes(r.status)) changes.conflicts.push(`${p.name}: OTC has his contract, nflverse lists him ${p.rosterStatus.toLowerCase()}`)
    }
  }
  snap.otherRosters[t.id] = kept

  const page = pages.get(t.id)
  const dead = deadMoney(page, season)
  const space2026 = teamCapSpace(page, season - 1) ?? 0
  const entry = snap.teams.find((x) => x.id === t.id)
  const previous = entry.audit
  entry.dead = dead
  entry.existingDead = dead + voids
  entry.rollover = Math.max(0, space2026)
  // OTC's cap for the team can differ from the league cap (incentive credits, prior overages):
  // whatever makes its own cap space add up.
  const liabilities = summaryFigure(page, season, 'Total Cap Liabilities')
  const otcSpace = teamCapSpace(page, season)
  entry.capAdjustment = liabilities != null && otcSpace != null ? otcSpace + liabilities - entry.capLimit : 0
  // Today's figures for the team picker.
  if (otcSpace != null) entry.capSpace = otcSpace
  const top51 = summaryFigure(page, season, 'Top 51')
  if (top51 != null) entry.activeCap = top51
  entry.audit = {
    checked: today,
    source: `https://overthecap.com/salary-cap/${t.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    rosterSource: rosterCsv,
    rolloverBasis: `Unused ${season - 1} cap space on OverTheCap (${(space2026 / 1e6).toFixed(2)}M); only positive space rolls over.`,
    deadMoney: dead,
    voidCharges: voids,
    otcCapSpace: otcSpace,
    // What changed since the original snapshot: earlier runs' changes carry forward.
    // Conflicts are only current.
    ...Object.fromEntries(
      Object.entries(changes)
        .map(([k, v]) => [k, k === 'conflicts' ? v : [...new Set([...(previous?.[k] ?? []), ...v])]])
        .filter(([, v]) => v.length),
    ),
  }
  const n = Object.values(changes).reduce((a, v) => a + v.length, 0)
  if (entry.capAdjustment) report.push(`${t.id}: cap adjustment ${(entry.capAdjustment / 1e6).toFixed(2)}M`)
  report.push(`${t.id}: ${n ? Object.entries(changes).filter(([, v]) => v.length).map(([k, v]) => `${k} ${v.join(', ')}`).join(' · ') : 'no contract changes'} · rollover ${(entry.rollover / 1e6).toFixed(2)}M`)
}

snap.freeAgents = snap.freeAgents.filter((p) => !signedOff.has(p.id))
snap.rightsPlayers = snap.rightsPlayers.filter((p) => !signedOff.has(p.id))
snap.version = `${season}-${today.replace(/-/g, '')}-audit`
const note = `Every team's contracts audited ${today} against its OverTheCap cap page and nflverse's ${season - 1} rosters (scripts/audit.mjs): releases, trades, new deals and changed cap numbers applied; dead money is OTC's ${season} total plus void-year charges; projected rollover is unused ${season - 1} cap space. The home team's books were audited by hand.`
snap.notes = [...snap.notes.filter((n) => !n.startsWith("Every team's contracts audited")), note]
for (const s of [
  { label: 'Over the Cap: every team salary-cap page (contracts, dead money, cap space)', url: 'https://overthecap.com/salary-cap-space' },
  { label: `nflverse: ${season - 1} rosters (current team and status)`, url: rosterCsv },
])
  if (!snap.sources.some((x) => x.url === s.url)) snap.sources.push(s)

for (const line of report) console.log(line)
console.log(`Free agents signed off the list: ${signedOff.size}`)
if (DRY) console.log('Dry run: nothing written.')
else {
  writeFileSync(SNAPSHOT, JSON.stringify(snap))
  console.log(`Wrote ${SNAPSHOT} (version ${snap.version})`)
}
