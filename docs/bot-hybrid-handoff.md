---
title: 304 — B6o / B7o hybrid bots (R1+R2 cheap, R3+ DDS)
status: handoff, 2026-05-26
purpose: Build hybrid open-trump bots that side-step the R1/R2 cost of full DDS. Read [bot-speed-tier3-changes.md](bot-speed-tier3-changes.md) for the current bench.
---

# Why this exists

After Tier 3 P1, B6's compute is hyper-concentrated in the first two rounds:

```
B6:  R1 1947 ms   R2 1175 ms   R3 128 ms   R4 18 ms   R5+ < 3 ms
B7:  R1  683 ms   R2  489 ms   R3  89 ms   R4 11 ms   R5+ < 3 ms
```

R1 + R2 = ~94 % of B6's per-game compute and ~91 % of B7's. And R1 is also where DDS is *least optimal* — the 200 k node budget is binding, so the bot is approximating the tail of the tree rather than solving it. R3 onward DDS solves exactly and runs fast.

A hybrid that uses a cheap heuristic for R1+R2 and DDS for R3+ should be:
- **~10× faster per game** (most cost moves off the critical path)
- **strength-neutral, or close** — we're replacing budget-bound approximation with a well-tuned heuristic in exactly the rounds where DDS already approximates

This is the cheapest single change that could put a DDS-class bot under the 500 ms median target for tournament density.

# Design sketch

Two new bots, each a thin wrapper around an existing pair:

| New bot | Early rounds (R1+R2) | Late rounds (R3+) |
|---|---|---|
| `b6o-dds-mc-hybrid` | B5 (csp-search) | B6 (dds-mc) |
| `b7o-bridge-hybrid` | B5 (csp-search) | B7 (bridge-derived) |

B5 is the right early-round delegate: it's a 2-ply expectimax over a world sample with a caps-aware override. It's already used as the "smart cheap" reference and it tops every Bx where x < 5.

(B3-heuristic is another plausible early-round delegate. It's cheaper than B5 but ~150 ELO weaker. Pick B5 by default; gate behind an option if you want to A/B.)

# Where to put it

The bot zoo lives at `engine/bots/`. Pattern to follow (the existing files are good models):

- New file: `engine/bots/b6o-dds-mc-hybrid.ts`. Exports `chooseDDSMCHybrid: (ctx: BotContext) => BotChoice`. The body just looks at `ctx.state.play.roundNumber` and delegates to either `chooseCSPSearch` (from `b5-csp-search.ts`) or `chooseDDSMC` (from `b6-dds-mc.ts`).
- Same for `b7o-bridge-hybrid.ts`.
- Register both in `engine/bots/index.ts` next to B6/B7. Profile metadata: same shape as the others, names like "DDS Monte Carlo (hybrid)" and "Bridge-derived (hybrid)".

# Determinism

The B5 and B6/B7 codepaths are individually deterministic in `(info-set, rng seed)`. Concatenating them is deterministic too — the round number is part of the state, so the dispatch is total and reproducible. No new RNG hooks needed. Validate with the standard `--determinism` flag.

# Tunable: the cutover round

The default cutover is "B5 for R ≤ 2, DDS for R ≥ 3". The right cutover depends on R3's cost — currently 128 ms for B6 and 89 ms for B7, well inside the 500 ms target. If P3/P4 land first and bring R2 under target, the cutover could move down to R ≤ 1 and the hybrid would converge to plain B6/B7.

Expose `EARLY_ROUNDS = 2` as a `const` at the top of each hybrid file. Don't make it a runtime option — a per-bot constant keeps the determinism story simple.

# Strength expectation

Heuristic: R1 dominates information uncertainty (no completed rounds, no exhausted-suit constraints), so deep DDS gives the smallest *strength* gain there even though it's the most *expensive* to compute. By R3 most opponents have committed cards that prune the tree dramatically, and DDS within budget actually solves the subgame.

So the strength loss from a hybrid should be small. The expected outcome is:

- B6 vs B6o: roughly even, possibly B6o slightly behind (~20–40 ELO).
- B6o vs B5: clearly B6o ahead — the same margin B6 has over B5, minus whatever R1/R2 advantage B6 had.
- B5 vs B6 vs B6o: a meaningful three-way result that informs whether to keep B6 at all (the P5 question).

The hybrid is also a useful **diagnostic**: a head-to-head between B6 and B6o isolates "how much does R1/R2 DDS actually contribute to strength?" — which is exactly the question P5 is designed to answer in aggregate.

# Recommended order

1. Implement `b6o-dds-mc-hybrid.ts` first (B5 → B6). Smallest change, biggest payoff.
2. Bench it. Confirm R1 drops to ~6 ms (B5 R1 cost) and R3+ is unchanged. Confirm determinism passes.
3. Run a focused B6 vs B6o tournament (~50 games × 2 duplicate, 1 period). One sitting, ~1 h.
4. Only then do B7o. (B7 may not even need a hybrid if it's already under target after P2/P3.)
5. Decide: keep both, fold B6o into B6 (replace), or fold B6 into B6o (drop the pure version).

# Validation

```bash
# Bench:
npx tsx tools/bots/bench/run-bench.ts --bots b6o-dds-mc-hybrid --seeds 5

# Determinism:
npx tsx tools/bots/bench/run-bench.ts --bots b6o-dds-mc-hybrid --seeds 3 --determinism

# Head-to-head strength:
npm run bots:tournament -- --bots b5-csp-search,b6-dds-mc,b6o-dds-mc-hybrid --games 50 --periods 1

# Full repo suite must stay green:
cd frontend && npx vitest run
```

# Hard constraints (unchanged)

- **Determinism in `(info-set, rng seed)`** — verify after wiring up.
- **Bots stay open-trump-only**.
- **Respect the `legalPlays` contract** including the lone-trump-holder lead rule.
- **No mid-game switching back to B5** based on time — if you want timed dispatch later, that's a separate handoff; the round-number-based hybrid is the supported design.

# Reading list

1. This file.
2. [bot-speed-tier3-changes.md](bot-speed-tier3-changes.md) — current bench.
3. `engine/bots/b5-csp-search.ts` — the early-round delegate.
4. `engine/bots/b6-dds-mc.ts`, `b7-bridge-derived.ts` — the late-round delegates and the wrapper pattern.
5. `engine/bots/index.ts` — bot registry.
