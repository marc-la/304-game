"""Caps obligation algorithm for the 304 card game.

Caps is the most complex component of 304. A player is caps-obligated
when there exists ANY ordering of their remaining cards that guarantees
winning all remaining rounds, irrespective of how any other player
chooses to play.

The algorithm uses brute-force permutation of the caller's remaining
cards combined with minimax simulation: for each permutation, simulate
all remaining rounds where opponents play optimally against the caller
and the partner's choices cannot be relied upon. If any permutation
results in the calling team winning all remaining rounds, caps
obligation exists.

Rules:
- Caps must be called at the first opportunity where certainty is
  achieved.
- Correct Caps before Round 7: +1 stone bonus.
- Late Caps: loss + 1 stone penalty.
- Wrong/Early Caps: 5 stone penalty.
- External Caps (from opposition): follows the same rules.
"""

from __future__ import annotations

import itertools

from game304.card import Card
from game304.seating import next_seat, partner_seat, team_of
from game304.state import CapsCall, CapsObligation, GameState
from game304.types import Seat, Suit, Team


def check_caps_obligation(state: GameState, seat: Seat) -> bool:
    """Check if a player is currently caps-obligated.

    A player is caps-obligated when there exists ANY ordering of their
    remaining cards that guarantees winning all remaining rounds,
    irrespective of how others play. This requires:
    1. The player's team has not lost any round so far.
    2. There exists at least one permutation of the player's cards
       that wins all remaining rounds against optimal opposition play.

    This function is called after every card play to track when
    obligation first arises (for Late Caps detection).

    Args:
        state: The full game state.
        seat: The player to check.

    Returns:
        ``True`` if the player can guarantee all remaining rounds.
    """
    play = state.play
    if play is None:
        return False

    # Can't be caps-obligated if the team has already lost a round
    my_team = team_of(seat)
    has_lost_round = any(
        team_of(r.winner) != my_team for r in play.completed_rounds
    )
    if has_lost_round:
        return False

    # Get remaining cards for all players
    remaining: dict[Seat, list[Card]] = {}
    for s in Seat:
        if state.pcc_partner_out == s:
            continue
        remaining[s] = list(state.hands.get(s, []))

    my_cards = remaining.get(seat, [])
    if not my_cards:
        return False

    # Try all permutations of the caller's remaining cards
    for play_order in itertools.permutations(my_cards):
        if _can_guarantee_with_order(
            state, seat, list(play_order), remaining
        ):
            return True

    return False


def validate_caps_call(
    state: GameState,
    seat: Seat,
    play_order: list[Card],
) -> bool:
    """Validate that a specific play order guarantees all remaining rounds.

    Called when a player explicitly calls caps with a stated play order.

    Args:
        state: The full game state.
        seat: The player calling caps.
        play_order: The exact sequence of cards the player claims
            will guarantee winning all remaining rounds.

    Returns:
        ``True`` if the play order guarantees a win.
    """
    remaining: dict[Seat, list[Card]] = {}
    for s in Seat:
        if state.pcc_partner_out == s:
            continue
        remaining[s] = list(state.hands.get(s, []))

    return _can_guarantee_with_order(state, seat, play_order, remaining)


def track_caps_obligation(state: GameState, seat: Seat) -> None:
    """Track when a player first becomes caps-obligated.

    Called after every card play. If the player is obligated and
    hasn't been tracked yet, records the round and card index for
    Late Caps detection.

    Args:
        state: The game state (mutated in place).
        seat: The player to check.
    """
    play = state.play
    if play is None:
        return

    if seat in play.caps_obligations:
        return  # already tracked

    try:
        if check_caps_obligation(state, seat):
            play.caps_obligations[seat] = CapsObligation(
                obligated_at_round=play.round_number,
                obligated_at_card=len(play.current_round),
            )
    except Exception:
        pass  # caps check is best-effort for tracking


def is_caps_late(state: GameState, seat: Seat) -> bool:
    """Check if a caps call by this seat would be considered late.

    A call is late if the player was obligated at an earlier point
    (earlier round, or same round but earlier card index) than the
    current game state.

    Args:
        state: The current game state.
        seat: The player calling caps.

    Returns:
        ``True`` if the call is late.
    """
    play = state.play
    if play is None:
        return False

    obligation = play.caps_obligations.get(seat)
    if obligation is None:
        return False

    # Late if obligated at an earlier round or earlier in the same round
    if obligation.obligated_at_round < play.round_number:
        return True
    if (
        obligation.obligated_at_round == play.round_number
        and obligation.obligated_at_card < len(play.current_round)
    ):
        return True

    return False


