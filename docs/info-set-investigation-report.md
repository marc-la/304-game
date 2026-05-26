# Information-Set Completeness & Closed-Trump Timing — Investigation Report

Date: 2026-05-26
Branch: main (uncommitted work present — see "Pre-existing work-in-progress" below)
Working tree: matches the `M` list in the handoff (runtime.ts, store.ts, runtime.test.ts, closed-trump.test.ts modified vs. HEAD).
Tests run: `npx vitest run` from `frontend/` — 157 passed, 1 file (`apps/304dle/__tests__/submit-caps.test.ts`) fails to **transform** due to a pre-existing duplicate-declaration parse error in [apps/304dle/store.ts:166](apps/304dle/store.ts#L166) and [apps/304dle/store.ts:185](apps/304dle/store.ts#L185).

Scope per handoff: a spec-correctness audit. Findings include doc edits, code edits, or both, with priority calls. I did **not** modify any production code (the user has work-in-progress in `store.ts` directly addressing §2.3.2 that must land first).

---

## Pre-existing work-in-progress

The uncommitted diff already addresses several concerns this audit was asked to investigate:

1. **`runtime.ts`** — new `validatePlayLegality` enforces §S7/§T-2..§T-8/follow-suit on every scripted play. Also fixes a §S6/§S10 bug: when the trumper plays the (formerly folded) trump card from hand, the trump-card slot is now cleared. This subsumes part of §1.3.2 and §1.3.4 in the handoff (see F4).
2. **`store.ts` (submitCaps)** — partially rewritten to consult the cached stamp first, falling back to a live CSP re-check. **This is the right direction for §2.3.2**, but:
   - It contains a duplicate `const stamp = …` (lines 166 and 185) that breaks transform.
   - Even when fixed, it does not solve the linger-window case where obligation arises *from this round's §T9 reveal* — no stamp exists yet, the CSP still bails on in-progress face-downs, and the verdict is still `wrong-not-obligated`. See F1 for the full fix.
3. **`submit-caps.test.ts`** — new file exercising the verdict tree. Cannot load until the duplicate-declaration is removed.

The audit findings below assume the parse error is resolved.

---

## Verdicts (one-line each)

- §1.3.1 In-progress face-down trump constraint: **over-deducing** (real bug in `info.ts`; impact narrow — see F3)
- §1.3.2 Trumper §T-4 face-down constraint: **mostly correct**; one mid-round opponent-viewing-trumper subcase over-deduces (F4-b)
- §1.3.3 Forced-play retroactive deduction (§T-8): **spec gap** — out of scope as currently written; recommend explicit non-goal
- §1.3.4 Folded card known to trumper: **doc update needed**; implementation already correct (F4-a)
- §1.3.5 §T9 folded-card public reveal: **under-deducing** — non-trumpers do not record the publicly-revealed-lifted folded-card identity (F2)
- §1.3.6 Card-elimination via own-hand subtraction: **verified correct** (falls out of W1+W5 in enumerator)
- §1.3.7 Trump-count composite: **verified correct via conservation**; CSP path uses pool-based bookkeeping, not full enumeration
- §2.3.1 `trackCapsObligation` timing in `resolveRound`: **correct**
- §2.3.2 UI linger period vs engine: **verified divergence — harmful** (F1, the most impactful finding)
- §2.3.3 Lenient-policy lateness math: **correct**
- §2.3.4 Seat rotation in `generate-scripted`: **correct**
- §2.3.5 R8 final-card boundary: **correct** (double-guarded — both `callWindowClosed` and the `roundNumber <= 8` gate in `resolveRound`)

---

## Per-item findings

### F1: §2.3.2 — UI linger / engine state divergence [P1]

**Claim.** When a closed-trump round fills with a face-down trump play, the UI's `Table.tsx:viewerKnowsEntry` ([apps/304dle/components/Table.tsx:25-31](apps/304dle/components/Table.tsx#L25-L31)) flips all face-down entries to face-up for the trumper (and reveals face-down trumps to everyone). During the `ROUND_LINGER_MS = 1500` window before `resolveCurrentRound` fires ([apps/304dle/App.tsx:199-202](apps/304dle/App.tsx#L199-L202)), the runtime has the round in `currentRound` (not yet in `completedRounds`). If the player calls Caps during the linger, the engine evaluates obligation against the unresolved in-progress state, where:

- `info.ts:viewerKnowsIdentity` ([engine/info.ts:75](engine/info.ts#L75)) gates the trumper's privileged observation on `inCompletedRound = true`. For the in-progress round, `buildInfoSet` passes `inCompleted = false` ([engine/info.ts:143](engine/info.ts#L143)). The trumper does *not* know the face-down identities.
- `caps-csp.ts:initCtx` ([engine/caps-csp.ts:109-117](engine/caps-csp.ts#L109-L117)) explicitly bails (`return null`) when any in-progress entry is face-down and unknowable. The comment at [caps-csp.ts:141-143](engine/caps-csp.ts#L141-L143) confirms: "Mid-round, even the trumper has not yet observed face-downs (clause 6 fires at round resolution). Suppress."
- `checkCapsObligationCSP` therefore returns `false`.
- No stamp can have been written either: the §T9 reveal that grants the trumper visibility hasn't fired, so no prior `applyPlay`/`trackCapsObligation` call has seen the obligation.
- `isCapsLate` returns `false` (no stamp).
- `submitCaps` verdict: `wrong-not-obligated`. **5-stone penalty for following the engine's own UI hint.**

**Trace.**

1. `applyPlay` for the 4th card (face-down trump) — `trackCapsObligation` fires, CSP bails on in-progress face-down → no stamp.
2. App.tsx sets the 1500ms linger timer.
3. UI redraws — `viewerKnowsEntry` flips face-downs to face-up.
4. Player clicks "Call Caps" → `caps-confirm` modal → cancels the linger timer (App.tsx's `useEffect` re-runs because `appState.kind` changes).
5. Confirm → `submitCaps`:
   - `engine.play.currentRound.length === 4` (round still unresolved).
   - `checkCapsObligation(engine, 'south')` → CSP `initCtx` → bails on in-progress face-down → false.
   - No stamp present.
   - Verdict: `wrong-not-obligated`.

**Diagnosis.** Code bug. The user's in-progress fix in `store.ts` (consult stamp first) is necessary but not sufficient: when the obligation arises *from the §T9 reveal that's about to fire*, no stamp exists during the linger and the CSP cannot evaluate it.

**Proposed code change.** Two-layer fix:

1. **Authoritative fix — pre-resolve the round before evaluating in `submitCaps`.** If `currentRound.length === turnOrder(rt).length`, run `resolveRound(rt)` *first*, then evaluate obligation against the post-resolve state. The linger remains a purely visual smoothing device, but the engine's truth is current at decision time.
   - `apps/304dle/store.ts:submitCaps` — at the top, after building `engine`, branch: if `s.runtime.currentRound.length === turnOrder(s.runtime).length` then call `resolveRound(s.runtime)` and rebuild `engine`. Then proceed to existing logic.
   - Also remove the duplicate `const stamp = …` on line 185 (or merge with line 166).

2. **Defensive fix — `trackCapsObligation` at end of `resolveRound` is already correct** (the trumper's stamp fires at the right instant once resolveRound runs). The fix in (1) ensures that path is reached before evaluation.

**Alternative considered.** Making `applyPlay` auto-trigger `resolveRound` for the round-filling play. Cleaner formally but requires Table.tsx to render the "just-completed last round" during linger instead of `currentRound`. Higher blast radius; defer unless the band-aid in (1) proves insufficient.

**Test to add** (`apps/304dle/__tests__/submit-caps.test.ts`):

```ts
it("'correct' when the obligating §T9 reveal happens on this round and the user clicks during the linger", () => {
  // Build a closed-trump runtime, play out rounds up to a state where:
  //   - team_a has won every completed round
  //   - the in-progress round is full (4 entries)
  //   - one entry is a face-down trump (so §T9 will reveal it)
  //   - the post-resolve state would make south caps-obligated
  // Do NOT call resolveRound. Stamp must be empty.
  // Call submitCaps. Expect verdict 'correct' (not 'wrong-not-obligated').
  // The fix: submitCaps pre-resolves the round before evaluating.
});
```

---

### F2: §1.3.5 — Folded-card public-reveal under-deduction for non-trumpers [P2]

**Claim.** Per rules.md "Resolving Folded Cards": when §T9 fires and the folded trump card is still on the table (cut was an in-hand trump, not the folded card itself), the folded trump card "is shown to all players, then picked up and added to the Trumper's hand." After the lift, the folded card's identity is **public** — every seat saw it. Non-trumpers should be able to constrain "the folded trump card identity X is in the trumper's hand."

**Trace.** `runtime.ts:resolveRound` lines 346-349 lift the folded card into the trumper's hand by pushing the original `trump.trumpCard` onto `hands[trumperSeat]` and setting `trumpCardInHand = true`. `trump.trumpCard` (the identity) is preserved. But `buildInfoSet`:

- [engine/info.ts:89](engine/info.ts#L89): `foldedOnTable = trump.trumpCard !== null && !trump.trumpCardInHand`. After the lift, `trumpCardInHand = true` → `foldedOnTable = false`.
- [engine/info.ts:93-94](engine/info.ts#L93-L94): `knownFoldedCard = isViewerTrumper && foldedOnTable ? trump.trumpCard : null`. Both branches fail for non-trumpers.
- No other field on `InformationSet` represents "publicly known card in seat S's hand." World enumeration freely places consistent cards in the trumper's hand, including worlds where the publicly-revealed identity is *not* in the trumper's hand.

**Diagnosis.** Both — spec gap and code gap.

- Spec: §3 clause 4 says "Public face-down revelations … become public at the moment of reveal." This is sufficient *in principle* to cover the folded-card lift, but only if "public face-down revelation" is interpreted to include the folded trump-card lift as well as cards-played face-down-then-revealed. The formalism doesn't make this explicit, and the implementation drew a tighter interpretation.
- Code: no info-set field models "publicly-revealed card now in seat S's hand."

**Proposed doc change.** In [docs/caps_formalism.md](docs/caps_formalism.md):
- §3 clause 4: extend to read "Public face-down revelations. Face-down cards revealed during round resolution (§T9 trump reveals), **including the folded trump card itself when it is lifted into the trumper's hand**. These become public at the moment of reveal — their identity is in `I_V` for all seats from that point onward, even if the card subsequently moves into a hand."
- §4 add a new W6 (or extend W5): "Publicly-revealed cards subsequently held in seat `Q`'s hand appear in `W.hand[Q]` exactly."

**Proposed code change.** In [engine/info.ts](engine/info.ts):
- Add `knownInHand: ReadonlyMap<Seat, ReadonlySet<CardId>>` to `InformationSet`. Populate for **all** viewers when `trump.trumpCard !== null && trump.trumpCardInHand && trump.isRevealed`: add `trump.trumpCard` to `knownInHand[trumperSeat]`. (For trumpers and open-trump, this is also true and harmless — they already know it via `ownHand`.)
- In `enumerateForTrump` ([engine/info.ts:218](engine/info.ts#L218)): for each `knownInHand[seat]` entry, force-assign the card to the seat's hand slot before enumerating the remaining slots. Equivalent to pre-deducting from `unknown` and shrinking the slot's `size` by the count of forced assignments. Simpler: subtract `knownInHand[seat]` cards from `unknown`, decrement `handSlotsBySeat.get(seat).size`, and materialise the hand by union.
- In `worldIsConsistent` ([engine/info.ts:362](engine/info.ts#L362)): assert `knownInHand[seat] ⊆ world.hands.get(seat)` for every seat.
- In `caps-csp.ts:initCtx` ([engine/caps-csp.ts:61](engine/caps-csp.ts#L61)): subtract `info.knownInHand` cards from `pool` (they are not unknown) and decrement opp.size accounting accordingly. Maintain the existing `pool.size === oppTotal + hiddenSlotCount + foldedUnknownCount` invariant by including these forced assignments.

**Test to add.** Build a state with a closed-trump R3 in which east cuts with 9h face-down, §T9 fires, Jh (folded) lifts to south's hand. View as east. Assert:
- `eastInfo.knownInHand.get('south')` contains `Jh`.
- `enumerateWorlds` produces only worlds where `world.hands.get('south')` contains `Jh`.

**Impact on caps verdict.** Likely small in 304dle today (puzzles are pre-computed and the obligation is for south as trumper, so the trumper's view already has knownFoldedCard). The bug primarily affects the *external* caps predicate (non-trumper viewers) and the worlds-counter UI display ([apps/304dle/worlds-counter.ts](apps/304dle/worlds-counter.ts)) — non-trumpers see an over-large `Worlds` count, mis-grading puzzle difficulty.

---

### F3: §1.3.1 — In-progress face-down trumpSuit over-deduction [P2 for correctness, P3 for impact]

**Claim.** `buildInfoSet` calls `absorbRound` on the in-progress round identically to a completed round ([engine/info.ts:142-144](engine/info.ts#L142-L144)). `enumerateForTrump` builds hidden slots with `forbiddenSuits = {ledSuit, trumpSuit}` regardless of round status ([engine/info.ts:234](engine/info.ts#L234)). The trumpSuit-forbidden constraint's justification (§T9 reveal would have surfaced a trump fold) only applies to *resolved* rounds. For an in-progress round, §T9 has not yet fired; a face-down play could still be a trump cut. Forbidding trumpSuit excludes the actual world.

**Code evidence.** Already cited above. Direct contradiction with caps_formalism §4 W4: "the player couldn't follow, **and a trump fold would have been revealed at round end** — see play_invariants.md §S7." The "would have been revealed at round end" justification fails for the in-progress round.

**Diagnosis.** Code over-deducts; spec is correct as written but only by the implicit reading that "every face-down entry the enumerator processes is in a resolved round."

**Impact assessment.** Narrower than feared:
- **CSP caps path (the production path in 304dle):** `caps-csp.ts:initCtx` ([engine/caps-csp.ts:109-117](engine/caps-csp.ts#L109-L117)) bails before world enumeration if any in-progress entry is face-down and unknowable. So the over-deduction never reaches the obligation predicate.
- **World-enumeration paths (`validateCapsCall`, `explainCapsFailure`, `checkClaimBalance`, `worlds-counter`):** all affected. `validateCapsCall` is dead code in 304dle (replaced by CSP); `explainCapsFailure` could give a misleading "no consistent world" answer if called mid-round; `checkClaimBalance` is house-rule-only and likely OK to defer; `worlds-counter` UI display would *understate* the world count mid-round.

**Proposed doc change.** [docs/caps_formalism.md §4 W4](docs/caps_formalism.md):
- Insert: "This constraint applies to face-down entries in **completed** rounds only. For face-down entries in the in-progress round, the trump-fold reveal has not yet fired; a face-down cut is still possible. The hidden-slot suit constraint for in-progress entries is `forbiddenSuits = {ledSuit}` only."

**Proposed code change.** In [engine/info.ts](engine/info.ts):
- Extend `HiddenSlot` with `inProgress: boolean` (or `revealsPending: boolean`).
- `absorbRound` passes the flag through; `enumerateForTrump` line 234 conditionally builds `forbidden = inProgress ? new Set([hs.ledSuit]) : new Set([hs.ledSuit, trumpSuit])`.
- `worldIsConsistent` line 411 — mirror the conditional check.

**Test to add.** Construct a mid-round state where one of the unknown worlds requires the in-progress face-down to be a trump cut. Assert `enumerateWorlds` yields at least one such world.

---

### F4-a: §1.3.4 — Folded card known to trumper [P3, doc only]

**Claim.** `info.ts:93-94` correctly tracks `knownFoldedTrumpCard` for the trumper when the folded card is on the table. This is in the spirit of clause 6 ("trumper's privileged observations"), but clause 6 as written only mentions "face-down cards V inspected at end-of-round resolution," not the folded trump card the trumper committed pre-play.

**Diagnosis.** Doc gap only. The implementation is correct.

**Proposed doc change.** [docs/caps_formalism.md §3](docs/caps_formalism.md):
- Extend clause 6 to read: "Trumper's privileged observations (only if `V` is the trumper): the identity of every face-down card `V` inspected at end-of-round resolution, regardless of whether it was revealed publicly. This includes face-down minuses by opponents and partner. **Additionally, while the folded trump card sits face-down on the table (pre-§T9-reveal), the trumper knows its identity by virtue of having placed it.**"

### F4-b: §1.3.2 — Trumper face-down §T-4 constraint, mid-round opponent view [P3]

**Claim.** For a **non-trumper** viewing a **mid-round face-down by the trumper**: a hidden slot is created with `forbiddenSuits = {ledSuit, trumpSuit}`. But by §T-4, the trumper's face-down options are (a) the folded trump card (trump-suit) or (b) a non-trump-suit, non-led-suit card. Option (a) means the slot's card *can* be trump-suit. Forbidding it excludes the cut-with-folded-trump world.

**Resolution.** When the trumper plays the folded trump card as a cut, [runtime.ts:160-165](apps/304dle/runtime.ts#L160-L165) sets `rt.trump.trumpCard = null`. From the post-play state, `foldedOnTable = false`, so `buildInfoSet` does not create a separate folded slot — meaning the folded-card identity should logically appear *in the hidden slot for the trumper's face-down*. But the slot's forbidden-suits excludes trump-suit, so no world places the folded trump card there. Card conservation fails (one trump card unaccounted for), and `totalCapacity !== unknown.length` at [info.ts:269](engine/info.ts#L269) causes enumeration to yield zero worlds — silently. The probe I wrote (deleted) hit exactly this issue.

**Diagnosis.** Code over-deducts in this subcase. Combined with F3, the fix is the same: don't forbid trumpSuit on in-progress hidden slots. For the trumper's own face-down slot specifically, even when the round is in-progress, the slot *can* be the folded trump.

**Proposed code change.** Covered by F3. Additionally: if `hs.seat === trumperSeat`, even after F3's relaxation, the slot remains correct (forbidden = {ledSuit}; trump-suit allowed, representing the folded-trump-cut case).

**Test to add.** Build a state mid-round where the trumper played a face-down cut with the folded trump (after the cut, before the round resolves). View as a non-trumper. Assert `enumerateWorlds` yields at least one world, and that world's hidden-slot assignment is the trump card.

---

### F5: §1.3.3 — Forced-play retroactive deduction (§T-8) [P4, spec gap]

**Claim.** §T-8 (Exhausted Trumps) is a forced play: if the trumper has priority + holds trump + nobody else holds trump, trumper *must* lead trump. Observing that the trumper *did not* lead trump (when otherwise eligible) is evidence somebody else holds trump.

**Diagnosis.** Spec gap, but reasonable to declare out of scope. The world enumerator does not reason backwards from "this play was legal under the rules ⇒ what does that imply about hidden state." Doing so would require encoding the legal-plays predicate as a constraint, which substantially complicates the CSP.

**Proposed doc change.** [docs/caps_formalism.md §12 (Out of scope)](docs/caps_formalism.md):
- Add: "**Retroactive deduction from forced plays.** Inferences of the form 'seat X did not play in suit S despite having priority + a rule that would have forced them to' (e.g. §T-8 Exhausted Trumps) are not captured by `Worlds(I_V, S)` as defined. The world enumerator constrains hand contents from observed face-up plays, suit-exhaustion events, and §T9 reveals — not from the absence of plays the rules would have forced. Adding this would require modeling the legal-plays predicate as a per-world consistency constraint. Out of scope for v1; revisit if specific puzzles surface where this inference is dispositive."

**Proposed code change.** None — explicit non-goal.

---

### F6: §1.3.6, §1.3.7 — Card-elimination and trump-count deductions [verified]

These fall out cleanly of W1 (card conservation) + W3 (suit-exhaustion) + W5 (identity agreement):

- **F6-a (§1.3.6):** if south has tracked every heart except 9h, and only one seat is non-void in hearts, world enumeration's per-slot suit constraints + the "unknown" pool partition force 9h to the sole eligible seat. The existing CSP path (`isFeasible` Hall-condition check at [engine/caps-csp.ts:391-403](engine/caps-csp.ts#L391-L403)) captures the same logic without explicit enumeration.

- **F6-b (§1.3.7):** trump-count tracking is a derived consequence of W1 (every card is somewhere). The CSP's `pool` set + per-seat `opp.size` + exhaustion bookkeeping computes it implicitly. `oppIsSoleTrumpHolder` ([engine/caps-csp.ts:405-414](engine/caps-csp.ts#L405-L414)) and `computeTrumpHolders` ([engine/caps-csp.ts:416-428](engine/caps-csp.ts#L416-L428)) use this to fire the must-lead-trump rule in opp-leads. Efficient and correct.

No findings.

---

### F7: §2.3.1, §2.3.3, §2.3.4, §2.3.5 — Timing/rotation/window [verified correct]

- **§2.3.1 `trackCapsObligation` ordering inside `resolveRound`:** [runtime.ts:323-376](apps/304dle/runtime.ts#L323-L376). Sequence: compute winner → §T9 reveal → push to `completedRounds` → clear `currentRound`/increment `roundNumber` → call `trackCapsObligation`. At call time, the just-resolved round is in `completedRounds` and the trumper's clause-6 visibility applies. Correct.

- **§2.3.3 Lenient-policy math:** `vPlaysAtObligation = (roundNumber - 1) + (playedInCurrent ? 1 : 0)`. After `resolveRound`, `roundNumber` has incremented and `playedInCurrent = false`, so `vPlaysAtObligation` equals the count of cards south played *up through the round that triggered obligation*. `isCapsLate` uses the same formula at call time; `vPlaysNow > vPlaysAtObligation` iff south played strictly more cards than at stamp time. Matches caps_formalism §8.3 lenient policy ("no event of type 'V plays a card' lies strictly between S* and t_call").

- **§2.3.4 Seat rotation in `generate-scripted`:** [tools/puzzles/generate-scripted.ts:229-242](tools/puzzles/generate-scripted.ts#L229-L242). Standard cyclic rotation: shift = (south_idx − target_idx + 4) % 4; applied to all of hands, trumper, priority, and every script entry. Symmetric across all seats — no asymmetry to introduce a bug. Verified by re-derivation.

- **§2.3.5 R8 final-card boundary:** Double-guarded.
  1. `trackCapsObligation` ([engine/caps.ts:159-161](engine/caps.ts#L159-L161)): `callWindowClosed = roundNumber === 8 && currentRound.length >= expectedRoundSize` returns early.
  2. `resolveRound` ([apps/304dle/runtime.ts:368-374](apps/304dle/runtime.ts#L368-L374)): only calls `trackCapsObligation` after resolve if `roundNumber <= 8`. After R8 resolves, `roundNumber === 9` so no call.
  
  No stamp can be written at or after the close of the call window. Correct.

---

## Spec gaps (concrete edits to `docs/caps_formalism.md`)

1. **§3 clause 4** — extend to cover folded-trump lift identity (see F2).
2. **§3 clause 6** — extend to cover the trumper knowing the folded-trump-card identity pre-lift (see F4-a).
3. **§4 W4** — restrict to completed rounds only; add explicit handling for in-progress face-down slots (see F3).
4. **§4 add W6** (or extend W5) — publicly-revealed cards in a hand are constrained to that hand (see F2).
5. **§12 Out of scope** — add forced-play retroactive deduction as an explicit non-goal (see F5).

## Implementation findings (concrete edits, separate from spec gaps)

1. **`apps/304dle/store.ts:submitCaps`** [F1, P1] — remove duplicate `stamp` declaration; add round-fill pre-resolve before evaluating obligation.
2. **`engine/info.ts`** [F2, P2] — add `knownInHand` field; populate from `trump.trumpCard + trumpCardInHand + isRevealed`; thread through enumeration and consistency checks.
3. **`engine/info.ts` + `caps-csp.ts`** [F3 + F4-b, P2] — flag in-progress hidden slots; relax their forbidden-suits to `{ledSuit}` only.
4. **No code change** for F4-a, F5, F6, F7.

## Non-findings (investigated and verified correct)

- §1.3.6 Card-elimination via own-hand subtraction
- §1.3.7 Composite trump-count deduction
- §2.3.1 trackCapsObligation timing in resolveRound
- §2.3.3 Lenient-policy lateness math
- §2.3.4 Seat rotation in generate-scripted
- §2.3.5 R8 final-card boundary

---

## Priority recommendations for next session

1. **P1 first** — land the user's in-progress `store.ts` work (resolve the duplicate-`stamp` parse error), then extend `submitCaps` with the round-fill pre-resolve from F1. Add the failing-test-then-passing-test pair sketched in F1. This is the only finding with a direct, demonstrable player-harm path (5-stone penalty for following the UI hint).

2. **P2** — F2 (folded-card lift identity). Most impactful for the *external* caps predicate and the worlds-counter difficulty grading. Affects the formalism's external-caps interpretation.

3. **P2** — F3 + F4-b (in-progress hidden slot suit constraints). Code change is small; spec change is small. Low risk because the CSP-path caps verdict is already protected; primarily aligns the world-enumerator with the formalism.

4. **P3+** — F4-a, F5 are doc-only and can be batched.

## Methodology notes

I wrote probe tests for §1.3.1 and §1.3.5 and confirmed the bugs by static reading after the probes hit card-conservation errors in my fabricated states (the bug was in my states, not in the engine). The findings stand on direct code citations; constructing legal end-to-end counter-examples is straightforward future work but not necessary to establish the diagnoses. The proposed tests in F1/F2/F3 are the right place to invest that work.

I did **not** modify production code. The user's WIP in `store.ts` overlaps with F1 and must be merged or reverted before further edits land.

*End of report.*
