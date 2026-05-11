# multiplayer/

**Status: exiled from production.** The Pages workflow ships `frontend/dist/` only; nothing here is deployed.

This directory holds the FastAPI server and its Python tests. The vs-bots / multiplayer flow at [`/play`](../site/play.html) probes for the backend at startup and falls back to an in-browser `localTransport` when it isn't reachable — so the live site works without anything in here running.

## Contents

- `backend/main.py` — FastAPI app: match lifecycle, per-player views, action endpoints.
- `backend/lobby.py` — pre-game lobby (room creation, joins, seat assignment).
- `backend/serializers.py` — server → client view shapes.
- `backend/requirements.txt` — Python deps.
- `tests/` — pytest suite covering the API, the lobby, and the bot.

## Known breakage

`backend/main.py` and the tests import `game304.*`. The Python engine they depend on has been retired and lives at [`../_archive/game304/`](../_archive/game304/). Running the backend today therefore requires one of:

1. **Resurrect game304 on the Python path** — `cd ../_archive && pip install -e ./game304`, or copy `game304/` back next to `backend/` and add a setup file.
2. **Rewrite to use the TS engine** — call into the engine via Node, Pyodide, or a thin RPC. This is the long-term direction (per `.claude/soul.md` and the engine retirement note in memory).

Until one of those happens, treat the contents of this directory as a frozen blueprint, not running software.

## When the backend IS up

Run `cd backend && uvicorn main:app --reload` (or your equivalent). The Vite dev server proxies `/api` to `localhost:8000`, and `apps/play/transport/select.ts` will pick the backend transport instead of the in-browser one.

## Why keep it

The play UI in `apps/play/` is built on a `Transport` interface (`apps/play/transport/types.ts`). The local transport runs `Match` + `SimpleBot` entirely client-side; the backend transport, when available, runs an authoritative match server-side and supports actual multiplayer. The UI doesn't care which side is talking back to it — so keeping the backend on ice lets the multiplayer flow be revived without touching the React app.
