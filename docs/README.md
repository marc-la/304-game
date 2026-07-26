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

### 304dle caps work (2026-07-26 session)

Seven briefs, written to be picked up independently. The dependency
graph is the important part — three can start immediately, the rest
wait on the predicate.

```
                       caps-par-authority  ── blocks ──┬─ decoy-days
                       (par is wrong: the              ├─ caps-verdict-model
                        predicate under-claims)        └─ puzzle-regeneration
                                                             ▲
   soul-amendments ─ blocks ─ decoy-days                     │
   closed-trump-bot ──────────────── (if shipping closed) ───┘

   START ANYTIME, no dependencies:
     caps-call-ux · dds-transposition · closed-trump-bot
```

- [handoffs/caps-par-authority-handoff.md](handoffs/caps-par-authority-handoff.md) — **the blocker.** The obligation CSP under-claims, so par is systematically later than the truth and correct players are told "too early". Ship an offline-verified par and grade against it.
- [handoffs/closed-trump-bot-handoff.md](handoffs/closed-trump-bot-handoff.md) — closed mode generates **zero** puzzles because the curator's closed-trump bot defends too weakly. ~95% of real 304 is closed, so this is the biggest single gap. Fully independent.
- [handoffs/caps-call-ux-handoff.md](handoffs/caps-call-ux-handoff.md) — replace the caps confirmation dialog with arm-and-point on the felt. Pure UI, independent.
- [handoffs/dds-transposition-handoff.md](handoffs/dds-transposition-handoff.md) — a real double-dummy solver so seven-card positions can be verified at all. Independent; strengthens the par work's validation.
- [handoffs/decoy-days-handoff.md](handoffs/decoy-days-handoff.md) — hands that sweep through the par window then break, so "should I call at all?" is live. Needs par first, and needs the §VI.3 amendment.
- [handoffs/caps-verdict-model-handoff.md](handoffs/caps-verdict-model-handoff.md) — early ≠ late; merge `missed` into late; two streaks. Needs par first.
- [handoffs/soul-amendments-handoff.md](handoffs/soul-amendments-handoff.md) — §VI.3 ("when, not if"), §VI.2 (the worlds counter), §VI.4 (the 3–5 minute claim). Marc's sign-off; no code.

### Older

- [handoffs/closure-tests-handoff.md](handoffs/closure-tests-handoff.md) — deduction-closure test suite; A8 half landed (`info-closure.test.ts`), Layer-2 + P-class regressions still open.
- [handoffs/rules-spec-code-drift-audit.md](handoffs/rules-spec-code-drift-audit.md) — P1–P6 spec/code drift items; partially landed, status markers need a refresh.
- [handoffs/deductions-audit.md](handoffs/deductions-audit.md) — non-bug deduction gaps deferred from the v1 audit; refreshed 2026-05-26 with Class-C deferrals.
- [handoffs/info-set-followup-investigations.md](handoffs/info-set-followup-investigations.md) — deeper-investigation tasks queued from the 2026-05-26 spec audit (budget benchmark, Long-2011 mapping, §T-8, Claim Balance, Absolute Hand).
- [handoffs/spec-change-workflow.md](handoffs/spec-change-workflow.md) — proposed spec→test convention; not yet adopted into CLAUDE.md.
- [handoffs/t8-retroactive-design.md](handoffs/t8-retroactive-design.md) — §T-8 retroactive-deduction design; pre-implementation, ship/defer call open.

## Explainers (curated)

Plain-English write-ups for 304 players and other lay readers — what's happening under the hood without needing to read the code.

- [explainers/bots-explained.md](explainers/bots-explained.md) — what each of the eight bots actually does, in player-friendly terms.

## Specs (durable)

The reference docs the engine implements against. Edit only when the underlying truth changes.

- [specs/rules.md](specs/rules.md) — the game rules.
- [specs/caps_formalism.md](specs/caps_formalism.md) — the caps (claim-balance) math.
- [specs/play_invariants.md](specs/play_invariants.md) — engine invariants the implementation must preserve.
