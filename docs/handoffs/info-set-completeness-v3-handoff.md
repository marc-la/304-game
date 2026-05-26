---
title: 304 — Info-Set Completeness v3 Handoff
status: open, ready for a fresh session
audience: a fresh Claude session picking up where v2 left off
sibling docs:
  - ../specs/caps_formalism.md (the spec — updated 2026-05-26 with A-class refinements; this handoff is the engine side)
  - info-set-completeness-v2-handoff.md (v2 — almost complete; this handoff carries forward anything unfinished)
  - deductions-audit.md (Class-C deferrals; do not conflate with this handoff)
  - info-set-followup-investigations.md (deeper-investigation work queued separately)
---

# Mission

The 2026-05-26 spec audit ("v3") extended the v1 findings with eight
new or refined items. The spec changes landed in
[../specs/caps_formalism.md](../specs/caps_formalism.md) as A1–A8 (see
the §3 clause-4 expansion, the new §3.5 closure properties, the W4
case table, the W6 extension, and the §12 non-goals).

This handoff captures the **engine work** that pulls the
implementation up to the new spec. Items B1–B8 each map to one or
more A-items; B1 and B3 carry forward from v2 if not yet shipped.

Soundness reminder: every gap below is a *completeness* gap, not a
soundness gap. The engine over-considers worlds in some cases and
silently bails in others; neither produces false-positive caps
confirmations. The user's concrete impact is "told they're not yet
obligated when a strong player with the same info would have called."

---

# 1. Priority — open-trump pre-play reveal (A1 / B7)

## What it is

Per rules.md "Open Trump Games", when the trumper does **not** have
R1 priority, they reveal one trump-suit card to all players before
R1. The revealed card may or may not be the originally-folded one.
Its identity is in `I_V` for every non-trumper viewer from the moment
of reveal — see [../specs/caps_formalism.md §3 clause 4(c)](../specs/caps_formalism.md).

The engine has no field anywhere that tracks WHICH card was revealed.
`apps/304dle/runtime.ts:RuntimeOptions.mode = 'open'` is the only
open-trump flag; the runtime treats `options.trumpCard` as both the
originally-folded card AND the implicitly-revealed card. They are
not necessarily the same.

## Why it matters

- *304dle today:* zero impact. Always-trumper-south means the viewer
  is always the trumper; the trumper knows their own hand.
- *Engine-as-library / multi-viewer:* substantial. Any tournament or
  bot scenario with a non-trumper viewer of an open-trump-non-priority
  game under-deducts: `knownInHand[trumperSeat]` is missing the
  revealed-card identity.
- *PCC:* same mechanic — rules.md "Partner Closed Caps" uses the
  identical reveal-then-return-to-hand procedure. (PCC is caps-excluded
  per §C-10, so this is moot for the caps predicate, but engine
  callers that build info-sets in PCC still see the gap.)

## Suggested approach

1. **Engine state.** Extend `EngineTrumpState` ([engine/state.ts](../../engine/state.ts))
   with `revealedTrumpCardId: CardId | null`. Populate for
   open-trump-non-priority modes; null otherwise.
2. **Runtime.** [apps/304dle/runtime.ts:newRuntime](../../apps/304dle/runtime.ts)
   takes `revealedTrumpCardId?: CardId` in `RuntimeOptions`. Default
   to `null` (the originally-folded card was *not* the revealed one)
   or to the originally-folded card if the puzzle author declares it.
3. **buildInfoSet.** Extend the `knownInHand` population block in
   [engine/info.ts](../../engine/info.ts) (around line 167–176) to
   include `revealedTrumpCardId` whenever it is set AND the card is
   still in the trumper's hand. The "still in hand" check is W1
   conservation: subtract any card in `knownPlayed` matching the
   revealed identity. (Equivalently: check `trumperHand.includes(revealedTrumpCardId)`.)
4. **Curatorial.** When the puzzle generator emits an
   open-trump-non-priority script, it must declare which trump card
   was revealed. The choice is the trumper-bot's; it's authoring
   data, not deducible. [tools/puzzles/generate-scripted.ts](../../tools/puzzles/generate-scripted.ts)
   needs a corresponding field.

## Acceptance criteria

- New test in `engine/__tests__/info.test.ts` (create if absent):
  build an open-trump runtime where trumper is north, R1 priority is
  east, revealed card is 9♠ (not the folded card J♠ which the trumper
  keeps private). Build info-set for south viewer. Assert
  `southInfo.knownInHand.get('north')` contains `9♠` but not `J♠`.
- Existing tests still pass.

---

# 2. Trumper face-down §T-4 refinement (A2 / B4 / B8)

## What it is

