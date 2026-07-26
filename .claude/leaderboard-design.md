---
title: Leaderboard Domain — Design Spec
status: binding for all leaderboard-surface work
purpose: the unified visual + information-design contract for the leaderboard pages (dashboard, history, insights). Any session that touches these pages reads this first. Produced from a seven-agent cross-examination (visual design, data communication, IA/navigation, history UX, rules fitness, CSS audit, directory audit) on 2026-07-26.
---

# Leaderboard design spec

**The concept: the ledger, not the dashboard.** The leaderboard is the friend
group's whiteboard, codified — a scorekeeper's ledger in the site's editorial
voice. It must read as the same site as `index.html` (serif display voice, warm
ground, one accent), not as a bolted-on SaaS analytics panel. The Reid-library
whiteboard (soul §IV.12) is the styling north star for anything that renders
betting notation.

## 1. Page structure

Three flat pages + a redirect. One question per page:

| Page | Question it answers | Scroll contract |
|---|---|---|
| `site/leaderboard.html` | "Who's winning, what happened last session?" | **No vertical scroll** at default zoom on portrait phones (390×844) and desktop. Bends: landscape phones scroll; 200% zoom scrolls; `overflow:hidden` is banned — no-scroll is a layout goal, never an enforcement. |
| `site/leaderboard-history.html` | "What exactly happened, when?" (the archive) | Scrolls; default view = current season, older seasons collapsed. |
| `site/leaderboard-insights.html` | "How do we each play?" (bet-sheet resolution) | Scrolls, but aim for ≤ 2 viewports of content. |
| `site/stats.html` | redirect to `leaderboard.html` (old links). | — |

