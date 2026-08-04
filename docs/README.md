---
title: 304 — Docs Index
status: living document
---

# What lives where

```
docs/
  handoffs/   live, intra-session state (deleted when shipped)
  explainers/ plain-English lay-reader write-ups (post-session curated)
  specs/      durable reference: rules, formalism, invariants
  bots/       generated bot documentation (output of `npm run bots:docs`)
```

Group play **data** (stats spreadsheet, betting CSVs) lives in the top-level
[`data/`](../data) directory, not here — docs are documentation.

Full conventions: [.claude/docs-workflow.md](../.claude/docs-workflow.md).

## Handoffs (live)

The brief for "what to pick up in a future session". When the work lands, the handoff is deleted — git log is the changelog.

Ten briefs. **Start at
[handoffs/orchestration-handoff.md](handoffs/orchestration-handoff.md)** —
it sequences all the others into one session's worth of work, with the
parallelism, the file-ownership collisions, and the scope call about what
is realistically achievable. Everything below is a track it drives.

**The run design (2026-08-04) reframes most of these** — a day becomes a
sequence of deals rather than one deal. `run-structure-handoff.md` is the
anchor and everything downstream assumes it.

Two gates sit in front of the run: the predicate has to be right, and the
constitution has to stop forbidding it.

```
   soul-first-principles ─ blocks ┐      (soul §VI forbids the run today)
                                  ▼
   caps-par-authority ─ blocks ─ run-structure ─┬─ decoy-supply
   (par is wrong: the                           ├─ caps-verdict-model
    predicate under-claims)                     ├─ run-tempo
                                                └─ puzzle-regeneration
                                                        ▲
   closed-trump-bot ────────── (if shipping closed) ─────┘
   dds-transposition ───────── (decoy throughput) ───────┘

   START ANYTIME, no dependencies:
     caps-call-ux (arm-and-point half) · dds-transposition · closed-trump-bot
```

- [handoffs/orchestration-handoff.md](handoffs/orchestration-handoff.md) — **the entry point.** Sequences the nine tracks below into four waves. Names what can run in parallel, where file ownership collides, and what has to be parked to get a playable run in one session.
- [handoffs/run-structure-handoff.md](handoffs/run-structure-handoff.md) — **the anchor.** A day is a run of deals, drawn from an exponential tail: usually 1–2, rarely 6. Caps stops being guaranteed. One player action (Call Caps); decoys end themselves when the opposition takes a round. Kills the redeal loop.
- [handoffs/caps-par-authority-handoff.md](handoffs/caps-par-authority-handoff.md) — **the blocker.** The obligation CSP under-claims, so par is systematically later than the truth and correct players are told "too early". Ship an offline-verified par and grade against it.
- [handoffs/soul-first-principles-handoff.md](handoffs/soul-first-principles-handoff.md) — **the other blocker.** Strip `soul.md` to first principles; move every design prescription (all of §VI, the 12 "Design implication" blocks) into a new `.claude/304dle-design.md`. Unblocks the run without a constitutional amendment.
- [handoffs/decoy-supply-handoff.md](handoffs/decoy-supply-handoff.md) — the deals that are *not* caps, now ~55% of everything played. Carries the oracle bug: certifying decoys with the runtime CSP would kill players for reading correctly. Supersedes `decoy-days`.
- [handoffs/caps-verdict-model-handoff.md](handoffs/caps-verdict-model-handoff.md) — run-shaped verdicts; early ≠ late; merge `missed` into late; two streaks; depth is texture, never score. Needs par first.
- [handoffs/run-tempo-handoff.md](handoffs/run-tempo-handoff.md) — redistribute time inside a deal toward the deduction window (R3–R6) without lengthening it, so a run still fits a few minutes.
- [handoffs/puzzle-window-regeneration-handoff.md](handoffs/puzzle-window-regeneration-handoff.md) — regenerate the shipped window as runs. ~3x the compute; schema changes. Strictly downstream.
- [handoffs/closed-trump-bot-handoff.md](handoffs/closed-trump-bot-handoff.md) — closed mode generates **zero** puzzles because the curator's closed-trump bot defends too weakly. ~95% of real 304 is closed, so this is the biggest single gap. Fully independent.
- [handoffs/caps-call-ux-handoff.md](handoffs/caps-call-ux-handoff.md) — replace the caps confirmation dialog with arm-and-point on the felt. Call Caps is the only player action. Pure UI, independent.
- [handoffs/dds-transposition-handoff.md](handoffs/dds-transposition-handoff.md) — a real double-dummy solver so seven-card positions can be verified at all. Promoted: the decoy temptation metric needs world *counts*, not witnesses.

## Explainers (curated)

Plain-English write-ups for 304 players and other lay readers — what's happening under the hood without needing to read the code.

- [explainers/bots-explained.md](explainers/bots-explained.md) — what each of the eight bots actually does, in player-friendly terms.

## Specs (durable)

The reference docs the engine implements against. Edit only when the underlying truth changes.

- [specs/rules.md](specs/rules.md) — the game rules.
- [specs/caps_formalism.md](specs/caps_formalism.md) — the caps (claim-balance) math.
- [specs/play_invariants.md](specs/play_invariants.md) — engine invariants the implementation must preserve.
