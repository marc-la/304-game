---
title: 304dle — Asymmetric verdicts and a streak that means something
status: OPEN (2026-07-26). Depends on caps-par-authority; overlaps decoy-days.
owns: apps/304dle/scoring.ts, apps/304dle/storage.ts, apps/304dle/components/ResultScreen.tsx
depends_on: caps-par-authority-handoff.md
---

# Goal

Make the four outcomes carry different weight, in the direction the
rulebook already specifies, so that guessing early stops being a
reasonable strategy.

# State of play

`apps/304dle/scoring.ts`: `extendsStreak = correct && difficulty !== 'trivial'`.
Late, early and missed are therefore **identical outcomes** — all reset
the streak to zero.

The rules disagree. `docs/specs/rules.md` H-12: Late Caps = loss + 1
stone; Early and Wrong Caps = 5 stone each. Soul §IV.8 asks that calling
caps wrong hurt more than calling it right rewards. With symmetric
downside and a narrow par band, guessing early is weakly dominant —
the scoring currently teaches the inverse of the rulebook.

Marc's ruling this session, which the model must not soften: **early
caps is a guess and dies like one — no strikes, no leniency.** The
gradient belongs on the *late* side, which is the honest failure (you
read it, slowly) rather than the gamble.

Also decided: `missed` should merge into `late`. `caps_formalism.md`
§8.4 already classifies "no call made, S* existed, team swept" as Missed
**Late** — the code mints a separate verdict the formalism does not have.

Also live: the daily currently has one streak, extended only by a
correct non-trivial call. If Late is the modal outcome, that streak sits
at zero forever and the day-40 contract is empty. NYT ships two streaks
(played vs solved) for exactly this reason.

# Recommended approach

Par-delta ladder on the late side, hard stop on the early side:

- called within the lenient window of `S*` → **Caps**
- one own-play past it → still a win, but marked
- two or more → **Late**, graded by distance
- never called, `S*` existed → **Late** (merged from `missed`)
- called with no `S*` → **Early**, terminal, no gradient
- (with decoy days) declined correctly → win

Two counters rather than one: a *days played* streak that any completed
run extends, and a *caps* streak that only an on-par call extends.

Note the interaction with `gradeDifficulty`: it bands on worlds-at-call
(1000/100/10), and round-boundary world counts fall roughly 34,650 →
1,680 → 90 across R4→R6. So "difficulty" is largely *when you called* in
disguise. Either derive it from something else or drop it; do not
present it as a skill signal while it is a clock.

# Validation gate

- No strategy that ignores the cards beats a materially better rate than
  chance. Measure it: replay the shipped window under fixed-round
  policies and report the verdict distribution.
- Early and Late produce visibly different outcomes and different streak
  consequences.
- `apps/304dle/__tests__/runtime.test.ts` verdict tests updated and green.
- Result copy states *why* in one sentence, per the standing decision to
  keep the standard exact but always show the proof.

# Hard constraints

- Do not weaken the obligation predicate to make verdicts feel kinder.
  The standard stays exact; the *explanation* is what improves.
- Streak state lives in `localStorage` (`apps/304dle/storage.ts`,
  schema-versioned) — bump the version on any shape change.
- No emoji share grid, no stat table on the result screen; both were
  removed deliberately as unreadable.

# Reading list

- `apps/304dle/scoring.ts`, `apps/304dle/storage.ts`.
- `docs/specs/rules.md` §C-3 to §C-7 and the H-12 house-rule row.
- `docs/specs/caps_formalism.md` §8.
- `.claude/soul.md` §IV.8, §IV.11.
