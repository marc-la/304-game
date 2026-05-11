# 304

A four-player partnership trick-taking card game from Sri Lanka — playable as a daily Wordle-style puzzle.

---

## What's in here

- **Static site** ([site/](site/)) — landing, [rules](site/rules.html), daily 304dle puzzle, leaderboard. Built with Vite, deployed to GitHub Pages.
- **TypeScript engine** ([engine/](engine/)) — pure 304 rules engine, shared by both React apps.
- **React apps** ([apps/304dle/](apps/304dle/), [apps/play/](apps/play/)) — the daily puzzle and the vs-bots / multiplayer flow.
- **Curator + generator** ([tools/](tools/)) — Node CLIs that produce the pre-baked puzzle JSON.
- **FastAPI backend** *(local dev only, exiled from production)* — see [multiplayer/](multiplayer/).

For a layered tour of the tree, read [`.claude/directory.md`](.claude/directory.md).

## Host it yourself

The public site is fully static. Pick whichever path suits you.

### Option A — auto-deploy via GitHub Pages

1. Fork this repo.
2. In your fork, go to **Settings → Pages** and set **Source: GitHub Actions**.
3. Push to `main`. The workflow at [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) builds and deploys.

### Option B — build locally, host anywhere

Requires **Node 22+**.

```bash
cd frontend
npm ci          # reproduces the exact dep tree from package-lock.json
npm run build   # writes the static site to frontend/dist/
```

Then serve `frontend/dist/` from any static host (Netlify, Vercel, S3, nginx, `python -m http.server`, …).

## Develop

```bash
cd frontend
npm ci
npm run dev     # http://localhost:5173 with HMR
npm test        # vitest engine + app tests
```

The puzzle generator and curator CLIs are wired up as npm scripts:

```bash
npm run puzzles:generate -- --year 2027
npm run pool:curate -- ...
npm run pool:inspect -- ../site/public/puzzles/pool.jsonl
```

## License

[MIT](LICENSE)
