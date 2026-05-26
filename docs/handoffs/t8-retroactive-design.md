---
title: 304 — §T-8 Retroactive Deduction — Design Doc
status: OPEN; investigation output (2026-05-26). Pre-implementation design.
audience: a future session deciding whether to ship the §T-8 retroactive constraint
sibling docs:
  - deductions-audit.md (the parent — §2.1 / §5.1 raised this as the priority gap)
  - info-set-followup-investigations.md (§6 — the brief this doc fulfils)
  - ../specs/caps_formalism.md (§12 currently lists this deduction as explicit non-goal)
  - ../specs/play_invariants.md §T8 (the rule itself)
---

# Mission

The deductions-audit identifies §T-8 retroactive deduction — inferring
"a non-trumper held trump at past time `r_lead`" from observing the
trumper *not* leading trump despite the §T-8 trigger conditions — as
the only forced-play absence with deductive content beyond W3, and
the priority item if/when a session escalates that file.

This doc is the design output requested by [info-set-followup-investigations.md §6](info-set-followup-investigations.md).
It is **pre-implementation**: it specifies the inference precisely,
catalogues encoding options, walks a worked example, estimates cost
and reach, and recommends a ship/defer call.

It does *not* land code. A follow-up session should pick this up as
implementation input.

---

# 1. The inference, precisely

## 1.1 §T-8 (recap)

[play_invariants.md §T8](../specs/play_invariants.md):

> If the trumper has priority, leads, has any trump in hand, and no
> other player holds any trump-suit card, the trumper must lead a
> trump-suit card. Applies in both modes after trump is revealed;
> does not apply in PCC.

`legalPlays` enforces this forward (engine/play.ts:43–51 — see the
`seatsWithTrumps.size === 1 && seatsWithTrumps.has(seat)` guard). The
CSP enforces it forward during the adaptive opp quantifier
(`caps-csp.ts:oppIsSoleTrumpHolder` → `computeOppCandidates` line
~351, restricts opp-lead candidates to trump when sole holder).

The asymmetry: the engine enforces §T-8 forward (the rule), but it
does not use the absence of a §T-8-required lead as backward evidence.

## 1.2 The retroactive observation

Define a **§T-8 witness event** as a past play `e` in the viewer's
event log such that all of the following held at the moment of `e`:

1. `e` is a lead (`isLead = true` — `inProgress.length === 0` at `e`'s
   time, ignoring PCC-out).
2. The play seat is the trumper.
3. Trump is revealed (in open trump, true throughout; in closed
   trump, holds from the §T9 firing event onward).
4. Game is non-PCC (PCC is excluded from §T-8).
5. `e` was face-up and not of the trump suit.

(Note: condition 5 must hold in the actual observed play. The
trumper *could* have legally led trump or a non-trump under §T-8
unless they were the sole trump holder; observing non-trump is the
forensic signal.)

The retroactive inference for the viewer is:

> **§T-8 retro:** in every consistent world `W`, either the trumper
> held zero trump in hand at time `e`, or at least one non-trumper
> held at least one trump-suit card at time `e`.

Equivalently (negating): `W` is inconsistent if, under `W`, the
trumper held ≥1 trump AND every non-trumper held 0 trump at time `e`.

## 1.3 Reducing "held at time e" to current-state quantities

A world `W` only records *current* hand contents. To recover hand
contents at past time `e`:

```
hand_Q at time e  =  hand_Q at S_now ∪ { cards Q played after time e }
                  =  hand_Q^now ∪ playedSince(Q, e)
```

The viewer knows `playedSince(Q, e)` for face-up plays directly. For
face-down plays, the *suit* is constrained (W4 case table) but the
identity is only known to specific viewers (own plays, trumper's
clause-6 observations). Under a world `W`, every face-down identity
is fixed by `W.hiddenSlotAssignments`, so `playedSince(Q, e)` is
fully determined per world.

Therefore the §T-8 retro check is purely a function of `(W, e)`:

```
hand_Trumper_at_e_in_W  = W.hand_Trumper ∪ played-by-trumper-since-e (from W)
                          ∪ folded-card-not-yet-lifted-at-e (if applicable)

hand_NonTrumper_at_e_in_W = analogous for each non-trumper
```

Then check: `(trumper has ≥1 trump at e in W) ∧ (∀ NT: NT has 0 trump at e in W)`
→ reject `W`.

## 1.4 Folded-card subtlety

The folded trump card complicates the trumper's at-time-e trump
count by one bit:

- If `e` is in closed trump before §T9: the folded card is on the
  table, not "in hand" — does not count toward the §T-8 "trump in
  hand" trigger. But §T-8 requires trump revealed, which in closed
  trump means §T9 has already fired. So `e` strictly post-§T9 →
  folded card has been lifted (or was itself the §T9-revealing
  cut, in which case it's no longer in any hand). Either way,
  the folded-card's location at time `e` is *known* from the
  history: lifted-to-trumper, or played-as-the-cut. No ambiguity.
- In open trump from start: §T-8 fires from R1; the folded card was
  shown pre-play and is in the trumper's hand. The trumper's trump
  count includes it iff still in hand at time `e` (i.e., not yet
  played).

In both cases, the bit is recoverable from the public event log
without ambiguity.

## 1.5 What §T-8 retro does NOT tell us

- It does NOT tell us *which* non-trumper held trump at `e`. Just
  that some non-trumper did.
- It does NOT tell us *which* trump card. Just that ≥1 of the
  non-played-by-trumper trumps was in a non-trumper hand at `e`.
- It does NOT tell us anything about hand contents at `S_now` *if*
  the implicated trump was played between `e` and `S_now`. Tracing
  which seat played it requires the world's hidden-slot
  assignments (face-up trump plays are already known).

The constraint binds the world set, but it's an *existential* over
seats and trump cards, not a specific localisation.

---

# 2. What it gives 304dle vs. the engine library

## 2.1 In 304dle today

- South = trumper = viewer. The trumper sees their own hand. They
  always know whether they themselves are the sole trump holder
  (W5: ownHand identity). So a §T-8 retro inference about south's
  own past leads gives south zero new information — south already
  knew their hand at every moment.
- **Net 304dle impact: zero.** Same as the W4 refinement (A2) and
  the open-trump pre-play reveal (A1): structurally correct for
  the engine library but invisible in current 304dle.

## 2.2 In the engine as library

- Non-trumper viewer ("opp seat") reasoning about a trumper's past
  lead: §T-8 retro adds a real constraint. Quantifying *how often*
  it shifts an obligation result requires the puzzle-corpus
  benchmark from [info-set-followup-investigations.md §2](info-set-followup-investigations.md).
- External-caps reasoning is the natural consumer: external-caps
  callers are non-trumpers, and the trumper's lead history is one
  of the few information sources they have about opp hand contents.

## 2.3 Frequency intuition

The §T-8 trigger requires (a) trump revealed and (b) trumper has
priority and leads. In a typical 304 deal:

- Trump-reveal in closed trump fires when a face-down cut happens,
  typically R2–R4.
- The trumper gets priority by winning rounds. Trumpers who are
  caps-callable tend to *be* winning rounds.
- So the trumper-leads-after-reveal positions are common (every
  round the trumper wins, post-§T9).
- Of those, the trumper choosing not to lead trump occurs whenever
  they're not the sole trump holder *or* they've chosen non-trump
  for some other reason (e.g., setting up a slam in another suit).
- The forensic signal only fires when the trumper *was* sole trump
  holder under some hypothesis world and *didn't* lead trump. In
  practice this rules out exactly the "trumper holds all remaining
  trump" subset of worlds.

The most common application: pruning the "trumper sweeps remaining
trumps" world subset when the trumper has demonstrably chosen to lead
non-trump in a recent round. This subset would otherwise contribute
false-negative obligation answers when a non-trumper viewer reasons
about whether they have the trumps for a caps call themselves.

---

# 3. Encoding options

Three concrete approaches, ordered by scope.

## Option A — Per-world post-hoc legality filter (general)

After `enumerateWorlds` materialises a world `W`, run a full
legality replay: walk the event log from R1 forward, reconstruct
hands per `W`, and call `legalPlays` for every play. Reject `W` if
any play was illegal under `W`.

**Pros.**

- General: extends to any forced-play pattern, not just §T-8.
- Subsumes future patterns mechanically (§T-1, §T-6, §T-7 round-1
  trumper rules — though those have no information gain per
  [deductions-audit.md §2.2](deductions-audit.md)).
- Composable with the W4 case table; no new info-set fields.

**Cons.**

- Walks every play per world. ~32 events × small per-event cost.
  Bounded but non-trivial; at 1k worlds per state, ~32k
  `legalPlays` calls per `enumerateWorlds`. Each call is O(hand-size).
- Doesn't compose with the CSP path. The CSP doesn't materialise
  worlds; this approach has no CSP analogue.

**Where to add it.** New function `worldRespectsLegality(W, info,
events)` called inside `enumerateForTrump`'s yield (or via
`worldIsConsistent`, mirroring the W4 mirror).

