# Contributing to Front Office

Thanks for helping. Bug reports, data corrections and pull requests are all welcome.

## Getting set up

```sh
npm install
npm run dev      # http://localhost:5173 (append ?instant to skip animations)
npm test         # engine tests against the real data
npm run lint
npm run build    # type-checks, then builds dist/
```

CI runs lint, tests and the build on every pull request; please run them locally first.

## How the code is laid out

- `src/engine/` holds the rules as pure TypeScript with no UI. Every random choice is seeded per run and keyed per decision (`roll(seed, key)`), so the same run always gets the same answer. Keep it that way: no `Math.random()` in the engine.
- `src/game/store.ts` is the run state (Zustand) and the bridge between the UI and the engine.
- `src/ui/` holds the screens. Colours come from CSS custom properties set per team in `src/ui/theme.ts`, so use `var(--accent)`, `rgb(var(--pop-rgb) / 0.2)` and friends instead of literal colours. Literal colours are only for things that mean the same for every team (gold, alert, the medal tiers).
- Never hard-code a team. The team being played is `run.team` (or `snap.team`), and its name in headlines is `run.teamName`.

Engine changes should come with tests (`src/engine/*.test.ts`). They run against the real data, so assertions can name real players and teams. `team.test.ts` plays every team through to the draft, which catches most "works for one team only" mistakes.

## Data

Everything the game knows is in `public/data/`:

| File | What it is | How to rebuild |
| --- | --- | --- |
| `offseason-2027.json` | Contracts, cap figures, free agents, rights players, prospects, picks and all 32 teams | Not from scratch (see below); `npm run data:audit` brings every team's contracts up to date |
| `depth.json` | Each player's spot on his team's OurLads depth chart | `npm run data:depth` |
| `headshots.json` | Player id → NFL.com headshot, via nflverse | `npm run data:headshots` |
| `coordinators.json` | Every team's head coach and coordinators, from Wikipedia | `npm run data:coordinators` |
| `editorial.json` | Editor choices (see the README's Editorial controls) | The Editorial screen on the dev server |

`offseason-2027.json` was assembled once from public sources. It can't be rebuilt from scratch yet, but `npm run data:audit` (`scripts/audit.mjs`) keeps it current: it checks every team's contracts against its OverTheCap cap page and nflverse's rosters, applies releases, trades, new deals and cap changes, sets dead money and the projected rollover, and records what changed in each team's `audit` (look for `conflicts` there: places the two sources disagree, for a person to check). OTC pages are cached in `.cache/otc` for a day; run with `--dry-run` to see the changes without writing. The Jets' books were audited by hand and are left alone. Its shape is the `Snapshot` interface in `src/engine/types.ts`; the main parts:

- `roster`: the home team's contracts (the Jets', where the data started), with year-by-year base, bonus and other charges, and release and trade dead money. `otherRosters` has every other team's, keyed by team id. `forTeam` in `src/engine/team.ts` swaps these round for whichever team is played.
- `teams`: id, name, cap figures (`capLimit`, `capSpace`, `existingDead`), positional `needs` from 0 to 1, and QB outlook.
- `freeAgents` and `rightsPlayers`: pending free agents with their market price (`marketAAV`), contract type (UFA, RFA, ERFA, Void) and current team.
- `prospects` and `picks`: the draft class with board ranks, and every pick for 2027–2030 with its owner and original team.
- `rookieScale`, `salaryRules`, `futurePickValuation`: league rules the engine reads.
- `notes` and `sources`: every modelling assumption, and where each part came from. Add to both when you change the data.

A script that builds the snapshot from its sources, so it can be refreshed and carried to a 2028 offseason, would be a very welcome contribution.

If you spot a wrong contract, coach or pick, the **Data correction** issue template asks for the source.

## Pull requests

- Keep changes focused, and describe what a player will see differently.
- For visual changes, include a screenshot, ideally in two different team colours.
