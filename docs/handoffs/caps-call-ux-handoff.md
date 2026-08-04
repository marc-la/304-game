---
title: 304dle — Arm-and-point caps call
status: OPEN (2026-07-26). Independent of the predicate work; safe to run in parallel.
owns: apps/304dle/components/CapsConfirmModal.tsx, Table.tsx, App.tsx, app.css
---

# Goal

Replace the confirmation dialog with a gesture on the table: press Call
Caps to *arm*, then point at the card you are calling on.

**Call Caps stays the only player action.** A decline gesture was
designed and then cut (Marc, 2026-08-04): in the run, a deal ends by
itself when the opposition takes a round, so surviving a decoy is
inaction. One button, one gesture — see `run-structure-handoff.md`.

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

# Watch out for

Once the run lands, the armed state must be suppressed **during the
break beat and the inter-deal transition**. A player who arms in the last
moments of a deal and picks after the next one has dealt would otherwise
be calling caps on a board that no longer exists — and worse, the break
beat is exactly when an impatient player is most likely to be clicking.

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
- (Once the run lands) Arming cannot survive the break beat or a deal
  boundary.

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
