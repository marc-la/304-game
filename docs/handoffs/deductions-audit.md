---
title: 304 — Deductions Audit
status: OPEN; refreshed 2026-05-26 to add §5 (Class-C deferrals from the spec audit) and §2.1 forward pointer to the §T-8 design doc
audience: future Claude session, or a returning human reader
sibling docs:
  - ../specs/caps_formalism.md (the spec — updated 2026-05-26 with A-class refinements)
  - info-set-completeness-v3-handoff.md (B-class engine work that came out of the 2026-05-26 spec audit)
  - info-set-followup-investigations.md (deep-dive investigations queued post-2026-05-26)
  - t8-retroactive-design.md (pre-implementation design doc for §2.1 / §5.1 §T-8 retroactive deduction — 2026-05-26)
  - v1 audit (commit adbb02a) lives in git log only
---

# Why this file exists

The 2026-05-26 info-set investigation flagged that the engine's notion of
"information set" — the set of facts a viewer can deduce from observable
history — may not be **complete**. The bug-fixable parts (a UI/engine
linger divergence, the in-progress face-down suit constraint, the §T9
folded-card lift) were addressed in that session. Three classes of
*non-bug* observations were deferred to this document:

1. **§T-8 retroactive deduction** (forced-play inference) — the rules
   force the trumper to lead trump in specific positions; observing
   that they did *not* lead trump in such a position implies someone
   else holds trump. The world enumerator does not encode this.
2. **Other forced-play patterns** that may exist but were not catalogued.
3. **Adjacent literature** that may help calibrate or formalise the
   completeness question.

This is **not** a bug list. The engine is sound (no false caps
confirmations) under every concern raised here. The concern is
*completeness*: the engine may miss correct caps obligations that a
strong human player would identify. For 304dle today this manifests as
"the puzzle says you're not yet obligated when actually you are" — an
under-deduction. The player loses nothing concrete (no penalty for
missing a caps), but the puzzle's notion of "first opportunity" lags
the human-table notion.

Documented here in plain English so the question stays visible without
blocking ongoing work. Tackle in a dedicated session.

---

# 1. What the engine deduces today

The world enumerator in `engine/info.ts` (`buildInfoSet` +
`enumerateWorlds`) captures the following facts about every consistent
distribution of unseen cards:

| # | Deduction | Plain English |
|---|-----------|---------------|
| W1 | Card conservation | Every one of the 32 cards is somewhere; no card is in two places. |
| W2 | Hand sizes | After R rounds + K cards of the current round, each non-PCC seat has exactly the right number of cards left. |
| W3 | Suit exhaustion | "Seat X failed to follow suit S in some round, so seat X holds no S." Includes face-down plays in closed trump (any face-down is by definition off-suit). |
| W4 | Hidden face-down suit | A face-down minus in a *completed* round is neither the led suit (the player couldn't follow) nor the trump suit (a trump cut would have been revealed at round end). For *in-progress* face-downs the trump-suit forbidden is dropped (the §T9 reveal hasn't fired yet). |
| W5 | Identity agreement | Cards the viewer knows the identity of — own hand, public face-ups, public reveals, the trumper's privileged observations — appear in the same place across every consistent world. |
| W6 | Publicly-known hand membership | The §T9-lifted folded trump card is publicly known to be in the trumper's hand; every consistent world places it there. |

This corresponds to the bridge-Law-70 Commentary phrase
*"distributions consistent with players having shown out of a suit (or
suits) to this point"* — augmented for closed-trump-specific reveals.

The CSP solver in `engine/caps-csp.ts` consumes most of these directly
and approximates W5/W6 via a shared "unknown pool" with per-seat
hand-size and suit-exhaustion bookkeeping. See the inline comment near
`initCtx` for the W6 caveat (CSP path is sound but does not currently
restrict the lifted folded card to the trumper specifically — affects
external-caps reasoning only).

---

# 2. What the engine does NOT deduce

## 2.1 Forced-play retroactive deduction (the §T-8 case)

**Rule:** if the trumper has priority, holds trump, and no other seat
holds trump, the trumper *must* lead trump (Exhausted Trumps,
../specs/rules.md "Exhausted Trumps", ../specs/play_invariants.md §T8).

**Inference the engine misses:** if you observe the trumper *not*
leading trump in a position where §T8 *would have* forced it, then
some other seat must hold trump. This is observable evidence that
constrains the world distribution.

