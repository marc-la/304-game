---
title: 304 — Deductions Audit
status: OPEN, deferred from the 2026-05-26 info-set investigation
audience: future Claude session, or a returning human reader
sibling docs: caps_formalism.md (the spec), info-set-investigation-report.md (the bug-fix audit this defers from)
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
holds trump, the trumper *must* lead trump (Exhausted Trumps, rules.md
"Exhausted Trumps", play_invariants.md §T8).

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
The 2026-05-26 session's deliverables were:

- F1 — UI linger / engine divergence fixed.
- F2 — Folded-card §T9 lift identity (W6) propagated to non-trumper
  info-sets.
- F3 — In-progress face-down hidden slot constraint relaxed.
- F4-a — Formalism §3 clause 6 extended to cover the trumper's
  pre-lift knowledge.
- This deductions audit (F5) — the parts that aren't bugs.

A separate session is welcome to take this file as input and produce
a follow-up implementation plan. Tag it as `info-set-completeness-v2`
or similar so it's clearly downstream of the v1 work.
