---
title: 304 — Information-Set Completeness & Closed-Trump Timing Investigation
purpose: A deep-dive handoff. Audit (1) whether the engine's notion of "complete information set" captures every strictly-rule-deducible fact, and (2) whether the closed-trump timing model correctly handles the trumper's clause-6 observation window. Output: a verdict on whether the *formalism* needs updating, whether the *implementation* needs fixing, or both.
status: handoff, 2026-05-26
audience: a fresh Claude session
sibling docs: docs/gameplay-verification-handoff.md (rule-mechanics audit), docs/caps_formalism.md (the math being tested)
---

# Mission

You are investigating two coupled questions about the 304 caps formalism and its implementation:

1. **Is the information set, as currently constructed, *complete*?** That is: for every fact that the rules + cards-on-the-table objectively entail, does `buildInfoSet` + `enumerateWorlds` deliver that fact to the caps-obligation predicate?
2. **Does the closed-trump model handle the trumper's clause-6 observation timing correctly?** That is: in the moments around round resolution, does the implementation correctly distinguish between *what the trumper has seen* and *what the trumper is about to see*?

This is a **specification-correctness audit**, not a code-vs-spec audit. You may conclude the docs need updating, the code needs fixing, or both. Findings should include the proposed doc change AND the proposed code change.

This is sibling to but distinct from `docs/gameplay-verification-handoff.md`. That doc audits the implementation against the existing spec. **This doc audits the spec itself.**

---

# Background — what was just clarified

The user asked three questions that triggered this handoff:

1. *"Did you say a round lost to the opposition = late caps?"* — **No.** Late Caps per rules.md §C-3 requires winning all 8 rounds. If a round is lost, the §5 precondition fails and caps is *impossible*, not *late*. The formalism is right; the runtime matches. No work here.

2. *"Do we need an audit to discover a complete information set?"* — **Yes** — this is the bulk of your work.

3. *"Does closed trump break the formalism in the 'opp plays the card that puts trumper into caps but trumper only learns at end of round' case?"* — **The formalism handles it in principle**, but there are implementation-level timing edge cases worth a deep dive.

---

# 1. The information-set completeness question

## 1.1 What "complete" means here

A viewer V's information set I_V at state S should include **every fact about hidden card locations that is rule-derivable** from the observable history. The caps obligation predicate then quantifies over `Worlds(I_V, S)` — the worlds consistent with I_V.

If I_V omits a derivable fact, `Worlds(I_V, S)` is too large, and the predicate can fail to fire when it should (false negative — under-call). If I_V *over*-deduces, `Worlds(I_V, S)` is too small, and the predicate can fire when it shouldn't (false positive — wrong call).

**Both directions matter.** A puzzle that under-deduces tells south "you can't call yet" when objectively they can — frustrating but not unfair. A puzzle that over-deduces tells south they're caps-obligated when actually they aren't — *the player loses for following the engine's hint*.

## 1.2 What the formalism currently captures (caps_formalism §3 clauses 1–6)

| Clause | Captures |
|---|---|
| 1 | Own hand |
| 2 | Own play history (incl. face-down) |
| 3 | Public face-up history (all rounds) |
| 4 | Public face-down revelations (§T9 reveals) |
| 5 | Public suit-exhaustion (face-down or off-suit follow ⇒ public void) |
| 6 | Trumper's privileged observations (face-down identities at round resolution) |

§4 then enumerates worlds satisfying:
- W1 card conservation (32-card pack)
- W2 hand sizes
- W3 no suit-S cards in seats publicly void of S
- W4 hidden minus suit ≠ led-suit and ≠ trump-suit (the "if it were trump it would have been revealed" inference)
- W5 known-identity cards appear where they're known

## 1.3 Suspected omissions / over-deductions to investigate

For each item below: **construct a concrete game state, build the info set, enumerate worlds, and verify the deduction is or is not made.**

### 1.3.1 In-progress-round face-down minus constraint (suspected over-deduction)

