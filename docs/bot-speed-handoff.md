---
title: 304 — Bot Speed & Ultimate-Strongest-Bot Handoff (original)
purpose: A self-contained brief for the next session — make a 304 bot that is both faster than B6 and stronger than B6, suitable for tournament inclusion and for high-volume puzzle generation.
status: partially shipped, 2026-05-26
followup: Tier 2 algorithmic fixes (alpha-beta, bitmask hands, bound TT, killer, move ordering) are DONE. See [bot-speed-tier2-changes.md](bot-speed-tier2-changes.md) for what shipped and [bot-speed-tier3-handoff.md](bot-speed-tier3-handoff.md) for the current handoff (Tier 1 engine refactor, PVS, history heuristic, suit equivalence, strength experiment, WASM escape hatch). This document remains the canonical reference for the original problem statement, fixture seeds, and constraints.
---

# Where we are now

## The bot zoo

Seven open-trump play-only bots in [`engine/bots/`](../engine/bots/). All deterministic in `(info-set, rng seed)`. Interface:

```ts
type PlayBot = (ctx: BotContext) => { card: CardId };
// BotContext = { seat, hand, state: EngineGameState, rng }
```

| Bot | What it does | Speed at R1 lead (8-card hand) |
|---|---|---|
| B0 random | Uniform legal pick | ~10 μs / move |
| B1 high-low | Cheapest winner / lowest sluff | ~50 μs |
| B2 memo high-low | B1 + card memory | ~100 μs |
| B3 heuristic | Existing engine bot, star-spend thresholds | ~150 μs |
| B4 infoset 1-ply | EV over 32 sampled worlds, 1 trick lookahead | ~5–15 ms |
| B5 csp-search | 2-ply expectimax + caps-aware override | ~30–80 ms |
| **B6 dds-mc** | **Sample 8 worlds × full DDS each** | **~10–30 s** at opening |
| **B7 bridge-derived** | **Per-candidate fresh samples + DDS** | **~5–15 s** |

The tournament default is **B0..B5**. B6 and B7 are currently *too slow to include* in a 50-game round-robin — they'd take many hours. The current Leaderboard at `--games 10`:

```
1572  CSP Search (B5)
1567  InfoSet 1-Ply (B4)
1515  High-Low (B1)
1510  Heuristic (B3)
1500  Memo High-Low (B2)
1336  Random (B0)
```

B5 currently tops the rated set. Whether B6/B7 are *actually stronger* than B5 (as their algorithm suggests) is unverified at tournament-scale — we have anecdotal evidence from individual hands, but no head-to-head sample size.

## Tournament protocol (post-2026-05-26 refactor)

[`tools/bots/elo/`](../tools/bots/elo/). Per game:

- Trumper-seat rotates through {south, east, north, west} across games in a pairing (50/50 split between teams).
- Priority-seat rotates independently — offset by 1 from trumper (real-rule decoupling: dealer rotates separately from who-wins-the-bid).
- **Bid = 160** is the synthetic stake. Trumping team wins iff their points ≥ 160. Total 304 ⇒ mutually exclusive ⇒ no draws are possible.
- Open trump only (closed-trump bots live in `tools/curator/closed-trump-bot.ts`; not in the zoo).
- Duplicate-bridge symmetry: same seed + same trumper/priority position with home/away seat assignment flipped.
- Glicko-2 ratings; ~5 KB in-house implementation in [`glicko2.ts`](../tools/bots/elo/glicko2.ts).

## Match generation (offline)

Separate pipeline at [`tools/puzzles/`](../tools/puzzles/) — generates `ScriptedPuzzle` puzzles for 304dle. Uses the closed-trump-bot for closed games; uses the open-trump zoo for open games. **The handoff scope below is open-trump tournament play, NOT the curator pipeline.** That said, a stronger+faster open-trump bot is reusable in the curator's open-trump path.

---

# The problem to solve

> **Produce a 304 play bot that beats B5 in ELO AND runs in ≤ 500 ms per move (median over a full 8-round game).**

