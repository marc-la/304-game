---
title: 304 — Info-Set Completeness v2 Handoff (carry-forward from 2026-05-26)
status: open, ready for a fresh session
audience: a fresh Claude session
sibling docs:
  - docs/specs/caps_formalism.md (the spec the audit tested)
  - docs/handoffs/deductions-audit.md (separate, plain-English deferred-deductions thread)
  - v1 audit lives in git log only (commit adbb02a — "Fix info-set audit findings F1–F4 and add v2 handoff"); referenced report doc was deleted in the 2026-05-26 docs reorg
---

# Mission

The 2026-05-26 session ("v1") audited the engine's information-set
implementation against the formalism, fixed the bug-fixable findings
(F1–F4), and deferred F5 to [deductions-audit.md](deductions-audit.md).

This handoff captures the **known limitations** that v1 left behind —
each is sound (no false caps confirmations) but incomplete (under-
deduces, so the player may be told they are not yet caps-obligated when
a strong human would already be). Land them in a v2 session.

This is a much smaller scope than the v1 audit. Treat it as a focused
implementation session, not another audit.

---

# 1. Priority finding — CSP path does not consume `knownInHand` (W6)

## What it is

`engine/info.ts:InformationSet.knownInHand` was introduced in v1 to
record cards whose identity is publicly known to be in a specific
seat's hand. Today the only source is the §T9 lift of the folded
trump card (per [caps_formalism.md](../specs/caps_formalism.md) §3 clause 4
and §4 W6). The **world-enumeration path** (`enumerateWorlds`,
`worldIsConsistent`, `validateCapsCall`, `explainCapsFailure`,
`checkClaimBalance`, `worlds-counter`) already consumes it correctly.

The **CSP path** (`engine/caps-csp.ts`) does not. See the inline
comment at `initCtx` near the `known` set construction — the CSP
treats the lifted card as if any opponent might hold it, which is a
sound over-approximation but loses the "trumper specifically holds
this card" constraint.

## Why it matters

- **For caller-as-trumper (the majority of 304dle puzzles):** the
  lifted card is in `callerHand` already; `knownInHand` is redundant
  for the trumper viewer. **No impact.**

- **For caller-as-non-trumper (external caps):** the CSP enumerates
  worlds where another opponent has the lifted card. Those worlds are
  inconsistent in reality. The CSP's adversarial quantifier may find
  a "winning opp line" in one of those inconsistent worlds and
  conclude *not obligated* when reality is *obligated*. The player
  misses correct external-caps calls. **Affects external-caps
  puzzles.**

## Why v1 didn't fix it

The CSP models opp hands as a fungible shared pool keyed by per-seat
hand-size and suit-exhaustion sets. Forcing a specific card to a
specific seat requires tracking forced cards separately from the
pool — a change to `OppConstraint`, `applyOppPlay`,
`computeOppCandidates`, and the `pool.size === oppTotal + ...`
consistency check. Non-trivial; deferred so v1 could land focused
bug fixes.

## Suggested approach for v2

Two options, in increasing invasiveness:

**Option A — Forced-card extension (recommended).**

1. Add `forced: Set<CardId>` to `OppConstraint` in
   `engine/caps-csp.ts:initCtx`. Populate from `info.knownInHand` for
   each non-caller seat.