`engine/info.ts:138-144` calls `absorbRound` on `play.currentRound` exactly like a completed round. `absorbRound` creates hidden slots; the enumerator (§W4) forbids `ledSuit` and `trumpSuit` for hidden slots.

But §W4's justification is: "if the face-down was trump, §T9 would have revealed it at round end." That only applies to *resolved* rounds. **In an in-progress round, the §T9 reveal hasn't fired**, so a face-down trump cut is still hidden.

If the enumerator forbids `trumpSuit` for in-progress hidden slots, it deduces "no face-down in this round can be trump" — false in general.

**Counter-example to construct**: build a state where, mid-R5 (3 plays in, 1 yet to come), the only consistent world has opp X holding the J♥ (trump). The face-down opp Y played should *not* be ruled out as J♥ if Y plays before round resolves.

Worth checking: does this over-deduction propagate into a false-positive caps call? Build the case end-to-end.

### 1.3.2 Trumper face-down §T-4 constraint (possible under-deduction)

§T-4: trumper's face-down play is *either* the folded trump card *or* a non-trump-suit card. Never an in-hand trump.

After §T9 reveal, the folded trump card identity is public, so a trumper's resolved face-down minus has the §W4 constraint (forbid trump-suit). Fine.

But mid-game, with the folded card still on the table and unrevealed:

- For an in-progress trumper face-down, what does §W4 say? The slot has `forbiddenSuits = {ledSuit, trumpSuit}` — but the trumper's face-down *could* be the folded trump card (which IS trump-suit). The current enumerator forbids trump-suit for the slot ⇒ wrongly excludes this possibility.

**However**: the folded trump card lives in a separate slot (`info.ts:244-253` creates a dedicated `folded:` slot with `allowedSuits = {trumpSuit}`). So the folded card identity isn't in the per-round hidden slot — it's in its own slot. Does this resolve the issue, or does it create a different bug (e.g. double-counting cards)?

**To investigate**: walk a closed-trump state where the trumper has played the folded card as a face-down cut. After §T9 reveal, what's in `hiddenSlots`? Is there a hiddenSlot for the trumper's cut entry? Is the folded slot still in the enumerator? Cross-check `applyPlay` (it sets `trump.trumpCard = null` when the folded card is played) against `buildInfoSet`.

### 1.3.3 Forced-play retroactive deduction (suspected omission)

If opp X had a high card of suit S available but played a lower S, that *might* establish "X doesn't have any cards higher than what they played in S" — but only under strict rules, which 304 doesn't have (X might be saving the high card; partner-choice is not enforceable).

**However**: §T-8 (exhausted trumps) is a *forced* play: if the trumper has priority + holds trump + nobody else holds trump, trumper *must* lead trump. So if you see the trumper *not* lead trump in such a position, you can deduce somebody else holds trump.

**To investigate**: does `enumerateWorlds` capture this kind of "what was forced and what wasn't" reasoning? Likely not — it enumerates based on hand-size + exhaustion constraints, not on the legal-play history. Worth specifying whether this is in or out of scope.

### 1.3.4 Folded-trump-card known identity to trumper (verify, not suspected bug)

The trumper *always* knows the folded trump card identity. `info.ts:93-94` sets `knownFoldedCard = isViewerTrumper && foldedOnTable ? trump.trumpCard : null`.

This is in clause 6 spirit but it's NOT in the formalism doc — clause 6 only covers face-down round entries, not the folded card itself. **Doc update candidate**: extend clause 6 to explicitly include the folded trump card identity for the trumper.

### 1.3.5 Public revelation of folded-card identity at §T9 (verify)

When a non-trumper plays a face-down trump and §T9 fires, the folded trump card "is shown to all players, then picked up and added to the Trumper's hand" (rules.md). After this reveal, the folded card identity is public.

**To investigate**: does `buildInfoSet` reflect this public knowledge? Trace: when §T9 fires, the runtime sets `isRevealed=true, isOpen=true`. The engine's `viewerKnowsIdentity` uses these flags. But does any code path set the folded-card identity as publicly known? Need to verify that non-trumper viewers see the folded-card identity post-reveal.

