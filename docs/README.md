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
```

Full conventions: [.claude/docs-workflow.md](../.claude/docs-workflow.md).

## Handoffs (live)

The brief for "what to pick up in a future session". When the work lands, the handoff is deleted — git log is the changelog.

- [handoffs/bot-hybrid-handoff.md](handoffs/bot-hybrid-handoff.md) — B6o/B7o hybrid bots, gated on a B6/B7 objective refactor (tricks → points).
- [handoffs/info-set-completeness-v2-handoff.md](handoffs/info-set-completeness-v2-handoff.md) — `knownInHand` doesn't propagate through the CSP path (W6). Carry-forward from the 2026-05-26 v1 audit.
- [handoffs/info-set-completeness-v3-handoff.md](handoffs/info-set-completeness-v3-handoff.md) — engine work to bring the implementation up to the 2026-05-26 spec audit (A-class spec landed; B-class engine queued).
- [handoffs/info-set-followup-investigations.md](handoffs/info-set-followup-investigations.md) — deeper-investigation tasks queued from the 2026-05-26 spec audit (budget benchmark, Long-2011 mapping, §T-8, Claim Balance, Absolute Hand).
- [handoffs/deductions-audit.md](handoffs/deductions-audit.md) — non-bug deduction gaps deferred from the v1 audit; refreshed 2026-05-26 with Class-C deferrals.

## Explainers (curated)

Plain-English write-ups for 304 players and other lay readers — what's happening under the hood without needing to read the code.

- [explainers/bots-explained.md](explainers/bots-explained.md) — what each of the eight bots actually does, in player-friendly terms.

## Specs (durable)

The reference docs the engine implements against. Edit only when the underlying truth changes.

- [specs/rules.md](specs/rules.md) — the game rules.
- [specs/caps_formalism.md](specs/caps_formalism.md) — the caps (claim-balance) math.
- [specs/play_invariants.md](specs/play_invariants.md) — engine invariants the implementation must preserve.
