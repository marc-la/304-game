---
title: 304 — B6/B7 Speed Optimisation, Tier 3+ Handoff
status: handoff, 2026-05-26
purpose: Pick up where Tier 2 left off. Read [bot-speed-tier2-changes.md](bot-speed-tier2-changes.md) first for what's already done; [bot-speed-handoff.md](bot-speed-handoff.md) for the original problem statement and bench fixture seeds.
---

# State of play, post-Tier 2

Tier 2 algorithmic fixes (alpha-beta, bitmask hands, bound-typed TT, killer, move ordering) are shipped — see [bot-speed-tier2-changes.md](bot-speed-tier2-changes.md). Current bench numbers, mean per-move over 5 fixture seeds × 32 moves each:

| Bot | Mean per-move | R1 per-move | p95 per-move | Full game |
|---|---|---|---|---|
| B5 (csp-search) | 1.7 ms | 6 ms | 3 ms | ~50 ms |
| B7 (bridge-derived) | **200 ms** | **1.1 s** | 1.7 s | ~6.5 s |
| B6 (dds-mc) | **640 ms** | **3.6 s** | 3.2 s | ~20 s |

Target from the original handoff: **beat B5 in ELO AND ≤ 500 ms median per move**. B6 is over target by 6× at R1; B7 by 2×. Mean is dominated by R1/R2 — R5+ moves are already < 5 ms.

A 50-game B6 pairing now takes ~30 min (was ~11 h). B7 is ~10 min/pairing. Tournament inclusion is **possible** for low-density runs; the 500 ms target unlocks full round-robin density.

# Speed strategy gap

R1 is the bottleneck because the DDS budget (`200_000` nodes/eval) is binding. With 8 candidates × 8 worlds = 64 evals per R1 move, and each eval saturating budget, we're approximating the deep tail of the tree instead of solving it.

Two ways to close the gap, both worth doing:

1. **Make each eval cheaper** so we can solve more of the tree within the budget (or shrink the budget while keeping accuracy). Targets: cut the alpha-beta tree further with PVS, history heuristic, suit-equivalence collapsing.
2. **Make each eval cleaner** by getting the engine state out of the hot path (Tier 1). The bot files no longer use `Map<Seat, ...>` internally — but they still build one for every world sample via `buildInfoSet → enumerateWorlds`, and that allocation pressure costs measurable time at R1.

# Follow-ups, ordered by expected payoff

## P1 — Tier 1 engine refactor (Map → Array)

**Why first**: benefits every bot, especially the sampling pipeline that feeds B6/B7. Frees up the inner hot loop without further DDS algorithm complexity.