### 1.3.6 Card-elimination via own-hand subtraction (verify completeness)

If south holds 3♥, 7♥, 8♥ and has seen K♥, Q♥, J♥, 10♥, A♥ played, then the only ♥ unaccounted for is 9♥. So 9♥ must be in north / east / west's hand (depending on void constraints).

**To investigate**: this is captured by W1 + W5. Build a state where 9♥ is the only remaining unaccounted-for heart and the existing exhaustions force it into a single seat. Verify `enumerateWorlds` produces a single world.

### 1.3.7 Composite trump-count deduction (verify)

Tracking remaining trumps is a core 304 skill. If you've seen 6 trumps played + you hold 1 + 1 is the folded card (known to you), then 0 trumps remain unaccounted for among opps. This is what enables many caps calls.

**To investigate**: does the trumpCount affect world enumeration directly, or only via card-conservation? It should fall out of conservation, but is the enumerator efficient about it? (Efficiency matters for caps-csp solver performance.)

---

# 2. The closed-trump timing question

## 2.1 The scenario the user posed

"A player plays the card that puts a person (who is trumping) into a caps position, but the round is yet to finish, so the trumper in the absolute state of the game is in caps, but only can call caps at the end of the round when they see the card."

## 2.2 What the formalism says

Per clause 6: trumper privately observes face-down identities **at round resolution**, not mid-round. So:

- *Mid-round* (after opp plays face-down, before round resolves): trumper's I_V does not include the face-down identity. Predicate may be false.
- *Post-round-resolution*: I_V includes the face-down identity (via clause 6). Predicate may flip to true.
- *S\** = the earliest state at which the predicate holds. For closed trump, S\* is typically the round-resolution state, not mid-round.

This is *correct* — caps obligation is information-set-relative. The trumper can't call caps on information they don't have.

## 2.3 Where the implementation could go wrong

Five concrete failure modes to investigate:

### 2.3.1 trackCapsObligation timing in resolveRound

Read `apps/304dle/runtime.ts:resolveRound`. The sequence:

```
1. compute winner + points
2. apply §T9 reveal effects (set revealed flags, lift folded card)
3. push to completedRounds  ← entries are now "in completed", clause 6 fires
4. update priority + roundNumber
5. trackCapsObligation       ← uses the post-§T9 state
```

This sequence appears correct. But verify:
- Is the `inCompletedRound` flag in `info.ts:viewerKnowsIdentity` correctly tied to the entry being in `completedRounds` (vs `currentRound`)?
- Does the `trackCapsObligation` invocation see the updated `revealed` flags on the just-resolved round?
- What about the case where §T9 *doesn't* fire (no face-down trump in the round)? Does the trumper still gain visibility into face-down minuses? Per clause 6, yes — and the implementation should handle this regardless of whether §T9 fired.

### 2.3.2 UI linger period and submitCaps

Read `apps/304dle/App.tsx:196-208`. The round-full state lingers for `ROUND_LINGER_MS = 1500` before `resolveCurrentRound` is called. During this window:

- The UI's `Table.tsx:viewerKnowsEntry` shows face-downs face-up to the trumper (round-full + isViewerTrumper branch).
- BUT the engine's `viewerKnowsIdentity` requires `inCompletedRound=true` — and during the linger, the round is still in `currentRound`, not `completedRounds`.

**The UI is lying.** The trumper *visually* sees the face-downs during the linger but the engine treats them as hidden. If the player clicks "Call Caps" during the linger:

- `submitCaps` calls `checkCapsObligation(engine, 'south')`
- The engine sees the in-progress state — face-downs are *still hidden* to the trumper at this point
- The predicate may return false even though the UI made the player think the caps was callable

**Construct this scenario** end-to-end and check if the verdict is correct. Likely failure mode: the player calls caps during the linger and gets `wrong-not-obligated` despite the UI showing the cards face-up.

### 2.3.3 Obligation stamp timing in resolveRound

