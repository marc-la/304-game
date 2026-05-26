---
title: 304 — B6o / B7o hybrid bots (R1+R2 cheap, R3+ DDS)
status: handoff, updated 2026-05-26 (post P2+P4 ship and first tournament read)
purpose: Build hybrid open-trump bots that side-step the R1/R2 cost of full DDS. PVS + suit-equivalence shipped 2026-05-26 (commit `0b302bd`); current bench lives in git log + the `dds-core.ts` header comment.
---

# Why this exists

After Tier 3 P2+P4, B6 and B7's per-round cost is much lower in absolute terms but the shape is the same — most of the work is in R1 and R2:

```
B6:  R1 484 ms   R2 195 ms   R3 30 ms   R4 7 ms   R5+ < 2 ms
B7:  R1 270 ms   R2 114 ms   R3 25 ms   R4 6 ms   R5+ < 1 ms
```

R1 + R2 still accounts for ~88 % of B6's per-game compute and ~85 % of B7's. The 500 ms median target is comfortably hit, but at *peak* (R1) B6 is right at the line, and the high-fidelity DDS at R1 may not be earning the cost given how much uncertainty remains in the info-set.

A hybrid that uses a cheap heuristic for R1+R2 and DDS for R3+ should still be **~2× faster per game** post-P2+P4 (vs ~10× pre-P2+P4) and should be roughly strength-neutral, possibly stronger if the cheap delegate is well-tuned for early-round play.

# ⚠ Prerequisite: refactor B6 / B7 before the hybrid

The first tournament after the P2+P4 ship surfaced a structural problem with B6 and B7 that the hybrid would otherwise inherit: **the DDS objective is wrong for 304**.

`engine/bots/dds-core.ts` searches `tricksByMyTeam` and scores trick wins as `won = 1` (see `dds()` and `evalDDS` return type). But 304 is decided on **points** — the trumper team needs ≥ 160 points (opp ≥ 145), and card points are very non-uniform (J=30, 9=20, A=11, 10=10, K=3, Q=2, 8=0, 7=0). A trick of J+9+A is worth 61 points; a trick of K+Q+8+7 is worth 5. B6 and B7 treat those two tricks as identical (1 unit each) and will routinely trade a high-value trick for two low-value ones.

This shows up in the first full tournament:

| Pairing (combined home+away, 200 games) | B6 win-rate | B6 net diff |
|---|---|---|
| B6 vs b4-infoset-1ply | 46.5 % | −28 |
| B6 vs b5-csp-search | 47 % | −13 |
| B6 vs every other bot | 53–65 % | +20 to +88 |

B4 and B5 both score by **points** (`pointsOf` per played card, signed by winning team — see `engine/bots/b4-infoset-1ply.ts:111` and `engine/bots/b5-csp-search.ts:149`). They search shallower than B6 but the *function* they search is correct for 304. That is enough to flip the head-to-head.

A hybrid built on the current B6/B7 inherits this flaw at R3+. Fix the objective first, *then* build the hybrid on a B6/B7 that actually beats B5.

## What the B6/B7 refactor looks like

The change is contained to two files: `engine/bots/dds-core.ts` and the two callers (`b6-dds-mc.ts`, `b7-bridge-derived.ts`). The alpha-beta, TT, killer, PVS, and suit-equivalence machinery from this session all carry over unchanged — only the scoring scalar moves.

### 1. dds-core.ts — change the search scalar from tricks to points

