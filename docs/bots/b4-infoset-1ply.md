# InfoSet 1-Ply (`b4-infoset-1ply`)

Builds an info-set, samples consistent worlds, evaluates each legal play's expected round outcome 1 ply ahead, picks the best EV.

## Strengths

- leverages suit-exhaustion
- reads opponent voids
- beats heuristic on mid-game positions

## Limitations

- no deep lookahead
- sample bias on wide-open positions

## Complexity

- Time: `O(W·L)`
- Space: `O(W)`
- Deterministic: true

## Rating

Glicko-2: **1567** ± 37  (volatility 0.0600)

Measured from a round-robin tournament — 10 games per pairing, 1 rating period(s), generated 2026-05-26T05:09:03.112Z.

## Head-to-head

Win/loss is points-threshold (bid = 160). No draws are possible.

| Opponent | Games | Wins | Losses | Avg points diff |
|---|---|---|---|---|
| b0-random | 20 | 15 | 5 | +73.5 |
| b1-high-low | 20 | 9 | 11 | -13.6 |
| b2-memo-high-low | 20 | 9 | 11 | -15.3 |
| b3-heuristic | 20 | 11 | 9 | +6.8 |
| b0-random | 20 | 15 | 5 | +34.3 |
| b1-high-low | 20 | 10 | 10 | +4.9 |
| b2-memo-high-low | 20 | 11 | 9 | -1.9 |
| b3-heuristic | 20 | 12 | 8 | +24.7 |
| b5-csp-search | 20 | 9 | 11 | +3.3 |
| b5-csp-search | 20 | 12 | 8 | -1.5 |

## Rationale for rating

Targets ~1700. Builds an info-set, samples ~32 consistent worlds, picks the play with the best expected single-trick value across the sample. The first bot that genuinely reads opponent voids and exhaustions.
