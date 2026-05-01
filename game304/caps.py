"""Caps obligation algorithm for the 304 card game.

Caps is the most complex component of 304. A player is caps-obligated
when there exists *some* committed sequence of plays from their hand
that guarantees winning all remaining rounds, irrespective of how any
other player chooses to play.

The algorithm is full minimax against the rest of the table:
- The caller commits to a fixed play order for their cards.
- Every other player (including the caller's partner) is treated as
  adversarial: for caps to hold, *every* legal sequence of opposing /
  partner plays must result in the caller's team winning every round.
- "Forced plays" (e.g. partner having only one card of the led suit)
  collapse out of the recursion naturally — there is only one branch
  to explore.

Rules:
- Caps must be called at the first opportunity where certainty is
  achieved.
- Correct Caps before Round 7: +1 stone bonus.
- Correct Caps in/after Round 7: normal scoring, no bonus.
- Late Caps: loss + 1 stone penalty (game flipped to loss).
- Wrong/Early Caps: 5 stone penalty.
- External Caps (from opposition): same correctness test, more lenient
  in practice but the algorithm is identical.
"""

from __future__ import annotations

import itertools

from game304.card import Card
from game304.seating import next_seat, partner_seat, team_of
from game304.state import CapsCall, CapsObligation, GameState
from game304.types import Seat, Suit, Team


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def check_caps_obligation(state: GameState, seat: Seat) -> bool:
    """Return ``True`` if ``seat`` is currently caps-obligated.

    A player is caps-obligated when there exists at least one ordering
    of their remaining cards that guarantees winning every remaining
    round, irrespective of how all other players (including their
    partner) might play.

    Used to detect the moment caps obligation first arises (for Late
    Caps detection).
    """
    play = state.play
    if play is None:
        return False

    my_team = team_of(seat)

    # Cannot be obligated if the caller's team has already lost a round
    if any(team_of(r.winner) != my_team for r in play.completed_rounds):
        return False

    my_cards = list(state.hands.get(seat, []))
    if not my_cards:
        return False

    # The caller may not be the leader of the current round if some cards
    # have already been played. Build "to play" plays for in-progress
    # players using simulation; the caller's order is what we vary.
    for play_order in itertools.permutations(my_cards):
        if _caps_holds(state, seat, list(play_order)):
            return True

    return False


def validate_caps_call(
    state: GameState,
    seat: Seat,
    play_order: list[Card],
) -> bool:
    """Return ``True`` if ``play_order`` guarantees all remaining rounds.

    The play order must contain exactly the caller's remaining cards
    (caller is the seat that called caps). Validation assumes the
    declared order is followed strictly; partner and opponents are
    adversarial.
    """
    return _caps_holds(state, seat, list(play_order))


def track_caps_obligation(state: GameState) -> None:
    """Record when each player first became caps-obligated.

    Should be called after every card play and after each round
    resolution. Only seats not already tracked are checked. Each new
    obligation is stamped with the current round number and the number
    of cards already played in the current round at the time of
    detection.

    Per the rules: "Caps cannot be called after the final card of round
    8 is played." Once the game has reached that point the call window
    is closed, so we do not record new obligations there.
    """
    play = state.play
    if play is None:
        return

    expected = 3 if state.pcc_partner_out is not None else 4
    call_window_closed = (
        play.round_number == 8 and len(play.current_round) >= expected
    )
    if call_window_closed:
        return

    for seat in Seat:
        if seat in play.caps_obligations:
            continue
        if state.pcc_partner_out == seat:
            continue
        try:
            if check_caps_obligation(state, seat):
                play.caps_obligations[seat] = CapsObligation(
                    obligated_at_round=play.round_number,
                    obligated_at_card=len(play.current_round),
                )
        except Exception:
            # Tracking is best-effort; never let an obligation check
            # crash the game loop.
            continue


def is_caps_late(state: GameState, seat: Seat) -> bool:
    """Return ``True`` if a caps call by ``seat`` would be late.

    A call is late if obligation was tracked at an earlier point than
    the current state — earlier round, or same round but earlier card
    index.
    """
    play = state.play
    if play is None:
        return False

    obligation = play.caps_obligations.get(seat)
    if obligation is None:
        return False

    if obligation.obligated_at_round < play.round_number:
        return True
    if (
        obligation.obligated_at_round == play.round_number
        and obligation.obligated_at_card < len(play.current_round)
    ):
        return True
    return False