**Where**: [engine/state.ts:73-81](../engine/state.ts#L73-L81) — `EngineGameState.hands` is `ReadonlyMap<Seat, ReadonlyArray<CardId>>`. Replace with `ReadonlyArray<ReadonlyArray<CardId>>` indexed by `SEAT_INDEX` from [engine/seating.ts:12-14](../engine/seating.ts#L12-L14).

**Mechanical changes**:
- All `state.hands.get(seat)` → `state.hands[SEAT_INDEX[seat]]`.
- All `state.hands` iteration → `for (let i = 0; i < 4; i++)`.
- Update the projector at [engine/game.ts](../engine/game.ts) (toEngineState) and runtime callers at [apps/304dle/runtime.ts](../apps/304dle/runtime.ts).
- Update [engine/info.ts:96-103](../engine/info.ts#L96-L103) `buildInfoSet` similarly — this is the per-world allocation that's still on the B6/B7 critical path.

**Test coverage**: every existing test that builds `EngineGameState`. Use the bot zoo test as a smoke test (it builds states directly).

**Expected payoff**: 2–5× on iteration-bound code per the original handoff. Most of that benefit accrues to `buildInfoSet` and `enumerateWorlds` rather than the DDS inner loop (which is already Map-free).

**Estimated effort**: 4–6 h, mostly mechanical sed-and-fix. Touches ~30 files. Worth its own focused PR.

## P2 — PVS (Principal Variation Search) in DDS

**Why**: After move ordering, the first child at most nodes IS the best. PVS exploits this by searching the first child with the full window, then the rest with a null window `(α, α+1)` — if a null-window search fails high, re-search with full window. Cuts node count further by ~1.5–2×.

**Where**: [engine/bots/dds-core.ts](../engine/bots/dds-core.ts) — inside `dds()`, change the for-loop over moves so move 0 uses `(alpha, beta)` and moves 1+ use a null window.

**Watch out for**:
- Re-search complexity: the second-call full-window re-search needs to handle the fail-soft return correctly.
- Doesn't combine perfectly with the bound-typed TT — re-searches need to clear or refresh their TT entries for affected children.

**Estimated effort**: 2–3 h with care; can introduce subtle bugs. Validate with the determinism check and bot zoo tests.

## P3 — History heuristic

**Why**: Generalises killer. Every time a move causes a cutoff, increment a per-card score. Sort moves by score (highest first). Catches recurring strong moves that aren't the most recent killer.

**Where**: [engine/bots/dds-core.ts](../engine/bots/dds-core.ts) — add `Uint32Array(32)` for per-card history, increment on cutoff, sort moves in `legalMoves` by `history[card]` descending (after killer pre-pend).

**Expected payoff**: 1.2–1.5× incremental over killer alone.

**Estimated effort**: 1–2 h.

## P4 — Suit-equivalence collapsing

**Why**: The big bridge-DDS win. Within a suit, cards held by one player with no enemy holding in between are interchangeable for trick-taking. If I hold K-Q-8 of clubs and opp holds 7♣ only, then K and Q are equivalent (both beat 7♣), so the DDS only needs to consider one of them. Collapses the branching factor dramatically on suit-rich positions.

**Where**: New helper in [engine/bots/dds-core.ts](../engine/bots/dds-core.ts) or a sibling file. In `legalMoves`, compute equivalence classes per suit (based on the current `s.hands[]` distribution) and emit one representative per class.

**Watch out for**:
- Equivalence is dynamic — it changes as cards are played. Recompute per node, not once.
- The TT key includes hand bitmasks, so caches remain correct (different masks = different states).
- The chosen card returned by the bot must still be a valid `CardId`. Pick a canonical representative deterministically.

**Expected payoff**: 1.5–4× per the original handoff. Highest variance — works great on K-Q-J holdings, marginal on scattered hands.

**Estimated effort**: 4–6 h. The trickiest of the algorithmic items. Validate by comparing minimax values against the un-collapsed solver on a few seeds.

## P5 — Strength experiment (does B6 actually beat B5?)

**Why** (from the original handoff §"Open questions"): we have anecdotal evidence B6 plays stronger than B5, but no statistical confirmation at tournament scale. **This question gates everything else** — if B6 isn't actually stronger, the speed work is unmotivated.

**How**: Run a focused B5-vs-B6 only tournament. With B6 at ~30 min/pairing now, a 100-game pairing in each direction (200 games total) takes ~1 h.

```bash
# From repo root:
cd frontend && npx tsx ../tools/bots/elo/bin/run-tournament.ts \
  --bots b5-csp-search,b6-dds-mc \
  --games 100 --periods 1
```

(Check the actual CLI flags at [tools/bots/elo/bin/](../tools/bots/elo/bin/) — adjust if names differ.)

**Decision criterion**: if B6 wins ≥ 60% of decisive games, the speed work pays. If 50–55%, marginal. If < 50%, investigate sampling bias (Tier 3 of original handoff) before further speed work.

**Repeat for B7** — same protocol.

**Estimated effort**: 1 h elapsed (compute-bound, mostly machine time).

## P6 — WASM port of dds-core (escape hatch)

**Why**: If P1–P4 still leave R1 above 500 ms, a Rust/C port of the inner DDS loop should run 5–10× faster than TS.

**Where**: Port [engine/bots/dds-core.ts](../engine/bots/dds-core.ts) — the file is intentionally self-contained (no engine state imports, just card primitives) to make this porting tractable. ~200 LOC.

**Watch out for**:
- Adds a build dependency. User noted in the original handoff this is acceptable "if it makes a 10×+ difference".
- Bo Haglund's [dds](https://github.com/dds-bridge/dds) is the bridge reference. Needs adaptation: 8-card hands, 304 trump-only rule, no dummy.
- Determinism contract must hold: same input → same output, byte-identical.

**Estimated effort**: 1–2 days. Last resort.

# Recommended order

For the next session, I'd suggest:

1. **P5 first** (1 h). Confirm B6 is actually stronger than B5. If not, the rest is moot.
2. **P1 (Tier 1 engine refactor)** — biggest mechanical win, benefits every bot.
3. **P3 (history) + P2 (PVS)** — algorithmic refinements on the new fast engine.
4. **P4 (suit equivalence)** if still over target.
5. **P6 (WASM)** only if everything else fails.

# Reading list for the next session

In order:

1. This file.
2. [bot-speed-tier2-changes.md](bot-speed-tier2-changes.md) — what's already done.
3. [bot-speed-handoff.md](bot-speed-handoff.md) — original problem statement, fixture seeds, constraints to honor.
4. [engine/bots/dds-core.ts](../engine/bots/dds-core.ts) — the file you'll be editing for P2/P3/P4.
5. [engine/state.ts](../engine/state.ts) and [engine/info.ts](../engine/info.ts) — what you'll touch for P1.

# How to validate any change

```bash
# Bench (compare to numbers in bot-speed-tier2-changes.md):
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 5

# Determinism check (must pass for every change):
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 3 --determinism

# Bot legality + determinism unit tests:
cd frontend && npx vitest run ../engine/bots/__tests__/bots.test.ts

# Full repo suite — must stay at 157 passed:
cd frontend && npx vitest run
```

# Constraints to honor (unchanged from original handoff)

- **Determinism in `(info-set, rng seed)`** — hard zoo invariant.
- **No new runtime dependencies** unless WASM (which the user has pre-approved if 10×+ payoff).
- **Bots stay open-trump-only** — closed trump is a separate stream.
- **Respect the `legalPlays` contract** including the lone-trump-holder lead rule.

# Open questions to revisit

From the original handoff, still open:

1. Does B6 actually beat B5? (P5 above. Tier 2 makes this question affordable for the first time.)
2. Is 500 ms/move the right target? Mostly matters for tournament density; puzzle generation is fine at 5 s/move offline.
3. Keep B7 as a distinct bot, or fold it into B6 as a sampling-variant flag? After Tier 2 they share most code anyway. Decide after P5 — if both meaningfully beat B5 with different strength profiles, keep both. If they converge to the same play, fold.
