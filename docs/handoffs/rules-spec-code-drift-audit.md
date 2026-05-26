---
title: 304 — Rules ↔ Spec ↔ Code Drift Audit
status: OPEN; v1 audit 2026-05-26. Eleven drift findings catalogued; six P-class action items.
audience: a session willing to either ship the action items or use this as input for further investigation
sibling docs:
  - ../specs/rules.md (house rules — authoritative)
  - ../specs/caps_formalism.md (caps predicate spec)
  - ../specs/play_invariants.md (engine state/transition invariants)
  - closure-tests-handoff.md (A8 closure-test brief)
  - spec-change-workflow.md (the top-down spec→tests workflow this audit recommends adopting)
  - deductions-audit.md / t8-retroactive-design.md (sister audit threads)
---

# Mission

Cover-to-cover re-read of [rules.md](../specs/rules.md) cross-referenced against
[caps_formalism.md](../specs/caps_formalism.md), [play_invariants.md](../specs/play_invariants.md),
and the engine code. Goal: surface every place the implementation,
the play-invariant spec, or the caps formalism has drifted from the
authoritative rules — including silent drift that hasn't broken a
test yet.

Soul-of-this-doc: **rules.md is the source of truth.** The two spec
documents and the engine are downstream and must conform. If you
disagree with rules.md, edit rules.md first, then propagate.

---

# 1. P-class action items (drift with concrete impact)

## P1 — Mid-round caps call can produce a false-negative "wrong" verdict

**Severity: HIGH.** Concrete user harm: 5-stone penalty for a call
that was actually correct.

### What happens

