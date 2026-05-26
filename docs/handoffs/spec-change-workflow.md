---
title: 304 — Spec-Change → Regression-Test Refactor Workflow
status: OPEN; v1 proposal 2026-05-26. Top-down: docs/specs/* are the source of truth; regression tests are derived; engine implements both.
audience: anyone editing docs/specs/*.md, or a session adding this convention to CLAUDE.md
sibling docs:
  - closure-tests-handoff.md (the regression-test suite this workflow leans on)
  - rules-spec-code-drift-audit.md (the audit that motivated this workflow)
  - ../../CLAUDE.md (the project handbook this should eventually be linked from)
---

# The problem this solves

304's specs (rules.md, caps_formalism.md, play_invariants.md) and
the engine code can — and have — drifted apart silently. The
2026-05-26 v3 spec audit found 8 A-class spec refinements and 8
B-class engine items that all *should* have been picked up the
moment the spec changed. They weren't, because there was no
process linking spec edits to engine updates.

This handoff proposes a **top-down workflow**: edits to
`docs/specs/*` are the trigger for a corresponding refactor of
the regression tests, which then drives the engine update.

---

# The workflow

## Layer of truth

```
docs/specs/*.md            ← source of truth (prose)
       │
       ▼
engine/__tests__/*-closure.test.ts  ← derived (executable spec)
       │
       ▼
engine/**/*.ts             ← implements both
```

Where two layers disagree, the higher layer wins. So:

- Tests must conform to specs.
- Engine must conform to tests.
- A spec edit invalidates the relevant tests; the tests must be
  updated *first*; then the engine fix follows.

## Per-edit checklist

When editing any file in `docs/specs/*`:

1. **Identify the affected closure-test file.** Use the table in
   [closure-tests-handoff.md §1](closure-tests-handoff.md#L24).
   - `caps_formalism.md §3 / §3.5 / §4` → `engine/__tests__/info-closure.test.ts`
   - `play_invariants.md §S / §T / §C` → `engine/__tests__/play-invariants-closure.test.ts`
   - `rules.md` → run the rules-spec-code-drift-audit and update
     both closure-test files as needed.

2. **Update or extend the test file.** If the spec edit added a new
   property, add a new `it` block. If it tightened an existing
   property, update the corresponding `expect`. Mark new tests
   `it.skip` if the engine fix isn't ready yet, with a forward
   pointer to the handoff that tracks the fix.

3. **Run the test suite.** Any test that *passes* against the new
   spec needs no engine work. Any test that fails (or is newly
   skip-marked) becomes the engine task list.

4. **Update the engine.** Implement the smallest change that makes
   the relevant tests pass.

5. **Commit per [auto-commit.md](../../.claude/auto-commit.md).**
   Stage the spec edit, the test refactor, and the engine fix in
   one or more commits. Prefer separate commits per layer so the
   audit log is legible: `commit 1 = spec edit`, `commit 2 =
   tests`, `commit 3 = engine`. This lets a future bisect
   isolate which layer introduced a regression.

## When a spec edit doesn't need tests

Some spec edits are pure prose clarifications (rewording, fixing
typos, adding worked examples, expanding the "out of scope"
list). These don't change any predicate. No test refactor is
needed.

**Heuristic.** If you cannot construct a state where the
edited-vs-prior wording would yield a different `buildInfoSet`,
`checkCapsObligation`, or `validPlays` output, the edit is prose-only.

When in doubt, add a closure-test assertion against the new
wording. The test is cheap; the silent drift is expensive.

---

# Why top-down

There's an alternative — *bottom-up* — where the engine drives
the spec (the code is right and the docs catch up). 304 deliberately
rejects this for three reasons:

1. **Caps is a normative predicate.** It's defined by the rules
   of the game, not by what the code happens to do. If the code
   says "obligated" and the rules say "not obligated," the rules
   win — the code is wrong.
2. **Specs are auditable by humans without reading code.** The
   spec is the artifact that gets shown to a player who asks
   "why was my call wrong?" The engine is an implementation
   detail.
3. **Bottom-up has no error mode.** If the engine is the source of
   truth, "the engine says X" is unfalsifiable. Top-down makes
   engine bugs visible: spec says X, code says Y, fix code.

---

# Hook / automation suggestions (deferred)

This workflow is currently **discipline-only** — there's no
automated enforcement. Possible future automation:

- **Git pre-commit hook.** If staged changes touch
  `docs/specs/*.md`, prompt: "Did you update the
  closure-test suite?" Surface skip-marked tests as a checklist.
- **CI check.** Diff between `docs/specs/*.md` HEAD vs. main; if
  changed, fail the build unless `engine/__tests__/*-closure.test.ts`
  was also touched in the same PR.
- **Doc-driven test generation.** Long-term: a custom test
  generator that reads structured assertions from spec files
  (e.g., YAML frontmatter blocks with `assert: ...`) and emits
  test stubs. Probably over-engineered; revisit if discipline
  proves insufficient.

For now: discipline. The closure-test suite is small enough
(~2.5 days to write, per the closure-tests handoff) that a manual
update on spec change is tractable.

---

# Acceptance criteria for adopting this workflow

To consider this workflow "live":

1. The closure-test files in
   [closure-tests-handoff.md](closure-tests-handoff.md) exist and
   pass.
2. A short paragraph linking to this workflow lives in
   [CLAUDE.md](../../CLAUDE.md) under a "Specs and tests" heading.
3. The next spec change (whatever it is) follows the per-edit
   checklist as a forcing function — and the experience either
   confirms the workflow or surfaces friction worth fixing here.

---

# Bootstrapping checklist

For the session that adopts this workflow:

- [ ] Implement the Layer 1 + Layer 2 closure tests per
      [closure-tests-handoff.md](closure-tests-handoff.md).
- [ ] Add the P-class skip-marked regression tests per the same
      handoff.
- [ ] Add a "Specs and tests" section to
      [CLAUDE.md](../../CLAUDE.md), 4–6 lines, linking here and to
      the closure-tests handoff.
- [ ] (Optional) draft the pre-commit hook for the
      `docs/specs/*` → `*-closure.test.ts` check.

# Out of scope

- The actual engine fixes for P-class items
  ([rules-spec-code-drift-audit.md](rules-spec-code-drift-audit.md)
  §1 has the to-do list and effort estimates).
- The §T-N renumbering (P2) — a separate refactor effort, ~1
  day mechanical.
- Spec changes to fix any open Class-C deferrals — those are
  governed by [deductions-audit.md](deductions-audit.md), not by
  this workflow.
- Bidding-phase spec — not formalised today; if formalised in
  future, the same workflow applies.
