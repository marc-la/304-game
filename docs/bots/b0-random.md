# Random (`b0-random`)

Picks uniformly from legal plays. Anchor for ELO calibration.

## Strengths

- blazing fast
- no state
- true baseline

## Limitations

- no follow-suit preference beyond legality
- no trick awareness
- no card memory

## Complexity

- Time: `O(L)`
- Space: `O(1)`
- Deterministic: true

## Rating

Glicko-2: **1336** ± 37  (volatility 0.0600)

Measured from a round-robin tournament — 10 games per pairing, 1 rating period(s), generated 2026-05-26T05:09:03.112Z.

## Head-to-head

Win/loss is points-threshold (bid = 160). No draws are possible.

| Opponent | Games | Wins | Losses | Avg points diff |
|---|---|---|---|---|
| b1-high-low | 20 | 8 | 12 | -27.2 |
| b2-memo-high-low | 20 | 9 | 11 | -32.9 |
| b3-heuristic | 20 | 9 | 11 | -1.2 |
| b4-infoset-1ply | 20 | 5 | 15 | -73.5 |
| b5-csp-search | 20 | 4 | 16 | -64.9 |
| b1-high-low | 20 | 7 | 13 | -27.4 |
| b2-memo-high-low | 20 | 8 | 12 | -22.0 |
| b3-heuristic | 20 | 8 | 12 | -19.9 |
| b4-infoset-1ply | 20 | 5 | 15 | -34.3 |
| b5-csp-search | 20 | 5 | 15 | -89.1 |

## Rationale for rating

Anchor at 1000 by Glicko-2 convention. By construction this is the noise floor — any other bot above 1000 demonstrates measurable play strength.
