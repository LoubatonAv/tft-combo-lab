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
