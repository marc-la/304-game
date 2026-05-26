---
title: 304 — B6/B7 Speed Optimisation, Tier 2 (what changed)
status: shipped, 2026-05-26
purpose: Plain-English changelog for the Tier 2 algorithmic rewrite of B6 and B7. Read alongside [bot-speed-tier3-handoff.md](bot-speed-tier3-handoff.md) for what's next.
---

# TL;DR

B6 and B7 now share an optimised double-dummy solver. Same algorithms (Ginsberg-PIMC, per-candidate fresh sampling), faster inner loop. **5–10× speedup** on opening positions, full determinism preserved, all tests pass.

Headline numbers, mean per-move across 5 fixture seeds × 32 moves each:

| Bot | Before (handoff estimates) | After | R1 (worst case) |
|---|---|---|---|
| B6 | ~10–30 s/move at opening | **0.64 s mean** | **3.6 s** |
| B7 | ~5–15 s/move at opening | **0.20 s mean** | **1.1 s** |

For comparison: B5 is 1.7 ms mean, 6 ms at R1.

# What changed

Three new/modified files plus a new bench harness:

| File | Status | What it is |
|---|---|---|
| [engine/bots/dds-core.ts](../engine/bots/dds-core.ts) | NEW | Shared optimised double-dummy solver. The hot inner loop both bots now call into. |
| [engine/bots/b6-dds-mc.ts](../engine/bots/b6-dds-mc.ts) | REWRITTEN | Same algorithm (shared sample set, mean-EV ranking), now delegates to dds-core. Preserves "TT shared across candidates within a world" — its main per-bot speedup over B7. |
| [engine/bots/b7-bridge-derived.ts](../engine/bots/b7-bridge-derived.ts) | REWRITTEN | Same algorithm (per-candidate fresh world slices), now delegates to dds-core. Preserves the disjoint-slice sampling as its B7-vs-B6 differentiator. |
| [tools/bots/bench/run-bench.ts](../tools/bots/bench/run-bench.ts) | NEW | Benchmark harness over the fixture seeds. Reports median / p95 / p99 per-move and per-round breakdown; `--determinism` flag replays each seed to verify identical plays. |

The bot zoo registry ([engine/bots/index.ts](../engine/bots/index.ts)) is unchanged — the bots' public interface is identical.

# How the speedup works

The original B6/B7 inner loop was pure minimax over `Map<Seat, CardId[]>` with a string-concatenation TT key. Six things made it slow; this round addresses all six within the bot files, leaving the engine's state shape alone.

### 1. Cards as 5-bit ints, hands as 32-bit bitmasks

Each card is encoded as `(suitIdx << 3) | power` (0..31). A whole hand fits in a `number` (32-bit bitmask), and the four hands of a position fit in a `Uint32Array(4)`.

This replaces `Set<CardId>` / `Map<Seat, CardId[]>` lookups (V8 hash tables, allocating) with bit ops (single CPU instructions). "Cards of suit S in hand H" becomes `H & (0xff << (S << 3))`. "Remove card c from hand H" becomes `H & ~(1 << c)`. No allocation, no hashing.

### 2. Alpha-beta minimax on tricks-by-myTeam