Stronger-than-B5 is the unique value. If we can also drop median per-move time below B5's (~50 ms), even better — that opens up B6-density tournaments. Failing the speed target but beating B6 in ELO is still a meaningful result, just less deployable.

---

# Why B6 / B7 are slow (root cause analysis)

[`engine/bots/b6-dds-mc.ts`](../engine/bots/b6-dds-mc.ts) — the double-dummy inner search:

1. **Per move at opening**: 8 candidate cards × 8 sampled worlds × `DDS_BUDGET = 20,000` node budget = up to 1.28 M node visits **per move**.
2. **Per game**: 32 moves × 1.28 M = up to 41 M node visits per game.
3. **Per pairing**: at 50 games × 2 (duplicate) × 41 M = 4 B node visits *per pairing*. At ~100 K nodes/sec in TS, ~11 hours.

Hot path: the inner `dds(...)` recursive minimax with a string-based `stateKey` for the transposition cache (line 36). Three issues:

- **String concatenation for cache key** — the `stateKey` function builds a multi-suit-sorted-string per node. Allocates garbage proportional to node count. **This alone is probably 30–50% of CPU.**
- **No alpha-beta pruning** — pure minimax. With deal-known double-dummy, alpha-beta should cut the tree by 5–10x.
- **No move ordering** — the loop iterates legal plays in `[...legal].sort()` (lexicographic). Bridge-DDS literature uses high-card-first ordering for max moves and low-card-first for min, which dramatically improves cut rate.
- **8 worlds sampled, but each candidate uses the same world set** — at opening, the 8 worlds in `enumerateWorlds` come from a deterministic backtrack. They are biased toward early-suit-lex orderings, which means the bot reasons over a non-representative sample. B7 partly addresses this with per-candidate fresh sampling but doesn't otherwise differ.

Closer-to-the-metal issues:

