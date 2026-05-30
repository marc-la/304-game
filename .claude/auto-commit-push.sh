#!/usr/bin/env bash
# .claude/auto-commit-push.sh
#
# Stop hook: runs at the end of every assistant turn. Acts as a safety
# net for the "commit-on-turn" convention in CLAUDE.md: if a turn left
# *staged* changes behind without committing them, this hook commits
# and pushes them with an auto-generated message.
#
# Deliberately conservative:
#   - Never runs `git add`. Staging is Claude's responsibility, so the
#     hook can't accidentally sweep in volatile files (the tournament's
#     in-flight results.json, generated puzzle pools, the user's
#     concurrent edits).
#   - Exits silently when there's nothing staged. In normal flow Claude
#     has already committed and pushed; the hook is a no-op.
#   - Auto-commit message names the files changed plus a timestamp.
#     If you want a thoughtful message, commit manually before the
#     turn ends — that's the documented convention.
#
# Disable for a single session by exporting:
#   CLAUDE_AUTO_COMMIT_DISABLED=1

set -euo pipefail

if [ "${CLAUDE_AUTO_COMMIT_DISABLED:-0}" = "1" ]; then
  exit 0
fi

# Locate repo root. Exits 0 (not an error) if we're not in a git repo —
# the hook may fire in contexts where a repo isn't checked out.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  exit 0
fi
cd "$ROOT"

# Nothing staged → nothing to do. The common case.
if git diff --cached --quiet; then
  exit 0
fi

# Build a compact summary from --stat: "3 files changed, 42 insertions(+)..."
SUMMARY=$(git diff --cached --shortstat | sed 's/^ *//' | tr -d '\n')
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Commit. Use --no-verify only if the user has signalled they want it;
# default to running pre-commit hooks normally.
git commit -m "auto: ${SUMMARY:-staged changes} (${TS})" \
           -m "Auto-committed by .claude/auto-commit-push.sh because the assistant turn ended with staged-but-uncommitted changes. The thoughtful per-turn commit convention is in CLAUDE.md." \
           -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

# Push. Fall back to noisy stderr (no exit-1) if push fails — the commit
# is already local and recoverable; failing the whole hook would just
# pollute the user-facing log.
if ! git push origin HEAD 2>&1; then
  echo "auto-commit-push: push failed; commit kept locally" >&2
fi
