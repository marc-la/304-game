---
title: 304dle — Regenerate the shipped window as runs
status: OPEN (2026-08-04, rescoped for the run). Strictly downstream; do not start early.
owns: site/public/puzzles/, .github/workflows/puzzles-refill.yml, apps/304dle/types.ts
depends_on: caps-par-authority-handoff.md (hard), run-structure-handoff.md (hard), decoy-supply-handoff.md (hard), closed-trump-bot-handoff.md (if closed)
---

# Goal

Replace the 24 shipped puzzles with a window whose metadata is correct
and whose unit is a **run** — an ordered sequence of deals per date, not
a single deal.

# State of play

The window at `site/public/puzzles/` (2026-07-27 onward) is
**mis-curated**, for three separate reasons, all of which predate the run
design and none of which it fixes:

1. Its `obligation` and `labour` values were computed against an
   obligation predicate that has since been fixed for over-claiming.
   After the fix, par moved substantially later — the spread went to
   roughly R5=8, R6=6, R7=10, with ten puzzles peaking at R7 where there
   is almost no window left to call in.
2. The predicate *also* under-claims, so even the post-fix par values are
   later than the truth. Two are confirmed wrong by independent
   verification (2026-08-02 and 2026-08-14 are obligated by R3; the
   engine stamps R5 and R6).
3. Every puzzle carries `revealedTrumpCardId: null`. The open-trump
   reveal is now emitted by the generator but these predate it, so the
   information the rules require the trumper to show
   (`docs/specs/rules.md` §245) is missing from the player's information
   set.

Regenerating before (1) and (2) are resolved simply bakes in another
round of wrong numbers. That is why this is a separate handoff and why it
must not be started early.

The generator itself is healthy: open mode with `b4-infoset-1ply` yields
about one accepted puzzle per 20s of compute, with labour 6–15 against a
threshold of 4, and a par-round quota that stops any single round
dominating. `flushDated` writes incrementally so a long run survives
interruption.

# What the run changes

**Schema.** A date now maps to a run, not a puzzle. `ScriptedPuzzle`
survives unchanged as the *deal* type — do not fold run concerns into
it. Add a wrapper carrying the ordered deals, each tagged `caps` or
`decoy`, plus per-decoy `temptation` / `refutationWidth`
(`decoy-supply-handoff.md`). `index.json` lists dates as before.

**Do not ship the depth in a readable field.** The wrapper must not
announce which deal is the caps one, and a client that fetches the day's
run can read anything in it. Puzzle data is public by construction (see
constraints), so this is a *horizon* control, not secrecy — but the array
position of the caps deal should not be trivially greppable by a casual
player poking at devtools. Decide the representation deliberately.

**Volume.** `E[depth] = 2.2`, so a 30-day window is ~66 deals against
today's 30, of which ~36 are decoys the funnel has never produced. At the
current ~20s per accepted caps deal, plus world-counting for temptation
which is strictly more expensive, this is roughly a 3x compute increase
on a job already measured in hours. Budget for it before starting.

**Payload.** Per-date files grow ~2.2x. Check the fetched size on a
phone connection before publishing; a run that is fine on desktop and
sluggish on 4G is a real regression against a daily ritual.

# Recommended approach

Once par is authoritative and the decoy funnel exists, regenerate a
30-day window and gate it on the verifier rather than on the generator's
own opinion — the two must agree before anything ships. Then wire that
gate into `.github/workflows/puzzles-refill.yml` so the scheduled top-up
cannot publish a run whose par has not been independently confirmed, or
whose decoys have not been independently certified non-obligated.

Watch the par spread as it comes out. Natural obligation is *late* —
R6+R7 is roughly 72% of sweeps in bot self-play — and the labour filter
kills nearly all R6 and all R7, which is why the band keeps collapsing to
the middle. If the quota starves, that is information: the honest fix is
a stronger defence (raising labour naturally), not a lower threshold.

Assemble runs only after both pools exist. Drawing depth first and then
hunting for deals to fill it will starve on the deep days.

# Validation gate

- `npm run puzzles:audit` → 0/N unsound.
- Sampled `npm run puzzles:verify` runs confirm par is the *first*
  obligated round, not merely *an* obligated round.
- **Every decoy certified non-obligated at every event state by the
  offline verifier** — not by `checkCapsObligation`, which under-claims
  and would admit real caps deals as decoys
  (`decoy-supply-handoff.md`, the oracle bug).
- Depth distribution across the window matches the target geometric, by
  counting the emitted files rather than trusting the draw.
- `apps/304dle/__tests__/today.test.ts` green — extended to replay every
  deal of every run end-to-end, validating legality via
  `applyScriptedPlay`.
- `index.json` matches the files on disk.
- Open-trump deals whose trumper lacks round-1 priority carry a non-null
  `revealedTrumpCardId`.
- Play three days in a browser before publishing, including at least one
  depth ≥ 3 day, timed (`run-tempo-handoff.md`).

# Hard constraints

- Puzzle data is public by construction — the site is static, so anything
  the browser fetches, anyone can fetch. Per-date files limit the
  *horizon*, not the secrecy. Do not attempt encryption; do not put it in
  repo secrets (they never reach the client).
- Keep the rolling window short. It bounds how far ahead answers are
  readable and it means generator improvements reach players in weeks.
- Do not lower `minLabour`, `minWitnessSuitSpan`, or the decoy temptation
  thresholds to make a run finish.
- Do not fold run concerns into `ScriptedPuzzle`. The deal type is shared
  with the per-deal runtime, which must stay run-agnostic.

# Reading list

- `tools/puzzles/generate-scripted.ts`.
- `tools/puzzles/audit-obligation.ts`, `tools/puzzles/verify-caps.ts`.
- `.github/workflows/puzzles-refill.yml`.
- `apps/304dle/__tests__/today.test.ts`.
- `apps/304dle/types.ts` — `ScriptedPuzzle`, `ScriptedPuzzleFile`.
