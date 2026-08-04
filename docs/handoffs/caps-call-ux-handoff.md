---
title: 304dle — Arm-and-point caps call, and the decline
status: OPEN (2026-07-26; decline added 2026-08-04). The arm-and-point half is independent of the predicate work and safe to run in parallel. The decline half needs the run.
owns: apps/304dle/components/CapsConfirmModal.tsx, Table.tsx, App.tsx, app.css
depends_on: run-structure-handoff.md (decline half only)
---

# Goal

Replace the confirmation dialog with a gesture on the table: press Call
Caps to *arm*, then point at the card you are calling on.

Then give that gesture its opposite: a way to say **no caps here** and
move to the next deal.

# State of play

Pressing Call Caps opens `CapsConfirmModal`, which explains what caps
means and asks for confirmation — every session, to a player who has
known the rules for seven years. That is soul §VI.5.2 (no tutorials)
firing daily. Marc chose arm-and-point this session; it is not built.

The design, already settled:

- Arming freezes the table, desaturates the felt, makes the hand
  non-interactive, and turns the button row into a cancel bar.
- **Pickable = whatever is physically on the felt at that instant.** Not
  a history strip — an echo of earlier rounds would be an
  elimination affordance and is forbidden by soul §VI.4.
  Mid-round: the cards down so far, plus the flower centre meaning "as
  of now". Round complete: the four petals. South to lead with an empty
  flower: the flower centre only.
- **The pick is never graded.** Caps is `∀W ∃σ_W`, so on some obligated
  states no single card wins in every world (`caps_formalism.md` §7) —
  grading it would ask for an answer that does not exist. It is a
  precision note on the reveal ("you called it on the ♣9; it was already
  yours at the ♦J") and must be structurally unable to turn a win into a
  loss.
- The pick *is* the commit. No third confirmation.

# The decline (new, 2026-08-04)

The run (`run-structure-handoff.md`) makes every deal a live *whether*
question, so the table needs a second commit: **no caps here.** Design
not settled; what is settled about it:

- **It is an accelerator, not an obligation.** A deal resolves on its own
  when the decoy breaks. Declining just skips ahead — correct → next
  deal, wrong → the run is over. Patient players never press it.
- **It gains no information**, so it cannot be farmed: you would have
  advanced anyway when the deal broke. It is purely speed traded for
  safety.
- **It must not be reachable by the same reflex as Call Caps.** These are
  opposite assertions with opposite fatal outcomes, sitting in the same
  button row, pressed under time pressure. A misclick here loses the day
  in the most infuriating way available. Separate them spatially, or make
  the decline a hold rather than a tap.
- **No confirmation dialog** — same reason the caps modal is being
  deleted (§VI.5.2).

Open question for Marc: is the decline armed-and-pointed too? There is no
card to point *at* — the assertion is about the whole position — so the
symmetry does not obviously carry. A hold-to-decline with the felt
dimming is the cheapest thing that reads as deliberate.

# Watch out for

Once the run lands, the armed state must also be suppressed **during the
inter-deal transition**. A player who arms in the last beat of a deal and
picks after the next one has dealt would otherwise be calling caps on a
board that no longer exists.

The gesture space already has collisions. Clicking the felt advances a
completed trick (`App.tsx`, `canAdvance`), and clicking your lit card
plays it — and playing a card is what makes a call **Late**
(`engine/caps.ts:234`, lenient policy: you are late once you play one
more card). So an armed state must suppress both, or an impatient click
loses the day. If a hurry-to-advance gesture is added later, make it a
*hold*, never a tap, for the same reason.

`Call Caps` is currently `disabled` only when the hand is empty, so it
can fire mid-animation. On arming, settle any in-flight card animation
before entering the pick state — the player should be pointing at a
board that has stopped moving.

# Validation gate

- Open the surface in a browser and exercise it end to end at desktop
  ≥1280px and phone ≤390px (`.claude/gui-verification.md` — tests do not
  prove the UI looks right).
- Arm → cancel → arm → pick, with no way to accidentally play a card
  while armed.
- A wrong pick with a correct call still reads as a win.
- The confirm modal is gone and nothing re-explains caps during play.
- (Decline half) Call and decline cannot be confused under a fast,
  imprecise tap on a 390px phone. Test this adversarially — try to hit
  the wrong one — rather than confirming each works in isolation.
- (Decline half) Arming cannot survive across a deal boundary.

# Hard constraints

- 304dle styles live in `apps/304dle/app.css`, never
  `site/css/styles.css` (`.claude/directory.md`).
- `framer-motion` and `zustand` are already dependencies; add none.
- Soul §VI.4: no countdown bars, no affordance that solves by
  elimination.

# Reading list

- `apps/304dle/App.tsx` — `PlayingShell`, the advance/play gestures.
- `apps/304dle/components/Table.tsx` — the flower and petal layout.
- `apps/304dle/components/CapsConfirmModal.tsx` — what is being replaced.
- `docs/specs/caps_formalism.md` §7 — why the pick cannot be graded.
- `.claude/gui-verification.md`.
