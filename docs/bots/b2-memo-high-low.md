# Memo High-Low (`b2-memo-high-low`)

B1 + tracks which cards have already been played. Will commit a star when guaranteed-best, will sluff when out-class is certain.

## Strengths

- closes obvious gifts
- won't over-spend a J that already dominates

## Limitations

- no info-set deduction across suits
- cannot reason about partner's hand

## Complexity

- Time: `O(L + H)`
- Space: `O(P)`
- Deterministic: true

## Rating

Glicko-2: **1500** ± 37  (volatility 0.0600)

Measured from a round-robin tournament — 10 games per pairing, 1 rating period(s), generated 2026-05-26T05:09:03.112Z.

## Head-to-head

Win/loss is points-threshold (bid = 160). No draws are possible.

| Opponent | Games | Wins | Losses | Avg points diff |
|---|---|---|---|---|
| b0-random | 20 | 11 | 9 | +32.9 |
| b1-high-low | 20 | 10 | 10 | +0.0 |
| b0-random | 20 | 12 | 8 | +22.0 |
| b1-high-low | 20 | 10 | 10 | +0.0 |
| b3-heuristic | 20 | 8 | 12 | -3.5 |
| b4-infoset-1ply | 20 | 11 | 9 | +15.3 |
| b5-csp-search | 20 | 11 | 9 | +3.8 |
| b3-heuristic | 20 | 9 | 11 | +9.6 |
| b4-infoset-1ply | 20 | 9 | 11 | +1.9 |
| b5-csp-search | 20 | 9 | 11 | -23.7 |

## Rationale for rating

Targets ~1350. Adds card-memory: knows which cards are out, so avoids leading or overspending a star (J/9/A) when that star is already the high-of-suit and will dominate later. Closes the obvious gifts that B1 hands out.
