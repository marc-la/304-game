---
title: 304 — Info-Set Investigation Follow-ups
status: open; these are research/extension tasks queued from the 2026-05-26 spec audit
audience: a future session willing to take on a multi-day investigation
sibling docs:
  - ../specs/caps_formalism.md (the spec)
  - info-set-completeness-v3-handoff.md (the engine work — separate from this)
  - deductions-audit.md (Class-C deferrals — separate again)
---

# Mission

The 2026-05-26 audit produced ten findings (A1–A8 spec; B1–B8 engine,
plus carry-forwards). It also produced an explicit list of things
that were *not* investigated in the session and would each repay a
dedicated effort. This handoff is the brief for those investigations.

These are not bugs and not deferred design decisions. They are
*open questions* about correctness, performance, and theoretical
coverage. Each item lists: the question, why it matters, what to
read first, and what a successful investigation outputs.

Treat each item as independent. They can be tackled in any order or
in parallel.

---

# 1. Probe tests for the 2026-05-26 findings

## Question

The 2026-05-26 spec audit stood on direct code citations and
re-reading the rules. No end-to-end probe tests were written for the
new findings (A1–A8) or the engine items they imply (B-class). The
v1 audit's methodology note applies: probes are valuable but were
not necessary for diagnosis at the layer of analysis used.

The follow-up question: *for each finding, construct a concrete
state + a viewer + an assertion that the engine fails (today) or
passes (after the v3 fix lands).* The B-class handoff suggests tests
inline; this item is about turning each suggested test into actual
code + a passing run.

## Why it matters

- Confidence: the diagnoses are correct in theory; the probe test
  closes the loop.
- Regression: once the fixes land, the probe tests guard against
  re-regression.
