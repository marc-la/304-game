---
title: 304dle — Regenerate the shipped puzzle window
status: OPEN (2026-07-26). Strictly downstream; do not start early.
owns: site/public/puzzles/, .github/workflows/puzzles-refill.yml
depends_on: caps-par-authority-handoff.md (hard), closed-trump-bot-handoff.md (if closed)
---

# Goal

Replace the 24 shipped puzzles with a window whose metadata is correct.

# State of play

The window at `site/public/puzzles/` (2026-07-27 onward) is
**mis-curated**, for three separate reasons:

1. Its `obligation` and `labour` values were computed against an
   obligation predicate that has since been fixed for over-claiming.
   After the fix, par moved substantially later — the spread went to
   roughly R5=8, R6=6, R7=10, with ten puzzles peaking at R7 where there
   is almost no window left to call in.
2. The predicate *also* under-claims, so even the post-fix par values
   are later than the truth. Two are confirmed wrong by independent
   verification (2026-08-02 and 2026-08-14 are obligated by R3; the
   engine stamps R5 and R6).
3. Every puzzle carries `revealedTrumpCardId: null`. The open-trump
   reveal is now emitted by the generator but these predate it, so the
   information the rules require the trumper to show
   (`docs/specs/rules.md` §245) is missing from the player's information
   set.

Regenerating before (1) and (2) are resolved simply bakes in another
round of wrong numbers. That is why this is a separate handoff and why
it must not be started early.

The generator itself is healthy: open mode with `b4-infoset-1ply` yields
about one accepted puzzle per 20s of compute, with labour 6–15 against a
threshold of 4, and a par-round quota that stops any single round
dominating. `flushDated` writes incrementally so a long run survives
interruption.

# Recommended approach

Once par is authoritative, regenerate a 30-day window and gate it on the
verifier rather than on the generator's own opinion — the two must agree
before anything ships. Then wire that gate into
`.github/workflows/puzzles-refill.yml` so the scheduled top-up cannot
publish a puzzle whose par has not been independently confirmed.

Watch the par spread as it comes out. Natural obligation is *late* —
R6+R7 is roughly 72% of sweeps in bot self-play — and the labour filter
kills nearly all R6 and all R7, which is why the band keeps collapsing to
the middle. If the quota starves, that is information: the honest fix is
a stronger defence (raising labour naturally), not a lower threshold.

# Validation gate

- `npm run puzzles:audit` → 0/N unsound.
- Sampled `npm run puzzles:verify` runs confirm par is the *first*
  obligated round, not merely *an* obligated round.
- `apps/304dle/__tests__/today.test.ts` green — it replays every shipped
  puzzle end-to-end and validates legality via `applyScriptedPlay`.
- `index.json` matches the files on disk.
- Open-trump puzzles whose trumper lacks round-1 priority carry a
  non-null `revealedTrumpCardId`.
- Play three days in a browser before publishing.

# Hard constraints

- Puzzle data is public by construction — the site is static, so
  anything the browser fetches, anyone can fetch. Per-date files limit
  the *horizon*, not the secrecy. Do not attempt encryption; do not put
  it in repo secrets (they never reach the client, and the 48KB cap
  makes it moot anyway).
- Keep the rolling window short. It bounds how far ahead answers are
  readable and it means generator improvements reach players in weeks.
- Do not lower `minLabour` or `minWitnessSuitSpan` to make a run finish.

# Reading list

- `tools/puzzles/generate-scripted.ts`.
- `tools/puzzles/audit-obligation.ts`, `tools/puzzles/verify-caps.ts`.
- `.github/workflows/puzzles-refill.yml`.
- `apps/304dle/__tests__/today.test.ts`.