**Example.** Closed trump → §T9 fired in R3, so trumps are now open.
The trumper has priority in R4. You've seen them lead a non-trump
suit. From §T8 you can conclude: the trumper does not hold *all*
remaining trump (else they'd be forced to lead trump). So at least
one trump is in another seat. Combined with knownPlayed and W3, you
may be able to localise it.

**Why the engine misses this.** `enumerateWorlds` builds consistent
worlds from positive evidence (cards played, suits exhausted, reveals).
It does not run the legal-plays predicate *backwards*: "this play was
legal in some world" is not currently a per-world consistency check.

**Cost to fix.** Substantial. Would require encoding the legal-plays
predicate as a per-world constraint (or running a legality check
during world materialisation and rejecting worlds where the actual
history was illegal). Adds significant complexity to the CSP.

**Frequency in 304dle.** Empirically rare — the puzzle generator's
sweep filter biases toward late-game obligations where §T8 already
fired. But it's the kind of inference a strong player makes
unconsciously, and missing it is the easiest path to "puzzle says
not-yet-obligated when human says yes."

## 2.2 Other forced-play patterns (candidate list)

Patterns to investigate the same way (each requires a worked example +
a verdict on cost/frequency):

- **§T-5 (Trump-led, in-hand trumps available):** the trumper *must*
  follow with a face-up in-hand trump card. Observing them play a
  non-trump or fail to follow tells you they're out of trump in hand.
  Mostly subsumed by W3 (exhaustion fires immediately) but worth
  cross-checking.
- **§T-1 (Closed-trump R1 trumper):** the trumper *cannot* lead trump
  on R1 in closed trump. So if R1 lead is trump *and* the leader is
  the trumper, that's impossible. No information gain (the trumper
  wouldn't have led trump in this case anyway), but it could rule out
  hypothetical world reconstructions.
- **Follow-suit forced plays:** if seat X follows suit but plays a
  surprisingly low card, no inference (the choice was theirs). If
  seat X *had* to play that card (it was their only card of the suit),
  knownPlayed already captures the identity. No new deduction.
- **PCC-out seat:** trivially deduced (the seat's hand is frozen and
  no longer participates). Not currently exercised — 304dle puzzles
  are non-PCC — but worth verifying when PCC support is revisited.

## 2.3 Probabilistic / inductive inferences (out of scope)

A strong 304 player *also* uses opponent-modelling: "they bid 220
without partner help, so they probably hold X." These are
probabilistic and not part of the caps obligation predicate (which
requires certainty in every world). Out of scope for caps; potentially
in scope for bot play strength.

---

# 3. Adjacent literature

From the info-set investigation handoff's §2.5 search (re-cited so this
file stands alone):

- **Bridge Law 70 + 2017 Laws of Duplicate Bridge Commentary** —
  https://www.worldbridge.org/wp-content/uploads/2019/01/2017LawsCommentary.pdf
  — the canonical claim-adjudication treatment, with explicit
  "distributions consistent with players having shown out of a suit"
  language that mirrors our W3/W4. Decades of worked claim cases.
  Most relevant for cross-checking edge cases in the existing
  W1–W6 set.

- **Long (2011) — "Search, Inference and Opponent Modelling in an
  Expert Skat-Playing Program," PhD thesis, Alberta** —
  https://skatgame.net/mburo/ps/thesis_long_2011.pdf — the most
  complete single-document treatment of information-set inference in
  a trick-taking game. Chapters on "Null" contracts (guarantee-of-
  outcome bids analogous to caps) and the strict-rule inference
  appendices are the priority reads. Likely contains forced-play
  retroactive inference as a named technique.

- **Frank, Basin & Bundy (1992) — "An Analysis of Multi-Player Card
  Games with Imperfect Information," AAAI** — the vanilla
  enumerate-then-double-dummy algorithm that our `enumerateWorlds`
  realises. Sources our existing approach; unlikely to contain the
  missing forced-play deduction but worth re-reading.

- **Truf (Indonesian trick-taking, Pagat)** — the closest structural
  cousin to 304's closed trump. Face-down trumps revealed at trick
  end, symmetric (all players learn simultaneously — unlike 304's
  asymmetric trumper-privileged observation). No academic literature
  found in the prior search.

- **28 / 29 (Indian/Bangladeshi, Pagat / Wikipedia)** — closed-trump
  bidding ancestors of 304. No academic CS literature surfaced;
  worth a re-search via Google Scholar / Indian academic databases
  (Sodhganga) and possibly Tamil-language sources for a serious
  investigation.

