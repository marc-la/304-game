---
title: 304dle — Make par authoritative (fix the under-claiming predicate)
status: OPEN (2026-07-26). Blocker for puzzle regeneration and for all verdict work.
owns: engine/caps-csp.ts, engine/caps.ts, apps/304dle/store.ts, apps/304dle/types.ts
blocks: puzzle-window-regeneration, decoy-days, caps-verdict-model
---

# Goal

Make the par round a player is graded against *correct*. Today it is
systematically later than the truth, so players who reason correctly are
told "too early".

# State of play

`checkCapsObligation` is a CSP over an information set
(`engine/caps-csp.ts`). It models the three non-caller seats as a shared
pool with per-seat sizes and suit-exhaustion sets, and never materialises
a world. Two **over-claiming** bugs in `trumpDominanceShortCircuit` were
fixed this session (the short-circuit ran before the round-resolution
branch, so it declared victory on tricks already lost — once when the
caller had been forced to follow a side suit, once when an opponent had
played the last outstanding trump earlier in the same round). The audit
went 11/24 puzzles unsound → 0/24.

What remains is the opposite defect and it is **structural, not a typo**.
The shared-pool relaxation grants the adversary more freedom than any
single consistent world does — it never commits to a globally consistent
assignment — so it is conservative and **under-claims**. Verified with
the independent offline solver:

```
2026-08-14, end of R3 — engine: not obligated (stamps R6)
  OBLIGATED: 9d → Ad → 10d → Qd → 10h sweeps all 400 sampled worlds
2026-08-02, end of R3 — engine: not obligated (stamps R5)
  OBLIGATED: 9d → Ad → 10d → Ac → 10c sweeps all 400 sampled worlds
```

Both were player-reported disputes; the player was right both times.

# Recommended approach

**Ship an offline-verified par in the puzzle and grade against it.**

The runtime cannot afford world enumeration — that is the whole reason
the CSP relaxation exists — but the *generator* can. So compute the true
first-obligation index offline with `tools/puzzles/verify-caps.ts`
semantics, store it, and have `submitCaps` grade against the stored
value rather than the live stamp.

This reverses an earlier call in this repo that `obligation` was dead
weight in the payload. It is not: it becomes the authority. Note the
leak trade-off — the answer ships to the client — which is already true
of the hands anyway and is addressed by the rolling-window horizon.

Alternatives considered:

- *Tighten the CSP's propagation.* Correct in principle, open-ended in
  practice, and a partial fix still leaves par wrong on some puzzles
  with no way to tell which. Do not gate the daily on this.
- *Enumerate in the browser when the world count is small.* Helps only
  in the late rounds where the count collapses — which is exactly where
  the CSP is already right. No help at R3–R5, where the disputes are.
- *Grade leniently (accept anything within N rounds of par).* Papers
  over a wrong number rather than fixing it, and makes the verdict
  unexplainable.

Schema note: `obligation.afterCardIndex` is currently the index of the
first card of the *next* round (`generate-scripted.ts`), not the moment
obligation arises. Obligation should be stamped at **per-play**
granularity, matching `runtime.ts:213` which re-checks after every play.
The formalism (`caps_formalism.md` §313) guarantees obligation only flips
False→True at observation events, so a linear rescan of the ≤5 event
states inside the obligation round pins it exactly — about five extra
predicate calls per accepted puzzle, not thirty-two.

# Validation gate

- `npm run puzzles:audit` reports 0/N unsound (it already does — keep it
  that way; this work must not reintroduce over-claiming).
- For at least 10 puzzles, `npm run puzzles:verify -- --date <d> --round <par-1>`
  reports **not obligated** and `--round <par>` reports **OBLIGATED**.
  That is the real gate: par is the first round at which it is true.
- The three player-reported cases resolve correctly: 08-02 and 08-14
  obligated by R3; 08-03 not obligated at R3 (partner-discretion case,
  engine already right).
- `engine/__tests__/caps-soundness.test.ts` still green.

# Hard constraints

- Determinism: `(info-set, rng seed) → same play, byte-for-byte`.
- `caps_formalism.md` §5 is the definition, including §257–262: the
  caller cannot rely on partner *choice*; partner is adversarial
  wherever they have discretion. Do not "fix" under-claiming by making
  partner cooperative — that would be a different game, and it is the
  reason 2026-08-03 is correctly not obligated at R3.
- No new runtime dependencies; the site is static.

# Reading list

- `engine/caps-csp.ts` — `adaptiveSweep`, `universalOppMove`,
  `computeOppCandidates`, `trumpDominanceShortCircuit`.
- `docs/specs/caps_formalism.md` §5 and §8.
- `tools/puzzles/verify-caps.ts` — the independent oracle.
- `apps/304dle/store.ts` `submitCaps` — where grading happens today.
- `tools/puzzles/generate-scripted.ts` — `findObligation`.