[apps/304dle/store.ts:157 submitCaps](../../apps/304dle/store.ts#L157)
is reachable from `kind === 'playing'`, including **mid-round** —
between any two card plays. The grace-period pre-resolve at
[store.ts:166-168](../../apps/304dle/store.ts#L166) only fires when
`currentRound.length === turnOrder(s.runtime).length` (round is
full and just-completed-but-not-yet-resolved). For genuine
mid-round states with 1, 2, or 3 cards played, no pre-resolve runs.

Mid-round, the CSP's [initCtx](../../engine/caps-csp.ts#L69) walks
the in-progress entries. At
[caps-csp.ts:133-141](../../engine/caps-csp.ts#L133-L141), if any
in-progress entry is a face-down play that isn't knowable to the
caller (an opp's face-down minus, mid-round and not yet revealed
by §T9), `initCtx` returns `null`. The comment explicitly says:

> The runtime's trackCaps hook will retry at end-of-round when the
> round is empty and any §T9 reveals have been applied; the cached
> stamp covers any earlier moment via the lenient timing policy.

The retry-at-end-of-round assumption breaks when the **player calls
caps during the gap**. Concretely:

1. R6: east leads face-up; north can't follow and plays face-down
   (minus). The face-down adds suit-exhaustion to north's
   `exhaustedSuits` (info-set clause 5 fires immediately).
2. `applyPlay` calls `trackCapsObligation`. CSP bails on north's
   unresolved face-down → no stamp written this tick.
3. South is about to play but spots the opportunity. South opens
   caps-confirm and submits.
4. `submitCaps` reads `stamp` → undefined. Calls
   `checkCapsObligation` → also bails. Sets
   `verdict = 'wrong-not-obligated'`. **5-stone penalty.**

### Why W3 alone could have flipped the obligation

North's face-down minus adds `exhaustedSuits[north] += {ledSuit}`.
That fact may, combined with prior knowns, force the unique-
distribution of a key card into the trumper's-friendly hand. The
formalism is sound (south's `I_V` includes this new exhaustion at
the moment of north's play, per §3 clause 5 + §3.5 I-C2); the
engine just bails on computing the predicate.

### Reach

- **304dle today:** depends on whether the puzzle corpus contains
  states where the first-obligation event is a mid-round
  exhaustion-add from an opp face-down. This is bounded by the
  generator. Quantifying: combine with the
  [info-set-followup-investigations.md §2](info-set-followup-investigations.md#L70)
  budget benchmark — extend it to also count "states where
  obligation flips inside an opp-face-down mid-round window."
- **Engine library:** real. Anyone driving the engine through arbitrary
  play sequences will hit this.

### Fix options

1. **A. CSP enumerates over unknowable face-down slots.** Replace
   the bail with a per-W4-case branching: for each face-down slot,
   enumerate the suit possibilities (W4-b for non-trumper in-progress,
   W4-d/W4-e for trumper in-progress) and AND the universal over
   the branches. Costs: search-space expansion proportional to slot
   count × candidate suits. For a single mid-round face-down, ~3
   branches. Likely affordable.
2. **B. World-enum fallback for mid-round states only.** When CSP
   bails, fall back to `enumerateWorlds` + per-world double-dummy.
   Slower but already exists. Could be gated on `currentRound.length > 0`
   to avoid degrading the round-boundary fast-path.
3. **C. Document and tighten the UI.** Disable the caps button
   mid-round; the player must wait for round resolution. Conflicts
   with rules.md ("In strict play, Caps should be called on the
   precise card at which certainty is first achieved — potentially
   mid-round."). UI-only workaround; predicate gap remains.

**Recommendation: A.** B is a hack and C contradicts rules.md.

### Test the discriminator

A test fixture exercising this would look like: a mid-round state
where (i) an opp has played face-down and (ii) the W3 exhaustion
fact from that play is the marginal information that flips south
to obligated. Construct one in `engine/__tests__/caps.test.ts`
under a new `describe("mid-round caps-call CSP fallback")` block,
mark `skip` until fixed (per the closure-tests handoff convention).

---

## P2 — §T-N numbering collision: rules.md vs. play_invariants.md

**Severity: MEDIUM.** Silent today; fragile under edits.

### What happens

`§T-N` is used in two specs with **different meanings at indices
1, 2, 5, 6**:

| § | rules.md | play_invariants.md |
|---|----------|---------------------|
| T-1 | No trump-lead R1 from priority (Closed) | Card play: source |
| T-2 | When folded trump card may be played | Suit-following |
| T-3 | Cut-or-minus when unable to follow | Closed-trump face-down rule |
| T-4 | No folding in-hand trumps | Trumper face-down restriction |
| T-5 | Trump-led, in-hand trumps available | Trump card face-up restriction |
| T-6 | Trump-led, only the folded trump remains | **Closed Trump R1 lead restriction** |
| T-7 | — | Open Trump R1 lead obligation |
| T-8 | — | Exhausted Trumps obligation |
| T-9 | — | Round resolution |
| T-10 | — | Phase exits |

Engine code references `§T-N` without document scoping. The
collision is currently harmless because:

- Code mostly references §T-6/§T-7/§T-8 — these exist *only* in
  play_invariants, so unambiguous.
- §T-3/§T-4 happen to be semantically compatible across both docs
  (both say "no folding in-hand trump" / "face-down when can't follow").
- §T-2 reference in [apps/304dle/runtime.ts:264](../../apps/304dle/runtime.ts#L264)
  ("folded trump cannot cut a trump-led round") matches rules.md
  §T-2; the same code at [line 273](../../apps/304dle/runtime.ts#L273)
  ("folded trump card face-up only on R8") also matches rules.md
  §T-2. By context the developer meant rules.md but the doc isn't
  pinned.

### Risk

Adding a new constraint in rules.md (e.g., §T-7 between current
§T-6 and existing rules.md text) would shift indices. Anyone updating
references would have to determine which doc was meant per cite —
the convention isn't recorded anywhere.

caps_formalism.md references §T-3/§T-4/§T-8/§T-9, and those happen
to be unambiguous, but the same fragility applies.

### Fix

Pick one of:

- **Re-number play_invariants.md** to use `§I-N` (for "invariants")
  or `§P-N` (for "play-phase invariants"). Update all code/doc
  references. Concrete + permanent.
- **Re-number rules.md** trumper-constraints to `§R-N` (for
  "rules-T"). Smaller blast radius (fewer refs).
- **Document the collision** at the top of both files: "References
  to §T-N in code refer to play_invariants.md unless otherwise
  noted." Cheaper but fragile.

**Recommendation: re-number play_invariants.md to §I-N.** "T" for
"transition" was an in-house abbreviation; "I" for "invariant" is
more descriptive AND eliminates the collision with rules.md's
"trumper-T" rules.

---

## P3 — R8 face-up folded-card play doesn't flip `isRevealed`/`isOpen`

**Severity: LOW.** Moot for game-end scoring; visible only to bots
reading state during R8 in a now-impossible edge case.

### What happens

In closed trump where the §T9 reveal **never fires** in R1–R7 (no
one cut with a face-down trump), the folded card is still on the
table going into R8. By §S2 conservation, the trumper has 0 cards
in hand at R8 start (8 dealt − 7 played − 1 folded = 0). By §T-2
(rules.md), the folded trump card is the trumper's R8 play, played
face-up as their last card.

[runtime.ts:355-380 resolveRound](../../apps/304dle/runtime.ts#L355-L380)
runs the §T9 reveal logic only when `e.faceDown` is true. A
**face-up** folded-card play in R8 satisfies
`suitOf(e.card) === trumpSuit` but `!e.faceDown`, so the reveal
block doesn't fire. After R8 resolution, the state has
`isRevealed = false`, `isOpen = false`, even though every player
just witnessed a trump card face-up.

### Reach

The R8 face-up folded play is the **final** card of the game. After
it resolves, `isGameOver(rt)` flips true and the runtime stops
applying caps-tracking logic. So the stale `isRevealed = false`
never affects an obligation predicate.

But: any bot reading the state after R8 (e.g., for post-game
analysis) sees an incoherent state where the trump suit is `null`
in non-trumper info-sets despite the cards being public.

### Fix

In [resolveRound](../../apps/304dle/runtime.ts#L355), after the
faceDownTrumpPlayed block, add:

```ts
if (!rt.trump.isOpen && !faceDownTrumpPlayed) {
  // R8 face-up folded-card edge case: the trumper's R8 last card
  // was the folded trump card played face-up. Trump becomes
  // publicly known but no §T9 reveal fired.
  const facedUpFolded = rt.currentRound.some(
    e => !e.faceDown && e.seat === rt.trump.trumperSeat
      && e.card !== null && suitOf(e.card) === rt.trump.trumpSuit
  );
  if (facedUpFolded && rt.roundNumber === 8) {
    rt.trump.isRevealed = true;
    rt.trump.isOpen = true;
  }
}
```

Mirror in [engine/play-engine.ts](../../engine/play-engine.ts)'s
analogous resolveRound for the full Game.

Add a closure-test assertion under the A8 handoff: "post-R8 state
always has `isRevealed = true` in any non-PCC closed-trump game
that reached R8 without earlier reveal."

---

## P4 — Claim Balance has no caller-facing API

**Severity: LOW for 304dle (single-objective: caps). MEDIUM for full game.**

### What happens

[engine/caps.ts:219 checkClaimBalance](../../engine/caps.ts#L219)
implements the predicate. There is **no** `Game.callClaimBalance`
entry point, no caps-call-style verdict path, no UI surface. The
rule (rules.md "Severe Penalties": *"Wrongly claiming balance ...
the severe penalty applies"*) is unenforced because the call can't
be made.

### Reach

- 304dle: doesn't expose claim balance. Not a regression.
- Full game (engine/game.ts): a real omission. A team in the
  full-rules context cannot legally invoke the house-rule
  mechanic.

### Fix

Two pieces:

1. **Engine API.** Add `Game.callClaimBalance(seat, threshold?)`
   mirroring `Game.callCaps`. On success, no immediate state
   transition — the call just gets recorded. On failure, apply
   auto-loss + 1 stone via the scoring path. The threshold
   defaults to the team's threshold (bid for trumper team,
   `304 − bid + 1` for opp team).
2. **Tri-valued result.** `checkClaimBalance` today returns
   `boolean` and can silently return `false` if `enumerateOrAbort`
   exhausts. Same B5/B6 pathology as
   [info-set-completeness-v3-handoff.md §5](info-set-completeness-v3-handoff.md#L323).
   Plumb a `{ holds: boolean, exhausted: boolean }` return up.

Also see [info-set-followup-investigations.md §4](info-set-followup-investigations.md#L185)
for the deeper Claim Balance investigation (CSP-style solver
sketch).

---

## P5 — `trackCapsObligation` default seat is `['south']` in the runtime path

**Severity: LOW.** Correct for 304dle; bites library users.

### What happens

[apps/304dle/runtime.ts:213](../../apps/304dle/runtime.ts#L213)
calls `trackCapsObligation(toEngineState(rt), rt.capsObligations)`
without an `opts.seats` override. The default at
[engine/caps.ts:172](../../engine/caps.ts#L172) is `['south']`.

For 304dle (south = trumper = viewer = only human seat), this is
correct and intentional. For any consumer of the runtime that
expects per-seat tracking (e.g., a tournament harness, a non-South
puzzle, an external-caps scenario), only south is tracked.

[engine/game.ts:500](../../engine/game.ts#L500) passes
`seats: ALL_SEATS` correctly. The drift is runtime.ts-specific.

### Fix

Either:

- Document the south-only assumption in runtime.ts with a comment
  ("304dle is south-trumper; library users wanting per-seat
  tracking must call trackCapsObligation directly with
  `seats: ALL_SEATS`").
- Or: parametrise the default — `runtime.ts` exposes a
  `trackSeats?: Seat[]` option in `RuntimeOptions`.

**Recommendation: document.** 304dle's south-only is a hot-path
optimisation; widening it costs CPU on every play.

---

## P6 — `Game.callCaps` doesn't run the post-final-card check explicitly

**Severity: LOW.** Implicitly covered by phase machinery.

### What happens

rules.md: "Caps cannot be called after the final card of round 8 is
played." [engine/game.ts:341 callCaps](../../engine/game.ts#L341)
checks `phase === 'playing'`. After the final card of R8,
`playCard` triggers `advanceAfterRound`, which calls
`_finalizeGame()`, setting `phase = 'complete'`. So `callCaps`
correctly rejects post-R8 calls.

But: the rejection error message is `"Not in play phase."` —
opaque. A user trying to call caps after R8 ends gets a generic
phase error, not "Caps window closed."

### Fix

Add a specific check inside `callCaps`:

```ts
if (
  play.roundNumber === 8 &&
  play.currentRound.length >= (this._state.pccPartnerOut !== null ? 3 : 4)
) {
  throw new CapsError(
    'Caps call window closed — final card of round 8 has been played.'
  );
}
```

Cosmetic. Could be batched with P4.

---

# 2. C-class observations (no immediate action — context for future audits)

## C1 — Reneging severe penalty has no scrutiny path

rules.md "Severe Penalties" auto-loss + 1 stone for reneging.
Engine prevents reneging at play time (`getValidPlays` enforces
suit-following). If reneging is detected post-hoc (a human played
through a mis-validated UI, or a play log has manual entry), there's
no entry point to apply the severe penalty.

**Why deferred:** software cannot easily renege if the validator is
sound. Real value only in a "load arbitrary scrutiny log" mode
which doesn't exist today.

## C2 — Absolute Hand post-game opposition claim path unimplemented

Already covered in [info-set-followup-investigations.md §5](info-set-followup-investigations.md#L233).

## C3 — Deliberate-throw concealment forensic predicate unimplemented

Already covered in [deductions-audit.md §5.4](deductions-audit.md#L243).
Out-of-scope per caps_formalism §12.

## C4 — Inspection-of-most-recent-completed-round-only is a UX rule

rules.md: "Between rounds, players may inspect the face-up cards
from the **most recently completed round only**." This is a
UX/etiquette rule for the human table — the engine's information
set assumes perfect recall (caps_formalism §12). The 304dle UI
may or may not respect this; if it does, that's a player-aid; if
it doesn't, the player has access to more info than the rules say
(but no rules violation since the player could mentally hold it).
Worth noting for UX design but **not** a drift in the formal sense.

## C5 — Spoilt Trumps phase scope

rules.md: "at any time before the last card of the last round is
played." engine: `phase === 'playing'` or `'pre_play'`. Effectively
same, since `pre_play` covers post-bidding-pre-R1, and `playing`
covers all of R1–R8. The trumper's `pre_play` phase reachability
for Spoilt Trumps is a side effect — actually wait, can Spoilt
Trumps be called by the *opposition* during `pre_play`? They'd
need to know trump suit, which they only know if open. In closed
trump pre_play, opps don't know the trump suit, so they couldn't
detect spoilt trumps yet. In open trump pre_play, they do know
trump suit (it was declared). The engine doesn't restrict by
mode. Plausibly fine.

## C6 — "Adaptive" worked-example in rules.md is admittedly broken

[rules.md "Worked Example — Caps via Adaptive Play"](../specs/rules.md#L368-L383)
explicitly says "Bad example — but the *shape* is right." This is
a documentation weakness, not engine drift. A future editor pass
on rules.md should construct a clean adaptive-caps example.

## C7 — Trumper's R2 lead in closed-trump implies Spoilt Trumps

rules.md "Exhausted Trumps": *"in practice it applies in rounds
3–7 of closed trump — round 2 leading-out implies Spoilt Trumps
(no opposition trumps from the deal)."* This is a deductive
observation, not a separately-implemented rule. The CSP's
adaptive search would naturally explore the implication; no
engine action needed.

## C8 — PCC + Caps confluence is correctly carved out everywhere I checked

PCC excludes caps in [engine/caps.ts:29,39,82,162,226,344](../../engine/caps.ts),
in spec §6 / §12, and in scoring.ts via the early PCC branch. The
A5 top-level guard ([info-set-completeness-v3-handoff.md §7](info-set-completeness-v3-handoff.md#L400))
is therefore already de facto in place. The handoff item is more
about code-clarity (explicit guard with a one-line comment) than
correctness.

## C9 — caps_formalism.md §12 PCC and bidding-phase non-goals confirmed

User confirmed in conversation: **no mandatory bidding behaviour
in rules.md**. Bidding signals strength but is not constrained by
card content (a player may bid high with a terrible hand). The
§12 bidding-phase exclusion is therefore tight. ✓

---

# 3. Methodology notes

This audit:

- Re-read rules.md end-to-end (622 lines) once, then targeted re-reads
  of every rule referenced from the engine.
- Cross-referenced every rules.md §B/§T/§C/§S section against
  caps_formalism.md and play_invariants.md.
- Spot-checked engine code where each rule lives:
  legalPlays, validateAndPlay, validatePlayLegality, resolveRound,
  checkSpoiltTrumps, calculateResult, calculateCapsResult, callCaps,
  callSpoiltTrumps, callAbsoluteHand, submitCaps, trackCapsObligation.
- Did **not** read the bidding-phase code (rules.md §B) — out of
  scope per the user's "no mandatory bidding" guidance.
- Did **not** read the dealing code (rules.md "Dealing") — same
  rationale.

A probe-test version of this audit — constructing concrete states
that exhibit each P-class drift — is the natural next step (see
the closure-tests-handoff.md companion).

---

# 4. Suggested sequencing

| # | Item | Effort | Reach |
|---|------|--------|-------|
| P1 | Mid-round CSP face-down enumeration (Option A) | 1–2 days | High (real puzzle harm potential) |
| P3 | R8 face-up folded reveal flip | 1 hour | Cosmetic / bot correctness |
| P5 | Document runtime.ts seats default | 15 min | Library clarity |
| P6 | Explicit post-R8 caps reject message | 30 min | Error-message clarity |
| P2 | §T-N renumber play_invariants → §I-N | 1 day (mostly mechanical sed + verify) | Long-term clarity / fragility |
| P4 | Claim Balance API + tri-valued return | 2–3 days (engine API + UI surface) | Full-game feature parity |

**Quick wins:** P3, P5, P6 — half a day total. Land before any
broader engine work.

**Real meat:** P1 (the actual concrete-harm gap). Should be done
*before* the v3 B-class items because it shares the CSP path and
the test infrastructure will overlap.

# 5. What this audit did NOT do

- **Probe tests for each finding.** A regression test for each P-item
  would close the loop. The
  [closure-tests-handoff.md](closure-tests-handoff.md) companion
  scopes this and the broader A8 closure-test suite.
- **Bidding-phase walk-through.** User confirmed no mandatory
  behaviour; skipped.
- **Dealing / shuffling code review.** No deductive content; skipped.
- **Scrutiny-phase UI review.** rules.md "Scrutiny" is descriptive,
  not normative for the engine.
- **Match-level scoring (multi-game progression).** Out of scope
  for the formalism (which is per-game) — see
  [play_invariants.md "Out of scope" → "Match-level invariants"](../specs/play_invariants.md#L292).
- **Full-game `Game` orchestrator integration tests.** The unit tests
  in `engine/__tests__/game.test.ts` exist but I didn't re-verify them
  against this audit's findings. P1/P3 may have regressions there.

# 6. What changed in adjacent docs (this session's stitching)

- This file: created.
- [closure-tests-handoff.md](closure-tests-handoff.md): created.
- [spec-change-workflow.md](spec-change-workflow.md): created.

No spec changes. No engine changes. Pre-implementation only.