v1's F4-b correctly fixed one subcase of the trumper's face-down
constraint (the cut-with-folded-trump case) by relaxing in-progress
slots to `forbidden = {ledSuit}`. That fix is unconditional and
over-corrects for the *minus* subcase: when the trumper plays
face-down while the folded card is still on the table, the play is
necessarily a non-trump-non-led minus from hand (§T-4 forbids folding
in-hand trump; the folded card itself remains on the table so it
cannot be the played card). Today's enumerator allows trump-suit in
this slot and generates worlds that violate §T-4.

The full case table is in
[../specs/caps_formalism.md §4 W4 case table](../specs/caps_formalism.md).
Five cases by (seat, viewer-observed-resolution, folded-trump-status).
Today's code handles two of the five correctly (W4-a and W4-b); v1's
F4-b fix collapsed W4-c, W4-d, W4-e into a single over-relaxed case.

## Why it matters

- *304dle today:* zero (south is both trumper and viewer; trumper's
  own face-downs are observable to self via clause 2).
- *Engine-as-library:* false-negative obligations whenever a
  non-trumper viewer reasons about a mid-round trumper face-down
  minus. The CSP path is already protected (it bails on unresolved
  face-downs at `caps-csp.ts:initCtx`); the world-enumeration path
  (`validateCapsCall`, `explainCapsFailure`, `checkClaimBalance`,
  `worlds-counter`) is affected.

## Suggested approach

1. **HiddenSlot extension.** Add to `engine/info.ts:HiddenSlot`:
   - `seatIsTrumper: boolean`
   - `foldedOnTableAtPlayTime: boolean`

   Both computable in `absorbRound` from the entry's seat, `trump.trumperSeat`,
   and the position of the entry relative to `trump.trumpCard !== null` at
   the time of play. For completed rounds the value is recoverable from
   the trump state history (or simply: for completed rounds the case
   collapses to W4-a / W4-c and these flags are redundant — but it's
   cleaner to set them anyway).

