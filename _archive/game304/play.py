"""Card play and round resolution for the 304 card game.

Handles playing cards during the 8 rounds of trick-taking, validating
legal plays, resolving rounds (including closed-trump face-down card
mechanics), and enforcing exhausted trumps.

Key rules:
- Following suit is mandatory when able.
- In Closed Trump, cards played when unable to follow suit go face-down.
- The trump card has special restrictions on when it can be played.
- Exhausted Trumps: if the trumper holds all remaining trump and has
  priority, they must lead all trump before any other suit.
  [House Rule] Only applies when trump is revealed.
"""

from __future__ import annotations

from game304.card import Card, hand_points
from game304.errors import GameError, InvalidPhaseError, InvalidPlayError, NotYourTurnError
from game304.seating import deal_order, next_seat, team_of
from game304.state import (
    CompletedRound,
    GameResult,
    GameState,
    PlayState,
    RoundEntry,
)
from game304.types import Phase, Seat, Suit, Team


def get_led_suit(current_round: list[RoundEntry]) -> Suit | None:
    """Determine the led suit from the cards played so far.

    The led suit is the suit of the first face-up card in the round.

    Args:
        current_round: Cards played so far in the current round.

    Returns:
        The led suit, or ``None`` if no cards have been played.
    """
    for entry in current_round:
        if not entry.face_down:
            return entry.card.suit
    return None


def validate_and_play(
    state: GameState,
    seat: Seat,
    card: Card,
) -> bool:
    """Validate a card play and add it to the current round.

    Checks all play rules (follow suit, closed trump constraints,
    trump card restrictions) and adds the card to the round if valid.
    Returns whether the card is played face-down.

    Args:
        state: The game state (mutated in place).
        seat: The seat playing the card.
        card: The card to play.

    Returns:
        ``True`` if the card was played face-down.

    Raises:
        InvalidPhaseError: If not in the play phase.
        NotYourTurnError: If it's not this seat's turn.
        InvalidPlayError: If the card play violates the rules.
    """
    if state.phase != Phase.PLAYING:
        raise InvalidPhaseError("Not in play phase.")

    play = state.play
    if play is None:
        raise InvalidPhaseError("Play state not initialised.")

    if seat != play.current_turn:
        raise NotYourTurnError("It's not your turn.")

    if state.pcc_partner_out == seat:
        raise InvalidPlayError("You are out of play (PCC).")

    hand = state.hands.get(seat, [])
    trump = state.trump
    is_trumper = seat == trump.trumper_seat

    # The trump card on the table is playable by the trumper even though
    # it is not in their hand list (it was placed face-down at selection).
    is_trump_card_play = (
        is_trumper
        and not trump.trump_card_in_hand
        and trump.trump_card is not None
        and card == trump.trump_card
    )
    if card not in hand and not is_trump_card_play:
        raise InvalidPlayError("That card is not in your hand.")

    trump_is_open = trump.is_revealed or trump.is_open
    is_leading = len(play.current_round) == 0

    led_suit = get_led_suit(play.current_round) if not is_leading else None
    played_suit = card.suit
    face_down = False

    if is_leading:
        _validate_lead(state, seat, card, played_suit, is_trumper, trump_is_open, play)
    else:
        face_down = _validate_follow(
            state, seat, card, hand, led_suit, played_suit, is_trumper, trump_is_open
        )

    # Trump card: can be played face-down (to cut), or face-up only in
    # round 8 as the trumper's very last card.
    if is_trump_card_play and not face_down:
        # Playing face-up — only allowed in round 8 as last card
        if play.round_number < 8 or len(hand) > 0:
            raise InvalidPlayError(
                "The trump card can only be played face down (to cut) "
                "or in round 8 as your last card."
            )

    # Remove card from hand (or from the table if it's the trump card)
    if is_trump_card_play:
        state.trump.trump_card = None
        if not face_down:
            # Folded trump card played face-up (only legal in round 8 as
            # the trumper's last card) — trump suit is now visible.
            state.trump.is_revealed = True
    else:
        state.hands[seat] = [c for c in hand if c != card]

    # Add to current round
    play.current_round.append(
        RoundEntry(seat=seat, card=card, face_down=face_down)
    )

    return face_down


