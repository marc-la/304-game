---
title: 304 — Strip the constitution to first principles
status: OPEN (2026-08-04). Marc's direction, given this session. No engine code; one doc split.
owns: .claude/soul.md, .claude/304dle-design.md (new), CLAUDE.md
blocks: run-structure, decoy-supply (soul §VI forbids both today)
---

# Goal

Marc's ruling, 2026-08-04: **the constitution should be first principles
only — no design or implementation prescriptions.**

`.claude/soul.md` currently mixes two documents. One is a constitution:
what 304 *is*, where it came from, what it feels like, what the compass
is. The other is a design brief for 304dle: what the trump chip should
display, that the worlds counter is "the visible spine", that a hand is
"a 3–5 minute pressurized deductive sprint", that a loss redeals the same
hand. Split them.

This supersedes the three-amendments plan from 2026-07-26. Each of those
was an attempt to drag a stale *prescription* back into line with the
code — which is the symptom, not the disease. The soul kept going stale
because it carried prescriptions at all.

# The split

**`.claude/soul.md`** keeps first principles: §I The Heart, §II Origin &
Cultural Texture, §III Foundational Principles, §IV The Texture
(descriptive halves), §V The Compass, §VII the checklist. This is the
part whose authority comes from being stable, and after the split it
should almost never need to change.

**`.claude/304dle-design.md`** (new) takes everything prescriptive. The
precedent already exists in this repo: `.claude/leaderboard-design.md` is
a binding design doc subordinate to the soul, referenced from
`CLAUDE.md`. Follow that shape exactly — do not invent a new convention.

What moves:

- **All twelve `> **Design implication.**` blocks** in §IV and §V.
- **§VI in its entirety** — VI.1 (what 304dle strips), VI.1.1
  (curatorial decisions, and the trump-chip UI spec), VI.2 (what it
  preserves), VI.3 (what it replaces, including redeal), VI.4 (the
  single-player virtue and the duration claim), VI.5 (the forbidden
  list).
- **§III.1's second sentence** — *"The possible-worlds counter in 304dle
  exists to visualize the asymmetry without removing it."* The principle
  is "information asymmetry is the fuel"; the counter is a mechanism.
- **§VII's 304dle-specific checklist items**, if any survive the pass.

# The test to apply

For each clause: **does it describe what 304 *is*, or what our
implementation should *do*?** First stays, second moves.

Expect judgment calls, and expect to get some wrong. *"The player should
feel surveilled"* (§IV.1) is close to a principle. *"Poker-library-style
placement animations are a viable starting point"* (§IV.6) is plainly a
prescription. When genuinely torn, **move it** — a principle that turns
out to live in the design doc is a smaller error than a prescription that
keeps the constitution churning, which is the failure this split exists
to end.

# What the split unblocks

The three pending amendments dissolve into ordinary design edits:

- **§VI.3 "when, not if" and the redeal loop.** The run reverses both.
  As constitutional clauses these needed sign-off and blocked
  `run-structure-handoff.md` outright; as design-doc clauses they are a
  normal edit. **This is the real unblocking** — the run stops waiting on
  a constitutional amendment.
- **§VI.2 the worlds counter as "the visible spine".** Already false in
  the code — the live ticker was removed and kept for the post-game,
  because a policy reading only the ticker matched or beat every
  fixed-round strategy with no memory at all. Carry that reasoning into
  the design doc; do not lose it in the move.
- **§VI.4 "a 3–5 minute pressurized deductive sprint".** Was queued to be
  amended *down* to 60–120s for being arithmetically false at one deal
  per day (34–64s measured). The run makes the original figure true
  (~1m50 average, ~5m at depth 6). **Move it unchanged.**

Carry the *reasoning* across, not just the clauses. Each was argued from
measurement, and a design doc that states conclusions without evidence
will be re-litigated in six months.

# Approach

Two commits, not one. First the mechanical split with no wording changes,
so the diff is reviewable as a move. Then the substantive edits (the run,
the reversals) on top, where they read as decisions.

Do not rewrite the soul's voice while moving things out of it. Its
authority comes from being Marc's.

# Validation gate

- No clause in the trimmed `soul.md` prescribes an implementation. Read
  it end to end and check — 12 design-implication blocks plus §VI is the
  known inventory, but the test above may catch more.
- Nothing is lost in the move: every prescription that leaves the soul
  lands in the design doc, with its reasoning.
- `CLAUDE.md` points at the new design doc the way it points at
  `.claude/leaderboard-design.md`. `.claude/directory.md`'s "soul
  touchpoints" section still resolves.
- The authority ordering is stated in both files: soul wins over design,
  design binds implementation.
- Marc signs off on the split *and* on the run reversals separately. The
  split is his direction; the reversals are a design decision the split
  merely relocates.

# Hard constraints

- Soul wins over rules where they conflict, and now over the design doc
  too. Do not let the split blur that ordering.
- Do not delete the cultural sections (§II, §IV descriptive halves) as
  part of tidying. They are the point.
- Do not soften §IV.11's rejection of luck-driven loss. Depth-is-not-score
  (`caps-verdict-model-handoff.md`) depends on it staying true.
- Do not batch unrelated edits into the split commit.

# Reading list

- `.claude/soul.md` — all of it; this is a whole-document pass.
- `.claude/leaderboard-design.md` — the precedent for a binding
  subordinate design doc.
- `CLAUDE.md` — where the pointer goes.
- `docs/handoffs/run-structure-handoff.md` — the blocked design.
- Git log for `apps/304dle/components/PublicInfo.tsx` — the ticker change
  and its measured justification.
