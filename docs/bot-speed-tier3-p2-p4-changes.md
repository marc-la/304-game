---
title: 304 — Bot Speed Tier 3 (P2 + P4 shipped, P3 rejected)
status: shipped, 2026-05-26
purpose: Record what changed when the algorithmic DDS speed-ups from [bot-speed-dds-algorithmic-handoff.md](bot-speed-dds-algorithmic-handoff.md) landed. Pair-doc to [bot-speed-tier3-changes.md](bot-speed-tier3-changes.md) (which covered the P1 Map→Array refactor).
---

# What this session shipped

Two algorithmic changes to `engine/bots/dds-core.ts`, both in the inner alpha-beta loop. Nothing else changed — same public API, same determinism contract, same node budget. Together they move B6 and B7 from "over the 500 ms-median target by 4×" to "comfortably inside the target", with the heavy first-round cost coming down by a factor of 2.5× to 4×.

1. **P2 — Principal Variation Search (PVS).** Inside `dds()`, the first child of every node is still searched with the full `(alpha, beta)` window. Every subsequent child is probed with a null window — `(alpha, alpha + 1)` on the maximising side, `(beta - 1, beta)` on the minimising side. The null probe asks a much cheaper question ("does this beat alpha?" / "does this beat beta?") and prunes hard. If the probe fails high (max) or fails low (min) inside the bounds, we re-search the child with the full window to extract its true value. The bound-typed transposition table already stores sound `(lower, upper)` bounds independent of the window used to derive them, so deeper TT entries written during the null probe stay valid for the re-search — no special TT plumbing was needed.

2. **P4 — Suit-equivalence collapsing.** Inside `legalMoves()`, when emitting candidate cards we now collapse within-suit equivalence classes. Two cards of the same suit held by the seat to play are interchangeable if every card of that suit with power strictly between them is also held by the same seat (no opponent holds a card that could split them in trick-taking value). We scan powers low-to-high per suit: an opponent's card closes the current group, a my-card either opens a new group (and is emitted) or is silently absorbed into the open group. The chosen representative is the strongest card in the class — so move ordering stays "high-power-first within suit". The lone-trump-leader case falls out for free: when no other seat holds trump, the entire trump suit collapses to a single emitted card.

# What did not ship

**P3 — history heuristic** was implemented, measured, and reverted. The expected payoff in the handoff was 1.2–1.5× on top of killer alone; the measured payoff in 304 was −19% to −39% at B6 round 1 (i.e. the bot got *slower*). Two reasons the heuristic is a poor fit here:

- The default move order ("high-power-first within suit") is already very strong in trick-taking because card power is monotonic in within-suit trick value. The killer heuristic catches the per-depth recency signal on top.
- 304's search trees are shallow (8-card hands, ≤32 plies). The same card is a candidate in a small number of distinct sub-positions, so cross-position aggregate signals like history don't accumulate enough useful gradient to overcome the cost of reordering.

Once P2 was in, the suit-equivalence collapse of P4 also reduces the branching factor enough that there is less to gain from any move-ordering trick.

**P6 — WASM port** was not started. With P2 + P4 the bench median per move is 0.4 ms (target was ≤ 500 ms) and B6 round 1 is at 484 ms per move — right at the round-1 target. WASM is held in reserve for a future session if the round-1 ceiling needs to come down further.

# Bench numbers, 5 seeds × 32 moves

Compare to the P1 column in [bot-speed-tier3-changes.md](bot-speed-tier3-changes.md):

| Bot | R1/move (P1 → P2+P4) | Mean/move (P1 → P2+P4) | p95/move (P1 → P2+P4) |
|---|---|---|---|
| B6 (dds-mc) | 1947 ms → **484 ms** | 409 ms → **90 ms** | 2830 ms → **407 ms** |
| B7 (bridge-derived) | 683 ms → **270 ms** | 159 ms → **52 ms** | 1040 ms → **287 ms** |

Speed-up factors: B6 is **4.0×** at round 1, **4.6×** on the per-move mean, **6.9×** on the per-move p95. B7 is **2.5×**, **3.0×**, **3.6×** on the same axes. The p95 improvement is the biggest qualitative win: the long-tail "this move took 2.8 seconds" outliers that previously made bot-vs-bot pairings feel hung are gone.

The bot-zoo vitest file (`engine/bots/__tests__/bots.test.ts`) — which exercises B6/B7 on full 8-card opening hands — went from 27.3 s to 8.0 s wall-clock, a 3.4× whole-file speed-up.

# Where the cost still sits, per round