def _validate_lead(
    state: GameState,
    seat: Seat,
    card: Card,
    played_suit: Suit,
    is_trumper: bool,
    trump_is_open: bool,
    play: PlayState,
) -> None:
    """Validate a leading card play.

    Checks:
    1. Closed Trump: trumper cannot lead trump on round 1.
    2. Open Trump (non-PCC), trumper has priority for round 1: must
       lead with a card of the trump suit. (PCC trumper is exempt and
       may lead any card on round 1.)
    3. Exhausted Trumps: when the trumper holds all remaining trump
       and has priority, they must lead trump before any other suit.
       Applies in both Open and Closed Trump after trump is revealed;
       does not apply in PCC.
    """
    trump = state.trump
    is_pcc = state.pcc_partner_out is not None

    # Closed Trump: trumper cannot lead trump on round 1
    if (
        not trump_is_open
        and is_trumper
        and play.round_number == 1
        and played_suit == trump.trump_suit
    ):
        raise InvalidPlayError(
            "Cannot lead with trump suit on the first round in Closed "
            "Trump. Declare Open Trump first."
        )

    # Open Trump (non-PCC), trumper has priority on round 1: must lead trump.
    # PCC trumper is exempt and may lead any card.
    if (
        trump_is_open
        and is_trumper
        and play.round_number == 1
        and not is_pcc
        and played_suit != trump.trump_suit
    ):
        # Only enforce if the trumper actually holds a trump-suit card
        hand = state.hands.get(seat, [])
        has_trump_in_hand = any(c.suit == trump.trump_suit for c in hand)
        if has_trump_in_hand:
            raise InvalidPlayError(
                "Open Trump: you must lead round 1 with a card of the "
                "trump suit."
            )

    # Exhausted Trumps: does not apply in PCC
    if (
        trump_is_open
        and is_trumper
        and play.round_number > 1
        and not is_pcc
    ):
        if _check_exhausted_trumps(state, seat) and played_suit != trump.trump_suit:
            raise InvalidPlayError(
                "Exhausted Trumps: you must lead all remaining trump "
                "cards before playing another suit."
            )


def _validate_follow(
    state: GameState,
    seat: Seat,
    card: Card,
    hand: list[Card],
    led_suit: Suit | None,
    played_suit: Suit,
    is_trumper: bool,
    trump_is_open: bool,
) -> bool:
    """Validate a following card play and determine if it's face-down.

    Trumper-specific rules in Closed Trump (when unable to follow suit):
    - May **cut** with the folded trump card (face-down), or
    - May **minus** a non-led, non-trump-suit card (face-down).
    - May NOT fold an in-hand trump-suit card. In-hand trump-suit cards
      may only be played face up.
    - If the led suit is the trump suit and the trumper has no in-hand
      trump (the folded trump card stays as the indicator), they must
      minus a non-trump-suit card.
    - If the trumper holds only trump-suit cards in hand plus the
      folded trump card and the led suit is non-trump, they must cut
      with the folded trump card.

    Returns:
        ``True`` if the card should be played face-down.
    """
    trump = state.trump
    face_down = False

    if led_suit is None:
        return False

    has_led_suit = any(c.suit == led_suit for c in hand)

    if has_led_suit:
        # Must follow suit
        if played_suit != led_suit:
            raise InvalidPlayError(
                f"You must follow suit ({led_suit.value}). You have "
                f"cards of that suit."
            )
        return False

    # Cannot follow suit — may play any card
    if trump_is_open:
        # Open trump: any card, face-up
        return False

    # Closed trump: card goes face-down (cut or minus)
    face_down = True

    if not is_trumper:
        # Non-trumper: any card may be folded. No further restrictions.
        return face_down

    # ----- Trumper-specific face-down restrictions -----
    is_folded_trump_card = (card == trump.trump_card)
    is_in_hand_trump = (
        card.suit == trump.trump_suit and not is_folded_trump_card
    )

    # The trumper may never fold an in-hand trump-suit card.
    if is_in_hand_trump:
        raise InvalidPlayError(
            "The trumper cannot fold an in-hand trump-suit card. "
            "Cut with the folded trump card or minus a non-trump card."
        )

    if led_suit == trump.trump_suit:
        # Led suit is trump and the trumper has no trump in hand.
        # The folded trump card cannot follow trump face-up while it
        # remains the indicator. Must minus a non-trump card.
        if is_folded_trump_card:
            raise InvalidPlayError(
                "The trump card cannot follow the trump suit while it "
                "remains the indicator. Minus a non-trump card."
            )
        # Non-trump card → minus, face-down. Allowed.
        return face_down

    # Led suit is non-trump and trumper cannot follow.
    # Allowed face-down plays: folded trump card (cut) or non-trump card (minus).
    # is_in_hand_trump already rejected above.
    return face_down