- Curatorial: states that exhibit a finding are valuable for puzzle
  authoring (they're "interesting positions").

## What to read first

- [info-set-completeness-v3-handoff.md](info-set-completeness-v3-handoff.md) — each item lists a suggested test.
- [../specs/caps_formalism.md](../specs/caps_formalism.md) — the W4 case table is the single
  most important reference for constructing valid states.
- [engine/__tests__/info.test.ts](../../engine/__tests__/info.test.ts) (if it exists; create if not).
- v1 audit methodology note in the v1 commit (`git show adbb02a`).

## Output

A test file (`engine/__tests__/info-spec-audit.test.ts` or
similar) with one or more `it(...)` block per A/B finding, marked
`skip` until the corresponding fix lands. As fixes land, unskip and
verify pass.

---

# 2. CSP node-budget benchmark against the puzzle corpus

## Question

The CSP has a 50,000-node budget ([engine/caps-csp.ts:59](../../engine/caps-csp.ts#L59)).
World-enumeration has a 5,000-world cap ([engine/caps.ts:17](../../engine/caps.ts#L17)).
Both fall back silently to "not obligated" on exhaustion (B5 / B6).
The question: **does the shipped puzzle corpus ever trigger either
fallback at a state the player might call caps from?**

This is a quantitative question. The answer is currently unknown.

## Why it matters

If "yes": then the curator is shipping puzzles that produce wrong
"wrong-not-obligated" verdicts at some game state. Player gets a
5-stone penalty for following the engine's hint. Concrete harm.

If "no" + the gap is wide: then the budget is generous and B5/B6's
tri-valued return change can be confidently shipped without
behavioural impact.

If "no" + the gap is tight: then any further refinement that
broadens the CSP's branching (e.g., the B2 pigeonhole pre-pass) must
be accompanied by a budget revisit.

## What to read first

- [tools/puzzles/generate-scripted.ts](../../tools/puzzles/generate-scripted.ts) — how puzzles are generated.
- [apps/304dle/data/puzzles.json](../../apps/304dle/data/puzzles.json) (or wherever the corpus
  lives) — what's shipped.
- [engine/caps-csp.ts:adaptiveSweep](../../engine/caps-csp.ts) — where the budget burns.

## Output

A one-page report:
- For the full corpus, the distribution of node-visits per
  `checkCapsObligationCSP` call across every state the player might
  caps-call from. Quantiles (p50, p95, p99, max).
- Same for world-count per `enumerateOrAbort` call (for the
  validate/explain/balance paths).
- A go/no-go on whether the current budgets are safe at the worst
  case in the corpus.
- A test asserting "no shipped puzzle exhausts at any reachable
  caps-call state" (or, if the answer is "they do", a flag for the
  puzzle generator to reject such states).

## Estimated effort

Half day to a day. Mostly mechanical — instrument the CSP, replay
the corpus, aggregate.

---

# 3. Long 2011 (Skat) literature mapping

## Question

Long's 2011 PhD thesis "Search, Inference and Opponent Modelling in
an Expert Skat-Playing Program" is the most complete single-document
treatment of information-set inference in trick-taking games. The
deductions-audit §3 cited it as priority reading.

Specific question: **do Long 2011's named inference techniques map
onto our W1–W6 catalogue, and if not, what's the gap?** Each
unmapped inference is a candidate for a new W-rule or for the
deferred deductions list.

Closely related: Skat's "Null" contracts (a player guarantees to
*lose every trick*) are structurally analogous to caps (a player
guarantees to *win every trick*). Long's analysis of Null contracts
is likely the closest analogue to caps-obligation reasoning.

## Why it matters

This is the single highest-leverage external-knowledge investment.
Skat is a well-studied game with academic literature spanning
decades. 304's adaptive caps has direct structural cousins in Null
contracts. Anything we discover here either confirms our catalogue
is complete or extends it.

## What to read first

1. Long 2011: <https://skatgame.net/mburo/ps/thesis_long_2011.pdf>
   - Chapters on Null contracts (the closest analogue to caps).
   - Inference-rule chapters.
   - Strict-rule inference appendices.
2. Frank, Basin, Bundy 1992: foundational; the
   enumerate-then-double-dummy framework we already implement.
3. Frank & Basin 1998 (AIJ): non-locality pathologies in
   probabilistic single-dummy. Confirms certainty (claim) analysis
   is immune. Useful boundary-setter.
4. Bridge Law 70 + 2017 Commentary:
   <https://www.worldbridge.org/wp-content/uploads/2019/01/2017LawsCommentary.pdf>
   - "distributions consistent with players having shown out of a
     suit" — direct W3 analogue.
   - Decades of worked claim cases.

## Output

A new document (suggest `docs/explainers/info-set-literature-map.md`
once curated) with:
- Each named inference from Long 2011.
- Mapping onto W1–W6 (or "not yet covered").
- For "not yet covered": a worked example in 304 where the
  inference would be dispositive, and a verdict on cost/frequency.

## Estimated effort

Multi-day. Honest read of one ~300-page thesis + cross-mapping.

---

# 4. Claim Balance investigation

## Question

[engine/caps.ts:checkClaimBalance](../../engine/caps.ts) still uses world-enumeration with
the `MAX_WORLDS = 5000` cap and a permutation-based witness search.
Caps proper moved to the CSP path (which can't easily express the
points-threshold predicate). Claim Balance therefore inherits the
B6 silent-abort pathology described in the v3 handoff.

Specific question: **does Claim Balance ever fire at a reachable
state with >5000 worlds in 304's house rules?** And: **is there a
CSP-style adaptive solver for points-threshold predicates that
avoids the world enumeration?**

## Why it matters

Claim Balance is a house-rule mechanic (rules.md "Claim Balance" /
§"Severe Penalties"). Wrong claim → auto-loss + 1 stone. Engine
correctness matters for any future Claim Balance UI.

It's also intellectually interesting: caps is "win every round";
claim balance is "exceed point threshold." The first is naturally
adaptive (CSP fits); the second has a quantitative goal that doesn't
obviously fit CSP's existential branching.

## What to read first

- [engine/caps.ts](../../engine/caps.ts) — `checkClaimBalance`, `hasBalanceWitness`,
  `orderMinPointsInWorld`.
- [../specs/caps_formalism.md §6](../specs/caps_formalism.md) — Claim Balance specialisation
  (one-liner: replace goal with point-total predicate; same world
  enumeration).

## Output

Two paths:
1. **Quantitative.** Same as the budget benchmark in §2 above, but
   for `checkClaimBalance` paths against synthesized house-rule
   states (Claim Balance isn't in the 304dle puzzle corpus). Report:
   does the enumeration ever exhaust?
2. **Algorithmic.** A design doc for a CSP-style claim-balance
   solver, or a verdict that the world enumeration is intrinsic.

## Estimated effort

Half day for (1). Multi-day for (2), depending on whether the
CSP-translation works.

---

# 5. Absolute Hand post-game opposition claim

## Question

rules.md §"Absolute Hand" allows two paths:
- *Goodwill declaration* (pre-play, by the trumper). Treated in the
  formalism §6 as "round-1 case of caps."
- *Post-game opposition claim*: "If the opposition lost every round
  and can demonstrate that no permutation of their play would have
  won them any round, they may claim absolute hand during scrutiny."

The second path is **not modelled** in the formalism. Its predicate
is: "for every permutation of opposition plays, the opposition wins
zero rounds." This is a `∀ opposition strategy: lose every round`
predicate against the actual deal — strictly stronger than caps
(it's not a single-dummy / single-info-set question, it's
double-dummy across all permutations of the losing side).

Specific question: **does this predicate have a clean CSP / search
implementation, and does the engine currently support it?**

## Why it matters

Absolute Hand is a rare safeguard (well under 1% of hands per
rules.md). But: if the engine ever supports the post-game
opposition claim path, it needs this predicate. Today there is no
engine entry point for it.

Less urgent than the caps work because the safeguard's threshold is
high and the rules explicitly say "burden is on the opposition." But
it's a structural omission from the engine's view of the rulebook.

## What to read first

- rules.md §"Absolute Hand" — the two paths.
- [../specs/caps_formalism.md §6](../specs/caps_formalism.md) — current treatment (goodwill
  declaration only).
- [engine/dd.ts](../../engine/dd.ts) — double-dummy infrastructure that would back any
  full-deal predicate.

## Output

Either:
- A short doc justifying *why* the post-game claim path doesn't
  need engine support (e.g., it's a social check at scrutiny, no
  predicate needed).
- Or: a design for the predicate + an engine entry point + a UI
  surface for the claim. Likely needs to live behind a feature flag
  given the rarity.

## Estimated effort

Half day for the framing decision. Multi-day if implementation.

---

# 6. The §T-8 forced-play retroactive deduction (carry-forward)

## Question

Documented in [deductions-audit.md §2.1 / §5.1](deductions-audit.md).
The world enumerator constrains hand contents from observed events.
It does not run the legal-plays predicate backwards over absences:
"the trumper had priority, did not lead trump, therefore some opp
holds trump."

Specific question: **how hard is it to encode the legal-plays
predicate as a per-world consistency constraint, and what's the
performance impact?**

## Why it matters

§T-8 is the only forced-play absence (after subsuming §T-5, §T-7
under W3 and §T-6 under "no info gain") with deductive content
beyond W3. The deductions-audit identifies it as the priority gap.

## What to read first

- [deductions-audit.md §2.1, §5.1](deductions-audit.md).
- [engine/play.ts:legalPlays](../../engine/play.ts) — the legal-plays predicate.
- Long 2011 chapters that may have a named technique for this
  (per §3 above).

## Output

A design doc:
- Encoding scheme (per-world legality check vs. per-state
  constraint propagation).
- Performance estimate (the legal-plays predicate per-world per-event
  is expensive; can we cache?).
- A worked example showing §T-8 retroactive deduction firing in a
  realistic 304dle puzzle.
- Recommendation: ship vs. defer.

## Estimated effort

Multi-day investigation. This is the unresolved P1 from
deductions-audit, and it's the most intellectually substantive item
in this list.

---

# Sequencing

These are independent. Suggested priority:

1. **§2 (budget benchmark)** — cheap, immediate value, unblocks B5/B6 in v3.
2. **§1 (probe tests)** — moderate, regression nets for v3.
3. **§3 (Long 2011)** — high leverage, multi-day, validates or extends the catalogue.
4. **§6 (§T-8)** — multi-day, depends on §3 for technique inspiration.
5. **§4 (Claim Balance)** — moderate, less urgent.
6. **§5 (Absolute Hand post-game claim)** — least urgent, framing-first.

# Out of scope

- Spec changes (those landed 2026-05-26 — see [../specs/caps_formalism.md](../specs/caps_formalism.md)).
- B-class engine work (see [info-set-completeness-v3-handoff.md](info-set-completeness-v3-handoff.md)).
- C-class deferred deductions (see [deductions-audit.md §5](deductions-audit.md)).
