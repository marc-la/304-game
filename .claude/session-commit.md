---
title: End-of-Session Commit & Push
status: standing instruction
applies_to: every working session in this repository
---

# End-of-Session Commit & Push

This project ships from `main`. There is no PR review flow for routine work. Once a session is complete and both the developer and Claude are satisfied with the changes, the session ends with a commit and a push to `main` — performed by Claude, not left for the developer to remember.

## When this applies

Trigger this flow when **both** are true:

1. The developer has signaled the session is done — explicit "we're done", "ship it", "looks good, that's a wrap", or any close-out where the work is being treated as complete.
2. Claude has no outstanding concerns — tests pass, [GUI verification](gui-verification.md) is complete for any UI-touching changes, no half-finished edits or known regressions remain.

If either side is not satisfied, **do not commit**. Surface the unresolved item and wait. A push to `main` is harder to undo than a few extra minutes of conversation.

## The flow

Run these in order. Use parallel `Bash` calls where the steps are independent.

1. **Snapshot the state.** In parallel: `git status` (no `-uall`), `git diff` (staged + unstaged), `git log -10 --oneline` (to match the repo's commit-message style).
2. **Decide the commit message.** Write 1–3 sentences focused on the *why*, not the *what*. Match the existing log's tone — short, lowercase-leaning, plain. Do not invent ceremony the repo doesn't already have.
3. **Stage deliberately.** Add files by name. Do **not** use `git add -A` or `git add .` — those sweep in `.env`, credentials, build artifacts, and any in-progress work the developer didn't mean to ship. If an unfamiliar file appears in `git status`, ask before staging it.
4. **Commit.** Use a HEREDOC for the message so multi-line formatting survives. Include the standard `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailer.
5. **Verify the commit landed.** `git status` should be clean, `git log -1` should show the new commit.
6. **Push to `main`.** `git push origin main`. If the push is rejected (non-fast-forward), **do not force-push.** Pull, reconcile, and re-push — or stop and ask if reconciliation is non-trivial.

## Hard rules

- **Never `--no-verify`.** If a pre-commit hook fails, fix the underlying issue and create a new commit. Do not bypass hooks. Do not `--amend` after a hook failure — the failed commit didn't happen, so amending modifies the *previous* (unrelated) commit and can destroy work.
- **Never force-push to `main`.** Not with `--force`, not with `--force-with-lease`, not with `+main`. If history needs rewriting, that is a conversation, not an action.
- **Never commit secrets.** `.env`, `*.key`, `credentials*.json`, anything with the shape of an API token — refuse and warn, even if the developer staged it. Especially if the developer staged it.
- **One session, one commit (usually).** Prefer a single coherent commit per session over a chain of "wip" commits. If the work is genuinely two unrelated changes, two commits is fine — but don't manufacture history.

## What to report back

After the push, the final message to the developer should state:
- the commit SHA (short),
- the one-line summary,
- confirmation that `git push` succeeded,
- a link or hint if anything still needs attention (failing CI, follow-up work flagged during the session).

That ends the session.