def _check_exhausted_trumps(state: GameState, seat: Seat) -> bool:
    """Check if the Exhausted Trumps rule applies.

    The trumper must lead all remaining trump cards before playing
    any other suit if:
    1. Trump is revealed.
    2. No other player holds any trump cards.
    3. The trumper has both trump and non-trump cards remaining.

    [House Rule] Only applies once the trump suit has been revealed.

    Args:
        state: The current game state.
        seat: The trumper's seat.

    Returns:
        ``True`` if the trumper must lead trump.
    """
    trump = state.trump
    if not trump.is_revealed and not trump.is_open:
        return False
    if seat != trump.trumper_seat:
        return False

    trump_suit = trump.trump_suit

    # Check if any other player has trump cards
    for s in Seat:
        if s == seat:
            continue
        if state.pcc_partner_out == s:
            continue
        hand = state.hands.get(s, [])
        if any(c.suit == trump_suit for c in hand):
            return False  # someone else has trump

    # Trumper holds all remaining trump
    trumper_hand = state.hands.get(seat, [])
    has_trump = any(c.suit == trump_suit for c in trumper_hand)
    has_non_trump = any(c.suit != trump_suit for c in trumper_hand)

    # Only enforce if trumper has both trump and non-trump
    return has_trump and has_non_trump


def resolve_round(
    round_cards: list[RoundEntry],
    trump_suit: Suit | None,
    trump_revealed: bool,
) -> tuple[Seat, int, bool, list[Card]]:
    """Determine the winner and points of a completed round.

    This is the core trick-resolution algorithm. It handles both
    Open and Closed Trump scenarios, including face-down cards.

    Args:
        round_cards: The cards played in this round, in play order.
        trump_suit: The trump suit.
        trump_revealed: Whether trump was already revealed before
            this round.

    Returns:
        A tuple of:
        - ``winner``: The seat that won the round.
        - ``points_won``: Total point value of all cards in the round.
        - ``trump_found``: Whether trump was found among face-down cards.
        - ``revealed_cards``: List of face-down cards that were revealed
          (because they were trump).
    """
    # Find the led suit (first face-up card)
    led_suit: Suit | None = None
    for entry in round_cards:
        if not entry.face_down:
            led_suit = entry.card.suit
            break

    # Separate face-up and face-down cards
    face_up = [e for e in round_cards if not e.face_down]
    face_down = [e for e in round_cards if e.face_down]

    # Check for trump cards — both face-down cuts and face-up trump plays
    trump_folds = [e for e in face_down if e.card.suit == trump_suit]
    face_up_trumps = [e for e in face_up if e.card.suit == trump_suit]
    trump_found = len(trump_folds) > 0
    revealed_cards: list[Card] = []

    # Trump cards win if present (either face-down cuts or face-up plays)
    all_trump_entries = trump_folds + face_up_trumps
    if all_trump_entries:
        # Reveal face-down trump folds
        revealed_cards = [e.card for e in trump_folds]

        # Highest trump wins (lowest power = strongest)
        all_trump = [(e.seat, e.card) for e in all_trump_entries]
        all_trump.sort(key=lambda x: x[1].power)
        winner = all_trump[0][0]
    else:
        # No trump played — highest card of led suit wins
        led_suit_cards = [
            (e.seat, e.card) for e in face_up if e.card.suit == led_suit
        ]
        led_suit_cards.sort(key=lambda x: x[1].power)
        winner = led_suit_cards[0][0]

    # All cards contribute to points (including face-down)
    points_won = sum(e.card.points for e in round_cards)

    return winner, points_won, trump_found, revealed_cards