## 3.1 Pointers for a deeper investigation

If a future session escalates this audit:

1. Read Long 2011 chapter by chapter. Map every named inference back
   onto our W1–W6 catalogue. Each unmatched inference is a candidate
   for §2 of this file.
2. Run a worked-puzzle benchmark: take a corpus of 304dle puzzles,
   identify the human-recognised first-obligation round (manually or
   from an expert annotation), and compare to what
   `trackCapsObligation` stamps. Discrepancies are concrete
   completeness gaps.
3. Search Google Scholar / ACM DL for "trick-taking imperfect
   information inference" beyond the bridge/Skat literature. Look for
   work on Indian/South-Asian trick games specifically.

---

# 4. Out of scope for the 2026-05-26 bug-fix session

This file documents observations. It does not propose code changes.
The 2026-05-26 v1 session's deliverables were:

- F1 — UI linger / engine divergence fixed.
- F2 — Folded-card §T9 lift identity (W6) propagated to non-trumper
  info-sets.
- F3 — In-progress face-down hidden slot constraint relaxed.
- F4-a — Formalism §3 clause 6 extended to cover the trumper's
  pre-lift knowledge.
- This deductions audit (F5) — the parts that aren't bugs.

# 5. Class-C deferrals carried forward from the 2026-05-26 spec audit

The 2026-05-26 spec audit (separate from this file's v1 deferral)
turned up several additional out-of-scope items beyond §T-8. They
are kept here so the deferred-deductions thread stays unified.

Each item is documented as "deferred under the formalism's certainty
discipline." None is a bug. Each could be picked up if/when the
table's discipline shifts.

## 5.1 §T-8 retroactive deduction (the original)

Documented in §2.1 above. **Status: pre-implementation design doc
landed 2026-05-26 at [t8-retroactive-design.md](t8-retroactive-design.md).**
The design recommends **defer for 304dle, implement when an
engine-as-library use case materialises**, using an aggregate
current-state CSP constraint (Option B in the design doc). Reach,
encoding, performance, worked-example sketch, and CSP-integration
sketch are all in that doc. A future implementation session should
take it as input.

## 5.2 Spoilt Trumps false-call as evidence

A false Spoilt Trumps call by `W` reveals that `W` believed the
opposition held zero trump from the deal. Other players gain a
higher-order epistemic fact: `W`'s tracking model. Not a
certainty-grade constraint on hidden state. **Deferred** under §5's
adversarial-`τ` discipline.

## 5.3 Caps-call non-occurrence as evidence

If `V` (trumper) has not called caps by round R, opp observers can
infer "V doesn't yet believe V is caps-obligated from V's info-set."
Probabilistic; depends on assumptions about V's competence and
intent. Not certainty-grade. **Deferred.**

## 5.4 Deliberate-throw concealment

rules.md §C-7 punishes deliberately throwing a round to conceal
caps. This is a scrutiny-time forensic predicate ("did V have a
winning move at state S?"), not a play-time deduction. The §5
adversarial-`τ` quantifier already covers the certainty side. The
throw-detection predicate is a separate scrutiny check; **out of
scope** for `I_V`.

## 5.5 Memory limits

The formalism assumes perfect recall. Real players forget.
rules.md endorses this idealisation. **Out of scope** — the
predicate is the source of truth; human memory is the player's
responsibility.

## 5.6 Cross-game shuffle correlations

Minimal shuffling between games preserves some prior-deal order.
Inter-game correlations are probabilistic and dependent on
shuffling discipline. **Out of scope** for the single-game
obligation predicate.

These deferrals are now mirrored in [../specs/caps_formalism.md](../specs/caps_formalism.md) §12
as explicit non-goals, so the spec itself is the source of truth
for "what we deliberately don't model." This file remains the
working notebook for if/when any of them gets unblocked.

# 6. If you escalate

A future session that picks up this file should:

- For §T-8 specifically: take [info-set-followup-investigations.md](info-set-followup-investigations.md)
  as input (it has the Long-2011 mapping, the worked-puzzle
  benchmark, and the broader literature search queued up).
- For 5.2–5.6: each one needs its own framing decision before any
  implementation work. Treat them as design discussions, not
  bug-fixes.
- Tag any new handoff as `info-set-completeness-vN` so it threads
  cleanly with the v1/v2/v3 history.
