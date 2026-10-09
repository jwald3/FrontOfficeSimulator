# Front Office

**Play it: [jwald3.github.io/FrontOfficeSimulator](https://jwald3.github.io/FrontOfficeSimulator/)** · Open source, MIT-licensed

Run a pro football team's 2027 offseason as a game: pick any of the 32 teams, decide the head coach's future, release, restructure and shop players, re-sign your own, work free agency and trades, and run the draft — with the presentation of a franchise mode. Every page takes on your team's colours.

## Make it yours

Front Office is open source, and you're encouraged to use it however you like: fork it, mod it, re-skin it for your team's fan site, swap in your own rules or data, or pull the engine out for something else entirely. The code is MIT-licensed, so you can use, change and share it, commercially or not, as long as the license notice comes along.

Some places to start:

- **Your team, your site:** the colours, head coach decision copy, hiring board, re-sign calls and suggested moves are all editorial: change them on the Editorial screen (`npm run dev`, then Editorial on the title menu) without touching code, then deploy your own copy with the GitHub Pages workflow.
- **Your rules:** the engine in `src/engine/` is plain TypeScript with no UI, from the cap rules to the trade-value model and the draft AI, and it's covered by tests.
- **Your data:** the data files in `public/data/` are plain JSON with scripts to refresh them (see `CONTRIBUTING.md`).

Improvements that would help everyone are welcome back as pull requests, and bug reports and data corrections as issues.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests against the real data snapshot
npm run build    # static build in dist/
```

Append `?instant` to the URL to skip all animations.

To serve it from a subfolder (GitHub Pages, for one), build with `BASE_PATH=/FrontOfficeSimulator/ npm run build`. `.github/workflows/pages.yml` does this on every push to `main` once Pages is set to deploy from GitHub Actions. See `CONTRIBUTING.md` to help out.

## Playing as any team

The data snapshot is built around one team's books (the Jets', where the project started), and `forTeam` in `src/engine/team.ts` re-centres a copy on whichever team you pick: its contracts become your roster, its pending free agents and rights players become yours to re-sign, its cap figures replace the home team's, and everyone else becomes the league. The run remembers the team (`RunState.team`), so the engine never assumes one.

Team colours live in `src/ui/theme.ts`. Each team sets three colours — its primary, a light accent for buttons and lines, and a bright highlight — and everything else (backgrounds, panels, muted text, lines) is derived from the primary's hue. The page's CSS reads them as custom properties (see `:root` in `src/index.css`), so picking a team repaints every screen.

What differs by team:

- **Auditing:** the Jets' books (the snapshot's home team) were checked by hand against the team's official roster, its transactions and Spotrac. The other 31 are checked by `npm run data:audit` (`scripts/audit.mjs`) against each team's OverTheCap cap page and nflverse's current rosters: releases, trades, new deals, extensions and changed cap numbers are applied, players on reserve lists stay on the books, and every contract carries its current roster status. Each team's `audit` in the snapshot records what changed, and a test holds every audited team's cap space to OverTheCap's to the dollar.
- **Cap:** every team's cap includes a projected rollover. The Jets' is Spotrac's October estimate; the others' is their unused 2026 cap space on OverTheCap, which is what rolls over if they don't spend it. Team-specific cap adjustments (OTC's figure minus the league cap) are applied too.
- **Head coaches** for every team come from Wikipedia's team staff templates (`npm run data:coordinators`), as do the coordinators on the hiring board. A team's own coordinators are internal promotions.
- **Editorial content:** the shipped editorial choices (re-sign calls, suggested moves, depth chart edits, untouchables, the keep-or-fire case) are mostly about the Jets, so other teams play on the default rules. The game works the same for every team; it's just less curated.

## Layout

- `public/data/offseason-2027.json` — the data snapshot: contracts, free agents, rights players, prospects, picks, all 32 teams, rookie scale and salary rules. Its `notes` array documents every modelling assumption and its `sources` array lists where each part came from.
- `public/data/depth.json` — each player's spot on his team's current [OurLads](https://www.ourlads.com/nfldepthcharts/) depth chart. Rebuild it with `npm run data:depth`. Depth 1 is the listed starter.
- `public/data/headshots.json` — player id → NFL.com headshot, matched through the [nflverse](https://github.com/nflverse/nflverse-data) players table. Rebuild it with `npm run data:headshots` after refreshing the snapshot. Images load from NFL.com's CDN; draft prospects and players without a photo keep the silhouette.
- `public/data/coordinators.json` — every team's head coach and coordinators, from Wikipedia's team staff templates. Rebuild with `npm run data:coordinators`.
- `src/engine/` — the rules, as pure TypeScript with no UI: cap accounting, contract moves and negotiation. Randomness is seeded per run and keyed per decision, so outcomes are reproducible and can't be re-rolled by resubmitting.
- `src/game/store.ts` — run state (Zustand), persisted to `localStorage`.
- `src/ui/` — screens and components (React, Framer Motion).

## Cap model

At the start of a run as the Jets (the snapshot's home team) the engine reproduces these figures exactly (see `src/engine/engine.test.ts`):

| | |
|---|---|
| Adjusted cap (incl. projected rollover) | $337.42M |
| Committed, Top 51 | $228.15M |
| Dead & void charges | $10.04M |
| Total space | $99.23M |
| Draft reserve | $19.70M |
| **Effective space** | **$79.54M** |

Draft reserve is each unsigned pick's projected first-year charge above the $930K rookie minimum — a rookie takes a roster spot that would otherwise cost the minimum. Releases are pre-June 1 (all proration accelerates). Restructures convert base above the player's minimum into a bonus prorated over up to five remaining years. Cash is unchanged, so players always agree; each contract can be restructured once.

## Editorial controls

Content an editor chooses lives in `public/data/editorial.json` and ships with the game. Edit it from **Editorial** on the title menu, shown on the dev server (`npm run dev`) or with `?editor` in the URL. **Save** writes the file through a dev-server-only endpoint (`POST /__editorial`, see `vite.config.ts`), so commit the file afterwards to ship the change.

- **Head coach decision:** the case for keeping each team's coach and the case for a change, shown on the keep-or-fire screen. Pick the team, then write both sides.
- **Head coach candidates:** who's on the hiring board if you fire the head coach. Pick from every team's current offensive and defensive coordinators (`public/data/coordinators.json`, from Wikipedia's team staff templates; rebuild with `npm run data:coordinators`), and add anyone else by hand. A team's own coordinators are internal promotions and always accept. For everyone else, set interest — *Accepts*, *Leans accept* (75%), *Either way* (50%), *Leans decline* (25%) or *Declines* — and a note for his card. The **Interest levels** panel explains each level and lets you tune the three chances and the line the offer dialog shows.
- **Re-sign calls:** re-sign, tender or let walk each of our expiring players, with a reason. "Simulate re-signings" follows these calls and shows the reasons in its preview; players without one fall back to the rule. The editor picks the call, not the terms: a re-signed player signs at his own ask.
- **Suggested moves:** the default rule and per-player calls behind the Suggested tab of in-house decisions. The rule (releases that save at least $2M more than a replacement costs; restructures of starters 30 or younger once effective space is under $25M) can be switched off or retuned, and each player's dropdown shows what it picks for him ("Default: Release"). Override any player with release, restructure, trade block or don't suggest, plus a reason shown on his row; calls are listed first. "Simulate in-house decisions" makes the same moves and heads to re-signings.
- **Free agency:** mark any other team's pending free agent **Stays** (he re-signs at home before the market opens, so nobody can sign him) or **Hits market** (he always reaches it), with an optional reason shown on his card. Unmarked players roll the historical retention rate. Search by name or team, filter by position, or show only marked players.
- **Depth chart:** each player's role — his slot and string (1st–4th, or off the chart) — replacing the OurLads chart. Pick a team or search the league; ↺ puts a player back on his OurLads spot. 1st-string players are proven starters, so a change moves the lineup, the roster-talent grade, trade value and free-agent demand. A run already in progress keeps the roles its roster started with; new runs pick up the changes.
- **Draft order:** this season's team order, replacing the projection. Type a slot or nudge a team; every round follows it, compensatory picks stay at the end of their rounds, and traded picks follow the team they came from. Each pick takes the trade value and rookie contract of its new slot, so a team's draft reserve and effective space move with its picks. The projection's tie rotations between rounds are dropped once the order is edited. New runs pick up the change.
- **Draft board:** our own big board. Type a rank or nudge a prospect up or down; the order becomes every prospect's rank, so the draft screen, AI teams and projected rounds all follow it. Anyone not moved keeps his source spot, and **Reset order** goes back to the source board. Add a scouting note for his card, and set underclassmen to **Declares** or **Returns** instead of rolling their listed chance. Its **Recommendations** rules stop the draft suggesting a position once we've taken one early: by default, a quarterback in the first three rounds closes QB (the Fit column shows it as filled).

## Offer reports

Players can flag any trade offer from its review card as **too high** or **too low**, with an optional note. The report records the offer, the player's value (and the model's), and the run's seed, mode and data version. On the dev server it is written to `data/reports.json` (outside `public/`, so it never ships) and appears in **Feedback** on the editorial screen, where the editor sets the player's value on the spot, opens the trade-value model, or ignores it, and can reopen it later. Each report keeps its full history: flagged, adjusted (old and new value), ignored, reopened, with times.

A deployed site has no dev server, so reports need somewhere to go: build with `VITE_REPORTS_URL` set to an endpoint that accepts the same `POST` (see `src/game/reports.ts`). Without one, the flag button is hidden.

## No invented ratings

The game uses no player ratings or morale. Who's good is decided by real data:

- **Starters** are players listed first on a current OurLads depth chart, or on the editorial depth chart where an editor has changed a role. The lineup takes them first at each position, then the bigger contract, and the "roster talent" part of the grade counts proven starters in the 24 lineup spots against where you began.
- **Trade value** (in draft-chart points, this season's pick 1 = 3000; `src/engine/valuation.ts`) starts from each position's ceiling (QB 3000, EDGE 2200, WR 2000 … RB 800), scaled by his APY as a share of the position's five best-paid league-wide, raised to a star premium (1.6) so stars pull away from starters. Listed starters on cheap deals keep a floor (20% of the ceiling). Age runs against each position's prime (RBs fade after 26, QBs after 32): up to 15% more before it, a yearly decline after. Backups keep 60% (second string) or 35%, and one or two years of control left keep 70% or 85%. Garrett Wilson ($32.5M WR, 27) comes out at about 1,640, the fourth or fifth pick. A rookie we drafted is worth his slot. Every number is editorial (**Trade values** on the editorial screen), and an editor can set any player's value outright, which replaces the model's for him in offers, calls, negotiation and asking prices. A player can also be locked as untouchable: other teams won't trade him for any package, and a player on your team draws no offers or calls and can't go on the trade block. A player can also be marked **No 1sts**, never worth a first-round pick: no first, this year's or future, moves in any deal for him. Teams' offers and calls for him are built without firsts, counters can't ask for one, and the trade finder won't send one for him. That keeps cheap future firsts from being spent on players who aren't worth one.
- **Free-agent demand** (how fast he signs, rival offer sheets) comes from his market price plus a bump for starters. Note that most market prices in the snapshot are modelled estimates, not published projections (`marketKind: modeled`).
- **Draft prospects** are valued by consensus big-board rank, or by the editorial draft board when an editor has set one.

## Negotiation

Each player gets a personality rolled once per run: asking price around his market value, preferred length, expected guarantees, patience and (for our own players) a flat 4% hometown discount. An offer is scored against his ask; the threshold is firm and nothing re-rolls, so nudging an offer by a dollar can't fish for a yes. The agent-read meter is deliberately fuzzy. Lowball offers burn patience, and when it runs out he ends talks.

## Free agency and trades

Most free agents never reach the market: before it opens, each other team's pending free agent re-signs with his own team at the historical rate for his current contract — 59% under $2M a year, 38% at $2M or more — measured from OverTheCap contract histories for deals ending 2021–2024 (`node scripts/retention.mjs` reproduces it). An editorial call settles it for a given player instead. The market runs in four waves (Day 1 → Late market). Asking prices start 6% above the base ask and fall to 86% by the late market, while rival teams sign the best players first, weighted by positional need and cap room (every club gets $40M of modelled flexibility for cuts and restructures). Players on our trade block draw offers of picks each wave, and teams that need a position call unprompted about a couple of players we didn't shop, opening below his value. Everything that needs an answer lands in the **Inbox**: offer sheets and trade offers, each with a review card showing what goes each way and the cap effect if accepted. Accept, decline, or negotiate once: the team sweetens (up to 110% of his value), holds firm or pulls the offer, decided per offer so it can't be re-asked. Offers expire when the clock moves, and the inbox keeps a history of each one. Any offer can also be **countered** by naming the picks you want from that team: each team has a ceiling for the deal, fixed per offer (95–115% of the player's value, and never below its own offer). At or under it, the trade goes through on your terms; up to 20% over, they say no (two counters per offer); beyond that, they pull the offer. Future picks drop half a round for each season ahead and are valued on this season's chart, so a 2028 first trades like pick 32 and a 2029 first like pick 48 (the usual NFL rule of thumb is a full round; the drop is editorial). Unsolicited calls open at 80–100% of a player's value and trade-block offers at 80–105%. Teams take three calls about a player before they stop answering.

## Draft and grading

AI teams pick from the top 40 available by board rank (consensus, or the editorial board) plus positional need (which shrinks as they fill it), a nudge for consensus-mock pairings, QB appetite from each team's outlook (gone once the team has drafted a quarterback), and a per-run taste so no two drafts match. Underclassmen with remaining eligibility declare once per run at their listed probability. On the clock, teams below may call to trade up into our pick (open their offers from the phone button); counter any of them by naming the picks you want, against a ceiling of 110–130% of our pick's value. While another team is picking, **Trade up** offers our picks for any pick before our next one: teams want a 5–20% premium to move down, and take three calls about a pick (a lowball counts twice) before they stop answering. The dialog shows their read on the package and their patience, and an offer in range draws a counter while they still have patience: your package plus the fewest, smallest extra picks that reach their price, accepted with one click. Our picks sign the projected slot contract; because the draft reserve already held each rookie's cost above the minimum, effective space only moves by the minimum when a pick is made.

The final grade blends five categories — roster talent (proven starters in the lineup, before vs after), cap health (this season's room, next season's commitments, and improvement since kickoff), draft capital, roster completeness, and age — weighted by the objective chosen at kickoff. A passive offseason grades around a C.

## Starting point

The setup screen's **Starting point** skips ahead for a quick game: start at **Free agency** or **The draft**, with every decision before it simulated the way the game already suggests (`src/engine/quickstart.ts`). The head coach is kept; the Suggested moves are made, best first and re-checked after each one (editor calls included); re-signings follow "Simulate re-signings". Starting at the draft also runs free agency: each lineup spot without a proven starter gets the most coveted available starter at his Day 1 ask while $10M of effective space stays free, offer sheets are matched when affordable, and the league's waves run out. The simulated moves count toward the final grade like any others.

## Challenges and sharing

- **Challenge codes** (`FO-<seed>-<mode><objective>-<team>`, or a `?run=` link) pin everything random about a run and the team, so two people face the same offseason and can compare grades. Accepting one locks the team, mode and objective.
- **Share card:** a 1200×630 PNG drawn on canvas in the team's colours, with the grade, proven starters, cap space, headline moves and the challenge code.

## Status

| Phase | |
|---|---|
| 1 Head Coach | Playable: keep the team's head coach, or fire him and hire from the editorial board (staff promotions always accept; outside candidates may decline). No effect on the cap or grade |
| 2 In-House Decisions | Playable: release, restructure, trade block, suggested moves |
| 3 Re-Sign Your Own | Playable: negotiation (years, AAV, guarantees, four structures), franchise/transition tags, RFA/ERFA tenders, futures contracts |
| 4 Free Agency | Playable: four-wave market with rival signings, offer sheets (match or take the pick), an inbox of trade offers and unsolicited calls (accept, negotiate or decline), trade finder for any player in the league |
| 5 The Draft | Playable: 257-pick draft with need-driven AI, per-run declarations, trade-down calls, slot rookie contracts, UDFA recruiting within the bonus pool |
| 6 Your Offseason | Playable: objective-weighted letter grade, proven starters before/after, depth chart, move-by-move recap |

## Data sources and credits

Front Office is a fan project. It isn't affiliated with or endorsed by the NFL, any team, or any of the sources below, and team names and colours belong to their owners. No team logos are used.

- **Contracts, cap tables, free agents, compensatory picks and rookie slots:** [OverTheCap](https://overthecap.com), with cap rollover and some market values from [Spotrac](https://www.spotrac.com).
- **Depth charts:** [OurLads](https://www.ourlads.com/nfldepthcharts/).
- **Headshots:** loaded from NFL.com, matched through [nflverse](https://github.com/nflverse/nflverse-data).
- **Coaching staffs:** Wikipedia's NFL team staff templates.
- **Draft order and prospects:** [Tankathon](https://www.tankathon.com), [NFL Mock Draft Database](https://www.nflmockdraftdatabase.com) and [Drafttek](https://www.drafttek.com); future pick ownership from [Pro Sports Transactions](https://www.prosportstransactions.com).

The full list, with links, is in the snapshot's `sources` array and on the **Data & Rules** screen. The data is included for non-commercial, fan use; check each source's terms before reusing it elsewhere.

## License

The code is released under the MIT License (see `LICENSE`): use it, modify it and share it freely. The data in `public/data/` comes from the sources above and isn't covered by that license; check each source's terms before reusing it.