The stamp is set inside `resolveRound` *after* the round is pushed to `completedRounds`. So `vPlaysAtObligation` is computed based on the post-resolve state — south has played `roundNumber - 1` cards (where `roundNumber` has already been incremented).

Verify: does this give the right "lateness" semantics under the lenient timing policy (caps_formalism §8.3)? Specifically: if obligation fires at end of R5, can south call at the start of R6? They should be able to (lenient policy: no own-play between S\* and t_call). But the obligation stamp's `vPlaysAtObligation` is `(R5 plays = 5) + (south_played_in_current_round=0)` = 5. Then if south calls at start of R6 without playing, `vPlaysNow = 5`. `vPlaysNow > vPlaysAtObligation` → false → on-time. Good. What if obligation fires *mid-R6* due to a clause-6 observation from R5's resolution? The stamp is at start-of-R6 (= end of R5), and south is being asked to play their R6 card. They haven't played yet, so they can call. Good. But what if south plays first, *then* §T9 fires only because of a later observation? Actually this can't happen — the stamp fires inside `resolveRound`, before south's next play. Verify the ordering really is what I claim.

### 2.3.4 trackCapsObligation only runs for south

Read `engine/caps.ts:trackCapsObligation:163` — defaults to `['south']`. For 304dle this is fine (south is the player). But: in the scripted-puzzle generator, the obligated seat is rotated *into* south. If the rotation is buggy, the *actual* obligated seat at S\* may not be south in the puzzle, and the stamp will never fire. **Verify the rotation in `tools/puzzles/generate-scripted.ts:findObligation` + `seatRotation`** end-to-end on a closed-trump puzzle.

### 2.3.5 §T9 reveal on the LAST round (R8)

Read `runtime.ts:resolveRound:288-294` — `trackCapsObligation` is called only if `roundNumber <= 8` *after the increment*. So after R8 resolves, the obligation tracker is not called. But §T9 may fire on R8 and reveal something. Per rules: "Caps cannot be called after the final card of round 8" → so no late stamp is needed. **Verify the call-window-closed branch in `trackCapsObligation:159-161`** also covers this. There may be a subtle bug where the obligation could be stamped at the very-last-card boundary.

---

# 2.5 Prior art (added 2026-05-26 after a literature scan)

This section was added after a web search to ground the audit in existing work. **Bottom line: the foundations are well-trodden; the specific 304 closed-trump + trumper-privileged-inspection combination appears to be novel territory in the academic literature.** Use the prior art below to calibrate the audit, but do not assume the question is already answered in print.

## 2.5.1 Direct structural analogs (other games)

- **Truf (Indonesian trick-taking game)** — pagat.com. **The closest mechanistic cousin to 304's closed trump.** Quote from the rules: *"Trumps led or played to a trick are always played face down. Cards of non-trump suits are always played face up. … At the end of each trick, any trumps that are in it are turned face up, to find out who has won the trick."* This is structurally the same as 304's §T9 reveal. Critical difference: in Truf the reveal is **symmetric** — every player learns at the same moment. In 304 the trumper has the additional clause-6 privilege of inspecting *non-trump* face-downs too. No academic AI work on Truf surfaced in the search.

- **28 / 29 (Indian/Bangladeshi trick games)** — pagat.com, Wikipedia. Closed-trump bidding family directly ancestral to 304. The Wikipedia / pagat rules describe the closed-trump mechanic but **no academic CS or formalism literature on these games surfaced.** This confirms the user's suspicion that the specific information-flow mechanics here are not formally analyzed in print.

- **Skat (German trick-taking)** — the canonical academic-AI trick game. Has its own information asymmetry: the soloist sees the two-card "skat" before play; defenders don't. This is *structurally* the asymmetry we have (trumper knows more than non-trumpers), but Skat's asymmetry is *static* (set at deal time) while 304's is *dynamic* (each round-resolution updates the trumper's information set). Worth understanding as the closest well-studied case.

## 2.5.2 Methodological / formalism precedents

