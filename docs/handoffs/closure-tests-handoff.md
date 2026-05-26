---
title: 304 — Closure-Tests Handoff (A8 + drift regression nets)
status: OPEN; brief for the A8 closure-test suite + the P-class drift regression tests
audience: a session willing to write engine/__tests__/info-closure.test.ts (and friends)
sibling docs:
  - info-set-completeness-v3-handoff.md §8 (A8 — the closure-test brief this handoff fleshes out)
  - rules-spec-code-drift-audit.md (the P-class items that need regression nets)
  - ../specs/caps_formalism.md §3.5 (I-C1–I-C5: the properties to assert)
  - ../specs/play_invariants.md §C1–C2 (the lower-layer closure properties)
  - spec-change-workflow.md (the top-down workflow this test suite is the linchpin of)
---

# Mission

The 2026-05-26 spec audit added §3.5 to
[caps_formalism.md](../specs/caps_formalism.md) — the I-C1 through
I-C5 information-set closure properties that the engine *must*
satisfy. v3 handoff §8 (A8) flagged "tests-only, half day."

This handoff scopes the test suite concretely, expands the brief
to cover **two** distinct test surfaces, and folds in the
regression tests for the drift findings in
[rules-spec-code-drift-audit.md](rules-spec-code-drift-audit.md).

It is the regression-net half of the
[spec-change-workflow.md](spec-change-workflow.md): every change
in `docs/specs/*` must trigger a refactor or extension of the
tests catalogued here, top-down.

---

# 1. Two layers, two test files

## Layer 1: information-set closure (`info.ts` / spec §3.5)

**File:** `engine/__tests__/info-closure.test.ts` (new).

**What it asserts:** the I-C1–I-C5 properties hold across
representative state transitions. Each `it` block constructs a
play-phase state, applies a sequence of plays, and checks the
property at every transition.

### Test catalogue

| Test | Property | What it does |
|------|----------|--------------|
| `i-c1-persistence` | I-C1 (Persistence) | Apply a face-up play; assert every fact in `I_V(S)` survives in `I_V(S')` (knownPlayed grows; exhaustedSuits monotone; hiddenSlots set-monotone modulo §T9 reveals). |
| `i-c2-observation-discipline` | I-C2 | After a non-revealing face-up play (the suit was already exhausted-known), `knownInHand` must be unchanged. Verify by snapshot diff. |
| `i-c3-monotone-components` | I-C3 | Apply 8 rounds; at each `S → S'` step assert `knownPlayed.size` non-decreasing; assert `hiddenSlots.length` grows on face-down plays AND shrinks only on §T9 reveals (track per-round delta). |
| `i-c4-knownInHand-evolution` | I-C4 | Construct a closed-trump state with a §T9 reveal. Pre-reveal: `knownInHand[trumper]` does not include the folded card. Post-reveal: it does. Subsequent play of the lifted card: `knownInHand[trumper]` shrinks. |
| `i-c5-world-set-monotonicity` | I-C5 | Apply observation events; assert `enumerateWorlds(info).length` non-increasing modulo factoring out the freshly-played card identity. Probably needs a small fixture for tractability. |

### Pattern

Each test builds a fixture, calls `buildInfoSet` at multiple states
along the actual event sequence, and asserts the closure invariant
holds at every transition. Wrap the assertions in helpers so the
same property can be re-tested across multiple fixtures:

```ts
const assertHiddenSlotsMonotone = (
  before: InformationSet,
  after: InformationSet,
  reason: 'face-down-play' | 'face-up-play' | 't9-reveal',
) => { /* per-reason assertion */ };
```

## Layer 2: engine-state closure (`play_invariants.md` §C1 / §C2)

**File:** `engine/__tests__/play-invariants-closure.test.ts` (new).

**What it asserts:** state-invariants S1–S11 and the transition
invariants T1–T10 hold at every reachable play-phase state. This
is the engine analogue of I-C1–I-C5 at the lower layer.

### Test catalogue

| Test | Property | What it does |
|------|----------|--------------|
| `s1-card-conservation` | §S1 | After every play in a multi-round fixture, the multiset of cards across hands + folded slot + current round + completed rounds equals PACK exactly. |
| `s2-hand-sizes` | §S2 | Check the §S2 formula at every state; PCC-out seat frozen at 8. |
| `s6-trump-state-consistency` | §S6 | After every reachable transition, the trump state matches one of the three configurations (+ the transient mid-round trumper-cut case). |
| `s8-trumper-face-down-legality` | §S8 | No face-down in-hand trump card ever appears in any round's entries across a 100-game fuzz. |
| `c1-forward-closure` | §C1 | For each reachable state, enumerate `validPlays(seat)`, apply each, assert resulting state invariants hold. |
| `c2-move-set-agreement` | §C2 | Compare `validPlays` against a separate model implementation of legal moves (or a re-derivation from rules.md). |
| `non-terminal-non-empty` | §C2 last clause | Every non-terminal reachable state has at least one legal play. |
| `terminal-state-shape` | "Terminal states" table | Each of the three terminal types yields the documented post-state. |

