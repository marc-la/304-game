---
title: 304dle — Decoy supply (deals that look exactly like caps and are not)
status: OPEN (2026-08-04). Supersedes decoy-days-handoff.md. Depends on caps-par-authority.
owns: tools/puzzles/generate-scripted.ts, tools/curator/, tools/puzzles/verify-caps.ts
depends_on: caps-par-authority-handoff.md (hard), run-structure-handoff.md (frames it)
---

# Goal

Generate the deals that are *not* caps. In the run design these are no
longer a garnish — at `p = 0.45` they are **~55% of every deal the player
ever sees**. A weak decoy is not a wasted puzzle; it is a tell that
trains the player to skip deals without reading.

Marc's requirement, in his words: *"all the rounds are difficult in that
there is possible caps in the non-caps rounds."* A decoy has to be a deal
where calling caps is a genuinely reasonable read that happens to be
wrong.

# State of play

This handoff replaces `decoy-days-handoff.md` (deleted 2026-08-04; see
git log). Its findings survive intact and now matter more:

- **Do not build decoys as visible non-sweeps.** A hand where the
  opposition takes an early trick announces itself the moment the trick
  pile ticks over, and both piles are rendered
  (`apps/304dle/components/Table.tsx`). The adapted exploit — "call
  unless they've taken a trick" — scores *better* than doing nothing.
- **Build them as hands that sweep through the par window and break at
  R7/R8.** Visually identical to a caps deal for the whole decision
  period.
- **Supply is favourable.** Initial-run-length over ~6000 bot games:
  run=6 at 4.2%, run=7 at 3.0% (7.2% combined) versus sweeps at 3.2%.
  Decoys are ~2.2x more plentiful than caps deals, and the run needs
  them at ~1.2:1. Supply is not the binding constraint; **quality is.**

Nothing is built.

# The oracle bug — read this before writing the filter

The superseded decoy-days plan specified: *"run the decoys through
`checkCapsObligation` at every event state and assert never true."*

**That filter is unsound and will ship mislabelled deals.** The CSP in
`engine/caps-csp.ts` is a shared-pool relaxation that **under-claims**
(see `caps-par-authority-handoff.md`): it returns "not obligated" on
states where the truth is obligated — confirmed on 2026-08-02 and
2026-08-14. Filtering decoys by "the CSP never said obligated" therefore
admits deals that genuinely *are* caps. A player who reads one correctly
and calls it gets killed for being right.

At ~15% of days that was a slow leak. At ~55% of deals it is the
dominant failure mode of the whole design.

**Certify decoys with the offline verifier (`tools/puzzles/verify-caps.ts`
semantics), never with the runtime CSP.** This is the same authority
`caps-par-authority-handoff.md` makes par depend on, applied to the
mirror claim. Certification is also the cheap direction: proving *not
obligated* needs one refuting world exhibited, where proving *obligated*
needs the full sweep over all of them.

# Temptation — the metric that makes a decoy worth playing

Caps deals are graded by **labour** (how many observations are
load-bearing). Decoys need the mirror: **how nearly it was caps.**

At each event state `s`, let `W(s)` be the worlds consistent with south's
information set and `R(s)` the subset in which south does *not* sweep.
Obligation is `R(s) = 0`; a decoy has `R(s) > 0` everywhere. Define

```
temptation(deal) = max over s of [ 1 − R(s)/W(s) ]
```

A decoy where 34,649 of 34,650 worlds sweep scores 0.99997 and is
brutal. One where a third of worlds refute is a non-event and should be
rejected.

Second metric, and the more important one: **`refutationWidth`** — the
number of card-placement facts needed to characterise `R(s)` at the
tempting state. A decoy that fails because *"east could still hold the
♦Q"* has width 1. That is a good puzzle, because there is a nameable
reason it was not caps — which is exactly what the post-run reveal needs
to say, and what lets the player learn something instead of shrugging.
A decoy refuted by a diffuse cloud of unrelated placements teaches
nothing.

Proposed thresholds, to be tuned against real output: `temptation ≥ 0.95`,
`refutationWidth ≤ 2`. Expect to move these; do not lower them to make a
run finish (the same rule `minLabour` already lives under).

# Recommended approach

Emit both kinds from one pipeline, since they come from the same match
collection — a game is classified by its initial run length, not
generated differently. Then:

1. Collect matches as today (`tools/puzzles/match-collector.ts` already
   exposes run length).
2. Route run=8 sweeps to the caps-deal funnel (existing).
3. Route run∈{6,7} to the decoy funnel (new).
4. **Mandatory exclusion:** of games with run ≥ 4, a minority *were*
   caps-obligated at some point before breaking. Those are caps deals
   that later collapsed, not decoys. Exclude via the offline verifier.
5. Score surviving decoys on `temptation` / `refutationWidth`, keep the
   top band.
6. Assemble runs: draw depth from the geometric, take that many decoys
   plus one caps deal. Decoys within a run should not repeat a shape —
   two consecutive decoys refuted by the same suit is a pattern the
   player will learn.

# Cost, stated plainly

This roughly triples generation work: ~2.2 deals per day instead of one,
plus a decoy funnel that does not exist, plus world-counting for
`temptation` which the caps funnel never needed. Counting `R(s)` is
strictly more expensive than exhibiting one witness, and it is why
`dds-transposition-handoff.md` moves from optional to load-bearing.
Budget for it; do not discover it mid-run.

# Validation gate

- **No decoy is obligated at any event state, verified offline.** Not by
  `checkCapsObligation`. This is the gate that protects correct players.
- Accepted decoys meet the temptation and width thresholds, checked by
  inspecting emitted files, not by trusting a counter.
- A decoy is visually indistinguishable from a caps deal through the end
  of R6: the opposition pile stays empty until R7 at the earliest.
- Replay legality holds end-to-end — `applyScriptedPlay` validates every
  play against `legalPlays`, so a window-wide replay test is a real audit.
- Sample ten decoys and write out, in one sentence each, why it was not
  caps. If that sentence cannot be written, `refutationWidth` is not
  doing its job.

# Hard constraints

- Certification is offline-verifier only (see the oracle bug above).
- Do not implement decoys as visible non-sweeps.
- `caps_formalism.md` §257–262 holds on both sides: partner is
  adversarial wherever they have discretion. A decoy that is "not caps"
  only because partner would have to cooperate is **not** a decoy — it is
  the 2026-08-03 case, and it is correctly not obligated.
- Determinism unchanged.

# Reading list

- `docs/handoffs/run-structure-handoff.md` — the design this serves.
  (`decoy-days-handoff.md` is deleted; its exploit analysis is reproduced
  above and is the reasoning to preserve.)
- `tools/puzzles/generate-scripted.ts` — acceptance funnel, `findObligation`.
- `tools/puzzles/match-collector.ts` — run length.
- `tools/puzzles/verify-caps.ts` — the only sound oracle here.
- `docs/specs/caps_formalism.md` §5, §7, §8.
