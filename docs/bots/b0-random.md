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

_Not yet measured — run `npm run bots:tournament` to populate._

## Rationale for rating

Anchor at 1000 by Glicko-2 convention. By construction this is the noise floor — any other bot above 1000 demonstrates measurable play strength.
