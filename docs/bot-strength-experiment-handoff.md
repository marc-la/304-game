---
title: 304 — Bot strength experiment (P5: does B6 actually beat B5?)
status: handoff, 2026-05-26
purpose: Run a focused head-to-head to confirm B6 (and B7) actually play stronger than B5 at tournament scale. Gates further speed work — if B6 isn't actually stronger, the optimisation programme is unmotivated.
---

# Why this is its own handoff

Every prior speed handoff treated "B6 > B5 in strength" as an axiom. We have anecdotal evidence (decisive endgame picks in curated positions) but no statistical confirmation. Tier 2 + Tier 3 P1 made the experiment affordable for the first time:

- B6 vs B5: ~12 s/game (B6 side) → 100-game pairing in ~12 min.
- B7 vs B5: ~5 s/game → 100-game pairing in ~5 min.

A full P5 sweep (B5 vs B6 vs B7 head-to-head, both directions, 100 games each) takes about **1 h total compute** on a developer laptop. That's the entire experiment.

# What this gates

If B6 wins ≥ 60 % of decisive games vs B5: continue with [bot-speed-dds-algorithmic-handoff.md](bot-speed-dds-algorithmic-handoff.md) (P2/P3/P4) and [bot-hybrid-handoff.md](bot-hybrid-handoff.md). The speed work pays off.

If B6 is between 50 and 55 %: marginal. Stop speed work; investigate sampling bias and information-set quality (the original Tier-3 plan §"Open questions"). The Tier-2 spec mentions this as a possibility.

If B6 < 50 %: B6 is actually weaker than B5. Stop everything DDS-related; the issue is correctness, not speed. Open a bug.

Apply the same protocol to B7.

# Protocol

From repo root, with node 20 active:

```bash
# 100 games per direction × 2 directions (home/away swap) = 200 games per pairing.
# All four pairings together: 800 games ≈ 1 h.
npm run bots:tournament -- \
  --bots b5-csp-search,b6-dds-mc,b7-bridge-derived \
  --games 100 \
  --periods 1
```

Read the result from `tools/bots/elo/results.json`. Decision criteria:

- B6 vs B5 pairing: look at `home_wins / games` in the pairing where home=B6 (and the swapped one where home=B5). Win rate must be the same in both directions (otherwise something is bot-asymmetric; investigate).
- Same for B7 vs B5.
- The ELO column in the final leaderboard is a derived view — useful for narrative, but trust the raw pairing W/L for the gate.

# What to actually look at

The `runTournament` result already prints per-pairing W/L and the points-diff:

```
   b5-csp-search    vs  b6-dds-mc       38W /  62L   diff:  -41.2
   b6-dds-mc        vs  b5-csp-search   65W /  35L   diff:  +47.8
```

Match those numbers up with the decision criteria above. The mean home-points-diff is a secondary metric — it tells you the *margin* of victory, not just the count. If B6 wins 60 % of games but with diff: +1 only, the strength gap is real but very thin.

# If you want a quick smoke check first

A 20-game pairing finishes in ~5 min and gives a coarse signal. Don't trust it for the gate decision, but useful if the laptop's busy:

```bash
npm run bots:tournament -- \
  --bots b5-csp-search,b6-dds-mc \
  --games 20 --periods 1
```

# Open questions to keep in mind

From the original handoff, still relevant:

- **Is 500 ms/move the right target?** Mostly matters for tournament density; puzzle generation is fine at 5 s/move offline. If you find B6 beats B5 by a wide margin, consider whether the 500 ms is even the right ceiling.
- **B7 vs B6**: keep both, fold B7 into B6, or fold into a single hybrid? See [bot-hybrid-handoff.md](bot-hybrid-handoff.md). Decide after P5 — if both meaningfully beat B5 with different strength profiles, keep both. If they converge to the same play, fold.

# Validation

This handoff is the validation. No code changes; just running an existing CLI and reading the JSON.

If you've changed bot code in the same session, run `cd frontend && npx vitest run` first to catch any breakage before burning compute on a tournament.

# Reading list

1. This file.
2. [bot-speed-tier3-changes.md](bot-speed-tier3-changes.md) — what's already been done; sets bench expectations.
3. [bot-speed-handoff.md](bot-speed-handoff.md) — original problem statement, target.
4. `tools/bots/elo/tournament.ts`, `tools/bots/elo/bin/run-tournament.ts` — the CLI you'll be invoking.