def deduce_exhausted_suits(state: GameState) -> dict[Seat, set[Suit]]:
    """Deduce which suits each player is publicly known to be out of.

    A player is exhausted of a suit if they failed to follow it in a
    completed round (played a different suit face-up, or played a card
    face-down that was either revealed or remained hidden but was
    nonetheless an off-suit play). Used as a heuristic — the simulation
    itself uses actual remaining hands, which is more precise.
    """
    exhausted: dict[Seat, set[Suit]] = {s: set() for s in Seat}
    play = state.play
    if play is None:
        return exhausted

    for r in play.completed_rounds:
        if not r.cards:
            continue
        led_suit: Suit | None = None
        for entry in r.cards:
            if not entry.face_down:
                led_suit = entry.card.suit
                break
        if led_suit is None:
            continue
        for entry in r.cards:
            if entry.card.suit != led_suit:
                exhausted[entry.seat].add(led_suit)
    return exhausted


# ---------------------------------------------------------------------------
# Internal: minimax simulation
# ---------------------------------------------------------------------------


def _caps_holds(
    state: GameState,
    caller_seat: Seat,
    caller_play_order: list[Card],
) -> bool:
    """Return ``True`` if the caller's play order forces an all-rounds win.

    Treats the caller's partner and both opponents as adversarial: caps
    holds iff for *every* legal sequence of plays by the other three
    players, the caller's team wins every remaining round.
    """
    play = state.play
    if play is None:
        return False

    remaining_rounds = 8 - len(play.completed_rounds)
    if remaining_rounds <= 0:
        return True
    if len(caller_play_order) < remaining_rounds:
        return False

    # Build the live simulation hands for everyone (excluding PCC out seat).
    sim_hands: dict[Seat, list[Card]] = {}
    for s in Seat:
        if state.pcc_partner_out == s:
            continue
        sim_hands[s] = list(state.hands.get(s, []))

    # The caller's remaining cards must equal the play_order multiset.
    if sorted(caller_play_order, key=str) != sorted(sim_hands.get(caller_seat, []), key=str):
        return False

    # Mid-round: cards already played in the in-progress round count
    # toward the round outcome but do not affect remaining hands (already
    # removed from sim_hands at this point). Re-attach them.
    in_progress: list[tuple[Seat, Card, bool]] = [
        (e.seat, e.card, e.face_down) for e in play.current_round
    ]

    leader = play.priority if play.priority is not None else caller_seat
    trump_suit = state.trump.trump_suit
    my_team = team_of(caller_seat)

    return _simulate(
        sim_hands=sim_hands,
        caller_seat=caller_seat,
        caller_play_order=list(caller_play_order),
        caller_play_index=0,
        leader=leader,
        in_progress=in_progress,
        remaining_rounds=remaining_rounds,
        trump_suit=trump_suit,
        my_team=my_team,
        pcc_partner_out=state.pcc_partner_out,
    )


