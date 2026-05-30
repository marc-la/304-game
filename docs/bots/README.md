# 304 Bot Zoo

Deterministic play-only bots used to generate 304dle puzzles and to benchmark each other via a round-robin Glicko-2 tournament.

## Leaderboard (2026-05-26T05:09:03.112Z)

| # | Bot | Rating | RD |
|---|---|---|---|
| 1 | [b5-csp-search](b5-csp-search.md) | 1572 | ± 37 |
| 2 | [b4-infoset-1ply](b4-infoset-1ply.md) | 1567 | ± 37 |
| 3 | [b1-high-low](b1-high-low.md) | 1515 | ± 37 |
| 4 | [b3-heuristic](b3-heuristic.md) | 1510 | ± 37 |
| 5 | [b2-memo-high-low](b2-memo-high-low.md) | 1500 | ± 37 |
| 6 | [b0-random](b0-random.md) | 1336 | ± 37 |

## Bots

- [Random](b0-random.md) — Picks uniformly from legal plays. Anchor for ELO calibration.
- [High-Low](b1-high-low.md) — If a played card can win this trick at the moment of play, plays cheapest winner; else lowest-points sluff.
- [Memo High-Low](b2-memo-high-low.md) — B1 + tracks which cards have already been played. Will commit a star when guaranteed-best, will sluff when out-class is certain.
- [Heuristic](b3-heuristic.md) — The existing engine bot. Star-spend thresholds, partner-aware sluff, cut-when-rich, longest-non-trump lead. Used by the existing puzzle curator as the L4 baseline.
- [InfoSet 1-Ply](b4-infoset-1ply.md) — Builds an info-set, samples consistent worlds, evaluates each legal play's expected round outcome 1 ply ahead, picks the best EV.
- [CSP Search](b5-csp-search.md) — Reuses the caps-csp constraint machinery to run depth-limited adaptive minimax: caller branches existentially, opps universally over consistent legal plays.
- [DDS Monte Carlo](b6-dds-mc.md) — Ginsberg-GIB-style: sample N consistent worlds, double-dummy each, pick the play with highest EV across the sample. Reference "expert" play.