- **Bridge Law 70 + 2017 Laws of Duplicate Bridge Commentary** (worldbridge.org). The canonical claim-adjudication treatment, with explicit information-set language. From the commentary: *"the TD can assign the result of a line for maximum tricks against any distribution of the defenders' cards (and best play by defenders) in the context of distributions consistent with players having shown out of a suit (or suits) to this point."* That phrase — "distributions consistent with players having shown out of a suit" — is **exactly** our `Worlds(I_V, S)` construction in §4. The Commentary contains hundreds of worked claim cases over decades of case law; useful for grounding edge cases.
  - Read: https://www.worldbridge.org/wp-content/uploads/2019/01/2017LawsCommentary.pdf
  - Particularly: the Law 70 commentary and the section on adjudication under doubt.

- **Frank, Basin & Bundy (1992)** — "An Analysis of Multi-Player Card Games with Imperfect Information," AAAI. Cited in caps_formalism §10. The vanilla single-dummy algorithm — enumerate consistent deals, double-dummy each, intersect winning strategies — is what `enumerateWorlds + per-world DDS` does. This is the original formal source for the §5 predicate; the formalism doc cites it but the audit may want to re-read it with fresh eyes.

- **Frank & Basin (1998)** — "Search in games with incomplete information: a case study using Bridge card play," AIJ. Documents *probabilistic* single-dummy pathologies (strategy fusion, non-locality). Caps is *certainty*, so these pathologies don't apply — but reading the paper tells you which branches of the literature are safe to ignore.

- **Ginsberg (2001)** — "GIB: Imperfect information in a computationally challenging game," JAIR 14. Monte-Carlo single-dummy for *expectation*. Different problem from caps but the world-enumeration architecture is shared.

## 2.5.3 Academic AI on Skat (closest body of methodology to draw from)

The Buro group at Alberta has the most developed academic AI on a trick-taking game with information asymmetry. Their canonical references:

- **Buro, Long, Furtak & Sturtevant (2009)** — "Improving State Evaluation, Inference, and Search in Trick-Based Card Games," IJCAI. https://skatgame.net/mburo/ps/ijcai09-skat.pdf
- **Long (2011)** — "Search, Inference and Opponent Modelling in an Expert Skat-Playing Program." PhD thesis, Alberta. https://skatgame.net/mburo/ps/thesis_long_2011.pdf — **likely the most complete single-document treatment of information-set inference in a trick-taking game.**
- **Furtak & Buro (2013)** — "Recursive Monte Carlo Search for Imperfect Information Games," CIG. https://skatgame.net/mburo/ps/recmc13.pdf
- **Rebstock, Solinas & Buro (2019)** — "Policy Based Inference in Trick-Taking Card Games," IEEE CoG. arXiv:1905.10911. https://skatgame.net/mburo/ps/cog2019-policy-based-inference.pdf. Learns *opponent models* to estimate state probabilities — probabilistic, not certainty-based, so applicable to bot-play improvement (the B6/B7 handoff) more than to caps obligation.

For the **caps obligation audit specifically**: the Long 2011 thesis is the priority read. It covers strict-rule inference (the analog of our W3 / W4 / W5 constraints), opponent modelling (out of scope for caps but useful context), and probabilistic search. Chapters on Skat's "Null" contract are most relevant — Null is the closest Skat construct to our caps obligation (a guarantee-of-outcome bid).

## 2.5.4 Imperfect-information tree search (for cross-reference, not directly applicable)

- **Cowling, Powley & Whitehouse (2012)** — "Information Set Monte Carlo Tree Search," IEEE TCIAIG. The modern ISMCTS algorithm. Useful for B6/B7 work, not for the spec audit.
- **CFR / Counterfactual Regret Minimization** literature (Zinkevich et al. 2007, Libratus/Pluribus). Poker-specific but the strategy-space framework transfers.

## 2.5.5 What this means for the audit

1. **The W1–W5 world-consistency constraints** in our caps_formalism §4 are essentially the bridge-Law-70 Commentary's "distributions consistent with players having shown out of a suit" formalized. **Confidence: very high.** Use the Commentary as cross-check.

