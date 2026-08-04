---
title: 304dle — The run (a day is a sequence of deals, not one deal)
status: OPEN (2026-08-04). Design settled in outline, numbers unmeasured. Marc's sign-off required before any code.
owns: the concept. apps/304dle/store.ts, runtime.ts, types.ts, storage.ts, tools/puzzles/
blocks: caps-verdict-model, decoy-supply, puzzle-window-regeneration, run-tempo
depends_on: soul-amendments-handoff.md (§VI.3 forbids this today), caps-par-authority-handoff.md (hard)
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

`p` is the tuning knob. It trades session length against how often the
run structure manifests at all. `p = 0.45` gives `E[depth] = 2.2`.

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
could not — `soul-amendments-handoff.md` was about to amend that clause
*down* to 60–120s for being arithmetically false. **The run makes the
original clause true.** Withdraw that amendment rather than land it.

# Mechanics

**Advancing.** A deal ends when its truth becomes public. For a decoy
that is the break — the moment the opposition takes a trick, caps is
provably off and the run advances. For the caps deal the truth never
turns against the player, so it runs to R8; arriving there without
having called is a loss.

**The decline is an accelerator, not an obligation.** The player may
assert "no caps" early to skip to the next deal. Correct → advance.
Wrong → the run is over. It gains no information (you would have
advanced anyway when it broke), so it is a pure speed-for-safety trade
and cannot be farmed. Patient players simply never press it.

**Do not reward speed in v1.** A time bonus would make the accelerator
mandatory and fight the "give the player room to memorise" goal
directly. Record time; do not score it.

**Depth is visible; length is not.** Show "deal 3" — that is the
tension. Never show how many remain.

# The compounding-loss problem (name it, don't paper over it)

Per-deal survival compounds. At 80% per deal a four-deal day is a 41%
win; Wordle regulars sit above 95%. Worse, depth is luck, so the day's
difficulty would be set by a die roll — which soul §IV.11 explicitly
rejects (*"random unlucky loss... probably shouldn't exist"*).

The fix is not leniency at depth (that is sanitizing, §VI.5.5). It is to
make **surviving a decoy cheap and calling a decoy expensive**. Declining
correctly should be the low-effort default; the only way to die on a
decoy is to actively call it. Then per-deal survival for an attentive
player is ~95%, a four-deal day is ~81%, and the run punishes impatience
specifically rather than taxing depth. Design to that target and
**measure it before shipping**.

# Recommended approach

1. Land `caps-par-authority` first. Par must be authoritative on every
   deal, and decoys need the mirror guarantee — see the warning in
   `decoy-supply-handoff.md` about certifying decoys with the wrong
   oracle. Nothing here is safe on a predicate that under-claims.
2. Get Marc's sign-off on the §VI.3 amendments (`soul-amendments-handoff.md`).
   The constitution currently forbids this design outright.
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
- Attentive-play survival per decoy ≥ 95%, measured, not assumed.
- `E[day] ≤ ~2 min`, `P99 ≤ ~5 min`, measured on a real window.
- No strategy that ignores the cards beats chance materially at any depth.

# Hard constraints

- **Soul amendment required before shipping.** §VI.3 says every position
  is constructed so the cap is callable, *"when, not if"*, and mandates
  redeal on loss. This design reverses the first and deletes the second.
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
