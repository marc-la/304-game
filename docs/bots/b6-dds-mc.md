# DDS Monte Carlo (`b6-dds-mc`)

Ginsberg-GIB-style: sample N consistent worlds, double-dummy each, pick the play with highest EV across the sample. Reference "expert" play.

## Strengths

- strongest play overall
- handles complex positions
- best caps detection

## Limitations

- expensive per move (~100–500 ms)
- Monte-Carlo variance on small N

## Complexity

- Time: `O(N·DDS)`
- Space: `O(N)`
- Deterministic: true

## Rating

_Not yet measured — run `npm run bots:tournament` to populate._

## Rationale for rating

Targets ~2050. Ginsberg-GIB style: sample N worlds, full double-dummy each, pick the play with highest mean future-trick count. Reference "expert" play under the open-trump model; the ceiling we can build without bridge-library imports.