def resolve_current_round(state: GameState) -> CompletedRound:
    """Resolve the current round and update game state.

    Handles trump reveal mechanics (picking up the trump card,
    marking revealed cards), records the completed round, and
    updates team points.

    Args:
        state: The game state (mutated in place).

    Returns:
        The completed round record.
    """
    play = state.play
    trump = state.trump
    round_cards = play.current_round

    has_face_down = any(e.face_down for e in round_cards)
    trump_revealed_this_round = False

    if has_face_down and not trump.is_revealed and not trump.is_open:
        # Closed Trump resolution
        winner, points_won, trump_found, revealed = resolve_round(
            round_cards, trump.trump_suit, False
        )

        if trump_found:
            trump.is_revealed = True
            trump_revealed_this_round = True

            # If the trump card itself was not played this round,
            # it gets picked up and added to the trumper's hand.
            # trump_card is None when the trumper played it face-down
            # earlier in this round (validate_and_play clears it).
            if trump.trump_card is not None:
                trump_card_played = any(
                    e.card == trump.trump_card for e in round_cards
                )
                if not trump_card_played:
                    state.hands[trump.trumper_seat].append(trump.trump_card)
                    trump.trump_card_in_hand = True
                    # The card is no longer "the folded card on the table" —
                    # it's a normal card in the trumper's hand. Clear the
                    # slot to keep state consistent with declare_open_trump.
                    trump.trump_card = None

            # Mark revealed face-down trump cards
            for entry in round_cards:
                if entry.face_down and entry.card.suit == trump.trump_suit:
                    entry.revealed = True
    else:
        # Open trump or no face-down cards
        winner, points_won, trump_found, revealed = resolve_round(
            round_cards, trump.trump_suit, True
        )

    # Record completed round
    completed = CompletedRound(
        round_number=play.round_number,
        cards=list(round_cards),
        winner=winner,
        points_won=points_won,
        trump_revealed=trump_revealed_this_round,
    )
    play.completed_rounds.append(completed)

    # Update team points
    winner_team = team_of(winner)
    play.points_won[winner_team] += points_won

    return completed


def advance_after_round(state: GameState, completed: CompletedRound) -> bool:
    """Advance game state after a round is resolved.

    Sets up the next round or transitions to scrutiny if all 8
    rounds are complete. Always clears ``current_round`` — the cards
    have been archived into ``completed_rounds`` by ``resolve_current_round``.

    Args:
        state: The game state (mutated in place).
        completed: The just-completed round.

    Returns:
        ``True`` if all 8 rounds are complete (game should end).
    """
    play = state.play

    # Always clear the in-progress round; resolved cards are already
    # archived in completed_rounds.
    play.current_round = []

    if play.round_number >= 8:
        return True

    # Set up next round
    play.round_number += 1
    play.priority = completed.winner
    play.current_turn = completed.winner

    # Skip PCC partner
    if state.pcc_partner_out == play.current_turn:
        play.current_turn = next_seat(play.current_turn)

    return False


def advance_turn(state: GameState, seat: Seat) -> None:
    """Advance to the next player's turn within a round.

    Skips the PCC partner if they are out of play.

    Args:
        state: The game state (mutated in place).
        seat: The seat that just played.
    """
    play = state.play
    next_turn = next_seat(seat)
    if state.pcc_partner_out == next_turn:
        next_turn = next_seat(next_turn)
    play.current_turn = next_turn


def is_round_complete(state: GameState) -> bool:
    """Check if the current round has all cards played.

    Args:
        state: The current game state.

    Returns:
        ``True`` if all expected players have played.
    """
    play = state.play
    expected = 3 if state.pcc_partner_out else 4
    return len(play.current_round) >= expected


def check_spoilt_trumps(state: GameState) -> bool:
    """Check if the opposition holds zero trump cards from the deal.

    Spoilt Trumps occurs when the opponents of the trumping team
    collectively hold zero cards of the trump suit from the original
    deal. This is checked by examining both current hands and all
    cards played by the opposition.

    Per the rules: "If the Trumping team's opponents collectively
    hold zero Trump cards from the deal..."

    Args:
        state: The current game state.

    Returns:
        ``True`` if Spoilt Trumps condition is met.
    """
    trump = state.trump
    trumper_team = team_of(trump.trumper_seat)
    trump_suit = trump.trump_suit

    opposition_seats = [
        s for s in Seat
        if team_of(s) != trumper_team and s != state.pcc_partner_out
    ]

    opposition_trump_count = 0

    # Check current hands
    for seat in opposition_seats:
        hand = state.hands.get(seat, [])
        opposition_trump_count += sum(1 for c in hand if c.suit == trump_suit)

    # Check played cards (completed rounds)
    play = state.play
    if play is not None:
        for r in play.completed_rounds:
            for entry in r.cards:
                if entry.seat in opposition_seats and entry.card.suit == trump_suit:
                    opposition_trump_count += 1

        # Check current round in progress
        for entry in play.current_round:
            if entry.seat in opposition_seats and entry.card.suit == trump_suit:
                opposition_trump_count += 1

    return opposition_trump_count == 0


