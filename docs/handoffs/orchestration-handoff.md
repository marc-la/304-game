---
title: 304dle — Master orchestration (drive every open handoff to a playable run)
status: OPEN (2026-08-04). The entry point. Read this before any other handoff.
owns: nothing directly — it sequences the other nine handoffs.
sequences: soul-first-principles, dds-transposition, caps-call-ux, caps-par-authority, run-structure, decoy-supply, caps-verdict-model, run-tempo, puzzle-window-regeneration, closed-trump-bot
---

# What this is

A single brief that drives all outstanding 304dle work to a **playable,
testable run** in one session. It does not restate the handoffs — each
track below points at the one that owns it. What lives here is the
*sequencing*: what can run in parallel, what cannot, what must be pinned
before fanning out, and where the session has to stop and get a human to
look at a screen.

# The scope call — read this first

**"One session, fully operational" is achievable only with a reduced
target.** Two things cannot be compressed, and pretending otherwise would
produce a plan that fails in hour six:

1. **Generation compute.** A 30-day production window is ~66 deals at
   ~20s per accepted caps deal, plus a decoy funnel that does world
   *counting* rather than witness-exhibiting. That is hours of wall
   clock and no amount of parallelism changes it.
2. **`closed-trump-bot` is a whole new bot** — porting `b4`'s info-set
   machinery to a closed-trump action space. It is orthogonal to whether
   the run works, and open trump is already the specified v1 mode.

So:

| | |
|---|---|
| **In scope** | The run end-to-end on a **5-day window**: correct par, real decoys, run verdicts, tempo envelope, arm-and-point, open trump. |
| **Parked** | `closed-trump-bot`. The 30-day production window. Gating `puzzles-refill.yml`. |

The 5-day window is a *demonstrable artifact*, not a shippable one. It
proves the machine works; production regeneration is a follow-on job that
can run unattended.

# Definition of done

The session is done when all of these are true, in this order:

1. `npm test` green (vitest, from `frontend/`).
2. `npm run build` clean (`tsc -b && vite build`).
3. `npm run puzzles:audit` → 0/N unsound on the 5-day window.
4. Every decoy in the window certified non-obligated **by the offline
   verifier**, not by `checkCapsObligation`.
5. A human has played three days in a browser, including one at depth ≥ 3,
   at ≥1280px and ≤390px.
6. `soul.md` carries no implementation prescriptions.

**(5) is a hard human gate.** There is no browser automation in
`frontend/package.json` — no playwright, no puppeteer. A session that
reports the run "operational" on tests alone is lying by the standard in
`.claude/gui-verification.md`. Batch all UI work so this gate is paid
once, at the end, not five times.

# The real dependency graph

The blocking structure is not the whole story — **file ownership
collides in places the DAG does not show**, and two tracks that look
parallel will stomp each other. Collisions are marked `⚠`.

```
WAVE 0  (parallel, no shared files)
  A soul-first-principles   .claude/*, CLAUDE.md
  D dds-transposition       engine/dd.ts
  C caps-call-ux            apps/304dle/components/*, App.tsx ⚠(I), app.css

WAVE 1  (sequential — the bottleneck)
  B caps-par-authority      engine/caps-{csp,}.ts, store.ts ⚠(F), types.ts ⚠(F,J)
                            ← softly wants D landed (7-card verification)

WAVE 2  (F first, then H ∥ I; G runs alongside all of it)
  F run-structure           store.ts, runtime.ts ⚠(I), types.ts, storage.ts ⚠(H)
    ├ H caps-verdict-model  scoring.ts, storage.ts, ResultScreen.tsx
    └ I run-tempo           tempo.ts, runtime.ts, App.tsx
  G decoy-supply            tools/** only — no app files, so it is free to
                            run in parallel with F/H/I. START IT EARLY.

WAVE 3  (sequential, needs B+F+G)
  J puzzle-window-regen     site/public/puzzles/, types.ts

WAVE 4  integration + the human gate
```

**G is the long pole and it collides with nothing in `apps/`.** Launch it
the moment B lands, in parallel with the entire run-core wave. Sequencing
it after F, which the naive reading of the handoffs suggests, wastes the
one genuine parallelism opportunity in the plan.

# Pre-flight — do this in the main session before fanning out

Parallel agents in worktrees cannot see each other's changes, so any
interface two tracks share must exist **before** they split. Skipping
this is the most likely way this plan fails.

Pin, in `apps/304dle/types.ts` and `apps/304dle/scoring.ts`, as
types-only stubs with no behaviour:

- **The run wrapper.** `ScriptedPuzzle` stays the *deal* type, unchanged.
  Add the run container: ordered deals, each tagged caps/decoy, per-decoy
  `temptation` and `refutationWidth`. F, G and J all write against this.
- **The verdict kinds.** `advanced | busted-early | missed | won |
  won-marked | late` (see `caps-verdict-model-handoff.md` — there is no
  decline verdict). F and H both branch on these.
- **The storage v4 shape.** Run record: terminal verdict, depth,
  per-deal outcomes, elapsed. F and H both write it.

Commit the stubs before launching anything. Then no track has to guess,
and merges are mechanical.

# The tracks

Each track is a subagent brief. Give it the named handoff, the file
list, and its gate — the handoffs were written to be picked up cold, so
do not re-explain the context in the prompt.

Run parallel tracks with `isolation: "worktree"`. Sequential tracks run
in the main worktree.

### Wave 0 — parallel, 3 worktrees

