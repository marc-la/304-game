---
title: 304 — Three amendments the soul now needs
status: OPEN (2026-07-26). Marc's sign-off required; no code.
owns: .claude/soul.md
blocks: decoy-days (§VI.3 currently forbids it)
---

# Goal

Bring `.claude/soul.md` into line with three decisions already taken and,
in two cases, already shipped. The constitution binds implementation, so
leaving it stale means the code and the document disagree about what the
game is.

# The three

**§VI.3 — "when, not if".** Currently: *"Every position is constructed
so that the cap is callable — 'when, not if'."* This clause was written
to make the puzzle fair and it hollowed out the question. Because a caps
is guaranteed, the player knows before the deal that a call is coming and
the day reduces to guessing the round; measured, the shipped window
carried ~1.46 bits of answer, and pressing at the modal round while
reading nothing scored about half. Marc has approved days with no caps,
where the correct play is silence. **This is the amendment that blocks
other work** — `decoy-days-handoff.md` cannot ship while the
constitution says the opposite. Replacement should say positions are
curated for *interest*, never for *outcome*, and that whether a cap
exists is neither guaranteed nor signalled.

**§VI.2 — the possible-worlds counter as "the visible spine".** The live
ticker was removed from play this session and kept for the post-game.
The reason is measured, not aesthetic: a policy reading *only* the
ticker — call at the first boundary where it drops sharply — matched or
beat every fixed-round strategy with no memory at all. §VI.4 forbids any
affordance that lets a player solve by elimination without remembering;
the counter performed the elimination and printed the residue. §VI.2 and
§VI.4 were in direct contradiction and the measurement settles it. The
amendment should keep the counter as a *post-game* instrument.

**§VI.4 — "a 3–5 minute pressurized deductive sprint".** Arithmetically
false. Two independent estimates of the current build put a hand at
roughly 34–64 seconds; reaching 180s needs ~4.7s per card, which is dead
air. Either amend the number to ~60–120s, or state that the duration is
player-gated (rounds 1–4 auto-advance, 5–8 wait), which is what the code
now does. A tight daily is not a defect — the NYT Mini is ~60s.

# Approach

Amend, do not rewrite. The soul's voice is Marc's and its authority comes
from being stable; each change should be a surgical edit with the
reasoning attached, so a future reader can see *why* the clause moved.
Where a clause is being reversed rather than refined — §VI.3 is — say so
explicitly rather than quietly restating it.

Two of the three describe things already true in the code. §VI.3 does
not: it is a forward commitment, and it should not be amended until Marc
confirms the no-caps-days direction he approved in principle.

# Validation gate

- Marc signs off on each of the three, individually.
- No clause in the amended soul contradicts another (§VI.2 vs §VI.4 was
  the live example).
- `CLAUDE.md` and `.claude/directory.md` references still resolve.

# Hard constraints

- Soul wins over rules where they conflict — so an amendment here
  silently changes what implementations are allowed to do. Do not batch
  these with unrelated edits.
- Do not delete the cultural sections (§II, §IV) as part of tidying.

# Reading list

- `.claude/soul.md` §III.1, §VI.2, §VI.3, §VI.4, §VI.5.
- `docs/handoffs/decoy-days-handoff.md` — the blocked work.
- Git log for `apps/304dle/components/PublicInfo.tsx` — the ticker change
  and its measured justification.