2. **enumerateForTrump** ([engine/info.ts:268-282](../../engine/info.ts#L268-L282)):
   replace the binary `inProgress ? {ledSuit} : {ledSuit, trumpSuit}`
   with a five-way case dispatch matching the W4 table. The cleanest
   shape:

   ```ts
   const isCompleted = !hs.inProgress;
   if (isCompleted) {
     // W4-a / W4-c
     forbidden = new Set([hs.ledSuit, trumpSuit]);
   } else if (!hs.seatIsTrumper) {
     // W4-b
     forbidden = new Set([hs.ledSuit]);
   } else if (hs.foldedOnTableAtPlayTime) {
     // W4-d: trumper minus from hand
     forbidden = new Set([hs.ledSuit, trumpSuit]);
   } else {
     // W4-e: trumper cut with the folded trump (slot IS folded identity)
     forbidden = new Set([hs.ledSuit]);
     // Optional optimisation: pre-force this slot to the unique
     // unaccounted-for trump-suit card via W1 conservation.
   }
   ```

3. **worldIsConsistent** ([engine/info.ts:471-476](../../engine/info.ts#L471-L476)):
   mirror the same five-way check on read.

4. **CSP integration.** Today the CSP path bails on unresolved
   face-downs entirely. If you change that (e.g., to broaden CSP
   coverage of mid-round states), the same five-way logic must
   live in `caps-csp.ts`. For now, the CSP bail is fine.

## Acceptance criteria

- New tests in `engine/__tests__/info.test.ts`:
  - W4-d: closed-trump state, trumper played a face-down minus
    mid-round, folded card still on table, viewer is opp. Assert
    no enumerated world has a trump-suit card in the trumper's
    face-down slot.
  - W4-e: closed-trump state, trumper played the folded trump card
    face-down mid-round, viewer is opp. Assert exactly one enumerated
    world (modulo other unknown slots) places the folded-trump
    identity in the in-progress slot.
- v1's existing W4-b test still passes (trumper plays cut, opp
  watches — F4-b case).

---

# 3. CSP path doesn't consume W6 (B1 — v2 carry-forward)

## What it is

Already documented in v2 handoff §1. The CSP at
[engine/caps-csp.ts:67-78](../../engine/caps-csp.ts#L67-L78)
explicitly skips `info.knownInHand` from the unknown-pool / opp
constraint model. This causes false-negative obligations for
external-caps callers when the §T9-lifted folded card is dispositive.

## Status

Check v2's worktree: if §1 of v2 landed, this is shipped. Otherwise,
land it per v2's Option A.

## Why repeated here

For one-stop reading. If v2 is done, mark this item complete and
move on.

---

# 4. CSP pigeonhole pre-pass (B2)

## What it is

The CSP models opp hands as a fungible shared pool keyed by per-seat
hand-size + per-seat suit-exhaustion. Hall's marriage condition
catches global infeasibility, but **forced placements** of specific
cards to specific seats (via pigeonhole on suit-exhaustion + hand
sizes) are only caught lazily during adversarial branching. Under the
50,000-node budget at [engine/caps-csp.ts:59](../../engine/caps-csp.ts#L59),
the lazy approach can exhaust budget before discovering the
contradiction.

## Why it matters

Quantitative completeness gap. False-negative obligations under
budget exhaustion. Compounds with B5 (silent budget exhaustion).

## Suggested approach

Add a pre-pass at `initCtx` time. For each pool card, compute the
set of opp seats that *could* hold it (subject to W3 +
hand-size-feasibility). If exactly one seat is feasible, convert it
to a `forced` entry analogous to v2's `knownInHand` integration.

A single forward pass is enough for the common case ("card X has
only one possible seat"). Iterative passes can be added if there's
evidence the single-pass version misses real cases.

This is essentially the v2 Option A approach generalised: the source
of forced placements widens from "the §T9-lifted card" to "any card
the constraints have pinned to a unique seat."

## Acceptance criteria

- Existing tests still pass.
- New test: a state where exhaustion forces all unaccounted-for clubs
  to a single opp; `checkCapsObligationCSP` returns true even under a
  tight node budget. Without the pre-pass, the same state returns
  false at the tight budget (proving the lazy version was the
  bottleneck).

---

# 5. Tri-valued diagnostics for budget / world-cap exhaustion (B5 / B6)

## What it is

Two silent fallbacks:

- [engine/caps-csp.ts:251-256](../../engine/caps-csp.ts#L251-L256):
  on budget exhaustion, `adaptiveSweep` returns `false` indistinguishable
  from "rigorously not obligated."
- [engine/caps.ts:245-253](../../engine/caps.ts#L245-L253):
  `enumerateOrAbort` returns `null` if world count exceeds
  `MAX_WORLDS = 5000`. Downstream callers (`validateCapsCall`,
  `explainCapsFailure`, `checkClaimBalance`, `findWitnessOrder`,
  `orderSurvivesInfo`) treat `null` as "no result."

A puzzle player who is genuinely caps-obligated but whose state
exceeds either cap sees "wrong-not-obligated" and takes a 5-stone
penalty.

## Why it matters

Diagnostically opaque. No way to distinguish "engine says false" from
"engine ran out of resources and bailed." Latent risk for any future
state that pushes the limits.

## Suggested approach

1. **CSP.** Change `checkCapsObligationCSP` return type to
   `{ obligated: boolean, exhausted: boolean }` (or a tagged union).
   Callers can decide policy: 304dle's `submitCaps` should probably
   treat `exhausted: true` as "we don't know — let the player call
   if they think so, then resolve at scrutiny."
2. **World enum.** Same shape for `enumerateOrAbort`. The five
   downstream callers each get a chance to handle the unknown case
   explicitly.
3. **Trackability.** Log every exhaustion to a structured channel so
   you can find them in puzzle-generation runs. Asserting "the
   curated corpus never exhausts at any state the player might call"
   is a useful generator-side invariant.

## Acceptance criteria

- New CSP return type plumbed through `checkCapsObligation` and
  `trackCapsObligation`.
- New test: construct a state guaranteed to exhaust the budget
  (artificially low budget for the test). Assert the exhausted flag.
- Generator-side optional: a regression test that the shipped puzzle
  pool never exhibits exhaustion.

---

# 6. play-engine.ts §T9 plumbing (B3 — v2 carry-forward)

## What it is

Already documented in v2 handoff §2.
[engine/play-engine.ts:347](../../engine/play-engine.ts#L347) sets
`trump.trumpCard = null` after the §T9 lift, dropping the identity.
[apps/304dle/runtime.ts:360-363](../../apps/304dle/runtime.ts#L360-L363)
preserves the identity AND sets `foldedCardLifted = true`. The full-game
engine path is broken for W6.

## Status

Check v2's worktree. If shipped, mark complete. Otherwise:

- After the lift in `play-engine.ts:advanceAfterRound` (or wherever
  resolveRound lives in the engine path now), set
  `trump.foldedCardLifted = true` and preserve `trump.trumpCard`.
- Verify no downstream caller depends on the post-lift null (the v2
  handoff flagged this as a "larger behavioural change").

---

# 7. PCC top-level guard (A5)

## What it is

For PCC games, the engine's caps machinery silently returns "not
obligated" because `initCtx` returns `null` due to the 8-card
partner-out hand mismatching the pool / oppTotal expectation. This
*happens* to match the rules (caps doesn't apply in PCC) but it's by
accident, not by design.

The formalism now explicitly carves out PCC in §6 specialisations
and §12 non-goals. The engine should match.

## Suggested approach

Add an explicit top-level guard in `checkCapsObligation`:

```ts
export const checkCapsObligation = (
  state: EngineGameState,
  seat: Seat,
): boolean => {
  if (state.pccPartnerOut !== null) return false;
  return checkCapsObligationCSP(state, seat);
};
```

Same guard at the entry points of `validateCapsCall`,
`explainCapsFailure`, `checkClaimBalance`, `trackCapsObligation`, and
`findWitnessOrder`. Document with a one-line comment:
"// PCC: caps mechanics do not apply (rules.md §C-10)."

Alternatively (and more thoroughly): teach the world enumerator and
CSP to model the partner-out hand as a frozen 8-card slot. This is
strictly more general and would also let Claim Balance work for PCC
(rules don't explicitly forbid claim balance in PCC, only Caps and
External Caps). Defer unless there's a use case.

## Acceptance criteria

- New test: a PCC state. `checkCapsObligation('south')` returns
  `false` (and ideally exposes a structured reason like "not
  applicable in PCC", not just `false`).
- Behavioural change is null in 304dle (no PCC there).

---

# 8. Closure-property tests (A8)

## What it is

The new §3.5 in the formalism states I-C1 through I-C5 as testable
properties: information persistence, observation discipline,
monotone components, knownInHand evolution, world-set monotonicity.

These are spec-level properties of the engine's behaviour. No
specific bug to fix; the test suite should encode them as invariants.

## Suggested approach

Add `engine/__tests__/info-closure.test.ts`. For each property,
construct a representative state, apply a sequence of plays, and
assert the property holds at each transition. Specifically:

- I-C2 (observation discipline): after applying a non-revealing
  face-up play, assert `knownInHand` is unchanged.
- I-C3 (monotone components): after a sequence of plays, assert
  `knownPlayed.size` is non-decreasing and `hiddenSlots.length`
  grows on face-down plays / shrinks only on §T9 reveals.
- I-C5 (world-set monotonicity): assert `enumerateWorlds(info)`
  cardinality is non-increasing along an event sequence
  (modulo the played-card factor).

These tests double as regression nets for any future change to
`buildInfoSet`.

---

# Sequencing and effort estimate

| Item | Estimated effort | Notes |
|------|------------------|-------|
| 3 (B1, W6/CSP) | half day | Carry-forward from v2; may already be done. |
| 6 (B3, play-engine plumbing) | quarter day | Carry-forward; one-line + verify. |
| 7 (A5, PCC guard) | quarter day | Trivial, high clarity benefit. |
| 1 (A1, open-trump reveal) | half day | New field + curator wiring. Doesn't affect 304dle today. |
| 2 (A2/B4/B8, T-4 refinement) | half day | Spec-correct in 304dle today by accident (south self-views); fix for the engine library. |
| 5 (B5/B6, tri-valued) | half day | Mostly diagnostic but unblocks further investigation. |
| 4 (B2, pigeonhole pre-pass) | 1-2 days | The only item that needs real care. |
| 8 (A8, closure tests) | half day | Tests only; net new safety. |

Total: 4–5 days of focused work to bring engine fully in line with
the post-2026-05-26 spec.

# Out of scope

- Spec / formalism changes — landed 2026-05-26.
- Class-C deferrals (Spoilt Trumps false-call as evidence,
  caps-non-call as evidence, deliberate throw concealment, memory
  limits, cross-game shuffle correlations) — see
  [deductions-audit.md §5](deductions-audit.md).
- The §T-8 retroactive deduction — still deferred, lives in
  [deductions-audit.md §2.1 / §5.1](deductions-audit.md).
- Deep-dive investigation tasks (probe-test corpus, Long-2011 mapping,
  budget benchmark, Claim Balance & Absolute Hand investigations) —
  see [info-set-followup-investigations.md](info-set-followup-investigations.md).

# Working notes

- Run `cd frontend && npx vitest run` from the repo root (after
  `export PATH=/home/marc/.nvm/versions/node/v22.16.0/bin:$PATH`).
  Baseline at the time of this handoff: 170 passed + 1 skipped.
- The user has parallel WIP in `engine/__tests__/caps.test.ts`,
  `engine/bots/b6-dds-mc.ts`, `engine/bots/b7-bridge-derived.ts`,
  `engine/bots/dds-core.ts`, `engine/caps-csp.ts`, and
  `tools/bots/elo/results.json`. None of it interacts with the
  items above (it's bot-tournament work). Don't touch.
