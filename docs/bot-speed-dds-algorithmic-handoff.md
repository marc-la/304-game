---
title: 304 — DDS algorithmic speed-ups (P2 / P3 / P4 / P6)
status: handoff, 2026-05-26
purpose: Pick up the algorithmic optimisations carved out of the original Tier 3 plan. Read [bot-speed-tier3-changes.md](bot-speed-tier3-changes.md) first for the current baseline (P1 shipped). [bot-speed-handoff.md](bot-speed-handoff.md) has the original problem statement.
---

# State of play

After Tier 3 P1 (Map → Array refactor), the bench is:

| Bot | R1/move | Mean/move | p95/move |
|---|---|---|---|
| B5 (csp-search) | 6 ms | 1.7 ms | 3 ms |
| B7 (bridge-derived) | **683 ms** | 159 ms | 1.04 s |
| B6 (dds-mc) | **1.95 s** | 409 ms | 2.83 s |

Target: beat B5 in ELO AND ≤ 500 ms median per move. B6 at R1 is over by ~4×, B7 by ~1.4×. R5+ is already < 3 ms — every speed-up here is really a speed-up at R1/R2.

The 200 k node-budget cap is binding at R1 — every eval saturates it. That means each cheaper visit is reinvested into deeper search, not into faster wall-clock; the wall-clock win is whatever fraction of the budget we save outright.

# Why this is a separate handoff from the hybrid

The hybrid bot (B6o/B7o, see [bot-hybrid-handoff.md](bot-hybrid-handoff.md)) sidesteps the R1/R2 cost by using a cheap bot in those rounds. This handoff makes DDS itself cheaper — which compounds with the hybrid and is the only path if you want optimal play at R1.

# Follow-ups, ordered by expected payoff

## P2 — Principal Variation Search (PVS)

**Why**: After move ordering, the first child at most nodes IS the best. PVS searches the first child with the full window, then the rest with a null window `(α, α+1)`. If a null-window search fails high, re-search with full window. Cuts node count further by ~1.5–2× on top of plain alpha-beta.

**Where**: `engine/bots/dds-core.ts`, inside `dds()`. The for-loop over moves needs:
- Move 0 → `(alpha, beta)` (full window, as today).
- Moves 1+ → `(alpha, alpha + 1)` (null window).
- On a null-window fail-high (`value > alpha && value < beta`), re-search with full window.

**Watch out for**:
- Re-search complexity: the second full-window search of a child needs to write through any partial TT entries the null-window search left, otherwise you lock in incorrect bounds.
- Interaction with the bound-typed TT: re-searched children should overwrite, not merge, their entries until the re-search resolves.

**Expected payoff**: 1.5–2× wall-clock at R1.
**Estimated effort**: 2–3 h. Subtle bugs are likely; validate hard.

## P3 — History heuristic

**Why**: Generalises killer. Every time a move causes a cutoff, bump a per-card score. Sort moves by score (highest first). Catches recurring strong moves that aren't the most recent killer for this depth.

**Where**: `engine/bots/dds-core.ts`. Add a `Uint32Array(32)` for per-card history; increment on cutoff in the main loop; in `legalMoves` sort by `history[card]` descending after the killer pre-pend.

**Watch out for**: keep history reset per top-level `evalDDS` call, otherwise you bias across worlds. Keep determinism — sort with a stable tie-break (e.g. card index ascending).

**Expected payoff**: 1.2–1.5× on top of killer alone.
**Estimated effort**: 1–2 h.

## P4 — Suit-equivalence collapsing

**Why**: The big bridge-DDS win. Within a suit, cards held by one player with no enemy holding between them are interchangeable for trick-taking. If I hold K-Q-8 of clubs and opp holds only 7♣, K and Q both beat 7♣ and are equivalent — DDS only needs to consider one. Collapses the branching factor dramatically on suit-rich positions.

**Where**: New helper in `engine/bots/dds-core.ts` (or a sibling). In `legalMoves`, compute equivalence classes per suit from the current `s.hands[]` distribution and emit one representative per class.

**Watch out for**:
- Equivalence is dynamic — recompute per node, not once at the root.
- The TT key already includes hand bitmasks, so caches remain correct (different masks = different states).
- The chosen card returned by the bot must still be a valid `CardId`. Pick a canonical representative deterministically (e.g. lowest power within the class).

**Expected payoff**: 1.5–4×. Highest variance — works great on K-Q-J holdings, marginal on scattered hands.
**Estimated effort**: 4–6 h. The trickiest item.

## P6 — WASM port of `dds-core` (escape hatch)

**Why**: If P2–P4 still leave R1 above 500 ms, a Rust/C port of the inner DDS loop should run 5–10× faster than TS for the same algorithm.

**Where**: Port `engine/bots/dds-core.ts` only — the file is intentionally self-contained (no engine-state imports, just card primitives) to make this porting tractable. ~440 LOC.

**Watch out for**:
- Adds a build dependency. User has pre-approved this if the payoff is 10×+.
- Bo Haglund's [dds](https://github.com/dds-bridge/dds) is the bridge reference. Needs adaptation: 8-card hands, 304 trump-only rule, no dummy.
- Determinism contract must hold: same input → same output, byte-identical.

**Expected payoff**: 5–10×. Last resort.
**Estimated effort**: 1–2 days.

# Recommended order

1. **P3 (history)** first — cheap, well-defined, no nasty interactions.
2. **P2 (PVS)** — bigger payoff than P3, but trickier; do it on a clean baseline with P3 already in.
3. **P4 (suit-equivalence)** if R1 is still over target.
4. **P6 (WASM)** only if P2+P3+P4 isn't enough.

# Hard constraints

- **Determinism in `(info-set, rng seed)`** — hard zoo invariant. Every change must pass `--determinism` for 3+ seeds.
- **No new runtime dependencies** unless WASM (which is pre-approved if it's 10×+).
- **Bots stay open-trump-only** — closed trump is a separate stream.
- **Respect the `legalPlays` contract** including the lone-trump-holder lead rule.

# Validation, every change

```bash
# Bench (compare to numbers in bot-speed-tier3-changes.md):
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 5

# Determinism — must pass:
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 3 --determinism

# Bot zoo:
cd frontend && npx vitest run ../engine/bots/__tests__/bots.test.ts

# Full repo suite — must stay green:
cd frontend && npx vitest run
```

# Reading list for the next session

1. This file.
2. [bot-speed-tier3-changes.md](bot-speed-tier3-changes.md) — current bench baseline.
3. [bot-speed-tier2-changes.md](bot-speed-tier2-changes.md) — what alpha-beta + killer + TT already covers.
4. `engine/bots/dds-core.ts` — the file you'll be editing for P2/P3/P4.