def get_valid_plays(state: GameState, seat: Seat) -> list[Card]:
    """Return all cards a player can legally play.

    This is a query method that helps frontends show available actions.

    Args:
        state: The current game state.
        seat: The seat to check.

    Returns:
        A list of cards that can legally be played.
    """
    if state.phase != Phase.PLAYING:
        return []

    play = state.play
    if play is None or seat != play.current_turn:
        return []

    if state.pcc_partner_out == seat:
        return []

    hand = list(state.hands.get(seat, []))

    # Include the trump card from the table if it's the trumper's
    trump = state.trump
    is_trumper = seat == trump.trumper_seat
    if (
        is_trumper
        and not trump.trump_card_in_hand
        and trump.trump_card is not None
    ):
        hand.append(trump.trump_card)

    valid = []
    for card in hand:
        try:
            _validate_play_only(state, seat, card)
            valid.append(card)
        except (InvalidPlayError, GameError):
            continue

    return valid


def _validate_play_only(state: GameState, seat: Seat, card: Card) -> None:
    """Validate a card play without modifying state.

    A lighter version of ``validate_and_play`` that only checks validity.
    Mirrors the rules implemented in ``_validate_lead`` and
    ``_validate_follow``.
    """
    play = state.play
    trump = state.trump
    is_trumper = seat == trump.trumper_seat
    trump_is_open = trump.is_revealed or trump.is_open
    is_leading = len(play.current_round) == 0
    hand = state.hands.get(seat, [])
    is_pcc = state.pcc_partner_out is not None

    is_trump_card_play = (
        is_trumper
        and not trump.trump_card_in_hand
        and trump.trump_card is not None
        and card == trump.trump_card
    )

    played_suit = card.suit
    face_down = False

    if is_leading:
        # Closed Trump: trumper cannot lead trump on round 1
        if (
            not trump_is_open
            and is_trumper
            and play.round_number == 1
            and played_suit == trump.trump_suit
        ):
            raise InvalidPlayError("Cannot lead with trump on round 1.")

        # Open Trump (non-PCC), trumper has priority on round 1: must lead trump
        if (
            trump_is_open
            and is_trumper
            and play.round_number == 1
            and not is_pcc
            and played_suit != trump.trump_suit
        ):
            if any(c.suit == trump.trump_suit for c in hand):
                raise InvalidPlayError(
                    "Open Trump: must lead round 1 with the trump suit."
                )

        # Exhausted Trumps (does not apply in PCC)
        if (
            trump_is_open
            and is_trumper
            and play.round_number > 1
            and not is_pcc
        ):
            if _check_exhausted_trumps(state, seat) and played_suit != trump.trump_suit:
                raise InvalidPlayError("Exhausted Trumps.")
    else:
        led_suit = get_led_suit(play.current_round)
        if led_suit is not None:
            has_led_suit = any(c.suit == led_suit for c in hand)
            if has_led_suit and played_suit != led_suit:
                raise InvalidPlayError("Must follow suit.")

            if not has_led_suit and not trump_is_open:
                face_down = True
                # Trumper face-down restrictions
                if is_trumper:
                    is_folded_trump = (card == trump.trump_card)
                    is_in_hand_trump = (
                        card.suit == trump.trump_suit and not is_folded_trump
                    )
                    if is_in_hand_trump:
                        raise InvalidPlayError(
                            "Trumper cannot fold an in-hand trump card."
                        )
                    if led_suit == trump.trump_suit and is_folded_trump:
                        raise InvalidPlayError(
                            "Trump card cannot follow trump suit face-up "
                            "while it is the indicator."
                        )

    # Trump card face-up restriction: only in round 8 as the last card
    if is_trump_card_play and not face_down:
        if play.round_number < 8 or len(hand) > 0:
            raise InvalidPlayError(
                "Trump card may only be played face-up as the last card "
                "in round 8."
            )
