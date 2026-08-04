---
title: 304 — The amendments the soul now needs
status: OPEN (2026-08-04, enlarged by the run design). Marc's sign-off required; no code.
owns: .claude/soul.md
blocks: run-structure, decoy-supply (§VI.3 currently forbids both)
---

# Goal

Bring `.claude/soul.md` into line with decisions already taken — and, for
the run, with a decision Marc is taking now. The constitution binds
implementation, so leaving it stale means the code and the document
disagree about what the game is.

Three amendments were pending from 2026-07-26. The run design
(`run-structure-handoff.md`) enlarges the first, **withdraws** the third,
and adds a fourth.

# 1. §VI.3 — "when, not if", and the redeal loop

The big one, and it is now two reversals rather than one.

**"Every position is constructed so that the cap is callable — 'when,
not if'."** This clause was written to make the puzzle fair and it
hollowed out the question. Because a caps is guaranteed, the player knows
before the deal that a call is coming and the day reduces to guessing the
round; measured, the shipped window carried ~1.46 bits of answer, and
pressing at the modal round while reading nothing scored about half. The
replacement should say positions are curated for *interest*, never for
*outcome*, and that whether a cap exists is neither guaranteed nor
signalled.

**"Loss sting → redeal of the same hand."** This one is a straight
deletion, and it is the amendment with the most soul at stake. §VI.3
justifies redeal as the analogue of post-game scrutiny — *"You don't
escape it; you confront it."* A run cannot support it: replaying a run
tells you which deals were decoys, so attempt two is not the same
problem. **One run per day, terminal.**

The compensating argument, which the amendment should carry explicitly:
redeal existed because one decision per day is too few. A run gives one
to six live decisions per day with no answer leakage. It is a better
answer to the same need — but it *is* a loss, and the amendment should
say so rather than pretending the mechanic was never wanted.

**This amendment blocks the run outright.** Do not ship the mechanic
while the constitution says the opposite.

# 2. §VI.2 — the possible-worlds counter as "the visible spine"

Unchanged from 2026-07-26. The live ticker was removed from play and kept
for the post-game. The reason is measured, not aesthetic: a policy
reading *only* the ticker — call at the first boundary where it drops
sharply — matched or beat every fixed-round strategy with no memory at
all. §VI.4 forbids any affordance that lets a player solve by elimination
without remembering; the counter performed the elimination and printed
the residue. §VI.2 and §VI.4 were in direct contradiction and the
measurement settles it. Keep the counter as a *post-game* instrument.

# 3. §VI.4 — "a 3–5 minute pressurized deductive sprint" — **WITHDRAWN**

Do not land this one.

It was queued because the clause was arithmetically false: two
independent estimates put a single deal at 34–64s, and reaching 180s
needs ~4.7s per card, which is dead air. The amendment would have revised
the number *down* to ~60–120s.

The run makes the original clause true. At ~50s per deal and
`E[depth] = 2.2`, a day is ~1m50 with deep days at ~5m — which is the
3–5 minute band the soul claimed all along. **Withdraw the amendment and
leave §VI.4's duration as written.** Worth recording in the soul's own
margin: the clause was aspirational when written, was briefly false, and
the run is what made it honest.

# 4. §VI.4 — the single-player virtue needs a second sentence (NEW)

§VI.4 names the virtue as *"fast deduction under tempo"* and describes
the loop entirely inside one deal: watch the hand dwindle, call at the
right moment, wrong call → redeal.

Every clause there survives, but the frame is now one level too low. The
run adds a question the section does not contain: **is this the deal?**
That is not "when" and it is not "fast" — it is a whether-judgment made
under a horizon the player cannot see, and it is the thing Marc's design
exists to inject. The amendment should add it alongside fast deduction,
not replace it, and should name the failure mode the run punishes:
**impatience** — calling a deal that merely looks like caps.

This also needs the forbidden-list entry that follows from it: nothing
may signal, before or during a deal, whether it is the caps deal. The
trick piles are the known leak (`decoy-supply-handoff.md`).

# Approach

Amend, do not rewrite. The soul's voice is Marc's and its authority comes
from being stable; each change should be a surgical edit with the
reasoning attached, so a future reader can see *why* the clause moved.
Where a clause is being reversed rather than refined — §VI.3 is, twice —
say so explicitly rather than quietly restating it.

§VI.2 describes something already true in the code. §VI.3 and §VI.4(4)
do not: they are forward commitments on a design Marc has not yet signed
off. Do not land them on the strength of this handoff alone.

# Validation gate

- Marc signs off on each amendment individually, including the
  withdrawal of (3).
- No clause in the amended soul contradicts another (§VI.2 vs §VI.4 was
  the live example; §VI.3's redeal clause vs the run is the new one).
- The §VI.3 replacement does not accidentally license luck-driven
  outcomes — §IV.11 still forbids them, and depth-is-not-score
  (`caps-verdict-model-handoff.md`) depends on that staying true.
- `CLAUDE.md` and `.claude/directory.md` references still resolve.

# Hard constraints

- Soul wins over rules where they conflict — so an amendment here
  silently changes what implementations are allowed to do. Do not batch
  these with unrelated edits.
- Do not delete the cultural sections (§II, §IV) as part of tidying.
- Do not soften §IV.11's rejection of luck-driven loss to make the run's
  compounding-loss problem go away. That problem has a design fix
  (`run-structure-handoff.md`); it does not need a constitutional one.

# Reading list

- `.claude/soul.md` §III.1, §IV.11, §VI.2, §VI.3, §VI.4, §VI.5.
- `docs/handoffs/run-structure-handoff.md` — the blocked design.
- `docs/handoffs/decoy-supply-handoff.md` — the signalling leak.
- Git log for `apps/304dle/components/PublicInfo.tsx` — the ticker change
  and its measured justification.
