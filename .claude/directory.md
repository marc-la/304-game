---
title: 304 — Repository Layout
status: living document
purpose: orient any future session to where things live and where new code belongs.
---

# Repository layout

This repo ships **one** thing publicly: a static site on GitHub Pages built by Vite. Everything else is either consumed by that site, retired, or exiled to local dev.

Read [`.claude/soul.md`](soul.md) first. This file is the **map**; the soul is the **why**.

## Layers (top to bottom)

| Layer | Lives in | What it is | Depends on |
|---|---|---|---|
| **Static site** | `site/` | HTML entries, partials, classic JS/CSS, public assets. The Vite build root. | Engine + apps for the two React-mount pages. |
| **React apps** | `apps/304dle/`, `apps/play/` | The two interactive surfaces. Peers, not siblings — different audiences, different lifecycles. | Engine. Their own components. |
| **Engine** | `engine/` | Pure TS rules engine: cards, seating, play, bidding, caps, double-dummy, info-set, bots. **No React, no DOM, no app concerns.** | Nothing inside this repo. |
| **Tools** | `tools/puzzles/`, `tools/curator/` | Node CLIs run during development/release: puzzle generation, curation pipeline. Not shipped. | Engine. |
| **Multiplayer** | `multiplayer/backend/`, `multiplayer/tests/` | FastAPI server + Python tests. **Not in production deploy.** `apps/play/transport/select.ts` probes for it; absent ⇒ in-browser play via `localTransport`. Currently depends on the retired Python engine in `_archive/game304/`, so it doesn't run out of the box — see [`multiplayer/README.md`](../multiplayer/README.md). |
| **Archive** | `_archive/` | Retired code kept for reference. **Do not extend.** | Nothing reaches into this. |
| **Docs** | `docs/` | Three subtrees with separate lifecycles: `specs/` (rules, caps formalism, play invariants), `handoffs/` (live intra-session state, deleted when shipped), `explainers/` (plain-English lay-reader write-ups). See [`docs/README.md`](../docs/README.md) and [`.claude/docs-workflow.md`](docs-workflow.md). | Nothing. |
| **Soul + standing instructions** | `.claude/` | `soul.md`, `gui-verification.md`, `auto-commit.md`, `docs-workflow.md`, this file. Hook script `auto-commit-push.sh` plus `settings.json`. | Nothing. |
| **Node anchor** | `frontend/` | `package.json`, `node_modules/`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`. **No source code.** | Everything Node-based. |

The repo-root `node_modules` symlink points at `frontend/node_modules/` so Vite/Vitest resolve packages from anywhere under the tree.

## Where new code goes

Ask: *what layer is it?*

- **Rules logic** (legal plays, scoring, caps obligation, info-set, bots) → `engine/`.
- **304dle-specific** (daily-puzzle UX, scoring, share grid, worlds counter, tempo, onboarding) → `apps/304dle/`.
- **vs-bots / multiplayer UX** (lobby, action panels, control bar, transport selection) → `apps/play/`.
- **Static page** (rules companion, new explainer, leaderboard variant) → `site/` (new HTML; register in `frontend/vite.config.ts` `buildInputs`).
- **Shared chrome** (header, nav, footer fragment) → `site/partials/`. Reference with `<!-- @include partials/foo.html -->`.
- **Site-wide CSS** → `site/css/styles.css` (single file by current convention; split only if a real seam appears).
- **Classic page-script** (no React) → `site/js/`.
- **Puzzle data, generator, curator** → `tools/`.
- **Player/dev reference doc** → `docs/specs/` (durable spec), `docs/explainers/` (lay reader), or `docs/handoffs/` (live work). See [`.claude/docs-workflow.md`](docs-workflow.md) for the decision flow.
- **Multiplayer backend extension** → `multiplayer/backend/` (but understand the exile rules first).

**If a piece could plausibly live in two layers, push it down (toward `engine/`)** — that's the layer with the strongest invariants and the loosest coupling.

## Import aliases

Configured in `frontend/tsconfig.json` and `frontend/vite.config.ts`:

- `@engine` → `engine/index.ts`
- `@engine/*` → `engine/*`
- `@apps/*` → `apps/*`

Use `from '@engine/card'` etc. Avoid deep relative paths like `'../../engine/card'`.

## Build & deploy

- **Build:** `cd frontend && npm run build` writes static output to `frontend/dist/`.
- **Dev:** `npm run dev` (Vite, HMR, `/api` proxied to `localhost:8000`).
- **Test:** `npm test` (Vitest, finds `engine/`, `apps/`, `tools/` test files).
- **Deploy:** push to `main` ⇒ `.github/workflows/deploy-pages.yml` builds and ships `frontend/dist/` to Pages.
- **Backend (optional, local only):** see [`multiplayer/README.md`](../multiplayer/README.md) — currently requires resurrecting the retired Python engine.
- **Puzzle generation:** `npm run puzzles:generate -- --year 2027`.
- **Curator:** `npm run pool:curate -- ...`, `npm run pool:select -- ...`, `npm run pool:inspect -- <pool.jsonl>`.

## Hard rules

- **Don't add to `_archive/`.** If something there needs revival, lift it out properly.
- **Don't add Python to the production path.** The deploy is static; backend is exiled.
- **Don't grow a second component library.** If two apps need the same component, lift it into a shared spot only when duplication is real — *not speculative*.
- **Don't sprawl `tools/`.** Each tool group earns a subdir (`tools/puzzles/`, `tools/curator/`). Loose `tools/*.ts` is a smell.
- **Don't bake page-specific assets into `site/css/styles.css`.** If the daily puzzle needs its own styles, they live in `apps/304dle/app.css`.
- **Don't reach across apps.** `apps/304dle/` and `apps/play/` should not import each other. If they need to share something, it goes in `engine/` (if it's logic) or one of them duplicates a small UI primitive (until duplication earns extraction).
- **Don't move `frontend/`.** It's the Node anchor; npm scripts assume CWD is here. The repo-root `node_modules` symlink depends on this.

## Soul touchpoints (where the constitution lands)

- Tempo, worlds counter, caps as apex → `engine/{caps,info,caps-csp}.ts` + `apps/304dle/{tempo,worlds-counter}.ts`.
- The "redeal same hand" loss state → `apps/304dle/storage.ts` + result screen.
- Curated-but-realistic puzzles → `tools/curator/`.
- The 4-petal flower / round-pile lingering → `apps/304dle/components/Table.tsx` and play-app's `GameTable.tsx`.

When in doubt, read [`.claude/soul.md`](soul.md) §VII checklist and apply.
