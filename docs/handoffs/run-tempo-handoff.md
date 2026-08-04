---
title: 304dle — The tempo envelope (room to hold the information set)
status: OPEN (2026-08-04). Design only; depends on the run landing.
owns: apps/304dle/tempo.ts, runtime.ts, App.tsx
depends_on: run-structure-handoff.md
---

# Goal

Give the player time to memorise the information set *inside* a deal,
without letting a run of up to six deals overrun the few-minute session.

Marc's constraint has two halves that pull against each other: *"the
player has the time to memorise the information set, and slow down mid
round so that they can pace themselves"*, but *"the overall game should
only be like a few minutes"*. Both can hold only if time is
**redistributed** within the deal, not added to it.

# State of play

`apps/304dle/tempo.ts` returns a per-play delay from the bot's decision
width — forced moves snap at ~280ms, deliberated ones run longer, with
±42% jitter so no single delay certifies hidden state. That work is good
and stays; it is *per-play character*, and it is orthogonal to what this
handoff adds.

What does not exist is a **per-round envelope**. Every round currently
gets the same treatment modulo the bots' own decisions, so the deal
spends as much time on round 1 — where there is nothing to deduce — as on
round 5, where the whole puzzle lives. Two independent estimates put a
current deal at 34–64s.

`App.tsx` already gates advancement: rounds 1–4 auto-advance, 5–8 wait
for the player. That is the right instinct and the wrong curve.

# The shape

Cognitive load across a deal is not flat. It is near zero early
(no information yet), peaks in the middle (the information set is large,
still ambiguous, and collapsing), and falls at the end (either it has
resolved or it is too late). Tempo should trace that curve — which is
also what soul §IV.9 describes at a real table: *"slow down: critical
decisions, large unknowns... caps calls — always nail-biting, always
slow."*

| rounds | load | treatment |
|---|---|---|
| 1–2 | thin — nothing to deduce yet | brisk. auto-advance, bots snappy |
| 3–6 | **the deduction window** | slow. bots deliberate, the completed trick lingers, no auto-advance |
| 7–8 | resolved or lost | brisk again |

Net time per deal should come out **about where it is now** (~50s) with
the distribution moved: seconds taken off rounds 1–2 and 7–8 and spent
on 3–6. The player experiences more room exactly where they asked for
it, and the run still fits in the budget.

# Why this must not become a clock

Soul §VI.4 forbids countdown bars and explicit rushing: the puzzle must
*"rush the player without explicitly rushing them"*. So the envelope is
expressed entirely through bot tempo and trick-lingering — the same
channels a real table uses. Nothing on screen counts anything.

The corollary, from `run-structure-handoff.md`: **do not reward speed.**
The player cannot shorten a deal anyway — there is no decline, and a
decoy ends itself — so a time bonus would reward nothing but calling
sooner, which is the exact behaviour the run exists to punish. It would
also take back the room this handoff is trying to create. Record time, do
not score it.

# Interaction with the run

Deal length is **structural, not player-gated**: a decoy ends the moment
the opposition takes a round and is not played out
(`run-structure-handoff.md`), so a decoy is 7–8 rounds and the caps deal
is at most 8. There is no accelerator and no way for the player to
shorten a deal — which means the envelope below is the *only* lever on
session length. Tune it accordingly.

At ~50s/deal and `E[depth] = 2.2`, `E[day] ≈ 1m50`, with a 6-deal day at
~5m. See the table in `run-structure-handoff.md`.

**Watch for the deep-run drag.** The envelope is tuned for one deal; four
of them back to back is a different experience, and the mid-deal slowness
that feels generous on deal 1 may feel like wading on deal 4. If
measurement says so, the honest lever is a *slightly* compressed envelope
at depth — not a countdown, and not a difficulty change. Do not
pre-emptively build this; measure first.

# Validation gate

- Time in rounds 3–6 rises measurably against today's build; total deal
  time does not.
- `E[day] ≤ ~2 min` and `P99 ≤ ~5 min`, measured on a real window rather
  than estimated.
- Play a 4-deal day end to end in a browser and report whether deal 4
  drags (`.claude/gui-verification.md` — tests do not prove the UI feels
  right, and this handoff is entirely about feel).
- No delay band certifies hidden state. The ±42% jitter rule in
  `tempo.ts` exists because a 280ms snap was once a *proof* that a seat
  held one legal card; an envelope multiplier must not reintroduce that
  by narrowing bands.

# Hard constraints

- No countdown bars, no timers presented as pressure (§VI.4).
- No speed reward in v1.
- Tempo stays a tell that can lie (§IV.6). Preserve the jitter property
  above when layering the envelope on top of per-play delays.
- 304dle styles live in `apps/304dle/app.css`.

# Reading list

- `apps/304dle/tempo.ts` — per-play delays and the jitter reasoning.
- `apps/304dle/App.tsx` — `canAdvance`, the current 1–4 / 5–8 gate.
- `.claude/soul.md` §IV.9, §VI.4.
- `.claude/gui-verification.md`.
