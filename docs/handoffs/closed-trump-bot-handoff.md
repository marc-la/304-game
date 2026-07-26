---
title: 304 — A closed-trump bot strong enough to generate puzzles
status: OPEN (2026-07-26). Independent of all other 304dle work.
owns: tools/curator/closed-trump-bot.ts, engine/bots/*
blocks: closed-trump puzzle generation (which is ~95% of real 304)
---

# Goal

Make `--mode closed` produce puzzles. It currently produces **zero**, at
any budget.

# State of play

Marc's judgement is that roughly 95% of real 304 is closed trump, so the
shipped open-trump-only daily is the unrealistic case, not the realistic
one. Soul §VI.1.1 names Open Trump as the v1 mode, which is why the
generator was flipped to open this session — but that was forced by the
measurement below, not chosen on merit.

Measured, 200 matches in closed mode: 86 sweeps observed, **0 accepted**.
The rejection funnel is unambiguous — nearly every candidate dies on
`low-labour`, and 60 of 74 in-band candidates scored labour **0**.

Labour 0 means *no single observation is load-bearing*: south stays
caps-obligated even having forgotten any one card. Those are
over-determined, trivial caps and the curator is right to reject them.
The cause is the defence. Closed mode ignores `--bot` entirely and uses
`tools/curator/closed-trump-bot.ts`, a heuristic that defends so weakly
that the only sweeps it produces are ones where south was dealt a
monster. Compare open mode, where a stronger policy yields usable
labour: `b3-heuristic` accepts 2.3% of sweeps, `b4-infoset-1ply` 5.1%,
with labour 6–15.

So this is not a threshold-tuning problem. Lowering `minLabour` would
ship trivial puzzles.

# Recommended approach

Write a closed-trump bot that actually plays the information game. The
engine's bot zoo (`engine/bots/`) is open-trump-only, which is why a
separate curator bot exists at all — the closed-mode decisions it lacks
are the interesting ones:

- **§T-2/§T-3 cut-or-minus.** When you cannot follow, do you cut
  (face-down trump, trying to win) or minus (face-down junk, conceding)?
  This is the central closed-trump skill and the heuristic bot barely
  models it.
- **Trump-suit inference from other players' face-down plays.** A
  face-down card that wins tells you it was trump.
- **The trumper's asymmetry.** The trumper knows the suit; everyone else
  is guessing. `caps_formalism.md` §3 clause 6 gives the trumper sight of
  face-down identities at end of round — a real closed-trump bot should
  exploit that when trumping and respect it when not.

Simplest credible path: port `b4-infoset-1ply`'s information-set
machinery and give it a closed-trump action space, rather than growing
the existing heuristic. `b4` is the cheapest bot that produced usable
labour in open mode, and its info-set reasoning is exactly what closed
trump needs more of.

Alternatives: adapt `b5-csp-search` (caps-aware, stronger, slower —
worth measuring, but generation throughput matters); accept weak
defence and raise `minWitnessSuitSpan` instead (rejected — span is a
different axis and would not fix over-determination).

# Validation gate

- `npm run puzzles:generate -- --count 10 --mode closed --start-date <d>
  --out-dir /tmp/x` accepts ≥10 puzzles in a reasonable budget, with the
  printed funnel showing `low-labour` no longer dominant.
- Accepted closed puzzles show labour ≥ 4 and witness-suit-span ≥ 2,
  the same bar open mode meets.
- Generated scripts replay legally end-to-end: `applyScriptedPlay`
  validates every play against `legalPlays`, so
  `apps/304dle/__tests__/today.test.ts` passing over a closed window is
  a real legality audit.
- Face-down play rules hold: §T-2, §T-3, §T-4, §S7 (see
  `apps/304dle/runtime.ts` `validatePlayLegality`).

# Hard constraints

- Determinism: same seed → same play, byte-for-byte. Bots are seeded.
- Fit the `PlayBot` interface in `engine/bots/types.ts` if it lands in
  the zoo; register in `BOTS` and document in
  `tools/bots/docs/generate.ts`.
- §T9 reveal semantics are already implemented in
  `apps/304dle/runtime.ts` `resolveRound` — do not re-derive them.

# Reading list

- `tools/curator/closed-trump-bot.ts` — what exists now.
- `engine/bots/b4-infoset-1ply.ts` — the info-set machinery to port.
- `docs/specs/rules.md` "Closed Trump Games" (~line 253) and §T-2/§T-3.
- `docs/specs/play_invariants.md` §T9, §S6, §S7.
- `tools/puzzles/generate-scripted.ts` — the acceptance funnel and where
  closed mode picks its bot.