## Option B — §T-8-specific aggregate current-state constraint (targeted)

Derive, at `buildInfoSet` time, a list of §T-8 witness events. For
each, compute:

```
unsatisfiedTrumpsSince_e = (number of trump cards known played by
                            non-trumpers between e and S_now)
```

Cases:

- `unsatisfiedTrumpsSince_e ≥ 1`: the §T-8 retro observation is
  *already satisfied* by the visible play history. No further
  constraint.
- `unsatisfiedTrumpsSince_e = 0`: at least one non-trumper trump
  from time `e` must currently sit in a non-trumper hand at `S_now`.
  Adds a current-state aggregate constraint:

  > Sum of trump-suit cards across non-trumper hands at `S_now` ≥ 1.

Folded-card adjustment: any trumper-trumps-played-between-e-and-now
(face-up) reduce the trumper's at-time-e trump count by their
played count. This affects whether the §T-8 retro is even
applicable (it requires the trumper had ≥1 trump at `e`); if all
trumps known to have been at the trumper at time `e` are now
accounted for and the trumper has none left, the inference
short-circuits.

**Pros.**

- Single aggregate constraint per witness event — cheap to evaluate.
- Translates directly into a CSP constraint: "pool trump count
  allocated to non-trumpers ≥ 1." Easy to add to `initCtx` and
  `isFeasible` / branching rejection.
- Easy to test in isolation.

**Cons.**

- §T-8-specific. Won't reuse for hypothetical future forced-play
  patterns.
- The aggregate loses world-level localisation: it can't say
  *which* non-trumper holds the trump, even when the original
  observation might support a tighter constraint via combined
  exhaustion data.

**Where to add it.** New info-set field
`retroForcedNonTrumperTrumps: number` (the minimum count required
in non-trumper hands). `enumerateForTrump` rejects worlds where
non-trumper hand trump count < this minimum. CSP `initCtx`
augments `isFeasible` / `oppIsSoleTrumpHolder` analogously.

## Option C — Per-world replay restricted to §T-8 witness events (targeted, fine-grained)

The hybrid: pre-compute the §T-8 witness event list once during
`buildInfoSet`. Per world, walk only those events (not the full
log) and check the §T-8 condition. The non-§T-8 forced-play rules
are not checked (subsumed by W3 / not deductive).

**Pros.**

- More precise than Option B (per-world, not aggregate). Catches
  cases where Option B's aggregate is satisfied vacuously by some
  worlds but tight in others.
- Cheaper than Option A (only the witness events, not the full
  log).
- Composes with the W4 case table.

**Cons.**

- More code than Option B. The per-world replay logic needs care
  around face-down identities (W4-d / W4-e cases).
- Like Option A, no CSP analogue — CSP requires aggregate Option-B
  derivation.

