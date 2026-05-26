# High-Low (`b1-high-low`)

If a played card can win this trick at the moment of play, plays cheapest winner; else lowest-points sluff.

## Strengths

- solid trick-taking
- preserves stars when possible

## Limitations

- no card memory between rounds
- no opponent reading
- no signaling

## Complexity

- Time: `O(L)`
- Space: `O(1)`
- Deterministic: true

## Rating

Glicko-2: **1515** ± 37  (volatility 0.0600)

Measured from a round-robin tournament — 10 games per pairing, 1 rating period(s), generated 2026-05-26T05:09:03.112Z.

## Head-to-head

Win/loss is points-threshold (bid = 160). No draws are possible.

| Opponent | Games | Wins | Losses | Avg points diff |
|---|---|---|---|---|
| b0-random | 20 | 12 | 8 | +27.2 |
| b0-random | 20 | 13 | 7 | +27.4 |
| b2-memo-high-low | 20 | 10 | 10 | +0.0 |
| b3-heuristic | 20 | 11 | 9 | +7.6 |
| b4-infoset-1ply | 20 | 11 | 9 | +13.6 |
| b5-csp-search | 20 | 9 | 11 | -2.0 |
| b2-memo-high-low | 20 | 10 | 10 | +0.0 |
| b3-heuristic | 20 | 8 | 12 | -21.6 |
| b4-infoset-1ply | 20 | 10 | 10 | -4.9 |
| b5-csp-search | 20 | 9 | 11 | -7.6 |

## Rationale for rating

Targets ~1200. Plays legal cards, picks cheapest winner when one exists. No memory or signaling. Beats random consistently because losing cheaply is itself a competence; but no across-trick reasoning.