| | track | handoff | gate | size |
|---|---|---|---|---|
| **A** | soul-first-principles | `soul-first-principles-handoff.md` | `soul.md` has no prescriptions; every one lands in `.claude/304dle-design.md` with its reasoning; `CLAUDE.md` points at it | M |
| **D** | dds-transposition | `dds-transposition-handoff.md` | `puzzles:verify --date 2026-08-02 --round 1` terminates; five-card answers **identical** old-vs-new across a few hundred positions | L |
| **C** | caps-call-ux | `caps-call-ux-handoff.md` | arm → cancel → arm → pick, no way to play a card while armed; modal gone | M |

A is doc-only and unblocks the run politically — the constitution
currently forbids it. D is pure `engine/dd.ts` and makes B's validation
real. C is pure UI.

*Known churn:* C touches `App.tsx`, which I rewrites later. Accept it —
C also deletes a daily soul violation (the confirm modal), and the
arm-and-point gesture lives on the table, which F does not restructure.

### Wave 1 — sequential, main worktree

**B — `caps-par-authority-handoff.md`.** The bottleneck; everything
caps-shaped waits. Ship an offline-verified par and grade against it.

Gate: `puzzles:audit` 0/N unsound; for ≥10 puzzles `--round <par-1>` is
**not obligated** and `--round <par>` is **OBLIGATED**; 2026-08-02 and
2026-08-14 resolve to R3; 2026-08-03 stays not-obligated at R3;
`caps-soundness.test.ts` green.

Do not start wave 2 until this gate passes. A wrong par poisons decoy
certification, verdicts, and the window simultaneously.

### Wave 2 — G launches immediately; F then H ∥ I

**G — `decoy-supply-handoff.md`** (worktree, `tools/**` only). Launch the
instant B lands. Longest-running track; everything else can proceed
around it.

Gate: no decoy obligated at any event state **per the offline verifier**;
temptation ≥ 0.95 and `refutationWidth` ≤ 2; both break rounds (R7 and
R8) present in the output mix.

**F — `run-structure-handoff.md`** (main worktree). The run state machine
*above* `runtime.ts`, which stays a single-deal engine. Do not entangle
them.

Gate: a player who never calls survives every decoy — assert in a test,
it is structural; break beat fires and ends the deal; arming cannot
survive a deal boundary.

Then, in parallel worktrees:

**H — `caps-verdict-model-handoff.md`** (scoring, storage v4, result screen).
Gate: `busted-early` / `late` / `missed` visibly differ; "never call"
scores zero; surviving a decoy is visibly not a score.

**I — `run-tempo-handoff.md`** (tempo envelope).
Gate: time in R3–R6 rises, total deal time does not; no delay band
certifies hidden state (preserve the ±42% jitter property).

### Wave 3 — sequential

**J — `puzzle-window-regeneration-handoff.md`**, at **5 days, not 30.**
Gate: audit 0/N; par confirmed *first*-obligated by sampled verify;
`index.json` matches disk; `today.test.ts` extended to replay every deal
of every run.

### Wave 4 — integration

Full suite, build, then the human gate. Play three days including one at
depth ≥ 3, desktop and phone.

# Decision points that will come up

Pre-agreed answers, so a subagent does not improvise:

**D fails to make 7-card positions tractable.** Ship B against the
positions that *do* verify, and record which puzzles have unverified par.
Do not grade against an unverified par, and do not fall back to the CSP.

**Decoy supply misses the temptation threshold.** Accept fewer decoys and
shrink the window. **Do not lower the threshold** — that is the same rule
`minLabour` lives under, and a weak decoy trains players to skip deals
without reading.

**The par spread collapses late (R6–R7 heavy).** Known: R6+R7 is ~72% of
sweeps and the labour filter kills most of them. Accept a smaller window.
The honest fix is a stronger defence, which is `closed-trump-bot`'s
territory and is parked.

**A track's gate fails and the fix looks structural.** Stop that track,
leave the handoff open with findings appended, and continue the others.
Do not let one track's rework serialize the whole plan.

**Anything requires reversing a Marc ruling** (no decline, `p = 0.45`,
depth-is-not-score, no emoji grid, one player action). Stop and ask. These
are decisions, not defaults.

# If the session runs out of room

Land in this order — each prefix is independently coherent:

1. **A + B.** Constitution split and correct par. Fixes a live bug where
   correct players are told "too early", and unblocks everything. Ships
   value even if nothing else lands.
2. **+ F + H.** The run works, verdicts are right, on the existing
   window's caps deals with hand-assembled decoys. Playable.
3. **+ G + J.** Real generated decoys, real window.
4. **+ C + I + D.** Polish, tempo, verification depth.

Do **not** land G or J without B — a window generated against a wrong
predicate bakes in another round of wrong numbers, which is exactly the
state the current shipped window is in.

# Hard constraints (apply to every track)

- Determinism: `(info-set, rng seed) → same play, byte-for-byte`.
- No new runtime dependencies; the site is static.
- `engine/` stays free of app concerns; `apps/304dle` and `apps/play` do
  not import each other.
- 304dle styles live in `apps/304dle/app.css`.
- Commit per turn, stage explicitly, never `git add -A` — the repo has
  volatile artifacts. See `CLAUDE.md`.
- Each track deletes its handoff when its work lands and its gate passes.
  This file is deleted last.

# Reading list

- Every handoff in `docs/handoffs/` — this file sequences them, it does
  not replace them.
- `.claude/gui-verification.md` — the standard for the human gate.
- `.claude/directory.md` — layer boundaries the tracks must respect.
- `docs/README.md` — the same graph, one level up.
