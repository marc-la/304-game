# Heuristic (`b3-heuristic`)

The existing engine bot. Star-spend thresholds, partner-aware sluff, cut-when-rich, longest-non-trump lead. Used by the existing puzzle curator as the L4 baseline.

## Strengths

- tuned for caps non-triviality
- preserves J/9/A under threshold
- partner-aware

## Limitations

- hand-tuned numbers
- no deep lookahead

## Complexity

- Time: `O(L + H)`
- Space: `O(1)`
- Deterministic: true

## Rating

Glicko-2: **1510** ± 37  (volatility 0.0600)

Measured from a round-robin tournament — 10 games per pairing, 1 rating period(s), generated 2026-05-26T05:09:03.112Z.

## Head-to-head

Win/loss is points-threshold (bid = 160). No draws are possible.

| Opponent | Games | Wins | Losses | Avg points diff |
|---|---|---|---|---|
| b0-random | 20 | 11 | 9 | +1.2 |
| b1-high-low | 20 | 9 | 11 | -7.6 |
| b2-memo-high-low | 20 | 12 | 8 | +3.5 |
| b0-random | 20 | 12 | 8 | +19.9 |
| b1-high-low | 20 | 12 | 8 | +21.6 |
| b2-memo-high-low | 20 | 11 | 9 | -9.6 |
| b4-infoset-1ply | 20 | 9 | 11 | -6.8 |
| b5-csp-search | 20 | 10 | 10 | +6.8 |
| b4-infoset-1ply | 20 | 8 | 12 | -24.7 |
| b5-csp-search | 20 | 8 | 12 | -31.7 |

## Rationale for rating

Targets ~1500. The pre-existing engine bot with star-spend thresholds (J ≥ 18, 9 ≥ 10, A ≥ 8 points on table), partner-aware sluff, opportunistic cut-when-rich, longest-non-trump lead. The existing puzzle curator's L4 baseline.
