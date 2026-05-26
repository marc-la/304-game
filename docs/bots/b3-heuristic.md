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

_Not yet measured — run `npm run bots:tournament` to populate._

## Rationale for rating

Targets ~1500. The pre-existing engine bot with star-spend thresholds (J ≥ 18, 9 ≥ 10, A ≥ 8 points on table), partner-aware sluff, opportunistic cut-when-rich, longest-non-trump lead. The existing puzzle curator's L4 baseline.
