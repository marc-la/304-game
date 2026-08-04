---
title: 304dle — Run-shaped verdicts and a streak that means something
status: OPEN (2026-08-04, reframed for the run). Depends on caps-par-authority and run-structure.
owns: apps/304dle/scoring.ts, apps/304dle/storage.ts, apps/304dle/components/ResultScreen.tsx
depends_on: caps-par-authority-handoff.md, run-structure-handoff.md
---

# Goal

Make the outcomes carry different weight, in the direction the rulebook
already specifies, so that guessing stops being a reasonable strategy —
now across a run of deals rather than one.

# State of play

`apps/304dle/scoring.ts`: `extendsStreak = correct && difficulty !== 'trivial'`.
Late, early and missed are therefore **identical outcomes** — all reset
the streak to zero.

The rules disagree. `docs/specs/rules.md` H-12: Late Caps = loss + 1
stone; Early and Wrong Caps = 5 stone each. Soul §IV.8 asks that calling
caps wrong hurt more than calling it right rewards. With symmetric
downside and a narrow par band, guessing early is weakly dominant — the
scoring currently teaches the inverse of the rulebook.

Two rulings from earlier sessions stand and must not be softened:

- **Early caps is a guess and dies like one** — no strikes, no leniency.
  The gradient belongs on the *late* side, which is the honest failure
  (you read it, slowly) rather than the gamble.
- **`missed` merges into `late`.** `caps_formalism.md` §8.4 already
  classifies "no call made, S* existed, team swept" as Missed **Late**;
  the code mints a verdict the formalism does not have.

What is new: a verdict is no longer a property of a deal. It is a
property of a **run**, and most deals in a run end with no verdict at all.

# The verdict model

**Per deal** — exactly one outcome is terminal, and reaching it ends the day:

| outcome | condition | effect |
|---|---|---|
| `advanced` | decoy; declined correctly, or let it break | next deal. **Not a score.** |
| `busted-early` | called caps on a decoy | run over, loss |
| `declined-wrong` | actively declined the caps deal | run over, loss |
| `missed` | caps deal, never called, swept to R8 | run over, loss (graded as late) |
| `won` | caps deal, called within the lenient window of `S*` | run over, **win** |
| `won-marked` | one own-play past `S*` | win, marked |
| `late` | two or more past `S*` | run over, graded by distance |

`declined-wrong` and `missed` weigh the same but stay distinct kinds —
one is an assertion, the other a failure to see, and the reveal should
say which. Distinguishing them costs nothing and makes the explanation
honest.

**Per day**: the terminal deal's verdict, plus the depth reached.

**Depth is not score.** Depth is drawn, not chosen
(`run-structure-handoff.md`), and soul §IV.11 rejects luck-driven
outcomes. Record it as texture — a badge, a share shape, a story about
the day. Do not weight it.

# Streaks

Two counters, not one:

- **days played** — any completed run extends it.
- **caps** — only an on-par call on the caps deal extends it.

The reason is unchanged and now stronger: if `late` is the modal
outcome, a single streak sits at zero forever and the day-40 contract is
empty. NYT ships two streaks for exactly this reason. In a run a player
can also survive three decoys and then misread the caps deal — real skill
shown, nothing to show for it. The days-played streak catches that.

Do **not** add a depth streak or a deepest-run counter. Same reason as
above.

# `gradeDifficulty` is a clock, not a skill signal

It bands on worlds-at-call (1000/100/10), and round-boundary world counts
fall roughly 34,650 → 1,680 → 90 across R4→R6. So "difficulty" is largely
*when you called* wearing a costume. Either derive it from something else
or drop it; do not present it as a skill signal while it is a clock.

The run supplies a better candidate: grade on the **decoys survived**,
since `decoy-supply-handoff.md` scores every decoy for temptation. *"You
resisted two 0.99-temptation decoys and called it on par"* is a real
statement about the day. Follow-on, not a blocker.

# Storage

Schema **v4**. `DayResult` becomes a run record: terminal verdict, depth
reached, per-deal outcomes, elapsed time. v3 states are not migratable —
a v3 day has no depth, and inventing one corrupts the history the record
exists to preserve. Drop and restart, and say so in the bump comment.

# Validation gate

- No strategy that ignores the cards beats a materially better rate than
  chance — **at any depth**. Measure it: replay the shipped window under
  fixed-round, fixed-depth and always-decline policies, and report the
  full verdict distribution.
- `busted-early`, `late` and `missed` produce visibly different outcomes
  and different streak consequences.
- Surviving a decoy is visibly *not* a score anywhere in the UI.
- `apps/304dle/__tests__/runtime.test.ts` verdict tests updated and green.
- Result copy states *why* in one sentence, per the standing decision to
  keep the standard exact but always show the proof. In a run that
  sentence must cover the decoys too: *"deal 2 wasn't caps — east could
  still have held the ♦Q."* This is what `refutationWidth` buys.

# Hard constraints

- Do not weaken the obligation predicate to make verdicts feel kinder.
  The standard stays exact; the *explanation* is what improves.
- Do not add depth-based leniency. Compounding loss is real
  (`run-structure-handoff.md`) and the fix is cheap decoy survival, not a
  handicap at depth.
- Streak state lives in `localStorage` (`apps/304dle/storage.ts`,
  schema-versioned).
- No emoji share grid, no stat table on the result screen; both were
  removed deliberately as unreadable. **Note:** the run produces a
  natural share shape (a sequence of deals), and the 304 notation on the
  UWA whiteboard is the cultural seed of the whole product (§II, §IV.12).
  That is a genuine reopening of a closed decision — it needs Marc's
  call, and it is not licence to reinstate the emoji grid.

# Reading list

- `apps/304dle/scoring.ts`, `apps/304dle/storage.ts`.
- `docs/specs/rules.md` §C-3 to §C-7 and the H-12 house-rule row.
- `docs/specs/caps_formalism.md` §8.
- `.claude/soul.md` §IV.8, §IV.11.
- `docs/handoffs/run-structure-handoff.md` — where depth-is-not-score is argued.
