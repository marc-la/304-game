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

_Not yet measured — run `npm run bots:tournament` to populate._

## Rationale for rating

Targets ~1900. Two-ply expectimax over a sample of worlds, with a caps-aware override: when caps is obligated, plays the engine's witness-line first card. Near-perfect on caps-callable states; depth-limited so deep tactics may slip through.
