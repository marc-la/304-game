"""Trump card selection and management for the 304 card game.

Handles selecting the trump card (placed face-down after winning the
4-card bid), declaring Open Trump, and proceeding with Closed Trump.
These are pure functions that operate on state dataclasses.

Key rules:
- The trumper selects one of their 4 cards as the trump indicator.
- The card is placed face-down; its suit becomes the trump suit.
- Before play, the trumper chooses Open or Closed Trump.
- Open Trump: trump card is picked up, any trump-suit card is revealed.
- Closed Trump: trump card stays face-down, face-down card mechanics apply.
- PCC requires Open Trump.

[House Rule] The trumper can reveal any card of the trump suit when
declaring Open Trump, not necessarily the original trump card.
"""

from __future__ import annotations

from game304.card import Card
from game304.errors import InvalidPhaseError, InvalidTrumpSelectionError
from game304.seating import deal_order
from game304.state import GameState, PlayState, TrumpState
from game304.types import Phase, Seat, Team


def select_trump(state: GameState, seat: Seat, card: Card) -> None:
    """Select a trump card from the trumper's 4-card hand.

    The chosen card is placed face-down on the table. Its suit becomes
    the trump suit for the game. The card is removed from the trumper's
    hand. The trumper must not look at their remaining 4 cards before
    selecting (enforced by the UI, not here).

    After selection, the remaining 4 cards are dealt to each player
    from the deck, and the game transitions to 8-card betting.

    Args:
        state: The game state (mutated in place).
        seat: The seat selecting the trump card.
        card: The card to place as the trump indicator.

    Raises:
        InvalidPhaseError: If not in the trump selection phase.
        InvalidTrumpSelectionError: If the caller is not the trumper
            or the card is not in their hand.
    """
    if state.phase != Phase.TRUMP_SELECTION:
        raise InvalidPhaseError("Not in trump selection phase.")

    if seat != state.trump.trumper_seat:
        raise InvalidTrumpSelectionError(
            "Only the trumper can select the trump card."
        )

    hand = state.hands.get(seat, [])
    if card not in hand:
        raise InvalidTrumpSelectionError("That card is not in your hand.")

    # Set trump card and suit
    state.trump.trump_card = card
    state.trump.trump_suit = card.suit

    # Remove from hand (placed face-down on table)
    state.hands[seat] = [c for c in hand if c != card]

    # Deal remaining 4 cards from the deck
    if state.deck is not None:
        second_deal = state.deck.deal(state.dealer, 4)
        for s in second_deal:
            state.hands.setdefault(s, []).extend(second_deal[s])

    # Transition to 8-card betting
    state.phase = Phase.BETTING_8


def declare_open_trump(
    state: GameState,
    seat: Seat,
    reveal_card: Card | None = None,
) -> None:
    """Declare Open Trump before play begins.

    The trumper picks up the face-down trump card, then reveals any
    card of the trump suit to the other players (not necessarily the
    original trump card — house rule). From this point, all cards are
    played face-up.

    Args:
        state: The game state (mutated in place).
        seat: The seat declaring Open Trump.
        reveal_card: Any trump-suit card to show to other players.
            If ``None``, the original trump card is implicitly revealed.

    Raises:
        InvalidPhaseError: If not in the pre-play phase.
        InvalidTrumpSelectionError: If the caller is not the trumper,
            or the reveal card is invalid.
    """
    if state.phase != Phase.PRE_PLAY:
        raise InvalidPhaseError(
            "Can only declare Open Trump before play begins."
        )

    if seat != state.trump.trumper_seat:
        raise InvalidTrumpSelectionError(
            "Only the trumper can declare Open Trump."
        )

    # Pick up the trump card
    state.hands[seat].append(state.trump.trump_card)

    # Validate the reveal card if specified
    if reveal_card is not None:
        if reveal_card not in state.hands[seat]:
            raise InvalidTrumpSelectionError(
                "That card is not in your hand."
            )
        if reveal_card.suit != state.trump.trump_suit:
            raise InvalidTrumpSelectionError(
                "Revealed card must be of the trump suit."
            )

    # Set open trump state
    state.trump.is_revealed = True
    state.trump.is_open = True
    state.trump.trump_card_in_hand = True
    state.trump.trump_card = None  # no longer on table

    # Transition to playing
    state.phase = Phase.PLAYING
    _init_play_state(state)


def proceed_closed_trump(state: GameState, seat: Seat) -> None:
    """Proceed to play with Closed Trump (trump card stays face-down).

    The trump card remains on the table. Players who cannot follow suit
    play their cards face-down (cuts or minuses). Trump is revealed
    when a face-down trump card is played.

    Args:
        state: The game state (mutated in place).
        seat: The seat proceeding with Closed Trump.

    Raises:
        InvalidPhaseError: If not in the pre-play phase.
        InvalidTrumpSelectionError: If the caller is not the trumper,
            or if PCC requires Open Trump.
    """
    if state.phase != Phase.PRE_PLAY:
        raise InvalidPhaseError("Not in pre-play phase.")

    if seat != state.trump.trumper_seat:
        raise InvalidTrumpSelectionError("Only the trumper can proceed.")

    # PCC requires Open Trump
    if state.bidding is not None and state.bidding.is_pcc:
        raise InvalidTrumpSelectionError(
            "PCC requires Open Trump. Use declare_open_trump instead."
        )

    state.phase = Phase.PLAYING
    _init_play_state(state)


def _init_play_state(state: GameState) -> None:
    """Initialise the play state for the first round.

    The player to the dealer's right has priority (leads the first
    round). If PCC, the partner's turns are skipped.
    """
    order = deal_order(state.dealer)
    priority = order[0]

    # If PCC partner has priority, advance
    if state.pcc_partner_out == priority:
        from game304.seating import next_seat

        priority = next_seat(priority)

    state.play = PlayState(
        round_number=1,
        priority=priority,
        current_turn=priority,
    )