def _simulate(
    *,
    sim_hands: dict[Seat, list[Card]],
    caller_seat: Seat,
    caller_play_order: list[Card],
    caller_play_index: int,
    leader: Seat,
    in_progress: list[tuple[Seat, Card, bool]],
    remaining_rounds: int,
    trump_suit: Suit | None,
    my_team: Team,
    pcc_partner_out: Seat | None,
) -> bool:
    """Minimax simulator. Recurses round-by-round, play-by-play."""
    # Determine who has played in the current round and who is next.
    turn_order = _round_turn_order(leader, pcc_partner_out)
    played_seats = [s for s, _, _ in in_progress]

    # Find the next seat to play
    next_idx = len(played_seats)

    if next_idx >= len(turn_order):
        # Round is complete — resolve and recurse.
        winner = _round_winner(in_progress, trump_suit)
        if team_of(winner) != my_team:
            return False
        if remaining_rounds == 1:
            return True
        return _simulate(
            sim_hands=sim_hands,
            caller_seat=caller_seat,
            caller_play_order=caller_play_order,
            caller_play_index=caller_play_index,
            leader=winner,
            in_progress=[],
            remaining_rounds=remaining_rounds - 1,
            trump_suit=trump_suit,
            my_team=my_team,
            pcc_partner_out=pcc_partner_out,
        )

    next_seat_to_play = turn_order[next_idx]
    led_suit: Suit | None = in_progress[0][1].suit if in_progress else None

    if next_seat_to_play == caller_seat:
        # Caller plays their next committed card.
        if caller_play_index >= len(caller_play_order):
            return False
        card = caller_play_order[caller_play_index]
        hand = sim_hands.get(caller_seat, [])
        if card not in hand:
            return False
        # Must follow suit if able
        if led_suit is not None and any(c.suit == led_suit for c in hand) and card.suit != led_suit:
            return False
        # Apply the play
        new_hands = _hand_remove(sim_hands, caller_seat, card)
        new_in_progress = in_progress + [(caller_seat, card, False)]
        return _simulate(
            sim_hands=new_hands,
            caller_seat=caller_seat,
            caller_play_order=caller_play_order,
            caller_play_index=caller_play_index + 1,
            leader=leader,
            in_progress=new_in_progress,
            remaining_rounds=remaining_rounds,
            trump_suit=trump_suit,
            my_team=my_team,
            pcc_partner_out=pcc_partner_out,
        )

    # Other player (partner or opponent) — adversarial.
    other_hand = sim_hands.get(next_seat_to_play, [])
    if not other_hand:
        # No cards left — should not happen if remaining_rounds is consistent
        return False

    valid = _valid_plays_for(other_hand, led_suit)
    if not valid:
        return False

    # For caps to hold, every choice this player could make must still
    # result in the caller's team winning all remaining rounds.
    for chosen in valid:
        new_hands = _hand_remove(sim_hands, next_seat_to_play, chosen)
        new_in_progress = in_progress + [(next_seat_to_play, chosen, False)]
        ok = _simulate(
            sim_hands=new_hands,
            caller_seat=caller_seat,
            caller_play_order=caller_play_order,
            caller_play_index=caller_play_index,
            leader=leader,
            in_progress=new_in_progress,
            remaining_rounds=remaining_rounds,
            trump_suit=trump_suit,
            my_team=my_team,
            pcc_partner_out=pcc_partner_out,
        )
        if not ok:
            return False
    return True


def _valid_plays_for(hand: list[Card], led_suit: Suit | None) -> list[Card]:
    """Return all legal cards from ``hand`` given the led suit.

    If the player has any card of the led suit, only those are legal
    (must follow suit). Otherwise any card is legal.
    """
    if led_suit is None:
        return list(hand)
    suited = [c for c in hand if c.suit == led_suit]
    return suited if suited else list(hand)


def _hand_remove(
    sim_hands: dict[Seat, list[Card]], seat: Seat, card: Card
) -> dict[Seat, list[Card]]:
    """Return a copy of ``sim_hands`` with ``card`` removed from ``seat``."""
    new = {s: list(cs) for s, cs in sim_hands.items()}
    new[seat].remove(card)
    return new


def _round_turn_order(
    leader: Seat, pcc_partner_out: Seat | None
) -> list[Seat]:
    """Anticlockwise turn order for one round, skipping the PCC partner."""
    order: list[Seat] = [leader]
    cur = leader
    while len(order) < 4:
        cur = next_seat(cur)
        if cur == leader:
            break
        if cur == pcc_partner_out:
            continue
        order.append(cur)
    return order


def _round_winner(
    plays: list[tuple[Seat, Card, bool]],
    trump_suit: Suit | None,
) -> Seat:
    """Return the winning seat of a completed round.

    The first card played is the led suit. Trump cards beat non-trump.
    Among cards of the same suit (trump or led suit), the one with the
    lowest power index (J=0, 9=1, A=2, ...) wins.
    """
    if not plays:
        raise ValueError("No plays to resolve")

    led_suit = plays[0][1].suit

    # Identify candidates: any trump card outranks any non-trump.
    trumps = [(s, c) for s, c, _ in plays if trump_suit is not None and c.suit == trump_suit]
    if trumps:
        winner = min(trumps, key=lambda sc: sc[1].power)
        return winner[0]
    # No trumps — highest card of led suit wins
    led = [(s, c) for s, c, _ in plays if c.suit == led_suit]
    if not led:
        # Should not happen — the leader played led_suit
        return plays[0][0]
    winner = min(led, key=lambda sc: sc[1].power)
    return winner[0]
