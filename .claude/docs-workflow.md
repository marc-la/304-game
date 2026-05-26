---
title: Docs Workflow — Handoffs, Explainers, Specs
status: standing instruction
applies_to: any session that creates, updates, or deletes documents under `docs/`
---

# The three folders

The `docs/` tree has three subtrees, each with its own lifecycle. Putting a doc in the wrong subtree breaks the workflow — readers and future Claude sessions will look in the wrong place.

## docs/handoffs/

**What lives here**: live, intra-session state. The "what to pick up next session" briefs. A handoff is created when the current session uncovers work that's worth doing but won't fit in this session — a follow-up algorithm, a refactor, a deferred audit. It captures *everything* the next session needs to start cold: context, current state, recommended approach, validation gate, hard constraints.

**Lifecycle**:
- **Created**: during a session, when the model or user identifies a discrete piece of follow-up work big enough to need its own session.
- **Updated**: during a session that picks it up, to reflect what's been done so far.
- **Deleted**: when the work lands. Git log is the permanent record of "what got shipped" — there is no archive folder.

**Naming**: `<topic>-handoff.md` (or `<topic>-v2-handoff.md` for explicit revisits). Lower-kebab-case.

**Frontmatter**: `status:` should always say whether the handoff is `open`, `partially shipped`, or `superseded by <link>`. Date the status. Future readers should be able to tell at-a-glance whether this is alive or about to be deleted.

## docs/explainers/

**What lives here**: plain-English write-ups of *interesting* things, written for a lay reader. The thing that's interesting is usually conceptual — an algorithm's idea, a mental model, the *why* under the hood. Examples that belong: "what each of the eight bots actually does", "how the caps witness line works", "why double-dummy search is sound under uncertainty". Examples that don't belong: bug-fix changelogs, refactor notes, mechanical migration steps.

**Audience**: 304 players, future contributors, an interested reader who hasn't read the code. The bar is "could a player who's never written software follow this?" If not, simplify or move it to a spec.

**Lifecycle**:
- **Created**: only when Marc explicitly asks. Don't write explainers proactively post-session — the model is bad at judging which sessions produced *interesting* work vs. routine plumbing. Wait for the ask.
- **Updated**: when the underlying truth changes and the explainer would mislead.
- **Deleted**: rarely — only if the underlying thing the explainer described is gone entirely.

**Naming**: `<topic>-explained.md` or just `<topic>.md`. Lower-kebab-case.

## docs/specs/

**What lives here**: durable reference. The rules of 304. The caps formalism. The engine's play invariants. These are the documents the implementation is checked against. They change when the underlying truth changes — never as part of a session's incidental refactoring.

**Lifecycle**:
- **Created**: rarely. A new spec means a new layer of canonical truth.
- **Updated**: when the rules / formalism / invariants themselves change. Always with a clear paper trail in git log.
- **Deleted**: essentially never.

**Naming**: `<topic>.md` (no suffix). Lower-snake-case is OK here for parity with the existing `caps_formalism.md` / `play_invariants.md`.

# Decision flow

When deciding where a new doc goes — or whether to even write one:

```
Did the user explicitly ask for a doc?
├── No → don't write one. Inline the content in the response or a comment.
└── Yes
    ├── Is it about work that's not yet finished, or work for a future session?
    │   → docs/handoffs/
    ├── Is it a plain-English explanation of an *interesting* idea, written for a lay reader?
    │   → docs/explainers/
    └── Is it the canonical truth of a rule, formalism, or invariant?
        → docs/specs/
```

If a closed handoff would have been "the post-mortem of an interesting session", the right move is to delete it (git log preserves the work) and *separately* offer to write an explainer in plain English if Marc thinks the underlying ideas are interesting.

# When the user says "write me a handoff"

Default to enough context that a cold-start session can do the work without reading prior conversation. Include:

- One-line goal at the top.
- State-of-play summary (what's already true, what's not).
- Recommended approach with the alternatives considered.
- Validation gate (how the next session knows it's done).
- Hard constraints (determinism, the spec, no new deps, etc.).
- Reading list (the 3–5 files the next session must skim).

Avoid step-by-step task lists unless the work is genuinely mechanical. The next session has a brain.

# When the user says "write me an explainer"

Default to the longest explainer that earns its length. A long explainer that a player can follow start-to-finish is better than a short one that requires reading the code. Use diagrams (markdown ASCII), worked examples, and analogies. Avoid jargon that doesn't already exist in [specs/rules.md](../docs/specs/rules.md). Cross-link to specs liberally.

# What never goes in docs/

- Ship records / changelogs / "what changed in this PR". Git log is the changelog.
- Mid-session notes / TODO lists. Use the TodoWrite tool or your own scratch.
- Audit reports from one-off investigations. Either fold the findings into a spec edit (if it changed the truth), a handoff (if it left work undone), or delete them once acted on.

# Migrating older docs

The 2026-05-26 reorganisation deleted a batch of closed handoffs and ship-record `*-changes.md` files. If you find a stale reference in source code or another doc:

- If it pointed to a *closed* handoff: replace with a `git log` reference or remove the link entirely.
- If it pointed to a *moved* spec: update the path (e.g. `docs/rules.md` → `docs/specs/rules.md`).
- If you can't tell, search git log: `git log --follow -- docs/<old-name>.md`.
