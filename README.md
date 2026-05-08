# 304

A four-player partnership trick-taking card game from Sri Lanka — playable as a daily Wordle-style puzzle.

---

## What's in here

- **Static site** — landing, [rules](rules.html), daily 304dle puzzle, leaderboard. Built with Vite, deployed to GitHub Pages.
- **TypeScript engine** — pure 304 rules engine in [frontend/src/304dle/engine/](frontend/src/304dle/engine/).
- **FastAPI backend** *(local dev only)* — multiplayer server in [backend/](backend/), not part of the public site.

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
npm test        # vitest engine tests
```

## License

[MIT](LICENSE)