Sub-navigation: a **segmented control** (sentence-case, bordered, in the content
column — deliberately a *different visual grammar* from the uppercase global
nav so page-nav and site-nav can't be confused). Links are real `<a>` pages with
`aria-current="page"`. No H1 stack: no "Leaderboard" title, no subtitle — the
segmented control plus a right-aligned "updated 25 Jul" meta line IS the header.

## 2. Data rules

- **Source**: build-time pipeline (`tools/leaderboard/build-data.ts`) parses
  `data/stats.xlsx` + `data/bets/*.csv` → `site/public/data/leaderboard.json`
  (gitignored, regenerated every dev/build). Pages fetch that JSON only. No
  SheetJS, no Chart.js, no CDN scripts on any leaderboard page.
- **Seasons** are data-driven: a revolution whose Notes match `/SEASON (\d+)
  START/i` begins that season. Never hard-code a season boundary.
- **Scope honesty is non-negotiable.** Bet-sheet stats (caps, penalties, bet
  mix, stone ledgers) cover only revolutions with a CSV. They live on the
  insights page under an explicit coverage banner ("Betting-sheet resolution:
  N of M revolutions") and never sit beside all-time stats without a label.
  Counts, not percentages, while n is small.
- **Ranking rule** (revolutions won → matches won → stone) is stated in
  microcopy wherever a ranking is shown. Tied revolution wins credit every
  tied player; if a sum can visibly exceed the revolution count, say so.
- Killed stats — do not resurrect: Total Score (placement points), Best
  Partner, the cumulative partnership-over-time chart (converges by
  construction), per-card "i" tooltip essays.

## 3. Colour

Roles, not hues. Player identity is the **only categorical palette**; nothing
else may reuse its hues on the same surface.

```
/* Player palette — validated (dataviz six-checks) 2026-07-26.
   Light validated on cream #f4ecd8, dark on card #251812.
   All pairs CVD ΔE ≥ 9.7, contrast ≥ 3:1, in-band lightness. */
--player-LX: #bf4b26;  /* light */   --player-LX: #d4693d;  /* dark */
--player-ML: #00836b;               --player-ML: #289a8a;
--player-MN: #9a6b00;               --player-MN: #bd8a26;
--player-VM: #2963a5;               --player-VM: #5f92cf;
```

- Player hue appears as **fills, swatches, pills, line strokes — never body
  text** (text wears text tokens; a mark beside it carries identity).
- The winner of a revolution keeps their **player colour**; winning is marked
  by one glyph (★), never by a colour override. Never re-encode one fact twice.
- `--clr-accent` (cinnabar) is **interactive-only**: links, active states,
  filters. Never on data. This is what frees LX's sienna from ambiguity.
- Outcomes get exactly **two inks**: win = `--clr-house` green, loss = one
  red. Severity (wrong caps, PCC) is carried by notation weight (bold,
  strike, ×-mark), not by extra hues.
- No gradients anywhere in the leaderboard domain. No medal metals. 1st place
  may carry a single flat gilt mark.
- If a chart needs a palette change, re-run
  `dataviz/scripts/validate_palette.js` against the real surface — never
  eyeball it.

## 4. Type & rhythm

Three voices, total:

1. **Crimson Pro (serif)** — page-level and section headings. This reunifies
   the leaderboard with the index's editorial voice.
2. **Inter** — labels and UI copy, one micro-label size (0.75rem tracked
   uppercase) used sparingly. Labels never shout louder than data.
3. **JetBrains Mono** — **every numeral**: scores, percentages, tallies, axis
   ticks, the `2·27` notation. Tabular where columns align.

Spacing on an 8px grid (8/16/24/32/48). One corner radius: **6px** (999px only
for the segmented control / filter pills). Cards are flat: 1px `--clr-border`,
no shadows, no hover-lift transforms.

## 5. Components

- **Stat tiles (dashboard standings)**: 4 ranked tiles/rows. Hero figure =
  revolutions won (mono, dominant, ≥40px desktop). Secondary = match win %
  with a thin inked bar (magnitude encoding, baseline-anchored). Trend =
  recent-form pips (last 5 placements, oldest left; win pip gets the star
  ring). One microcopy line under the block states the ranking rule.
- **The race chart** (dashboard): hand-rolled inline SVG. Cumulative
  revolutions won, **stepped** line (counts are steps, not curves), player
  strokes 2px, direct labels at line ends (name + count) — no legend box
  needed beyond them, x-axis = revolution index with sparse date ticks,
  gridlines hairline `--clr-border` at low opacity, **vertical season divider
  rules** labelled S1/S2. The race chart always shows all-time; it never
  filters by season. Hover: crosshair + shared tooltip.
- **Partnership list** (dashboard): one compact ranked bar list, 6 rows: two
  player swatch dots + names, thin bar = win rate, faint reference rule at
  50%, direct `20–10` label. Caption once: "each pair has played ~31
  matches." Never six identical cards.
- **Season control**: `[Season 2 | Season 1 | All-time]` segmented toggle in
  the dashboard context strip; re-filters tiles + partnership list in place.
  Default = current season. Persist in URL hash.
- **History rows**: winner-first (`★ Name` in player colour), then a slim
  ordered run of the rest (`Marc 2·26 › Matthew 2·26 › Vithu 0·19`). The
  `n·m = matches won · stone` gloss appears once per page. Collapsed rows
  carry **event badges** parsed from the bet CSV (`250−`, `PCC`, `−W`,
  `PN×3`) and a `3 sets · sheet ✓ / no sheet` tail — information scent before
  expansion. Revolutions are linkable (URL hash); filters toggle `hidden`,
  never re-render (open state survives).
- **The bet sheet** (history): styled as the whiteboard artifact, not a data
  grid — mono notation as cell text, faint ruled lines, columns truncated at
  the last played round, empty cells as blank paper (no borders), team
  grouping by player-swatch pairs (never accent/link-colour borders), the
  CSV's OVERALL block rendered as the sheet footer, one collapsible
  **legend** pinned per page (grammar: `60` won · `60−` lost · `+1` early
  caps · `−L` late · `−W` wrong · `PCC` · `PN` · `H` honest). Tooltips
  reinforce, never sole channel (mobile has none).
- **Insights profiles**: one card per player — bets/set, bid-mix as a single
  sequential-ramp stacked bar over the ladder 60→70→H→100→250→PCC (ordered
  scale ⇒ one hue light→dark, darker = more aggressive), conversion counts,
  caps ledger strip (+1/+0/−L/−W), penalties. Plus: stone ledger table with
  inline bars, and the **event log** (every 250, PCC, −W, with date + set —
  the canon generator). AI play-style one-liners (from
  `data/player-styles.json`, when present) render under each profile card.

## 6. Theming mechanics (site-wide, affects these pages)

- Dark surfaces are a strict two-level hierarchy: page `--clr-bg`, raised
  `--clr-surface` (+ `--clr-surface-elev` for table heads/modals only). Do not
  invent new browns.
- `color-scheme` must track `data-theme`
  (`:root[data-theme="dark"] { color-scheme: dark }` etc.) so scrollbars and
  overscroll match a forced theme.
- Anything reading tokens into JS (chart strokes) re-reads on theme change
  (`data-theme` MutationObserver + `prefers-color-scheme` listener).

## 7. Forbidden list

1. CDN script tags on leaderboard pages.
2. Chart.js default anything (rotated 45° tick labels, bottom dot-legends).
3. Podium/medal treatments for a population of four.
4. A colour that means two things on one screen.
5. Tooltip-essay explanations — if a stat needs a paragraph, it's the wrong
   stat.
6. Mixed-coverage numbers (bet-sheet stats beside all-time stats, unlabelled).
7. `overflow: hidden` as a no-scroll enforcement.
8. Re-rendering the history tree on filter (loses open state).
