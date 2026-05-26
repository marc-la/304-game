# 304 — Play-Phase State Invariants

> Companion to [rules.md](rules.md). The rules describe the game; this
> document defines the invariants the engine must preserve at every
> reachable play-phase state, and the per-transition requirements for
> every legal move. Maintain both documents in lockstep — if a rule
> changes, update the corresponding invariant.

## Scope

This document covers the **play phase** specifically — the 8 rounds of
trick-taking that follow trump selection and 8-card bidding. The
bidding and trump-selection phases have their own invariants, treated
as out of scope here (see [Out of scope](#out-of-scope)).

## State representation

A play-phase state is the tuple:

| Field | Description |
|-------|-------------|
| **hands** | Mapping `seat → list[Card]` for all 4 seats. |
| **folded_trump_card** | The card placed face-down at trump selection, or `None` once picked up to the trumper's hand or played. |
| **trump_suit, trumper_seat** | Set together at trump selection. |
| **is_open, is_revealed, trump_card_in_hand** | Three booleans describing the current trump mode. |
| **round_number** | `r ∈ [1, 8]`. |
| **priority** | The seat that leads the current round. |
| **current_turn** | The seat to act next. |
| **current_round** | Ordered list of `(seat, card, face_down, revealed)` for the in-progress round. |
| **completed_rounds** | Resolved rounds, oldest first. |
| **points_won** | Mapping `team → int` accumulating points from resolved rounds. |
| **pcc_partner_out** | The seat that sits out for the entire game, or `None` if not PCC. |

## State invariants

These hold at **every reachable play-phase state**.

### S1 — Card conservation

The multiset of all cards across all locations equals the original
32-card pack. Locations:

- each seat's hand,
- the folded trump slot (if not None),
- the in-progress round's entries,
- every completed round's entries.

No card appears in two locations; no card is missing.

### S2 — Hand sizes

Let `r` be the current round number (1-indexed) and `played_now` be 1
if the player has already played in the in-progress round, else 0.
For each non-PCC-out seat:

```
len(hand) + (1 if seat is trumper and folded trump is on table else 0)
  = (9 - r) - played_now
```

For the PCC-out seat (if any), `len(hand) = 8` always — frozen at the
moment of PCC declaration.

### S3 — Round structure

- `r ∈ [1, 8]`.
- `k`, the number of cards played in the current round so far,
  satisfies `k ∈ [0, 4]` (or `[0, 3]` in PCC).
- `len(completed_rounds) = r - 1` while play is in progress.
- Every completed round contains exactly 4 entries (3 in PCC).

### S4 — Priority and turn

- Priority is set to a non-PCC-out seat.
- If `k = 0`, `current_turn = priority`.
- If `k > 0`, `current_turn` is the seat anticlockwise from the seat
  that just played, skipping the PCC-out seat if any.
- After round resolution, priority is set to the winner of the round
  just completed; the winner becomes the leader of the next round.

### S5 — Led suit

When `k ≥ 1`, the led suit is the suit of the first face-up card in
the current round. The leader's card is always face-up — the leader
chooses what to play. Therefore the led suit is defined as soon as
`k ≥ 1`.

### S6 — Trump state

Exactly one of these mutually exclusive configurations holds:

1. **Closed Trump, pre-reveal.** Folded trump card is on the table
   (not in any hand or round). `is_open = False`,
   `is_revealed = False`, `trump_card_in_hand = False`.
2. **Closed Trump, post-reveal.** Trump was revealed by a face-down
   trump play. `is_open = False`, `is_revealed = True`. The folded
   trump card is either:
   - in the trumper's hand (`trump_card_in_hand = True`) — if it was
     not the card that revealed trump; or
   - in a completed round (`trump_card_in_hand = False`,
     `folded_trump_card = None`) — if the trumper played it as the
     cut.
3. **Open Trump declared pre-play.** `is_open = True`,
   `is_revealed = True`, `trump_card_in_hand = True`. The folded
   trump card is in the trumper's hand from the moment of declaration.

`trump_suit` and `trumper_seat` are either both set or both None.

**Transient mid-round case.** Between the trumper playing the folded
trump card as a face-down cut and the round resolving, the engine
state has `trump_card = None` and `is_revealed = False`. This is
*not* a fourth configuration — it is a transient state that exists
only between two atomic events. Round resolution always fires
immediately after the 4th card (3rd in PCC) of a round is played, so
this state is observable only when the cut is the 1st, 2nd, or 3rd
card of the round. Walkers and invariant checks must allow this
transient state.

### S7 — Face-down cards

- Face-down entries can only be created in Closed Trump pre-reveal.
- After reveal, all subsequent plays are face-up.
- Face-down trump cards in completed rounds carry `revealed = True`
  (the trumper exposed them at resolution).
- Face-down non-trump cards in completed rounds remain hidden
  (`revealed = False`).

### S8 — Trumper face-down legality

Every face-down card the trumper has played, in any round, is either:

- **the folded trump card** (a cut), or
- **a card whose suit ≠ trump suit** (a minus).

**No face-down in-hand trump card ever appears in any round.**
This is a standing invariant — a violation indicates a bug in the
trumper's follow-suit validation.

### S9 — Points conservation

`points_won[A] + points_won[B] = sum of points across all cards in
completed_rounds`. Each completed round's `points_won` equals the sum
of point values of the cards played to it (4 in non-PCC, 3 in PCC).

### S10 — Location uniqueness

Every card belongs to exactly one location. There is no
"shared" or duplicate ownership — a card in the folded-trump slot is
not also in the trumper's hand; a card played to a round is not also
in any hand.

### S11 — PCC seat frozen

If `pcc_partner_out` is set:

- That seat's hand never changes from its dealt state.
- That seat never appears as `seat` in any current_round or completed
  round entry.
- The expected current-round count is 3, not 4.

## Transition invariants

Three transition types: a **card play**, an automatic **round
resolution** when the current round fills, and a **phase exit** (caps
call, spoilt trumps, absolute hand). Each must preserve every state
invariant above.

### T1 — Card play: source

The played card was either in the player's hand or, for the trumper
specifically, was the folded trump card on the table. The card is
removed from the source location and appended to `current_round`. No
other state mutations occur (until round resolution fires).

### T2 — Suit-following

If the player has any card of the led suit in their hand, the played
card's suit equals the led suit. (For the trumper, the folded trump
card never satisfies suit-following — it cannot be played face-up to
follow trump while it remains the indicator.)

### T3 — Closed-trump face-down rule

A card is played face-down iff:

- The trump is currently closed pre-reveal; AND
- The player is not leading; AND
- The player cannot follow the led suit.

### T4 — Trumper face-down restriction

When the trumper plays face-down, the card is either the folded trump
card (cut) or a card whose suit ≠ trump suit (minus). The trumper may
not fold an in-hand trump card under any circumstances — stricter
than the general face-down rule.

### T5 — Trump card face-up restriction

The folded trump card may only be played face-up in round 8, as the
trumper's last card. Otherwise it is only playable as a face-down cut.

### T6 — Closed Trump round-1 lead restriction

The trumper, when leading round 1 in Closed Trump, may not play a
card of the trump suit. To open with trump, declare Open Trump first.

### T7 — Open Trump round-1 lead obligation (non-PCC)

The trumper, when leading round 1 in Open Trump and not PCC, *must*
play a card of the trump suit (if they hold one). PCC trumpers are
exempt and may lead any card on round 1.

### T8 — Exhausted Trumps obligation

If the trumper has priority, leads, has any trump in hand, and no
other player holds any trump-suit card, the trumper must lead a
trump-suit card. Applies in both modes after trump is revealed; does
not apply in PCC.

### T9 — Round resolution

Fires automatically when the current round has 4 entries (3 in PCC).
Updates:

- **Winner determination.** The highest trump (if any trump was played)
  wins; otherwise the highest card of the led suit wins. "Highest"
  uses rank-power J > 9 > A > 10 > K > Q > 8 > 7.
- **Points.** Sum of point values of the round's cards is added to
  the winner's team.
- **Priority transfer.** Priority and current_turn are set to the
  winner.
- **Round number.** Incremented by 1 (unless this was round 8).
- **Trump reveal.** If any face-down card in the round was a trump
  card: `is_revealed` flips to True; every face-down trump in the
  round gets `revealed = True`; if the folded trump card is still
  on the table after this round (i.e. the cut was an in-hand trump,
  not the folded trump card itself), the folded trump card is moved
  to the trumper's hand and `trump_card_in_hand = True`.
- **Round archival.** The current round is moved into
  `completed_rounds` with the winner, points, and final card list.

### T10 — Phase exits

A phase exit ends the play phase early. The state invariants must
hold at the moment of exit; the resulting phase becomes `SCRUTINY`
then `COMPLETE`.

- **Caps call.** Any non-PCC-out player calls. Validity is checked
  by simulation. Result is one of: `correct`, `late`, or
  `wrong_early`.
- **Spoilt Trumps.** Any non-PCC-out player calls. Valid only if the
  opposition truly held zero trump from the deal AND it is before
  the final card of round 8. A *false* call is **not** a phase
  exit — it applies a 1-stone penalty and play continues.
- **Absolute Hand (goodwill).** Declared by the trumper before round
  1. The hand is shown face-up; play ends with no stone exchanged.

## Closure properties

Two derived properties the engine must satisfy. Together they form
the testable contract:

### C1 — Forward closure

For every reachable play-phase state `S` and every move `m` in the
legal-moves set of `S`, the resulting state `S'` satisfies all state
invariants.

### C2 — Move-set agreement

For every reachable state `S`, the engine's `valid_plays(seat)`
enumeration equals the model's computed legal-moves set for that
seat. A discrepancy in either direction is a bug — the engine accepts
an illegal move (over-permissive) or rejects a legal one
(over-restrictive).

A non-terminal state with empty legal moves is a bug.

## Terminal states

Three legal terminal states for the play phase:

| Terminal | Conditions |
|----------|------------|
| **All-rounds played** | All non-PCC-out hands are empty; folded trump card has been played (`folded_trump_card = None`, `trump_card_in_hand = False`); 8 completed rounds; points sum to exactly 304. |
| **Spoilt Trumps** | Game ends with no stone exchanged; play state is preserved as a record. |
| **Absolute Hand** | Game ends with no stone exchanged. |

After any of these the engine transitions to `SCRUTINY` then
`COMPLETE`, and stone is updated per the result.

## Out of scope

Documented separately if invariant testing is extended:

- **Bidding-phase invariants** — speech counts, partner restrictions,
  consecutive-pass termination, partner-skip mechanics, current-bid-
  holder skip, all-spoken termination.
- **Trump-selection invariants** — trumper picks from own hand,
  second selection on supersede, trump card placed face-down, deck
  empty after second deal, etc.
- **Match-level invariants** — stone monotonicity within a game,
  dealer rotation between games, match completion when a team
  reaches zero stone.
