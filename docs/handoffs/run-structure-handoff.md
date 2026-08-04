---
title: 304dle — The run (a day is a sequence of deals, not one deal)
status: OPEN (2026-08-04). Design settled in outline, numbers unmeasured. Marc's sign-off required before any code.
owns: the concept. apps/304dle/store.ts, runtime.ts, types.ts, storage.ts, tools/puzzles/
blocks: caps-verdict-model, decoy-supply, puzzle-window-regeneration, run-tempo
depends_on: soul-first-principles-handoff.md (soul §VI forbids this today), caps-par-authority-handoff.md (hard)
---

# Goal

Make the day's unit a **run** of deals rather than a single deal. The
player plays deal after deal, each one a plausible caps, until they reach
the one where caps is real. The number of deals is unknown to them and
drawn from an exponentially-tailed distribution: usually one or two,
sometimes three, occasionally four, rarely deeper.

The point is to inject the uncertainty that the single-deal puzzle
cannot carry. Today caps is guaranteed to exist (soul §VI.3, *"when, not
if"*), so the day collapses to guessing a round — measured at ~1.46 bits
of answer. In a run, *whether this deal is the one* is live on every
deal, and the answer has to come from the cards.

# Vocabulary (use this; the old usage is ambiguous)

| Term | Means | Was called |
|---|---|---|
| **round** | one trick, 4 cards. 8 per deal. | round (unchanged) |
| **deal** | one 8-round hand. One `ScriptedPuzzle` today. | puzzle, hand, "game" |
| **run** | the day's ordered sequence of deals. **The new unit.** | — |
| **day** | one run. One date. | day |

A run is *k* decoy deals followed by the caps deal. The player does not
know *k*.

# Why this is the right shape (and what it fixes)

**It restores the thing that could not be simulated.** Marc's framing:
in real 304 a player does not sit down worrying about caps — they play,
and caps emerges. 304dle cannot recreate that from inside a single deal,
because the player knows the deal was curated to contain one. Putting the
uncertainty *between* deals is an external injection that produces the
same posture: play the hand, read it, and let caps announce itself.

**It replaces the redeal loop with something better.** Soul §VI.3 makes
a failed day redeal the same hand — that exists because one decision per
day is too few. A run gives 1–6 live decisions per day with no answer
leakage. This is the strongest argument for the design, and it is also
the design's biggest cost: **redeal dies.** You cannot replay a run,
because attempt one tells you which deals were decoys. One run per day,
terminal. That is a soul amendment, not a detail.

**It dissolves the decoy-days contradiction.** The earlier decoy-days
plan (now `decoy-supply-handoff.md`) hit a wall: for a *whether* puzzle,
redeal gives the answer away. In a run there is no redeal to break, and
decoys stop being a ~15% sprinkle that dilutes the daily — they become
the substance of it.

**Depth is a compass, not a scoreboard.** Soul §IV.2 asks 304dle to
*develop* the compass by daily exposure. A player who has run this for
two months has an internalised prior over run depth, the same way the
friend group has an internalised bid tendency. That is exactly the
mechanism §IV.2 describes, and it arrives for free.

# What transfers from crash, and what does not

Marc's reference is the crash gambling curve. Transferring:

- **The unknown horizon.** You never know whether this deal is the last.
- **The exponential tail.** Depth 5–6 is rare enough to be mythology
  (§IV.12) — the "I got to deal six" story.
- **Escalating investment.** Deal 4 carries three survived decisions.

**Not** transferring: *cash out for a multiplier*. In crash, waiting
longer pays more, so the player picks a risk appetite. Here the correct
call is fixed by the cards — a design that pays you to skip a caps you
can see would corrupt the one skill the puzzle exists to test (§III.6).
Depth must therefore not be worth points. It is texture: a badge, a
share shape, a story. Not a score.

One inversion worth naming: in crash you bust by being greedy. In a run
you bust by being **impatient** — calling a decoy. That is the vice soul
§VI.4 already nominates for punishment (*"guessing, drift,
brute-forcing"*), so the failure mode lands where the constitution wants
it.

# The distribution

Recommended: **flat hazard, geometric, hard cap at 6.** `p ≈ 0.45` that
any given deal is the caps deal.

| depth | P(run ends here) | cumulative |
|---|---|---|
| 1 | 45% | 45% |
| 2 | 25% | 70% |
| 3 | 14% | 84% |
| 4 | 7.5% | 91% |
| 5 | 4% | 95% |
| 6 | 2% | 97% |
| no caps at all | ~2.8% | 100% |

**Flat, not rising — and this is the load-bearing choice.** A hazard
that climbs with depth hands the player a free prior: at deal 4 they
would know a call is probably right and could press without reading.
That is the cardless-baseline exploit from `decoy-supply-handoff.md`
promoted one level up. Flat hazard makes depth uninformative, so the
cards are the only evidence. The cost is that deal 5 feels like deal 1
in prior terms; the escalation has to come from investment and tempo
instead, which is where it belongs.

**Deal 6 is drawn normally, not forced to be caps.** Forcing it would
recreate the exploit at the cap. Letting it run means ~2.8% of days end
with no caps ever — a rare, strange, entirely correct day where silence
was right the whole way. That is more soulful than a guaranteed
resolution and it is un-exploitable.

**`p = 0.45` is locked** (Marc, 2026-08-04), giving `E[depth] = 2.2`. It
remains the knob if the daily ever needs retuning — it trades session
length against how often the run structure manifests at all — but treat
it as settled, not open.

# Time budget

The constraint Marc set: the whole day is a few minutes, *and* the player
gets more room mid-deal to hold the information set.

These are compatible only by **redistributing** time inside the deal
rather than adding it — see `run-tempo-handoff.md`. At ~50s per deal:

| depth | wall clock |
|---|---|
| 1–2 (70% of days) | 50s – 1m40 |
| 3 (14%) | ~2m30 |
| 4 (7.5%) | ~3m20 |
| 6 (2%) | ~5m |

`E[day] ≈ 1m50`. That lands where soul §VI.4 originally claimed ("a 3–5
minute pressurized deductive sprint") and where the single-deal build
could not — `soul-first-principles-handoff.md` was about to amend that clause
*down* to 60–120s for being arithmetically false. **The run makes the
original clause true.** Withdraw that amendment rather than land it.

# Mechanics

**There is exactly one player action: Call Caps.** Marc's ruling
(2026-08-04): no decline, no "no caps" button, no second gesture. The
player survives a decoy by staying quiet.

**The break ends the deal and announces itself.** When the opposition
takes a round — typically late — caps is provably off. The deal stops
there; the player does not play it out. A beat announces it ("Round 7 —
no caps") and the run moves on. The caps deal never breaks, so it runs
to R8; arriving there without having called is a loss.

This is the design's best property and it should not be traded away
later: **the only way to die on a decoy is to actively call it.** The
thrill is entirely in the temptation to call before the break — which is
also the thrill Marc named, and the reason the decoys have to be good
(`decoy-supply-handoff.md`).

The break is a reveal, and reveals carry weight (soul §IV.5). It should
be a beat, not a flat state change. It is not new information — the
player watched the trick resolve — so the animation formalises what the
felt already showed rather than telling them something they could not
see. Keep it that way.

**The callable window is R1 to the break.** After the break there is
nothing to call, so the danger window is R1–R6 — which is exactly the
deduction window (`run-tempo-handoff.md`). That alignment is not an
accident and is worth preserving.

**Do not reward speed.** Deal length is now structural rather than
player-gated, so a time bonus buys nothing and would fight the "room to
memorise" goal directly. Record time; do not score it.

**Depth is visible; length is not.** Show "deal 3" — that is the
tension. Never show how many remain.

# The compounding-loss problem (largely dissolved, 2026-08-04)

Recorded because it shaped the design and because a future change could
reintroduce it.

Per-deal survival compounds. At 80% per deal a four-deal day is a 41%
win; Wordle regulars sit above 95%. Worse, depth is luck, so the day's
difficulty would be set by a die roll — which soul §IV.11 explicitly
rejects (*"random unlucky loss... probably shouldn't exist"*).

The original fix was a design target: make surviving a decoy cheap and
calling one expensive. **Dropping the decline makes that structural
rather than a number to tune.** A patient player survives every decoy
with certainty, because inaction is survival. Compounding now applies
only to the player's own impatience, which is a skill, not a die roll.

Two consequences to hold on to:

- Any future mechanic that makes a decoy killable *without* an active
  call reopens this. Do not add one.
- The residual failure mode is a player who calls on temptation. That is
  precisely what should kill them (§VI.4: *guessing, drift,
  brute-forcing*), so the remaining loss rate is a measurement of the
  decoy quality, not a fairness problem. **Still measure it** — a
  temptation threshold set too high produces a punishing daily.

# Recommended approach

1. Land `caps-par-authority` first. Par must be authoritative on every
   deal, and decoys need the mirror guarantee — see the warning in
   `decoy-supply-handoff.md` about certifying decoys with the wrong
   oracle. Nothing here is safe on a predicate that under-claims.
2. Split the constitution from the design doc
   (`soul-first-principles-handoff.md`). Soul §VI currently forbids this
   design outright; after the split those clauses live in
   `.claude/304dle-design.md`, where reversing them is an ordinary design
   edit rather than a constitutional amendment. **The run is blocked on
   the split, not on the reversal.**
3. Build the run state machine above the existing per-deal runtime —
   `runtime.ts` stays a single-deal engine; the run orchestrates it.
   Do not entangle them.
4. Decoy supply and the temptation metric (`decoy-supply-handoff.md`).
5. Verdicts, streaks, storage v4 (`caps-verdict-model-handoff.md`).
6. Tempo envelope (`run-tempo-handoff.md`).
7. Regenerate as runs (`puzzle-window-regeneration-handoff.md`).

# Validation gate

- **The cardless baseline drops materially.** Projected: best
  card-blind strategy ("call at the modal round on deal 1") wins
  ~0.45 × (lenient window / par band) ≈ 20–25%, against the ~48%
  measured for the single-deal build. *That 48% is stale and the 22%
  is arithmetic, not measurement* — replay the shipped window under
  fixed policies and report both, before trusting either.
- Answer entropy roughly doubles (~1.46 → ~3 bits). This does not close
  the gap to Wordle's 11.2 and is not meant to; the day is one decision,
  not six guesses.
- A player who never calls survives every decoy, with certainty. This is
  structural, not statistical — assert it in a test rather than
  measuring it.
- Overall day-loss rate is a readout on decoy temptation, not on
  fairness. Measure it and report it as such; a punishing daily means the
  threshold is too high, not that the run is unfair.
- `E[day] ≤ ~2 min`, `P99 ≤ ~5 min`, measured on a real window.
- No strategy that ignores the cards beats chance materially at any depth.

# Hard constraints

- **Blocked on the constitution/design split**
  (`soul-first-principles-handoff.md`). Soul §VI says every position is
  constructed so the cap is callable, *"when, not if"*, and mandates
  redeal on loss. This design reverses the first and deletes the second,
  and cannot ship while the constitution says otherwise.
- **One player action: Call Caps.** No decline, no second commit. Any
  mechanic that lets a decoy kill a passive player reopens the
  compounding-loss problem above.
- Determinism unchanged: `(info-set, rng seed) → same play, byte-for-byte`.
- Depth must never be worth points (see the crash section).
- No countdown bars, no timers-as-pressure (§VI.4). The run's tension is
  structural.
- Onboarding tension, unresolved: a first-time player must learn that a
  day is multiple deals, while §VI.5.2 forbids tutorials. Probably solved
  by the first advance being self-explanatory, but it is **not** solved
  yet — flag it before build.

# Reading list

- `.claude/soul.md` §III.6, §IV.2, §IV.8, §IV.11, §VI.3, §VI.4.
- `docs/handoffs/decoy-supply-handoff.md` — supersedes the deleted
  `decoy-days-handoff.md` and carries forward its exploit analysis, which
  is still the best material in the repo on this.
- `apps/304dle/store.ts`, `runtime.ts` — the per-deal engine to wrap.
- `apps/304dle/types.ts` — `ScriptedPuzzle` becomes a run member.