2. **The "adaptive vs fixed-order" caps formulation** (∀W ∃σ_W vs ∃O ∀W in §5) is mathematically standard min-max-swap. **Confidence: high.** Read Frank/Basin 1992 to verify they use the same construction.

3. **The trumper's clause-6 privileged observation** appears to be **the genuinely novel piece**. No prior art surfaced for asymmetric round-by-round information updates of this exact shape. Truf has the structural cousin (face-down trumps revealed at trick end) but it's symmetric; Skat has the asymmetry (soloist privilege) but it's static (set at deal time, not per-round).
   - Implication: the audit cannot lean on prior formalism for clause 6. If the implementation is wrong, you are the one finding it.
   - Implication: the audit should consider whether clause 6 *as written* fully captures the table convention. Specifically, the Tamil-table tradition is described in `.claude/soul.md` §IV.7 and §VI.2; cross-check against that.

4. **The in-progress-round face-down minus constraint (§1.3.1)** has no direct prior art because closed-trump face-down play is rare in well-studied games. The "if it were trump it would have been revealed at trick end" inference is a 304-specific deduction. **The audit needs to derive this from first principles, not look it up.**

5. **The UI-linger-vs-engine divergence (§2.3.2)** is a software bug; prior art is irrelevant.

## 2.5.6 Search caveats

This literature scan was done via web search in a single session. Limitations:

- PDF fetches of the academic papers (arXiv, the Skat ones) returned as raw binary — the audit should **actually read these PDFs** rather than trust my summaries-of-search-snippets.
- The "no academic work on 28 / 29 / 304" finding is a *negative result from one search round*. A more thorough search (Google Scholar, ACM Digital Library, Indian academic databases like Sodhganga) might surface something. If you have time, escalate.
- Tamil-language academic sources, if any, would not be in this English-only search. Worth a note but unlikely to affect implementation.

---

# 3. Methodology

## 3.1 Investigation protocol per item

For each numbered concern in §1 and §2:

1. **Write a one-paragraph claim** about what you expect the formalism / implementation to do.
2. **Construct a concrete `EngineGameState`** (use the existing fixtures pattern in `engine/__tests__/fixtures.ts` for inspiration).
3. **Trace through the relevant code paths** — what does `buildInfoSet` produce? What does `enumerateWorlds` yield? What does `checkCapsObligation` return?
4. **If the result disagrees with your claim**, decide: is the doc wrong, or the code wrong?
5. **If both are right but the user-facing behavior is wrong**, the issue is a *spec gap* — the formalism doesn't cover the case and needs extension.

## 3.2 Tools you have

- All existing tests (`npm test`) — run after each hypothesised change to catch regressions.
- `npx vitest run path/to/test.ts` for targeted runs.
- The CSP solver tests in `engine/__tests__/caps.test.ts`, `engine/bots/__tests__/bots.test.ts`, and `apps/304dle/__tests__/closed-trump.test.ts` give you templates for constructing states.

## 3.3 What you cannot do

- **Do not** modify the formalism doc unless you have a concrete counter-example. The formalism is the contract; speculative changes are worse than gaps.
- **Do not** add new bot logic. This audit is engine + runtime + formalism only.
- **Do not** touch the UI except to flag the §2.3.2 linger-vs-engine divergence as a finding.

---

# 4. Output

A single markdown report with the structure below. Write it to `docs/info-set-investigation-report.md` (or hand the user a path of your choosing).