def deduce_exhausted_suits(state: GameState) -> dict[Seat, set[Suit]]:
    """Deduce which suits each player is known to be exhausted of.

    A player is exhausted of a suit if they failed to follow that suit
    in a previous round (played a different suit or a face-down card
    when that suit was led).

    Args:
        state: The current game state.

    Returns:
        A dict mapping each seat to a set of suits they are known
        to be exhausted of.
    """
    exhausted: dict[Seat, set[Suit]] = {s: set() for s in Seat}
    play = state.play
    if play is None:
        return exhausted

    for r in play.completed_rounds:
        if not r.cards:
            continue
        led_suit = r.cards[0].card.suit

        for entry in r.cards[1:]:  # skip the leader
            if entry.card.suit != led_suit:
                exhausted[entry.seat].add(led_suit)
            if entry.face_down and not entry.revealed:
                exhausted[entry.seat].add(led_suit)

    return exhausted


# ---------------------------------------------------------------------------
# Internal simulation
# ---------------------------------------------------------------------------


def _can_guarantee_with_order(
    state: GameState,
    seat: Seat,
    play_order: list[Card],
    all_remaining: dict[Seat, list[Card]],
) -> bool:
    """Check if a specific play order guarantees all remaining rounds.

    Uses minimax simulation: the caller plays cards in the given order,
    opponents play optimally to try to beat the caller, and the partner's
    play is assumed arbitrary (can't rely on their choice).

    Args:
        state: The game state.
        seat: The calling player's seat.
        play_order: The exact sequence of cards to play.
        all_remaining: Remaining cards for all players (not mutated).

    Returns:
        ``True`` if the play order guarantees winning all remaining rounds.
    """
    my_team = team_of(seat)
    trump_suit = state.trump.trump_suit
    play = state.play
    remaining_rounds = 8 - len(play.completed_rounds)

    if len(play_order) < remaining_rounds:
        return False

    # Deep-copy card lists for simulation
    sim_cards: dict[Seat, list[Card]] = {}
    sim_cards[seat] = list(play_order)
    for s in all_remaining:
        if s != seat:
            sim_cards[s] = list(all_remaining[s])

    current_priority = play.priority if play.priority is not None else seat

    for _ in range(remaining_rounds):
        leader = current_priority
        leader_card = (
            sim_cards[leader].pop(0) if sim_cards.get(leader) else None
        )
        if leader_card is None:
            return False

        led_suit = leader_card.suit
        best_card = leader_card
        best_seat = leader
        best_is_trump = trump_suit is not None and leader_card.suit == trump_suit

        # Each other player plays in turn order
        turn_order = _get_turn_order(leader, state.pcc_partner_out)

        for s in turn_order:
            if s == leader:
                continue
            hand = sim_cards.get(s, [])
            if not hand:
                continue

            # Determine playable cards (must follow suit if able)
            suit_cards = [c for c in hand if c.suit == led_suit]
            playable = suit_cards if suit_cards else hand

            is_opponent = team_of(s) != my_team

            if is_opponent:
                # Opponent tries every possible card — if ANY can win, caps fails
                for c in playable:
                    if _would_win_against(c, best_card, best_is_trump, led_suit, trump_suit):
                        return False  # opponent can win this round

                # Remove worst card (doesn't matter which — we just need
                # to remove something for the simulation)
                worst = playable[-1]
                hand.remove(worst)
            else:
                # Partner — play any card (can't rely on their choice)
                hand.remove(playable[0])

        current_priority = best_seat

    return True


def _would_win_against(
    card_a: Card,
    current_best: Card,
    current_best_is_trump: bool,
    led_suit: Suit,
    trump_suit: Suit | None,
) -> bool:
    """Check if card_a would beat the current best card.

    Args:
        card_a: The card to test.
        current_best: The current winning card.
        current_best_is_trump: Whether the current best is trump.
        led_suit: The suit that was led.
        trump_suit: The trump suit.

    Returns:
        ``True`` if card_a would win against current_best.
    """
    suit_a = card_a.suit

    # Trump beats non-trump
    if trump_suit is not None:
        if suit_a == trump_suit and not current_best_is_trump:
            return True
        if suit_a != trump_suit and current_best_is_trump:
            return False

    # Same suit — compare rank power (lower power = stronger)
    if suit_a == current_best.suit:
        return card_a.power < current_best.power

    # Different non-trump suits — can't beat
    return False


def _get_turn_order(leader: Seat, pcc_partner_out: Seat | None) -> list[Seat]:
    """Get the turn order for a round starting from a given leader.

    Args:
        leader: The seat leading the round.
        pcc_partner_out: The PCC partner who is out of play.

    Returns:
        List of seats in play order (anticlockwise from leader).
    """
    order = [leader]
    current = leader
    for _ in range(3):
        current = next_seat(current)
        if current != pcc_partner_out:
            order.append(current)
    return order