- `CardId` is a *string* (per the engine's brand-type decision). Every `Set<CardId>` and `Map<seat, CardId[]>` operation goes through V8 hash-table machinery. Switching to a packed 5-bit-rank + 2-bit-suit `Uint8Array` representation inside the hot loop (with a final translation back) is the standard chess-engine trick.
- `roundWinner` and `legalPlays` allocate new arrays on every call (line 60–82 of [`play.ts`](../engine/play.ts)). The DDS visits these tens of millions of times — every allocation matters.

---

# Optimization paths, ordered by expected payoff

## Tier 1 — engine hot-path fixes (do these first; benefit every bot)

| Change | Where | Expected speedup |
|---|---|---|
| Replace `Map<Seat, CardId[]>` in [`engine/state.ts`](../engine/state.ts) with a fixed 4-element array indexed by `SEAT_INDEX`. | `EngineGameState.hands` | 2–5x on iteration-bound code |
| Avoid array allocation in `roundWinner` ([`play.ts:62`](../engine/play.ts#L62)). Inline the comparison loop. | `engine/play.ts` | 1.5x on DDS inner |
| Cache the trumpSuit precomputed `suitOf` for each card in a `Uint8Array` indexed by the brand string. | `engine/card.ts` | 2x on `suitOf` calls |
| Switch the per-node DDS cache from string key to a packed `BigInt`. Each seat's hand → sorted bitset over 32 bits → 4 BigInts merged. | `b6-dds-mc.ts:stateKey` | 3–5x on cache lookup |

## Tier 2 — DDS algorithmic improvements

| Change | Expected payoff |
|---|---|
| **Alpha-beta pruning** in `dds()`. Replace pure minimax with negamax + α/β bounds. | 5–10x tree reduction |
| **Killer-move heuristic** — remember which card cut last at each depth, try it first at the next node. | 1.5–2x |
| **PVS (Principal Variation Search)** — assume the move-ordering's first child is best; search the rest with a null window. | 1.5–2x |
| **Transposition table with depth+flag** (exact / lower / upper bounds), not just stored value. | 1.5x |
| **Move ordering**: high-power-first for the team being maximized, low-power-first for the opposition. | 2–3x |
| **Symmetry collapse**: cards of the same suit with no intervening enemy holding compress to one canonical representative. (See `info.ts` §9 reduction notes.) | 1.5–4x; situational |

## Tier 3 — sampling improvements

| Change | Expected payoff |
|---|---|
| **Rejection sampling** of consistent worlds, not deterministic enumeration. Use the `info-set` constraints as a CSP and sample uniformly. | Better statistical coverage at same sample size |
| **Importance sampling**: weight world samples by their *likelihood under opponent play model* — a Bayesian update on opp's earlier choices. | Strict improvement if a reasonable prior over opp policies exists |
| **PIMC convergence**: drop sample count when posterior variance across worlds is small; spend the saved time on deeper search instead. | Adaptive — wins big in mid/late game |
| **Web-worker parallelization**: each candidate card → one worker. With 4 cores, 4x. Trivial to wire in Vitest/Node. | 4x linear if cores available |

## Tier 4 — algorithmic alternatives

| Approach | Why try it |
|---|---|
| **Counterfactual Regret Minimization (CFR)** with a poker-style abstraction layer. Train offline, ship a compact strategy table. | Hits the speed target by construction (lookup is O(1)); gets near-Nash play if training converges. Hard part is the abstraction. |
| **Distill B6 into a tiny neural net.** Generate 100k (state → B6's chosen card) training pairs offline; train a 2-layer MLP; ship as a 30 KB weight file. Inference: < 1 ms / move. | If the net hits ~95% agreement with B6, it'll likely play stronger than B5 at B5's speed. |
| **Hand-crafted opening book**: enumerate canonical 8-card openings (hand-class buckets), label each with B6's pick offline, ship a lookup. | The opening is where B6 is slowest *and* where the hand class is most informative — this is the natural place to spend pre-computation. |
| **Port the inner DDS to WASM.** A modest C/Rust port should run 3–10x faster than the TS version. | Big win, but adds a build dependency. Bo Haglund's `dds` (https://github.com/dds-bridge/dds) is the bridge reference; needs 8-card / 304-trump adaptation. |

---

# Concrete next-session plan

## Phase 1 — measure (1–2 hours)

Build a benchmark harness at `tools/bots/bench/` that runs each bot through a fixed seed sequence and reports:

- Median, p95, p99 per-move time
- Median time per round (rounds 1 / 4 / 8 separately)
- Node-visits per move (for search bots)
- Memory allocation pressure (Node `--inspect` heap snapshots)

Commit baseline numbers. Without this, optimization is fumbling.

## Phase 2 — Tier 1 hot-path fixes (4–6 hours)

These benefit every search bot. Order:

1. Engine `roundWinner` zero-allocation inline.
2. Replace `Map<Seat,...>` with `[hands: CardId[][]]` arrays. (Touches engine, runtime, bots — most diff is mechanical.)
3. Stateful packed key for DDS transposition table.
4. Verify B6 speed improvement; aim for 3–5x.

## Phase 3 — DDS algorithmic (4–8 hours)

1. Alpha-beta. Replace the pure-minimax loop in `b6-dds-mc.ts:dds()` with negamax + α/β.
2. Move ordering.
3. Killer move + PVS.
4. Re-benchmark.

After Phase 2 + 3: target 50–100x speedup over baseline B6. If we hit it, B6 becomes tournament-tractable.

## Phase 4 — strength experiments (open-ended)

Once B6 is fast enough to include, run a long tournament (`--games 200, --periods 3`) and check whether B6's ELO actually exceeds B5's. If yes: B6 is the new ceiling, label it. If no: investigate — probably a sampling bias (Tier 3 fixes).

If after Tier 1+2+3+4, B6 still under-performs or remains too slow, escalate:

- Phase 5a: distill B6 to a neural net (Tier 4 second row).
- Phase 5b: hand-crafted opening book (Tier 4 third row).
- Phase 5c: WASM port of DDS (Tier 4 last row).

## Phase 6 — closed-trump zoo extension (separate effort)

For the curator pipeline, none of the above directly helps closed-trump play. The closed-trump-bot at [`tools/curator/closed-trump-bot.ts`](../tools/curator/closed-trump-bot.ts) is heuristic. To improve closed-trump puzzle quality:

1. Add a `BotChoice` with `faceDown: boolean` to the [bot interface](../engine/bots/types.ts). Every bot in the zoo learns to *decide whether to fold a card*.
2. The DDS solver needs to model face-down information leak (face-down on a non-trump lead reveals "no led-suit" but not the card; face-down trump publicly reveals at §T9).
3. Re-run the curator with the new closed-trump bots.

This is a substantial effort (~1 week) and orthogonal to open-trump speed work.

---

# Files to read first

- [`engine/bots/b6-dds-mc.ts`](../engine/bots/b6-dds-mc.ts) — the bot to attack.
- [`engine/bots/types.ts`](../engine/bots/types.ts) — bot interface.
- [`engine/play.ts`](../engine/play.ts) — hot-path engine functions (`roundWinner`, `legalPlays`).
- [`engine/state.ts`](../engine/state.ts) — the `EngineGameState` shape; the `hands: Map<Seat,...>` is the main allocation pain.
- [`engine/info.ts`](../engine/info.ts) — world enumeration; what samples are drawn from.
- [`engine/caps-csp.ts`](../engine/caps-csp.ts) — already has a "budget exhausted" pattern; pattern to copy.
- [`tools/bots/elo/tournament.ts`](../tools/bots/elo/tournament.ts) — to grasp the tournament protocol.

## Files to NOT touch unless necessary

- `apps/304dle/*` — the player app is downstream. Bot work is in `engine/bots/` only.
- `tools/curator/*` — closed-trump pipeline; orthogonal.

---

# Open questions for the next session

1. **Is B6 actually stronger than B5?** Run a 100-game B5-vs-B6-only tournament before any optimization. If B6 already beats B5 cleanly, the speed work is sufficient. If B6 ties or loses, the strength work is necessary too.
2. **What's the right speed target?** The 500 ms-per-move number is my guess. If the puzzle generator runs once-per-week and uses 4 bots × 32 moves × 1000 puzzles, even 5 s/move is fine offline. For the live 304dle UI it'd be the player's bots, but those are scripted (no bot calls at play-time). Speed mostly matters for the *tournament* — i.e. how many games per pairing we can afford. Target ≥ 50 games per pairing in < 10 minutes total.
3. **Should we keep B7 (bridge-derived) at all?** It's almost the same algorithm as B6 with a slightly different sampling strategy. After speed work, decide whether it's a distinct artifact or just a B6 variant.
4. **CFR vs. distillation vs. opening-book** — these are mutually-not-exclusive but expensive. Pick one based on whichever produces a tractable artifact in the time budget.

---

# Constraints to honor

- **All bots must remain deterministic in `(info-set, rng seed)`.** This is a hard zoo invariant — needed for reproducible puzzles and stable ELO ratings.
- **No new runtime dependencies** unless absolutely necessary. WASM is OK if it makes a 10x+ difference and the user accepts the build complexity. ML libraries: only if shipping inference is a tiny static blob, no torch/onnx runtime.
- **All bots must respect the existing `legalPlays` contract.** No bot ever picks an illegal card. The existing test suite enforces this for the current bots.
- **All bots stay open-trump-only for now.** The closed-trump work is a separate stream.

# Bench fixture seeds

Use these seeds for any speed/strength comparison so numbers are commensurable across iterations:

```
1, 7, 23, 47, 91, 127, 199, 257, 401, 503,
601, 743, 877, 991, 1009, 1117, 1259, 1381, 1487, 1543
```

20 seeds × N games per seed = bench dataset. Don't change the seeds — they're a measurement standard.

---

*End of handoff. Open with: read `docs/bot-speed-handoff.md`, then `engine/bots/b6-dds-mc.ts`, then build the bench harness in `tools/bots/bench/`.*
