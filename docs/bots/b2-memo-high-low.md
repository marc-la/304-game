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

_Not yet measured — run `npm run bots:tournament` to populate._

## Rationale for rating

Targets ~1350. Adds card-memory: knows which cards are out, so avoids leading or overspending a star (J/9/A) when that star is already the high-of-suit and will dominate later. Closes the obvious gifts that B1 hands out.
