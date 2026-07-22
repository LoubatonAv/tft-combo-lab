# TFT Combo Lab

Small React + Vite + Tailwind + Node.js project for exploring custom Teamfight Tactics Set 17 compositions.

## What it does

- Choose a target trait, for example `Anima`.
- Choose board size from 5 to 10.
- Choose a carry focus or let the engine pick automatically.
- Generate and rank candidate boards.
- Show a TFT-style board plus champion cards.
- Score compositions by:
  - target trait breakpoint
  - active secondary traits
  - champion tier and cost
  - carry suitability and best-item availability
  - overlap with known meta shells
  - role balance: frontline + damage

## Install and run

```bash
npm install
npm run dev
```

Then open:

```txt
http://localhost:5173
```

The API runs on:

```txt
http://localhost:3001
```

## Validate data

```bash
npm run validate:data
```
## Import current MetaTFT snapshot

The app does **not** scrape during normal use. To update the local meta snapshot manually, run:

```bash
npx playwright install chromium
npm run import:meta
npm run validate:data
```

`npm run import:meta` updates:

- `server/data/itemSetStats.json`
- `server/data/itemCatalog.json`
- `server/data/championMeta.json`
- `server/data/unitUpgradeMeta.json`
- `server/data/unitBuildMeta.json`

The importer now attempts to collect normal item builds and star-filtered builds (`1★`, `2★`, `3★`) from MetaTFT unit pages. If MetaTFT changes its markup, the importer may still finish but some star rows can be empty; the app falls back to existing local rules instead of breaking.


## Important data note

This project uses a local snapshot in `server/data`.
That is intentional: TFTactics and MetaTFT are third-party sites and can change markup, use client-side rendering, or block scraping.
The runtime app should not depend on live scraping.

When the set changes, update:

- `server/data/champions.json`
- `server/data/traits.json`
- `server/data/metaComps.json`

## Architecture

```txt
src/                    React frontend
server/src/index.js      Express API
server/src/optimizer.js  Candidate pool + combo generation
server/src/scoring.js    Trait scoring and explanations
server/data/*.json       Local TFT data snapshot
scripts/validate-data    Data integrity check
```

## Critical reviewer notes

### Critical

1. Do not scrape third-party HTML on every app load. It is brittle, slow, and can break silently.
2. Keep `champions.json` and `traits.json` validated. Unknown trait names ruin the optimizer.
3. Avoid brute-forcing all 60 choose 10 boards. The optimizer narrows the candidate pool first.

### High

1. Trait breakpoints should live in one file only: `traits.json`.
2. Scoring weights should stay isolated in `server/src/scoring.js`.
3. Carry selection should be explicit. Auto carry is useful, but user override is required.
4. Use IDs internally, display names only in UI.

### Medium

1. Add a data editor screen later for fixing champion traits/items without touching JSON manually.
2. Add filters for “avoid 5-cost heavy boards”, “reroll”, “fast 8”, “fast 9”.
3. Add champion images once you choose a stable image CDN or local assets.

### Nice to have

1. Add item component ownership: e.g. user has Sword + Bow, rank carries accordingly.
2. Add economy plan notes.
3. Add augment/emblem inputs.
4. Add shareable comp URLs.

## Known limitation

The current local data is a practical seed snapshot for the app and engine. Before using it seriously for ranked decisions, review champion traits/items against your current in-game patch and update the JSON as needed.

## Champion images

Champion cards and board slots use TFTactics/SunderArmor Set 17 portrait URLs in this format:

```txt
https://sunderarmor.com/characters/Skin/17/{ChampionNameWithoutSpaces}.png
```

If an image fails to load, the UI falls back to the old emoji icon so the app does not break.
You can override any champion manually by adding `imageUrl` or `imageName` to that champion in `server/data/champions.json`.

## 2026-06 Coach + Augments update

Added a live-coach layer on top of the existing optimizer without replacing the core board logic.

New runtime inputs:

- **Playstyle**: `First place / capped` or `Top 4 / stable`.
- **Live state**: stage, HP, gold and level.
- **Components**: click components, including duplicate copies, so the advisor can value item/econ augments better.
- **Augments**: click augments as `Selected` or `Offered`.
- **Unit stars**: selected core units can be marked as 1★ / 2★ / 3★.

New data and logic:

- `server/data/augments.json` contains a local Set 17 augment snapshot with tier, description, tags and icon slugs.
- `server/src/augmentAdvisor.js` enriches augments and scores them against the current comp shape.
- `server/src/scoring.js` now adds augment fit into the comp score and shows augment warnings/reasons.
- First-place mode is stricter with weak 1/2-cost trait bots, unless they are 3★, required, or clearly useful.
- The UI has a new Augment Advisor card and Live Coach card in the comp details.

