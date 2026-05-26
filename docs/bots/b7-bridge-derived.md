# Bridge-Derived (`b7-bridge-derived`)

Spike port of single-dummy expectation-search ideas from bridge (Frank/Basin 1998, Ginsberg 2001 GIB). Sample-then-DDS hybrid with a richer move ordering than B6.

## Strengths

- principled from the bridge literature
- best move ordering

## Limitations

- experimental — limited tuning
- similar cost to B6

## Complexity

- Time: `O(N·DDS)`
- Space: `O(N)`
- Deterministic: true

## Rating

_Not yet measured — run `npm run bots:tournament` to populate._

## Rationale for rating

Experimental. Adapts move-ordering and per-candidate fresh-sampling ideas from the bridge single-dummy literature (Frank/Basin 1992; Ginsberg 2001). Time-boxed spike; rating is whatever the tournament returns.
