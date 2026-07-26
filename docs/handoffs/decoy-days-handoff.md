---
title: 304dle — Decoy days (make "should I call at all?" a live question)
status: OPEN (2026-07-26). Depends on caps-par-authority landing first.
owns: tools/puzzles/generate-scripted.ts (acceptance), apps/304dle/store.ts (verdicts)
depends_on: caps-par-authority-handoff.md
---

# Goal

Stop guaranteeing that a caps exists. Today every puzzle is a sweep by
construction, so the player knows before the deal that a call is coming
and only has to guess *when*.

# State of play

Marc approved ~15% no-caps days in principle; unbuilt. The measured
problem it addresses: pressing Call Caps at the end of R5 every day,
reading nothing, scored 11–12 of 24 on the shipped window. (That figure
predates the par fixes and is stale — **re-measure before using it as a
baseline**.) The day carries ~1.46 bits of answer; Wordle carries 11.2.

The important refinement, from adversarial analysis: **the naive
implementation makes things worse.** A no-caps day built as a non-sweep
announces itself the moment the opposition's trick pile ticks over, and
both piles are rendered (`apps/304dle/components/Table.tsx`). The adapted
exploit — "call R5 unless they've taken a trick" — scores *better* than
today.

What works instead: **hands that are still sweeping through the par
window and break at R7/R8.** Visually identical to a caps day for the
whole decision period. Natural supply is favourable — initial-run-length
measurements over ~6000 bot games: run=6 at 4.2%, run=7 at 3.0%
(7.2% combined) versus sweeps at 3.2%. So decoys are roughly 2.2x more
plentiful than the puzzles being generated today.

One filter is mandatory: of games with run ≥ 4, a minority *were*
caps-obligated at some point before breaking. Those must be excluded or
they are simply mis-labelled caps days.

# Recommended approach

Emit two puzzle kinds from the same pipeline and shuffle them into the
window. Add a player-facing **"No caps"** commit so declining is an
action rather than an absence — today running out of cards yields
`missed`, which reads as a failure rather than a correct read.

Verdict set becomes a 2x2: called/declined against caps-existed/not.
Correct declination is a **win**. Getting the mix right matters more
than the exact number: with obligation uniform over a band of width `w`
and a caps-day fraction `q`, the best cardless strategy scores
`max(1-q, q/w)`, minimised at `q = w/(w+1)`.

Grade a declined day only when it was *tempting* — a decoy where a call
was never plausible is a non-event and should not extend or break a
streak. "Plausible" wants a concrete definition; a workable one is the
number of round boundaries at which the refuting-world count was small.

Known tension to resolve, not paper over: this breaks the redeal loop
that soul §VI.3 mandates. For a "when" puzzle, replaying the same hand is
a fair second attempt. For a "whether" puzzle, the first attempt gives
the answer away completely. Either the verdict becomes final for the
day, or redeal must serve a *sibling* deal of the same shape and
different truth value.

# Validation gate

- Generated windows contain both kinds in the intended ratio, verified
  by inspecting the emitted files (not by trusting a counter).
- No decoy is ever caps-obligated at any round: run the decoys through
  `checkCapsObligation` at every event state and assert never true.
- The cardless baseline (always call at the modal round) drops
  materially — measure it, don't assume it.
- A decoy day is visually indistinguishable from a caps day through the
  end of R6: the opposition pile stays empty until R7 at the earliest.

# Hard constraints

- **Soul amendment required.** §VI.3 says every position is constructed
  so "the cap is callable — *when, not if*". This directly contradicts
  it. Coordinate with `soul-amendments-handoff.md`; do not ship the
  mechanic while the constitution says the opposite.
- Do not implement no-caps days as visible non-sweeps (see above).
- Determinism unchanged.

# Reading list

- `tools/puzzles/generate-scripted.ts` — acceptance funnel, `findObligation`.
- `tools/puzzles/match-collector.ts` — where run length is observable.
- `apps/304dle/store.ts` — `submitCaps`, `skipCapsToResult` (the current
  `missed` path).
- `apps/304dle/scoring.ts` — verdict kinds.
- `.claude/soul.md` §VI.3.