## Convention

Both test files share a `fuzzPlaySequence(state, n)` helper that
generates `n` random legal plays from a starting state. Use the
same fixture corpus where possible to amortise setup. Place
shared helpers in `engine/__tests__/fixtures.ts` next to the
existing ones.

---

# 2. P-class drift regression tests

In addition to the closure suite, the rules-spec-code-drift-audit
identifies six P-items, each needing a regression test marked
`skip` until the fix lands.

## File assignment

| P-item | File | Test description |
|--------|------|------------------|
| P1 (mid-round CSP false-negative) | `engine/__tests__/caps.test.ts` (new `describe` block) | Construct a state where an opp face-down minus mid-round adds the marginal exhaustion fact that flips south to obligated; assert `checkCapsObligation` returns `true`. Today it returns `false`. |
| P2 (§T-N collision) | none — doc fix, no test | Add a `docs/specs/README.md` cross-ref check (lint?). |
| P3 (R8 face-up folded reveal) | `engine/__tests__/play-invariants-closure.test.ts` | "post-R8 state always has `isRevealed = true` in any non-PCC game that reached R8 without earlier reveal" |
| P4 (Claim Balance API) | `engine/__tests__/game.test.ts` (new) | `game.callClaimBalance` exists and applies severe penalty on wrong claim. |
| P5 (runtime seats default) | `apps/304dle/__tests__/` (doc comment, not a test) | N/A — doc-only fix. |
| P6 (post-R8 caps reject message) | `engine/__tests__/game.test.ts` | Calling `callCaps` after R8's final card throws `CapsError` with a specific message substring. |

## Skip convention

Mark each pre-fix test with `it.skip` and a one-line comment:

```ts
it.skip('P1: mid-round CSP returns obligated when face-down minus adds exhaustion', () => {
  // Pre-fix: returns false (CSP bails on unresolved face-down).
  // Post-fix: returns true. Unskip when caps-csp.ts mid-round
  // enumeration lands. See rules-spec-code-drift-audit.md §P1.
  ...
});
```

This pattern is established by the v2-A handoff's caveat 1 (see
[info-set-completeness-v3-handoff.md §3 caveat 1](info-set-completeness-v3-handoff.md#L218)).

---

# 3. Effort estimate

| Block | Effort |
|-------|--------|
| Layer 1 (info-closure.test.ts) | half day |
| Layer 2 (play-invariants-closure.test.ts) | 1 day (more fixtures + fuzz infra) |
| P-class drift regression tests (skip-marked) | half day |
| Shared fuzz helper | 2 hours |
| **Total** | **~2.5 days** |

Compare to [info-set-completeness-v3-handoff.md §8](info-set-completeness-v3-handoff.md#L446)'s
"half day" — that was for Layer 1 alone. The broader regression-net
scope here is intentional: a robust regression suite *is* the
linchpin of the spec-change workflow (next handoff).

---

# 4. Why these tests matter (the strategic argument)

Today, the engine's correctness against the spec is assured by:

- Targeted unit tests for known bugs / known edge cases.
- The 174-pass test suite, mostly fixture-based, exercising
  representative scenarios.

This is a **point cloud** of test coverage. The closure-test layer
upgrades it to **structural** coverage: properties asserted across
*every* state transition, not just at specific snapshots. Drift —
silent or sudden — surfaces as a test failure rather than a
production bug.

In particular, the spec-change workflow (next handoff) leans on
this: when rules.md or a spec doc changes, the corresponding
closure tests should fail before the engine fix lands. The tests
become the *executable spec*, and the spec docs become their
prose companion.

---

# 5. Maintenance discipline

Going forward:

- **A change to caps_formalism.md §3.5** triggers an update to
  `info-closure.test.ts`.
- **A change to play_invariants.md §S/§T/§C** triggers an update
  to `play-invariants-closure.test.ts`.
- **A change to rules.md** triggers a re-run of the
  rules-spec-code-drift-audit (this handoff's sibling) and may
  surface new P-items.

The [spec-change-workflow.md](spec-change-workflow.md) handoff
formalises this discipline as a top-down rule.

---

# 6. Out of scope

- Tests for the bidding phase (out of scope per
  [play_invariants.md "Out of scope"](../specs/play_invariants.md#L292)).
- Tests for the match-level orchestrator.
- Property-based testing with a fixed seed corpus
  (fuzz-with-shrinking) — `fast-check` integration could replace
  the manual `fuzzPlaySequence` helper. Land if 2-day budget
  allows; otherwise defer.
- Performance regression tests for CSP/world-enum budgets — see
  [info-set-followup-investigations.md §2](info-set-followup-investigations.md#L70).
