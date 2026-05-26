---
title: 304 — Bot Speed Tier 3 (P1 done)
status: shipped, 2026-05-26
purpose: Record what changed in the Tier 3 P1 session. Pair-doc to the earlier [bot-speed-tier2-changes.md](bot-speed-tier2-changes.md) and [bot-speed-handoff.md](bot-speed-handoff.md).
---

# What this session shipped

**P1 from the Tier 3 plan**: the slim engine view's per-seat hands moved from `Map<Seat, …>` to a flat 4-slot array indexed by seat-number (`SEAT_INDEX`: N=0, W=1, S=2, E=3). This benefits everything that reads `state.hands` or `world.hands` — most notably B6/B7's per-world allocation in `enumerateWorlds.materialise()`, which was on the R1 hot path.

Everything still passes: 170 vitest tests green, B6/B7 determinism replays clean on 3 seeds, no behavioural change.

# Bench numbers, 5 seeds × 32 moves

Compare to the Tier 2 column in [bot-speed-tier2-changes.md](bot-speed-tier2-changes.md):

| Bot | R1/move (T2 → T3) | Mean/move (T2 → T3) | p95/move (T2 → T3) |
|---|---|---|---|
| B6 (dds-mc) | 3.6 s → **1.95 s** | 640 ms → **409 ms** | 3.2 s → **2.83 s** |
| B7 (bridge-derived) | 1.1 s → **683 ms** | 200 ms → **159 ms** | 1.7 s → **1.04 s** |

About a 1.6–1.9× wall-clock win, in line with the handoff's "2–5× on iteration-bound code" estimate (we're on the lower end because the DDS inner loop was already Map-free after Tier 2; the gain came from `buildInfoSet`, `enumerateWorlds.materialise`, `worldHandsToMasks`, and `legalPlaysFor`).

# Where the cost still sits, per round

```
B6:  R1  1947 ms   R2  1175 ms   R3  128 ms   R4  18 ms   R5+  <3 ms
B7:  R1   683 ms   R2   489 ms   R3   89 ms   R4  11 ms   R5+  <3 ms
```

R1+R2 account for ~94 % of B6's compute and ~91 % of B7's. The 200 k node budget is binding at R1 — the bot is approximating the tail, not solving it. This is the gap the next sessions are aimed at.

A full 8-bot round-robin at `--games 50 --periods 3` still runs B6 for about **9 hours** of compute on its own (~14 pairings × 100 games × 3 periods × ~8 s/game). That's slow, but it isn't a hang — see the hybrid handoff below for the biggest single mitigation.

# What changed, file-by-file

- `engine/seating.ts` — `SEAT_INDEX` is now exported; added `SEATS_BY_INDEX` (an alias of `ANTICLOCKWISE`) for `for (let i = 0; i < 4; i++)` loops that round-trip back to a `Seat`.
- `engine/state.ts` — `EngineGameState.hands: ReadonlyArray<ReadonlyArray<CardId>>` (was a `ReadonlyMap`). PCC-out seat keeps an empty entry rather than being absent, so callers can index without a presence check.
- `engine/info.ts` — `World.hands` switched to the same array shape (the per-world Map allocation in `materialise()` was the one called out as visible at R1). `buildInfoSet` reads through `SEAT_INDEX[seat]`. `worldIsConsistent` updated symmetrically.
- `engine/play.ts` — `seatsHoldingTrump` takes the array directly. No more per-call Map-construction in callers.
- `engine/bots/common.ts` — `legalPlaysFor` no longer allocates a `handsMap` per call; passes `state.hands` straight through.
- `engine/bots/dds-core.ts` — `worldHandsToMasks` takes the array shape, iterates 0..3 with a tight loop.
- `engine/bots/b6-dds-mc.ts`, `b7-bridge-derived.ts` — `Sample.hands` is now the array shape; the per-world "pin our hand to ctx.hand" loop replaced its Map-copy with a 4-slot array literal.
- `engine/bots/b4-infoset-1ply.ts`, `b5-csp-search.ts` — sampler converts `world.hands[i]` → internal `Map<Seat, CardId[]>` (these bots mutate hands during projection, so they need the Map; conversion is cheap once).
- `engine/caps.ts`, `engine/game.ts`, `engine/__tests__/{integration,play,fixtures}.test.ts`, `engine/bots/__tests__/bots.test.ts`, `tools/curator/layers/{2-dds,3-labour}.ts`, `tools/bots/elo/match.ts` — all updated to the new shape.

# What was deliberately not changed

- `InformationSet.handSizes` and `exhaustedSuits` stay as `Map<Seat, …>`. They're allocated once per call to `buildInfoSet` (not per world), and the savings from converting them are too small to justify the noise.
- `engine/dd.ts`'s internal `simHands` stays as `Map<Seat, CardId[]>` because `solveCaps` mutates it through `handRemove`. A `worldHandsToMap` / `mapToHandsArr` helper bridges in and out of the array boundary at the entry points.
- The full `GameState.hands: Record<Seat, CardId[]>` (the orchestrator-side schema) — separate concern. Only the slim engine view changed.

# Loose end: tournament observability

The original ask in this session also included "add a timing element to the tournament so I can see which pairings are slow." A first cut was prototyped (per-pairing wall-clock printed alongside W/L, `duration_ms` on `PairingResult`) but reverted. If the next session wants to ship this it's a ~30-line change in `tools/bots/elo/tournament.ts` — add `Date.now()` brackets around the inner `g`-loop and extend the progress callback. Keep the column-aligned look of the current line.

# What's next — pick your handoff

This session left three follow-up handoffs, all standalone. Pick whichever matches the next session's goal:

1. **[bot-strength-experiment-handoff.md](bot-strength-experiment-handoff.md)** — P5: confirm B6/B7 actually beat B5 with statistical confidence. Now affordable (~1 h compute). The original Tier 3 handoff said this gates everything else, and that's still true.
2. **[bot-hybrid-handoff.md](bot-hybrid-handoff.md)** — Build B6o/B7o: cheap-bot for R1+R2, DDS for R3+. Likely the single biggest practical win for tournament throughput (~10× per game) and the cheapest follow-up (~2 h work).
3. **[bot-speed-dds-algorithmic-handoff.md](bot-speed-dds-algorithmic-handoff.md)** — P2 (PVS), P3 (history heuristic), P4 (suit-equivalence), P6 (WASM). Direct DDS-internal speedups; orthogonal to the hybrid and stack with it. Use this after P5 confirms B6 is worth optimising further.

# How to validate any change (unchanged from Tier 2)

From repo root (with node 20 active):

```bash
# Bench:
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 5

# Determinism (must pass for every change):
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 3 --determinism

# Full vitest suite — must stay green:
cd frontend && npx vitest run
```

# Constraints to honor (still in force)

- **Determinism in `(info-set, rng seed)`** — hard zoo invariant.
- **No new runtime dependencies** unless WASM (pre-approved if 10×+ payoff).
- **Bots stay open-trump-only** — closed trump is a separate stream.
- **Respect `legalPlays`** including the lone-trump-holder lead rule.
