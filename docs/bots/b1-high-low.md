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

_Not yet measured — run `npm run bots:tournament` to populate._

## Rationale for rating

Targets ~1200. Plays legal cards, picks cheapest winner when one exists. No memory or signaling. Beats random consistently because losing cheaply is itself a competence; but no across-trick reasoning.
