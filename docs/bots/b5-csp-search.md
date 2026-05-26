# CSP Search (`b5-csp-search`)

Reuses the caps-csp constraint machinery to run depth-limited adaptive minimax: caller branches existentially, opps universally over consistent legal plays.

## Strengths

- finds adaptive lines
- near-perfect on caps-callable states

## Limitations

- slow per move
- depth-limited; misses deep tactics

## Complexity

- Time: `O(B^d)`
- Space: `O(d)`
- Deterministic: true

## Rating

Glicko-2: **1572** ± 37  (volatility 0.0600)

Measured from a round-robin tournament — 10 games per pairing, 1 rating period(s), generated 2026-05-26T05:09:03.112Z.

## Head-to-head

Win/loss is points-threshold (bid = 160). No draws are possible.

| Opponent | Games | Wins | Losses | Avg points diff |
|---|---|---|---|---|
| b0-random | 20 | 16 | 4 | +64.9 |
| b1-high-low | 20 | 11 | 9 | +2.0 |
| b2-memo-high-low | 20 | 9 | 11 | -3.8 |
| b3-heuristic | 20 | 10 | 10 | -6.8 |
| b4-infoset-1ply | 20 | 11 | 9 | -3.3 |
| b0-random | 20 | 15 | 5 | +89.1 |
| b1-high-low | 20 | 11 | 9 | +7.6 |
| b2-memo-high-low | 20 | 11 | 9 | +23.7 |
| b3-heuristic | 20 | 12 | 8 | +31.7 |
| b4-infoset-1ply | 20 | 8 | 12 | +1.5 |

## Rationale for rating

Targets ~1900. Two-ply expectimax over a sample of worlds, with a caps-aware override: when caps is obligated, plays the engine's witness-line first card. Near-perfect on caps-callable states; depth-limited so deep tactics may slip through.