2. Subtract forced cards from `pool` at construction. Subtract from
   `oppTotal` *only* for the consistency-check math (the forced cards
   still occupy hand slots; they're just not in the unknown pool).
3. Update the consistency check: `pool.size === (oppTotal - sum of
   forced.size across opps) + hiddenSlotCount + foldedUnknownCount`.
4. In `computeOppCandidates`, candidates include `forced` (subject to
   suit-following / exhaustion / must-lead-trump) in addition to
   pool-derived candidates.
5. In `applyOppPlay`, branch on whether the played card is from
   `forced` (remove from forced, leave pool alone) or from `pool`
   (existing path).
6. `universalOppMove` and `oppIsSoleTrumpHolder` already check
   `opp.size === 0` — preserve this semantics (size = forced + pool
   contribution).

Add a focused test in `engine/__tests__/caps.test.ts`:
build a closed-trump state where §T9 just fired, the lifted trump
card is publicly in the (north-as-trumper) hand, south is on the
opposing team, and south's external-caps obligation depends on
knowing the trumper specifically holds that card. Assert
`checkCapsObligationCSP(state, 'south') === true`. Without the v2
fix, expect false.

**Option B — Per-card per-seat full constraint model.**

Generalise the pool to a constraint set keyed by `(card, seat) →
{possible, forbidden, forced}`. More expressive (could handle other
future constraints like "this card is in either of these two hands")
but a substantial rewrite. Defer unless Option A proves
insufficient.

## Acceptance criteria

- Existing 170 tests still pass.
- New test (per Option A above) passes.
- The F2 benchmark from the v1 audit (git log `adbb02a`) — non-trumper
  viewer sees only worlds where the trumper holds the lifted card —
  passes via both `enumerateWorlds` (already passes) and
  `checkCapsObligationCSP` (new).

---

# 2. Secondary — `knownInHand` plumbing through the full-game path

`engine/state.ts:EngineTrumpState.foldedCardLifted` is declared
optional (`?: boolean`) and defaults to `false`. The 304dle runtime
([apps/304dle/runtime.ts:resolveRound](apps/304dle/runtime.ts)) sets it
correctly. The **full-game engine path** (`engine/play-engine.ts`
`resolveRound`-equivalent at line ~346, where the §T9 lift happens)
does not.

This matters when the full game / tournament / bot harness exercises
caps obligation against closed-trump states post-§T9. Today that path
mostly runs at engine internals (no caps obligation calls from bots
during their move selection). But if you wire up real caps detection
in a multi-game tournament, post-§T9 obligations for non-trumper
viewers will under-deduce by missing W6.

The fix is one line in `engine/play-engine.ts`: after the lift, set
`trump.foldedCardLifted = true`. Note: that same code currently sets
`trump.trumpCard = null` (the runtime preserves it; the engine
discards it). If you want W6 to be functional through the full-game
path, also preserve `trump.trumpCard` (don't null it). That's a
larger behavioural change — verify nothing else depends on the
post-lift null.

This is a low-priority follow-up. 304dle itself is unaffected.

---

# 3. Carry-forward from the deductions audit

[deductions-audit.md](deductions-audit.md) catalogues the
non-bug deduction gaps deferred from v1:

- **§T-8 retroactive deduction** (the priority deduction-completeness
  question).
- Other forced-play patterns to investigate.
- Adjacent-literature reading list.

These are a separate thread from the v2 CSP work above. Don't
conflate. A v2 session should pick **one** of:

- v2-A: ship the CSP `knownInHand` integration (this handoff). Small,
  contained, ~half day.
- v2-B: take the deductions audit forward (the separate doc). Open-
  ended; could be 1–2 weeks of investigation + implementation.

Pick A first unless you have specific puzzle evidence that the §T-8
gap is biting users.

---

# 4. Out of scope for this handoff

- Spec / formalism changes — v1 landed the W4 / W6 + clause-4 / clause-6
  edits. The formalism is current.
- UI changes — the F1 grace-period model (Continue button) is in
  place. No further UI work is implied here.
- Any restructuring of the audit reports or this handoff. They're
  point-in-time snapshots.

---

# 5. Working notes

- Run `cd frontend && npx vitest run` from the repo root (after
  `export PATH=/home/marc/.nvm/versions/node/v22.16.0/bin:$PATH`).
  Baseline: 170 passed + 1 skipped after v1.
- One pre-existing flaky test:
  `apps/play/transport/__tests__/localTransport.test.ts` failed once
  in five runs during v1. Unrelated to caps; tracked separately.
- The user has parallel WIP in `engine/bot.ts`,
  `engine/bots/common.ts`, `engine/caps.ts`, `engine/play.ts`,
  `tools/bots/elo/*`, `tools/curator/*`, and `docs/bots/*`. None of
  it interacts with the v2 CSP work. Don't touch.