Icon note:

Augment icons are referenced through remote CDN URLs at runtime. They are not bundled as local binary image files, so the app remains lightweight and does not break if an icon is missing; the UI falls back to initials.

## Experimental match-data analysis

The `feature/match-data-ranking` branch contains a separate final-board statistics foundation. It does not alter candidate generation or `/api/optimize` ranking.

Import one Riot-style match object or an array of match objects from a local file:

```bash
npm run import:matches -- test/fixtures/riot-matches.json
```

Imports are stored in `server/data/importedMatches.json`. Match IDs are deduplicated, and contextual-fingerprint summary groups are rebuilt after imports that add new matches. External fetching is deliberately not part of this command.

Normalized boards expose two hashes: `boardFingerprint` identifies intrinsic composition across patches, while `contextFingerprint` combines that board identity with set and patch for patch-specific statistics.

Query statistics for a candidate or optimizer-shaped board:

```http
POST /api/board-stats
Content-Type: application/json
```

```json
{
  "candidateBoard": {
    "units": [
      { "id": "riven", "starLevel": 2, "items": ["TFT_Item_Deathblade"] },
      { "id": "ezreal", "starLevel": 3, "items": ["TFT_Item_BlueBuff"] },
      { "id": "pantheon", "starLevel": 2 },
      { "id": "shen", "starLevel": 2 }
    ],
    "activeTraits": [
      { "name": "Timebreaker", "count": 4, "activeAt": 3, "isActive": true }
    ]
  },
  "set": 17,
  "patch": "17.7",
  "minimumSimilarity": 0.65,
  "minimumSampleSize": 5
}
```

The response contains the normalized candidate and a `statistics` object with sample size, similar-board count, average placement, Top 4 and win rates, average similarity, confidence, patch distribution, common unit/item variations, and explanations for the closest matches. Placement metrics are ordinary unweighted averages over valid placements from 1–8. `similarBoardCount` includes matching snapshots without placement, while `sampleSize` counts only snapshots supporting placement metrics. Placement-based fields remain `null` when no valid placement samples exist. Confidence is `insufficient` until the requested minimum sample size is met.

### Controlled Riot API ingestion

Create a development key in the Riot Developer Portal, then expose it only through the process environment. The CLI does not read a key from source files or command-line arguments.

PowerShell:

```powershell
$env:RIOT_API_KEY = "RGAPI-your-development-key"
npm run fetch:riot-matches -- --game-name "Player Name" --tag-line "TAG" --platform euw1 --count 10
```

Bash:

```bash
export RIOT_API_KEY="RGAPI-your-development-key"
npm run fetch:riot-matches -- --game-name "Player Name" --tag-line "TAG" --platform euw1 --count 10
```

Start with 10–20 recent matches. `--count` defaults to 20 and is capped at 50; `--start` defaults to 0. Supported current platform routes are `br1`, `eun1`, `euw1`, `jp1`, `kr`, `la1`, `la2`, `na1`, `oc1`, `ru`, `sg2`, `tr1`, `tw2`, and `vn2`. Riot has merged the former `ph2` and `th2` platforms into `sg2`.

The Account API resolves the Riot ID through the platform's regional cluster, TFT Summoner uses the platform host, and TFT Match uses the regional host. Match details are fetched sequentially with bounded retry handling for rate limits, transient server errors, and network failures. Permanent client errors are not retried. Failed match details are reported while the remaining batch continues.

Optional development-only storage override:

```powershell
$env:TFT_MATCH_DATA_PATH = "C:\temp\tft-imported-matches.json"
```

`server/data/importedMatches.json` remains the default. The match-data CLI
commands load `.env` from the project root, while values already set in the
process environment take precedence. Development API keys expire and must
never be committed; `.env.example` contains placeholders only.

To inspect one raw match schema without parsing or persisting it:

```powershell
npm run inspect:riot-match -- --match-id EUW1_7924916872 --platform euw1
```

The inspector prints selected match fields and participant keys. It omits
PUUIDs, Riot IDs, summoner identifiers, companion identity, request headers,
and the API key. It does not write the raw payload to disk.

### Controlled Challenger sampling

Seed a small deterministic sample from Riot's official TFT Challenger league.
Use a separate repository path for development sampling:

```powershell
$env:RIOT_API_KEY = "RGAPI-your-development-key"
$env:TFT_MATCH_DATA_PATH = Join-Path $env:TEMP "tft-challenger-sample.json"
npm run seed:challenger-matches -- --platform euw1 --players 10 --matches-per-player 10
```

Players are ordered by league points, match IDs are deduplicated across shared
lobbies before details are fetched, and imports still use the normal match
parser and repository duplicate protection. The command is intentionally
capped at 25 players and 20 matches per player and performs requests
sequentially.