**Where to add it.** Companion to `worldIsConsistent`; rejected
worlds are dropped from the generator.

## Comparison

| Aspect | A (general) | B (aggregate) | C (per-event replay) |
|--------|-------------|---------------|----------------------|
| Generality (other forced-play) | yes | no (§T-8 only) | no (§T-8 only) |
| World-enum integration | yes | yes | yes |
| CSP integration | no | **yes** | no |
| Per-world cost | high | none (pre-checked) | low (witness events only) |
| Per-world precision | full | aggregate | full |
| Code surface | medium | small | medium |

The CSP-integration row is the deciding factor. 304dle's primary
obligation engine is the CSP path (`checkCapsObligationCSP`);
world-enum is reserved for `validateCapsCall`, `explainCapsFailure`,
`checkClaimBalance`, and other secondary paths. A §T-8 retro
implementation that misses the CSP misses the path that actually
determines 304dle's puzzle correctness.

---

# 4. Worked example

A non-trumper viewer (south observing a north-trumper game), where
§T-8 retro shifts an obligation answer.

## 4.1 Setup

Closed trump, no PCC. Seats anticlockwise from south: south, east,
north, west. Trumper = north. Trump suit = spades. Folded card = J♠
(only the trumper knows pre-§T9).

Hands (full deal — given for reproducibility; the south viewer
sees only south's hand and public history):

| Seat | Cards |
|------|-------|
| north | (J♠ folded) + 7♠ 9♣ A♣ K♣ Q♣ 8♦ 7♦ |
| east | A♠ 9♠ 7♥ J♥ 9♥ K♥ Q♥ 8♥ |
| south | J♣ 10♣ 8♣ K♦ A♦ 10♦ Q♦ J♦ |
| west | 10♠ K♠ Q♠ 8♠ 9♦ A♥ 10♥ 7♣ |

(South's view = own hand only at deal time.)

## 4.2 Event sequence

| R | Lead/Plays | Notes |
|---|------------|-------|
| 1 | north leads 9♣ (face-up; closed-trump R1 §T-6 forbids trump). East 7♣ (wait — east doesn't have 7♣ in deal). | Let me restate — adjusting deal. |

The example construction is sensitive to many micro-details (deal
legality, face-up/face-down choices, §T9 timing). Rather than fully
synthesising one here, I'll describe the *shape* the worked example
must take, and leave the exact card list to the test-construction
session:

1. **R1.** North (trumper) leads non-trump face-up. All seats
   follow face-up. North wins R1 (carry the trump-leadable position
   into R2).

2. **R2.** North leads non-trump face-up. Some opp cuts with a
   face-down trump (a low spade) and wins R2. §T9 fires: trump is
   now revealed; the cut spade flips face-up; the folded J♠ lifts
   into north's hand (W6 fact: south knows J♠ is in north's hand
   from R3 onward).

3. **R3.** The R2-cutter (say west) leads. The round resolves
   normally; north wins R3 (priority returns to north).

4. **R4 lead — the §T-8 witness event.** North has priority, leads.
   §T-8 says: if north holds trump and no other player holds trump,
   north must lead trump. North plays a **non-trump face-up** card.
   South observes this.

   South's deduction: under §T-8 retro, either north has no trump
   at R4 lead time, or some other seat has trump. South already
   knows north holds J♠ in hand (W6 from §T9 lift in R2 → R3
   onward). So "north has no trump" is false. Therefore: at R4 lead
   time, at least one non-trumper held trump.

   In the deal, west started with 10♠ K♠ Q♠ 8♠ and has played the
   cut 8♠ in R2; west still holds 10♠ K♠ Q♠. So the inference is
   correct against the actual world.

5. **R5–R8.** South's caps-obligation question at some later state
   `S_now`: does south's team (south + north) sweep the remaining
   rounds?

## 4.3 Without §T-8 retro

The world enumerator's W1–W6 catalogue would include worlds where:

- North holds the entire remaining trump suite (e.g., north has J♠
  and a fictional reassignment puts 10♠ K♠ Q♠ in north's
  unaccounted-for slots, with west's trumps "moved" to other
  non-played slots).

Wait — actually, world enumeration respects W2 (hand sizes) and W3
(suit exhaustion). If west played a face-down minus (cut) in R2,
W3 doesn't mark west exhausted in spades (the cut was a trump, not
an off-led-suit play; in fact west *demonstrated* spades).

The world enumerator currently *doesn't* distinguish "north has J♠
and three other trumps" from "north has J♠ alone with trumps
distributed elsewhere" — both are consistent with W1–W6. The §T-8
retro rules out the first.

## 4.4 With §T-8 retro

The aggregate Option-B constraint: "at least one trump-suit card
in non-trumper hands at `S_now`." Equivalently: "north is not the
sole holder of remaining trump at `S_now` (unless trump played
between R4 lead and `S_now` zeroes the inference)."

This constraint, at the CSP level, is exactly the negation of
`oppIsSoleTrumpHolder(trumper)`-from-the-non-trumper-perspective.
The CSP can add it as a static feasibility check at `initCtx`.

The effect on the obligation answer: worlds where north is sole
trump holder are eliminated. If south's caps-strategy depends on
some non-trumper having a beatable trump for north to absorb (or
on west not surprising south's strategy with a late trump cut),
removing the "north has all trumps" worlds may flip the answer
from "not obligated" to "obligated."

## 4.5 Honest caveat

I have not (in this session) constructed a complete numeric
example through to obligation flip — the same problem the v2-A
handoff flagged in §3 caveat 1 ("couldn't pin down a self-
consistent scenario where the W6 fix *alone* flips the obligation
answer"). The implementation session should attempt this both as a
test fixture and as a sanity check on the design.

---

# 5. Performance estimate

## 5.1 Option A (full per-world legality replay)

- `worldRespectsLegality(W, info, events)` walks ~32 events.
  Per-event: hand reconstruction is O(hand-size); `legalPlays` is
  O(hand-size).
- Per world: ~32 × O(8) ≈ 256 basic ops.
- At 1000 worlds per `enumerateWorlds` call: 256k ops. Negligible.
- At 5000 worlds (MAX_WORLDS cap): 1.28M ops. Single-digit ms.

## 5.2 Option B (aggregate)

- One-shot computation at `buildInfoSet`. Cost: walk the event log
  once to detect §T-8 witness events. O(rounds × seats) = O(32).
- Per-world: zero (constraint is pre-checked / used in enumerator
  pruning).
- CSP impact: one extra feasibility check per node ≈ O(opp-count).
  Lost in the noise.

## 5.3 Option C (per-world witness-event replay)

- Pre-computation: same O(32) as Option B.
- Per world: one pass over the witness events (typically 0–3). O(1).
- Total: linear in worlds × O(1). Negligible.

**Verdict.** Performance is not a discriminator. Option A is fine
for world-enum; Options B/C are essentially free.

---

# 6. CSP integration sketch (Option B)

Goal: add the aggregate "non-trumper holds ≥ 1 trump" constraint
to `checkCapsObligationCSP` for non-trumper viewers.

## 6.1 Pre-computation (during `buildInfoSet`)

Add an info-set field:

```ts
interface InformationSet {
  // ... existing fields ...

  // §T-8 retroactive aggregate. The minimum number of trump-suit
  // cards that must lie in non-trumper hands at S_now to satisfy
  // §T-8 retro across all observed witness events. Computed from
  // the event log; zero when no witness event imposes a binding
  // constraint. See docs/handoffs/t8-retroactive-design.md.
  retroNonTrumperTrumpMinimum: number;
}
```

For each §T-8 witness event `e`, compute:

```ts
const trumpsPlayedByNonTrumpersBetween_e_and_now = ...;
if (trumpsPlayedByNonTrumpersBetween_e_and_now === 0) {
  // Constraint binds: at least one trump must currently be in
  // a non-trumper hand.
  minimum = Math.max(minimum, 1);
}
```

(The constraint never exceeds 1 from a single witness event,
because §T-8 says "≥ 1 trump in some non-trumper hand at `e`." Two
distinct witness events might each force ≥ 1, but the constraints
are the *same trump* unless the events are separated by a
non-trumper trump play — in which case the second event's
constraint resets. The maximum over events is the right
aggregation.)

## 6.2 CSP application

In `initCtx`, after building the opps map:

```ts
const trumpsInPoolCount = [...pool].filter(c => suitOf(c) === trumpSuit).length;
const trumpsInForcedNonTrumper = ...; // sum over non-trumper opps' forced sets
const trumpsAvailableForNonTrumpers = trumpsInPoolCount + trumpsInForcedNonTrumper;

if (trumpsAvailableForNonTrumpers < info.retroNonTrumperTrumpMinimum) {
  return null; // infeasible from the outset
}
```

In `isFeasible` and at branch points where a trump is "consumed"
into the trumper's hand, track remaining-trump-capacity and prune
branches that would zero out non-trumper-trump availability when
the retro minimum > 0.

In `oppIsSoleTrumpHolder` (for the trumper-as-target case): the
function asks "is opp X the sole remaining trump holder?" If
`retroNonTrumperTrumpMinimum > 0` and X is the trumper, the
answer is forced *false* (some non-trumper must hold trump
somewhere). This eliminates the §T-8 forward-rule firing on the
trumper during the search, which was the original problem.

## 6.3 World-enum application

In `enumerateForTrump`, before yielding a world, check:

```ts
const nonTrumperTrumpCount = sumOver(nonTrumperSeats, seat =>
  world.hands[SEAT_INDEX[seat]].filter(c => suitOf(c) === trumpSuit).length
);
if (nonTrumperTrumpCount < info.retroNonTrumperTrumpMinimum) {
  continue; // skip world
}
```

Same check in `worldIsConsistent`.

## 6.4 Soundness

The constraint is sound iff §T-8 was actually triggered at `e`.
Triggers:

- Trumper had priority and led: directly observable.
- Trumper held ≥ 1 trump at `e`: requires tracking the trumper's
  trump count at time `e`. Reconstructible from event log + W6
  (folded card location).
- Trump was revealed at `e`: requires `e.round > §T9-fire-round`
  in closed trump, or always in open trump. Observable.
- Trumper led non-trump face-up: directly observable.
- Non-PCC: trivially checked.

All conditions are observable from public information. The
constraint is sound.

---

# 7. Recommendation

## 7.1 Ship/defer

**Defer for 304dle. Implement when an engine-as-library use case
materialises.**

Reasons:

- Zero impact on 304dle's puzzle correctness (always-trumper-south).
- Same status as A1 (open-trump pre-play reveal) and A2 (W4 case
  table refinement): both are listed as "engine-as-library only"
  in [info-set-completeness-v3-handoff.md](info-set-completeness-v3-handoff.md);
  this should join them at similar priority.
- Cost-benefit for engine library: half day of code (Option B) plus
  the worked-example construction (a few hours) plus the
  puzzle-corpus benchmark from [info-set-followup-investigations.md §2](info-set-followup-investigations.md)
  to validate. Total: 1–1.5 days of focused work.

## 7.2 If/when implemented

1. **Use Option B (aggregate current-state CSP constraint).**
   CSP-integrable, cheap, sound. Generality is worth less than CSP
   coverage since the §T-8 case is the only known applicable case.
2. **Add the info-set field `retroNonTrumperTrumpMinimum`** with
   the computation in §6.1.
3. **Mirror in `worldIsConsistent` + `enumerateForTrump`** (§6.3)
   so the world-enum path stays sound.
4. **Test fixtures.** Two:
   - The §4 worked example, fully concretised, with `expected.obligated`
     flipping when `retroNonTrumperTrumpMinimum > 0`.
   - A negative case: a state where a §T-8 witness event exists
     but `trumpsPlayedByNonTrumpersBetween_e_and_now > 0` —
     constraint should *not* bind, obligation answer unchanged.
5. **Spec update.** Remove "Forced-play retroactive deductions"
   from [../specs/caps_formalism.md §12 non-goals](../specs/caps_formalism.md),
   add a new §3 clause 7 covering the inference, and add a W4 / W6
   sibling constraint W7 (or extend §4 with the aggregate).
6. **Cascade.** The §T-8 implementation creates a template for any
   future forced-play retroactive inferences that the Long-2011
   investigation (§3 of followup-investigations) may surface.

## 7.3 If NOT implemented

Keep the spec's §12 non-goal text as-is. Add a stable pointer from
that bullet to this design doc so a future returning reader has the
analysis without reconstructing it.

---

# 8. Open questions for the implementation session

1. **Multi-event interaction.** Two §T-8 witness events `e_1 < e_2`
   with a non-trumper trump play between them: `e_1`'s constraint
   is consumed by the play, `e_2`'s constraint is fresh. The
   aggregate-maximum derivation in §6.1 handles this case (each
   event recomputes its own count of trumps-played-since-event).
   But: what if a face-down minus *might* have been a non-trumper
   trump under some worlds? The aggregate Option B computes a
   conservative minimum (treats face-down minuses as "unknown,
   assume not a trump"); some worlds where the face-down was in
   fact a trump are not pruned. Option C catches this; Option B
   doesn't. For 304's W4 case table, non-trumper face-downs in
   completed rounds are forbidden from being trump (W4-a), so the
   gap only opens for in-progress non-trumper face-downs (W4-b) at
   the time `e_2` was logged. The implementation session should
   verify Option B doesn't over-prune in this edge case.

2. **Interaction with B2 (CSP pigeonhole pre-pass).** Both
   manipulate `forced` / pool aggregates. They should compose
   cleanly: the pigeonhole pre-pass adds *specific* forced
   placements; §T-8 retro adds an *aggregate* minimum. Sequence
   matters: run pigeonhole first (may add forced trump to a
   specific non-trumper, satisfying §T-8 retro automatically),
   then check §T-8 retro on the residual.

3. **Should §T-8 retro fire mid-round?** A witness event mid-round
   (the trumper has just led non-trump in the current round) is
   the most recent observation. The aggregate constraint should
   bind from that moment, not just from the round-resolution
   event. This means `buildInfoSet` must scan `currentRound` plus
   `completedRounds` for witness events.

4. **External-caps vs caps.** External-caps callers are precisely
   the non-trumpers for whom §T-8 retro matters. Verify the same
   info-set path is taken for both `checkCapsObligation` and any
   external-caps entry point (today the external-caps surface is
   minimal — see [info-set-followup-investigations.md §5](info-set-followup-investigations.md)).

5. **PCC.** §T-8 is excluded in PCC. The witness-event detector
   must check `pccPartnerOut === null` (or, equivalently, skip
   when in PCC). PCC paths should be guarded at the top per A5 /
   [info-set-completeness-v3-handoff.md §7](info-set-completeness-v3-handoff.md)
   anyway.

# 9. Related work — re-reading suggestions

The two pieces of literature most likely to contain a named
analogue of §T-8 retroactive inference:

- **Long 2011 §"strict rule inference."** Skat has forced-play
  rules (e.g., Bedienpflicht — follow-suit obligation). If the
  thesis catalogues retroactive inference from forced-play
  patterns, it likely uses similar machinery. Priority read.
  See [info-set-followup-investigations.md §3](info-set-followup-investigations.md).

- **Bridge Law 70 claim adjudication** worked examples. The
  WBF 2017 Commentary collection has cases where claim
  adjudicators reason from "declarer must follow rule X, so the
  remaining distribution is constrained." Less formalised than
  Long but more applied-to-claim. Useful for sanity-checking the
  §T-8 framing.

Both are queued in [info-set-followup-investigations.md §3](info-set-followup-investigations.md);
this design doc does not depend on them. They would inform whether
the catalogue should grow beyond §T-8.