```markdown
# Information-Set Completeness & Closed-Trump Timing — Investigation Report

Date:
Branch / commit:
Tests run: (paste the npm test output summary)

## Verdicts (one-line each)

- §1.3.1 In-progress face-down trump constraint: [over-deducing / correct / under-deducing]
- §1.3.2 Trumper §T-4 face-down constraint: [over / correct / under]
- §1.3.3 Forced-play retroactive deduction: [in scope / out of scope / spec gap]
- §1.3.4 Folded card known to trumper: [doc update needed / correct]
- §1.3.5 §T9 folded-card public reveal: [implementation correct / bug]
- §1.3.6 Card-elimination via own-hand subtraction: [verified / bug]
- §1.3.7 Trump-count composite: [efficient / inefficient / wrong]
- §2.3.1 trackCapsObligation timing in resolveRound: [correct / bug]
- §2.3.2 UI linger period vs engine: [verified divergence: harmful / harmless]
- §2.3.3 Lenient-policy lateness math: [correct / off-by-one]
- §2.3.4 Seat rotation in generate-scripted: [correct / wrong]
- §2.3.5 R8 final-card boundary: [correct / bug]

## Per-item findings

For each finding:

### F1: §1.3.1 — In-progress face-down minus over-deduction [P1]

**Claim**: ...

**Counter-example state**: ... (paste TS literal)

**Trace**: ... (what `buildInfoSet` produced, what `enumerateWorlds` yielded, what was wrong)

**Diagnosis**: doc gap / code bug / both

**Proposed doc change**: ...

**Proposed code change**: ...

**Test to add**: ... (paste failing-test source)

### F2: ...

## Spec gaps (formalism updates needed)

[Specific edits to caps_formalism.md, with line citations.]

## Implementation findings (separate from spec gaps)

[Specific edits to engine/info.ts, engine/caps-csp.ts, runtime.ts, etc.]

## Non-findings

[Things you investigated that turned out to be correct.]
```

---

# 5. Specific files to read

- `docs/caps_formalism.md` — the spec under audit. Read it twice.
- `docs/rules.md` — particularly §T-1..§T-6, §T9, and the Caps section.
- `docs/play_invariants.md` — §S6 trump state, §T9 round resolution.
- `engine/info.ts` — `buildInfoSet`, `enumerateWorlds`, `viewerKnowsIdentity`. The core artifact.
- `engine/caps-csp.ts` — `checkCapsObligationCSP` and `findWitnessLine`. How the predicate consumes the info-set.
- `engine/caps.ts` — `trackCapsObligation`, `isCapsLate`. Timing layer.
- `apps/304dle/runtime.ts` — `resolveRound`, the §T9 reveal logic, the `trackCapsObligation` call sites.
- `apps/304dle/store.ts` — `submitCaps`. The UI gateway.
- `apps/304dle/components/Table.tsx` — `viewerKnowsEntry`. The UI's interpretation of what's visible. The known divergence from engine `viewerKnowsIdentity` is the §2.3.2 concern.
- `tools/puzzles/generate-scripted.ts:findObligation` + `seatRotation` — the rotation that may bury bugs in §2.3.4.

---

# 6. Time budget

- Reading formalism doc + rules + invariants + caps-csp source: **60 min**
- Reading runtime + info.ts + caps.ts: **45 min**
- Each §1 item: **30–60 min** (7 items × ~40 min = 4–5 hours)
- Each §2 item: **45–90 min** (5 items × ~60 min = 4–5 hours)
- Writing the report: **60 min**

Total: ~10–12 hours. If shorter, prioritize: §2.3.2 (UI/engine divergence — likely real bug), §1.3.1 (in-progress face-down — likely real bug), §1.3.2 (trumper face-down constraint — formalism-level concern).

---

# 7. Where this fits

This handoff is the *third* in a series:

- `docs/bot-speed-handoff.md` — make B6 fast enough to win the tournament.
- `docs/gameplay-verification-handoff.md` — audit the code against the existing rule docs.
- `docs/information-set-completeness-handoff.md` (this) — audit the rule docs themselves, especially around closed-trump information flow.

These are independent — you don't need to read the other two to do this one. But if you find that an issue here overlaps with the gameplay verification audit, cite the overlap.

---

*End of handoff. Open with: re-read `docs/caps_formalism.md` §3, §4, §5, §6, §8 carefully. Then read `engine/info.ts` end-to-end. Then start with §2.3.2 (the UI-linger investigation) — it's the most likely real bug and the easiest to construct an end-to-end counter-example for.*