- Rename `tricksByMyTeam` → `pointsByMyTeam` in `DDSResult` and the `evalDDS` return.
- Replace the per-trick `won` line in `dds()` ([engine/bots/dds-core.ts:325](engine/bots/dds-core.ts#L325)) with the sum of `cardPoints` for the four cards in the resolved trick, signed by which team won:
  ```ts
  // before: won = SEAT_TEAM[winner] === w.myTeam ? 1 : 0
  // after:  won = SEAT_TEAM[winner] === w.myTeam ? trickPoints(s) : 0
  ```
  where `trickPoints(s)` sums a new `CARD_POINTS[card_idx]` lookup table for the four cards in `s.trickCards`. Build the lookup at module load alongside `CARD_SUIT` and `CARD_POWER`.
- Update the initial-window setup in `evalDDS`: today `dds(s, 0, tricksLeft, 0, w)` where `tricksLeft = (cards_left + trick_len) >> 2`. Replace with `pointsLeft = sum of pointsOf for all unplayed cards + already-in-trick cards`, and call `dds(s, 0, pointsLeft, 0, w)`.
- Widen the TT entry encoding. The current `encodeTT` packs `(lower+1, upper+1)` into 16 bits (8 bits each), valid for the tricks range [-1, 33]. Points range is [0, 304] per call (and intermediate alpha/beta during recursion can sit anywhere in [−304, 304]). Switch the entry from a 16-bit packed int to either:
  - Two separate `Int16Array` slots indexed by the cache key's hash, or
  - A plain object `{ lower, upper }` stored in the existing `Map`.
  The TT key (`makeKey`) doesn't change — it's keyed on state, not on bounds.
- Audit the budget-exhaustion fallback: `return (alpha + beta) >> 1` is fine in principle but the midpoint of a [0, 304] window is a worse estimate than the midpoint of a [0, 8] window. Consider tightening the budget or switching the fallback to `alpha` (a sound but pessimistic lower-bound proxy).

### 2. b6-dds-mc.ts and b7-bridge-derived.ts — update the candidate-selection math

Both bots score candidates by adding `preWon` (the trick-completion bonus when the candidate completes the current trick) to the DDS return value. Change `preWon` from a 0/1 trick-count to the full points of the completed trick when our team wins, 0 otherwise. The candidate-comparison math (`mean over worlds`, pick highest) stays unchanged — it just operates on a points-valued mean instead of a tricks-valued mean.

### 3. Add caps awareness to B6 / B7 (decide: now or follow-up)

B5 has a caps-aware override ([engine/bots/b5-csp-search.ts:174-184](engine/bots/b5-csp-search.ts#L174-L184)): when its team is the trumper team and the current seat is caps-obligated, B5 calls `findWitnessLine` from `engine/caps-csp.ts` and plays the witness's first card. This is a *certificate* — a play sequence the engine proved satisfies caps — so B5 gets these positions right by construction.

B6 / B7 don't have this. In caps-obligated positions they fall back to pure DDS, which doesn't model caps at all. Two options:

- **Cheap**: add the same witness override at the *entry* of `chooseDDSMC` / `chooseBridgeDerived`, mirroring B5. ~20 lines, no DDS-internal changes. Catches the static-caps positions but doesn't propagate through the search.
- **Hard**: thread caps state into the DDS recursion — TT key extension, per-state caps-obligation tracking. Estimated 1–2 days. Defer unless the entry-level override doesn't close the gap to B5.

Default: do the cheap version as part of the prerequisite. Re-tournament. If the gap to B5 closes, ship. If not, escalate.

### 4. B0–B5 review (likely zero changes)

- **B0 random**: no scoring, no change.
- **B1 high-low**, **B2 memo-high-low**, **B3 heuristic**: rule-based. They implicitly point-aware via `pointsOf`-driven star preservation. No change needed for objective alignment.
- **B4 infoset-1ply**: already scores by points ([engine/bots/b4-infoset-1ply.ts:111](engine/bots/b4-infoset-1ply.ts#L111)). No change.
- **B5 csp-search**: already scores by points + has caps witness ([engine/bots/b5-csp-search.ts:149](engine/bots/b5-csp-search.ts#L149)). No change.

If a future session wants a `score` helper to canonicalise "signed-points-from-my-team's-view" across B4 / B5 / refactored B6 / B7, that's a tiny dedupe in `engine/bots/common.ts` — *not* a prereq. Don't block the refactor on it.

### 5. Validation gate (must pass before the hybrid starts)

```bash
# Bench: B6/B7 numbers should be similar or slightly better than the
# P2+P4 column (the search is unchanged, the scoring is wider but the
# TT still cuts; expect ±20% noise).
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 5

# Determinism still holds — must pass.
npx tsx tools/bots/bench/run-bench.ts --bots b6-dds-mc,b7-bridge-derived --seeds 3 --determinism

# Strength: head-to-head B5 vs refactored B6 / B7.
npm run bots:tournament -- --bots b5-csp-search,b6-dds-mc,b7-bridge-derived --games 100 --periods 1

# Pass criterion: B6 and B7 each beat B5 by ≥ +20 net diff at n=200.
# If they don't, the objective fix alone isn't enough — escalate to
# the hard caps-aware variant or revisit the search depth at R1.
```

Only after this gate passes does the hybrid work below begin in earnest.

# Design sketch (unchanged from original)

Two new bots, each a thin wrapper around an existing pair:

| New bot | Early rounds (R1+R2) | Late rounds (R3+) |
|---|---|---|
| `b6o-dds-mc-hybrid` | B5 (csp-search) | B6 (dds-mc, refactored) |
| `b7o-bridge-hybrid` | B5 (csp-search) | B7 (bridge-derived, refactored) |

B5 is still the right early-round delegate. After the B6/B7 refactor it remains the strongest cheap option (caps-aware, point-scored, 2-ply lookahead).

(B3-heuristic remains a plausible cheaper delegate; defer the B5-vs-B3 A/B until the hybrid is shipped.)

# Where to put it

Same as before:

- New file: `engine/bots/b6o-dds-mc-hybrid.ts`. Exports `chooseDDSMCHybrid: (ctx: BotContext) => BotChoice`. Body inspects `ctx.state.play.roundNumber` and delegates to `chooseCSPSearch` or `chooseDDSMC`.
- Same for `b7o-bridge-hybrid.ts`.
- Register both in `engine/bots/index.ts`.

# Determinism

Unchanged from the original handoff. B5 and refactored B6/B7 are individually deterministic in `(info-set, rng seed)`. The round-number-keyed dispatch is total. Validate with `--determinism`.

# Tunable: the cutover round

The default cutover is "B5 for R ≤ 2, DDS for R ≥ 3". The right cutover depends on how the refactored B6/B7 compare to B5 round-by-round:

- If refactored B6/B7 clearly beats B5 by R3, keep cutover at 2.
- If refactored B6/B7 also beats B5 at R2 (which is possible — R2 has more info-set pruning than R1), move cutover to 1.
- If refactored B6/B7 doesn't beat B5 at all, the hybrid is pointless — fold the whole thing and keep B5.

Expose `EARLY_ROUNDS = 2` as a `const` at the top of each hybrid file. Don't make it a runtime option.

# Strength expectation (revised)

Old expectation (pre-refactor): "small strength loss from hybrid; B6 ≥ B6o ≥ B5 with ~20-40 ELO gaps."

Revised expectation (post-refactor, assuming the prereq gate passes):

- Refactored B6 vs B5: B6 ahead by ≥ +20 net diff (gate criterion above).
- B6 vs B6o: roughly even, possibly B6o slightly behind. The R1/R2 information uncertainty makes deep search expensive *and* low-yield; the heuristic in those rounds is probably good enough.
- B6o vs B5: clearly B6o ahead — same margin B6 has over B5, minus whatever R1/R2 advantage B6 had.

If the prereq gate *fails* (refactored B6 still doesn't beat B5), the hybrid is moot — the underlying DDS isn't carrying its weight even at R3+ and the path forward is a strength investigation, not a hybrid wrapper.

# Recommended order (updated)

1. **Prerequisite (this handoff's blocker)**: refactor B6/B7 to score by points instead of tricks. Add cheap caps-witness override at bot entry. Re-bench. Re-tournament against B5. Confirm the gate criterion.
2. Implement `b6o-dds-mc-hybrid.ts` (B5 → refactored B6). Smallest change, biggest payoff *if* step 1 passed.
3. Bench it. Confirm R1+R2 drops to B5 cost (~6 ms R1) and R3+ matches refactored B6. Confirm determinism passes.
4. Run a focused B5 / B6 / B6o tournament (~50 games × 2 duplicate, 1 period, ~30 min).
5. Only then do B7o. (B7 may not need a hybrid at all if its mean/move is already comfortable.)
6. Decide: keep both, fold B6o into B6 (replace), or fold B6 into B6o (drop the pure version).

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
- **No mid-game switching back to B5** based on time — round-number-based hybrid is the supported design.

# Reading list

1. This file.
2. `git log -- engine/bots/dds-core.ts` — speed history (P1 Map→Array, Tier 2 alpha-beta + bitmasks, P2+P4 PVS + suit-equivalence).
3. `engine/card.ts` — `POINTS` table for the refactor.
4. `engine/bots/dds-core.ts` — where the objective change lives.
5. `engine/bots/b5-csp-search.ts` — early-round delegate AND reference for caps-witness override.
6. `engine/bots/b6-dds-mc.ts`, `b7-bridge-derived.ts` — late-round delegates and the wrapper pattern.
7. `engine/caps-csp.ts` — `findWitnessLine` for the caps override.
8. `engine/bots/index.ts` — bot registry.
