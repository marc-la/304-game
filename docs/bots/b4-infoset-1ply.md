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

_Not yet measured — run `npm run bots:tournament` to populate._

## Rationale for rating

Targets ~1700. Builds an info-set, samples ~32 consistent worlds, picks the play with the best expected single-trick value across the sample. The first bot that genuinely reads opponent voids and exhaustions.
