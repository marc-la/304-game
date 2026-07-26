---
title: 304 — Claude Code workspace conventions
status: living document
purpose: One-page orientation. Anything Claude needs in every session. Links to longer-form rules in .claude/.
---

# Read first

1. [.claude/soul.md](.claude/soul.md) — the design constitution. Where rules contradict the soul, soul wins.
2. [.claude/directory.md](.claude/directory.md) — repo layout. Where things live, where new code goes.
3. [docs/README.md](docs/README.md) — the docs tree (handoffs / explainers / specs) and what belongs where.

# The docs tree at a glance

| Folder | Purpose | Lifecycle |
|---|---|---|
| `docs/handoffs/` | Live, intra-session state. The "what to pick up next session" briefs. | Updated during a session. Deleted when the work lands. Git log preserves history. |
| `docs/explainers/` | Plain-English, lay-reader-friendly write-ups of *interesting* things — algorithms, mental models, the "why under the hood". | Curated by Marc post-session ("this was interesting; write it up"). Not created automatically. |
| `docs/specs/` | Durable reference. Rules, formalism, invariants. | Edited only when the underlying truth changes. |

Full conventions in [.claude/docs-workflow.md](.claude/docs-workflow.md).

# Git workflow — commit-on-turn

After **any** assistant turn that modified tracked files, stage those files explicitly and commit with a clear one-line message before signing off. Push to `origin/main` immediately — there is no PR flow for routine work on this repo.

- **Don't** use `git add -A` or `git add .` — pick the specific files you touched. The repo has volatile artifacts (`tools/bots/elo/results.json` during tournaments, generated puzzle pools) that should not auto-commit.
- **Don't** stage files modified by the user concurrently (e.g. the user edits `dds-core.ts` while you reorganise docs). Stage your own work only.
- **Don't** force-push, amend published commits, or skip hooks unless explicitly asked.

A Stop hook in [.claude/settings.json](.claude/settings.json) acts as a safety net: if a turn left staged-but-uncommitted changes behind, the hook commits and pushes them with an auto-generated message. In normal flow the hook is a no-op because Claude has already committed.

Full rules + the hook script: [.claude/auto-commit.md](.claude/auto-commit.md).

# UI-touching work

See [.claude/gui-verification.md](.claude/gui-verification.md). Tests prove code runs; they don't prove the UI looks right.

# Standing context (always loaded)

- 304 is a Tamil South-Asian trick-taking card game. The single ship target is a static GitHub Pages site (304dle) plus a multiplayer surface.
- The bot zoo lives at `engine/bots/`. The CSP / caps machinery lives at `engine/caps-csp.ts` and `engine/info.ts`.
- Determinism is a hard invariant for bots: `(info-set, rng seed)` → same play, byte-for-byte.
- Any change to the leaderboard surfaces (`site/leaderboard*.html`, `site/js/leaderboard/`) is bound by [.claude/leaderboard-design.md](.claude/leaderboard-design.md).
- Play data (stats.xlsx, betting CSVs) lives in `data/`; the build parses it into `site/public/data/leaderboard.json`.