```
B6:  R1   484 ms   R2  195 ms   R3   30 ms   R4   7 ms   R5+  <2 ms
B7:  R1   270 ms   R2  114 ms   R3   25 ms   R4   6 ms   R5+  <1 ms
```

The 200 k node budget is no longer saturating at round 1 for B7 in most positions, and is only occasionally binding for B6. The pattern of "R1+R2 = ~90% of compute" is the same as before, but the absolute cost has come down by ~4×. A full 8-bot round-robin at `--games 50 --periods 3` now runs B6 in roughly **2 hours** of compute on its own, down from the ~9 hours quoted in the P1 doc.

# What changed, file-by-file

Just one file:

- `engine/bots/dds-core.ts`:
  - **PVS**: the per-move recursive call site in `dds()` was forked into three branches — first move (full window), maximising side with null probe + optional re-search, minimising side with null probe + optional re-search. Same shape applied to the trick-completion branch (where the recursive call uses `(alpha − won, beta − won)`).
  - **Suit-equivalence**: the bit-scan over `movesMask` in `legalMoves()` was replaced by an explicit power-walk per suit that tracks an `inGroup` flag and emits one card per equivalence class. The opponent mask is `(allInSuit & ~(hand & suitByte))`, which uses the full hand (not `movesMask`) so the must-lead-trump restriction collapses correctly to a single emitted card when this seat is the lone trump holder.

No callers needed updating: `legalMoves()` is internal to the module, and the only externally-visible behaviour change is "may return fewer cards, but the bot still picks a valid `CardId`." The chosen representative is canonical and deterministic.

# What was deliberately not changed

- **The TT key.** Equivalence collapse is applied at move-generation time, not in the key. Two states whose hands are different bitmasks still get different keys even if the moves would collapse to the same set, because the down-stream search still operates on the actual bitmasks. This keeps the cache semantics straightforward.
- **The killer heuristic.** Still per-depth, still set on every cutoff. The killer-promote loop survives suit-equivalence cleanly: if the killer card is no longer emitted (it was collapsed into another card's class), the loop simply doesn't find it and no promotion happens. No correctness issue, slightly weaker priming on a small fraction of nodes.
- **The node budget.** Still 200 k for both B6 and B7. With cheaper visits the budget is binding less often, so the bot is now solving closer to the true value at round 1 than approximating the tail.
- **B6's per-world TT sharing.** Still shared across all candidates for a given world. The PVS re-search benefits from this — when the second candidate triggers a re-search, deep TT entries written during the first candidate's full search resolve much of the re-search immediately.

# Determinism

The hard zoo invariant — same `(info-set, rng seed)` → same play — still holds. `--determinism` mode in the bench replays each seed and verifies the chosen cards are byte-identical to the first run. All 5 fixture seeds passed for both B6 and B7 after this change.

# What was tried and rejected

History heuristic (P3 from the handoff). The implementation matched the handoff sketch:

- `Uint32Array(32)` on the work struct, reset per top-level `evalDDS` call.
- Stable in-place insertion sort by `history[card]` descending after `legalMoves()`, before the killer-promote step.
- Increment `history[card]` on every beta cutoff.

Three measurements, all with 3–5 seeds and the same scope as the bench above:

| Metric | Baseline (P1) | With P3 alone |
|---|---|---|
| B6 R1/move | 1445 ms | 1727 ms |
| B7 R1/move | 571 ms | 559 ms |
| B6 total (3 seeds) | 32.2 s | 41.3 s |
| B7 total (3 seeds) | 12.1 s | 12.2 s |

B6 was a clear regression, B7 was within noise. The diagnosis above (strong default order, shallow tree, weak cross-position signal) explains both. The code is not retained — the bench cost of the reorder pass was not paid back in node-count reduction.

If a future session wants to revisit P3, the failure mode to design around is: the per-card score has to refine, not replace, the high-power-first base order. A history-as-tie-breaker formulation (only reorder among cards of identical default-order priority) would have no cards to reorder in 304 since within-suit power is monotonic — so a useful P3 would have to operate across suits, which raises the bar substantially.

# How to validate any future change to this file

```bash
# Bench (compare to numbers in this doc):
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 5

# Determinism — must pass:
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 3 --determinism

# Bot zoo (still 170 vitest tests, 1 skipped):
cd frontend && npx vitest run
```

# Constraints honoured (unchanged)

- Determinism in `(info-set, rng seed)` — verified by the determinism replay above.
- No new runtime dependencies.
- Bots stay open-trump-only.
- `legalPlays` contract honoured, including the lone-trump-holder lead rule (the suit-equivalence collapse is downstream of the contract, not a relaxation of it).