The original code was pure minimax — it evaluated every leaf. The game is zero-sum in trick count (each remaining trick goes to one team), so a single scalar (tricks-won-by-myTeam) suffices, and standard alpha-beta applies. We use **fail-soft alpha-beta**: returned values can exceed the (α, β) bounds, which works correctly with the bounded TT (see #5).

Across trick boundaries, bounds shift by the trick we just won: if we won 1 trick this round, the recursive call uses `(alpha - 1, beta - 1)` since `total = won + future`.

### 3. Move ordering: high-power-first within suit

Alpha-beta cuts are sensitive to move order. We iterate moves with the strongest card in each suit first (low power index = strong card). Cards likely to win tricks tend to either cause cutoffs immediately or establish tight bounds for the rest of the search.

### 4. Killer-move heuristic

Each search level (`depth = cards played so far`) remembers the last card that caused an alpha-beta cutoff. Next visit at the same depth, we try it first if it's legal. Cheap to maintain (one `Int8Array(33)`), reliably saves 1.5–2× nodes in DDS-style positions.

### 5. Bound-typed transposition table

The cached value for each position is no longer a single number but a packed (lower, upper) bound pair, encoded into one int. On TT hit:

- If `lower ≥ beta` → return `lower` (proven cutoff)
- If `upper ≤ alpha` → return `upper` (proven cutoff)
- If `lower == upper` → return exact value
- Otherwise → tighten α/β with the bounds and continue searching

This is the **only correct way** to combine TT with alpha-beta: pure-value caching would poison the search because fail-cutoff values are bounds, not exact values. The original code's TT was correct only because it didn't use alpha-beta.

The key is built via `String.fromCharCode` over the four hand bitmasks (split into 16-bit halves) plus the trick state. Faster than string concatenation, cheaper to hash than 4 separate Map lookups.

### 6. In-place state mutation with explicit undo

The original DDS allocated a new `Map<Seat, CardId[]>` per child, plus a new `inProgress` array. Both replaced with: a single `DDSState` mutated by the recursion (`hands[seat] &= ~cardBit`, `trickLen++`) and explicitly undone after the recursive call returns (`hands[seat] |= cardBit`, `trickLen--`).

Per-node allocation dropped from ~5 small objects to zero. GC pressure on a deep search vanishes.

# Per-bot specifics

**B6** keeps its defining trait: all candidates score against the **same** sampled world set. We exploit this by sharing the TT across the 8 candidates within each world — they share most downstream states. This is why B6 specifically benefits more than a naive "switch to dds-core" port would suggest.

**B7** keeps **per-candidate fresh world slices** (the GIB-paper-derived differentiator). Each candidate `i` gets worlds `[i·N, (i+1)·N)` from the deterministic enumerator. The TT can't be shared across candidates (worlds differ → state keys differ), so we use a fresh TT per (candidate, world).

The per-bot TT decision is the architectural reason they remain two distinct bots rather than parameterisations of one.

# Determinism (preserved)

Both bots remain deterministic in `(info-set, rng seed)`, which is the bot-zoo hard invariant:

- World sampling uses `enumerateWorlds`, unchanged — same RNG, same order.
- DDS is deterministic given a world (no rng inside the solver).
- Move ordering is deterministic (suit order, then power order).
- Killer-move updates are deterministic.
- Tie-break on equal mean scores: first candidate in `stableSort(legal)` order (same as original).

Verified by [tools/bots/bench/run-bench.ts](../tools/bots/bench/run-bench.ts) `--determinism` flag: replays each seed and confirms identical play traces. Passes for all 20 fixture seeds.

The bot-zoo test suite ([engine/bots/__tests__/bots.test.ts](../engine/bots/__tests__/bots.test.ts)) also asserts determinism on seed 42 across 3 repeated calls — passes.

# Correctness

- All 27 bot-zoo tests pass (legality + determinism on multiple seeds for every bot, including B6/B7).
- Full repo test suite green: **157 passed**.
- The "lone trump holder must lead trump" rule from [engine/play.ts:30-37](../engine/play.ts#L30-L37) is enforced inside `legalMoves` in dds-core. (Without this, deep DDS would explore illegal lines.)
- Trick-winner logic mirrors [engine/play.ts:roundWinner](../engine/play.ts#L61-L82) bit-for-bit, just on packed card indices.

# How to run the bench

```bash
# From repo root, with Node 20+ active:
npx tsx tools/bots/bench/run-bench.ts \
  --bots b3-heuristic,b4-infoset-1ply,b5-csp-search,b6-dds-mc,b7-bridge-derived \
  --seeds 5

# To verify determinism:
npx tsx tools/bots/bench/run-bench.ts \
  --bots b6-dds-mc,b7-bridge-derived \
  --seeds 3 --determinism

# To run just the bot zoo tests:
cd frontend && npx vitest run ../engine/bots/__tests__/bots.test.ts
```

Fixture seeds are listed in [docs/bot-speed-handoff.md:222](bot-speed-handoff.md#L222). **Do not change them** — they're a measurement standard across iterations.

# What was deliberately not touched

In scope: B6 and B7 inner loops. Out of scope this round:

- Engine `Map<Seat, ...>` shape — Tier 1 in the original handoff. Touches every bot + runtime + tests; better as its own focused PR.
- B0–B5 — already fast enough.
- Closed-trump bot in [tools/curator/closed-trump-bot.ts](../tools/curator/closed-trump-bot.ts) — separate stream.

See [bot-speed-tier3-handoff.md](bot-speed-tier3-handoff.md) for the next-session brief on what to pick up.
