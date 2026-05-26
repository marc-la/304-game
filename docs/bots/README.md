# 304 Bot Zoo

Deterministic play-only bots used to generate 304dle puzzles and to benchmark each other via a round-robin Glicko-2 tournament.

_Run `npm run bots:tournament` then `npm run bots:docs` to populate._

## Bots

- [Random](b0-random.md) — Picks uniformly from legal plays. Anchor for ELO calibration.
- [High-Low](b1-high-low.md) — If a played card can win this trick at the moment of play, plays cheapest winner; else lowest-points sluff.
- [Memo High-Low](b2-memo-high-low.md) — B1 + tracks which cards have already been played. Will commit a star when guaranteed-best, will sluff when out-class is certain.
- [Heuristic](b3-heuristic.md) — The existing engine bot. Star-spend thresholds, partner-aware sluff, cut-when-rich, longest-non-trump lead. Used by the existing puzzle curator as the L4 baseline.
- [InfoSet 1-Ply](b4-infoset-1ply.md) — Builds an info-set, samples consistent worlds, evaluates each legal play's expected round outcome 1 ply ahead, picks the best EV.
- [CSP Search](b5-csp-search.md) — Reuses the caps-csp constraint machinery to run depth-limited adaptive minimax: caller branches existentially, opps universally over consistent legal plays.
- [DDS Monte Carlo](b6-dds-mc.md) — Ginsberg-GIB-style: sample N consistent worlds, double-dummy each, pick the play with highest EV across the sample. Reference "expert" play.
- [Bridge-Derived](b7-bridge-derived.md) — Spike port of single-dummy expectation-search ideas from bridge (Frank/Basin 1998, Ginsberg 2001 GIB). Sample-then-DDS hybrid with a richer move ordering than B6.
