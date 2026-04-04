"""Bidding logic for the 304 card game.

Handles all bidding actions (bet, pass, partner) for both 4-card and
8-card betting phases. These are pure functions that operate on state
dataclasses — the ``Game`` orchestrator calls them and manages phase
transitions.

Rules implemented:
- Minimum bid 160 (4-card) or 220 (8-card "Honest")
- Increments of 10 below 200, 5 at 200+
- Below-200 bids (4-card) / below-250 bids (8-card): first speech only
- Cannot undercut your own partner's highest bid
- Partner action: both players consume a speech, partner's turn skipped
- Three consecutive passes end bidding
- PCC as highest possible bid (8-card only)
"""

from __future__ import annotations

from game304.card import Card, hand_points
from game304.constants import (
    INCREMENT_200_PLUS,
    INCREMENT_BELOW_200,
    MAX_CONSECUTIVE_RESHUFFLES,
    MIN_BID_4_CARD,
    MIN_BID_8_CARD,
    PCC_BID_VALUE,
    REDEAL_POINT_THRESHOLD,
    RESHUFFLE_POINT_THRESHOLD,
    THRESHOLD_4_CARD,
    THRESHOLD_8_CARD,
)
from game304.errors import InvalidBidError, InvalidPhaseError, NotYourTurnError
from game304.seating import deal_order, next_seat, partner_seat
from game304.state import (
    BiddingState,
    GameState,
    PendingPartnerResponse,
    PlayerBidState,
    Speech,
)
from game304.types import BidAction, Phase, Seat


def get_increment(current_bid: int) -> int:
    """Return the required bid increment for a given bid level.

    Bids below 200 must increase in increments of 10.
    Bids of 200 and above must increase in increments of 5.

    Args:
        current_bid: The current highest bid value.

    Returns:
        The required increment (10 or 5).
    """
    return INCREMENT_200_PLUS if current_bid >= 200 else INCREMENT_BELOW_200


def validate_bid_value(
    bidding: BiddingState,
    value: int,
    player_state: PlayerBidState,
    caller_seat: Seat,
) -> None:
    """Validate a numeric bid against all bidding rules.

    Checks minimum bid, increment validity, partner undercut
    prevention, and first-speech constraints.

    Args:
        bidding: The current bidding state.
        value: The proposed bid value.
        player_state: The caller's per-player bidding state.
        caller_seat: The seat placing the bid.

    Raises:
        InvalidBidError: If the bid violates any rule.
    """
    is_four_card = bidding.is_four_card
    min_first = MIN_BID_4_CARD if is_four_card else MIN_BID_8_CARD
    threshold = THRESHOLD_4_CARD if is_four_card else THRESHOLD_8_CARD
    is_first_speech = player_state.speech_count == 0
    partner = partner_seat(caller_seat)
    partner_is_highest = bidding.highest_bidder == partner

    # Determine minimum bid
    if bidding.highest_bid == 0:
        # No bids yet — minimum is the floor
        min_bid = min_first
    elif is_first_speech:
        min_bid = max(
            min_first,
            bidding.highest_bid + get_increment(bidding.highest_bid),
        )
    else:
        # After first speech, minimum is the threshold (200 or 250)
        min_bid = max(
            threshold,
            bidding.highest_bid + get_increment(bidding.highest_bid),
        )

    # Cannot undercut partner
    if partner_is_highest and value < threshold:
        raise InvalidBidError(
            f"Cannot undercut your partner. Minimum bid is {threshold}."
        )

    if value < min_bid:
        raise InvalidBidError(f"Bid must be at least {min_bid}.")

    # Validate increment
    if value > min_first and bidding.highest_bid > 0:
        required_increment = get_increment(max(bidding.highest_bid, value))
        diff = value - bidding.highest_bid
        if diff % required_increment != 0 or value <= bidding.highest_bid:
            raise InvalidBidError(
                f"Invalid bid increment. Must increase by multiples of "
                f"{required_increment}."
            )


def advance_bidder(bidding: BiddingState, pcc_partner_out: Seat | None = None) -> None:
    """Advance to the next bidder, skipping players whose turn was consumed.

    When a player's turn is consumed by the "partner" action, their
    ``skipped`` flag is set. This function clears the flag and advances
    past them.

    Args:
        bidding: The current bidding state (mutated in place).
        pcc_partner_out: Seat of the PCC partner who is out of play.
    """
    next_s = next_seat(bidding.current_bidder)
    attempts = 0
    while attempts < 4:
        state = bidding.player_state[next_s]
        if state.skipped:
            state.skipped = False  # consume the skip
            next_s = next_seat(next_s)
            attempts += 1
        else:
            break
    bidding.current_bidder = next_s


def init_bidding_state(
    first_bidder: Seat,
    is_four_card: bool,
    four_card_bid: int | None = None,
    four_card_bidder: Seat | None = None,
) -> BiddingState:
    """Create a fresh bidding state for a betting phase.

    Args:
        first_bidder: The seat who bids first (player to dealer's right).
        is_four_card: ``True`` for 4-card bidding, ``False`` for 8-card.
        four_card_bid: The winning 4-card bid (for 8-card phase context).
        four_card_bidder: The 4-card bid winner (for 8-card phase context).

    Returns:
        A new ``BiddingState`` instance.
    """
    player_state = {seat: PlayerBidState() for seat in Seat}
    bidding = BiddingState(
        is_four_card=is_four_card,
        current_bidder=first_bidder,
        player_state=player_state,
    )
    if not is_four_card:
        # 8-card bidding carries forward the 4-card bid
        bidding.four_card_bid = four_card_bid
        bidding.four_card_bidder = four_card_bidder
        bidding.highest_bid = four_card_bid or 0
        bidding.highest_bidder = four_card_bidder
    return bidding


def place_bid(
    state: GameState,
    seat: Seat,
    action: BidAction,
    value: int = 0,
) -> str | None:
    """Process a bidding action (bet, pass, partner, or PCC).

    This is the main entry point for bidding. It validates the action,
    updates bidding state, and returns a transition signal if bidding
    has ended.

    Args:
        state: The full game state (mutated in place).
        seat: The seat taking the action.
        action: The bidding action to take.
        value: The bid value (only for BET actions).

    Returns:
        A transition signal string if bidding has ended:
        - ``'trump_selection'``: Bid established, move to trump selection.
        - ``'redeal'``: All players passed, redeal.
        - ``'pre_play'``: No 8-card bids, proceed with 4-card bid.
        - ``'new_8_card_trump'``: New 8-card bid supersedes 4-card bid.
        - ``'pcc'``: PCC bid established.
        - ``None``: Bidding continues.

    Raises:
        InvalidPhaseError: If not in a betting phase.
        NotYourTurnError: If it's not this seat's turn to bid.
        InvalidBidError: If the bid is invalid.
    """
    if state.phase not in (Phase.BETTING_4, Phase.BETTING_8):
        raise InvalidPhaseError("Not in a betting phase.")

    bidding = state.bidding
    if bidding is None:
        raise InvalidPhaseError("Bidding state not initialised.")

    if seat != bidding.current_bidder:
        raise NotYourTurnError("It's not your turn to bid.")

    player_state = bidding.player_state[seat]
    partner = partner_seat(seat)
    partner_state = bidding.player_state[partner]

    if action == BidAction.PARTNER:
        return _handle_partner(bidding, seat, player_state, partner, partner_state)

    if (
        bidding.pending_partner is not None
        and seat == bidding.pending_partner.partner_seat
    ):
        return _handle_partner_response(
            state, bidding, seat, action, value, partner_state
        )

    if action == BidAction.BET:
        return _handle_bet(state, bidding, seat, value, player_state)

    if action == BidAction.PASS:
        return _handle_pass(state, bidding, seat, player_state)

    if action == BidAction.PCC:
        return _handle_pcc(state, bidding, seat, player_state)

    raise InvalidBidError(f"Invalid bid action: {action}")


def _handle_partner(
    bidding: BiddingState,
    seat: Seat,
    player_state: PlayerBidState,
    partner: Seat,
    partner_state: PlayerBidState,
) -> None:
    """Handle the PARTNER action — ask partner to bid on your behalf.

    Both the caller and their partner consume a speech. The partner's
    normal turn will be skipped when it comes around.

    Per the rules: "Both players have now used their first speech. The
    partner's normal turn is skipped when bidding comes around to them."
    """
    if partner_state.skipped or partner_state.partner_used_by is not None:
        raise InvalidBidError(
            "Your partner has already been used via partnering."
        )

    # Both players consume a speech
    player_state.speech_count += 1
    player_state.has_partnered = True
    partner_state.partner_used_by = seat
    partner_state.speech_count += 1

    bidding.speeches.append(
        Speech(
            seat=seat,
            action=BidAction.PARTNER,
            speech_number=player_state.speech_count,
        )
    )

    # Partner now bids in caller's position
    bidding.current_bidder = partner
    bidding.pending_partner = PendingPartnerResponse(
        original_seat=seat, partner_seat=partner
    )
    return None


def _handle_partner_response(
    state: GameState,
    bidding: BiddingState,
    seat: Seat,
    action: BidAction,
    value: int,
    partner_state: PlayerBidState,
) -> str | None:
    """Handle the partner's response after being asked to bid.

    The partner can bet or pass on behalf of the original player.
    """
    original_seat = bidding.pending_partner.original_seat

    if action == BidAction.BET:
        validate_bid_value(bidding, value, partner_state, seat)
        bidding.highest_bid = value
        bidding.highest_bidder = seat
        bidding.consecutive_passes = 0
        bidding.speeches.append(
            Speech(
                seat=seat,
                action=BidAction.BET_FOR_PARTNER,
                value=value,
                speech_number=partner_state.speech_count,
                on_behalf_of=original_seat,
            )
        )
    elif action == BidAction.PASS:
        bidding.consecutive_passes += 1
        bidding.speeches.append(
            Speech(
                seat=seat,
                action=BidAction.PASS_FOR_PARTNER,
                speech_number=partner_state.speech_count,
                on_behalf_of=original_seat,
            )
        )
    else:
        raise InvalidBidError(
            "When responding to a partner request, you can only bet or pass."
        )

    # The responding partner's own turn will be skipped (they already spoke)
    bidding.player_state[seat].skipped = True
    bidding.pending_partner = None

    # Resume from the original player's position so advance goes to the
    # next player in normal order (not from the partner's position).
    bidding.current_bidder = original_seat
    advance_bidder(bidding, state.pcc_partner_out)
    return _check_bidding_end(state, bidding)


def _handle_bet(
    state: GameState,
    bidding: BiddingState,
    seat: Seat,
    value: int,
    player_state: PlayerBidState,
) -> str | None:
    """Handle a regular BET action."""
    validate_bid_value(bidding, value, player_state, seat)

    player_state.speech_count += 1
    bidding.highest_bid = value
    bidding.highest_bidder = seat
    bidding.consecutive_passes = 0

    bidding.speeches.append(
        Speech(
            seat=seat,
            action=BidAction.BET,
            value=value,
            speech_number=player_state.speech_count,
        )
    )

    advance_bidder(bidding, state.pcc_partner_out)
    return _check_bidding_end(state, bidding)


def _handle_pass(
    state: GameState,
    bidding: BiddingState,
    seat: Seat,
    player_state: PlayerBidState,
) -> str | None:
    """Handle a PASS action."""
    player_state.speech_count += 1
    bidding.consecutive_passes += 1

    bidding.speeches.append(
        Speech(
            seat=seat,
            action=BidAction.PASS,
            speech_number=player_state.speech_count,
        )
    )

    advance_bidder(bidding, state.pcc_partner_out)
    return _check_bidding_end(state, bidding)


def _handle_pcc(
    state: GameState,
    bidding: BiddingState,
    seat: Seat,
    player_state: PlayerBidState,
) -> str | None:
    """Handle a PCC (Partner Closed Caps) bid.

    PCC is only available on 8-card betting. It is the highest possible
    bid — the trumper plays alone (partner sits out) and must win all
    8 rounds playing Open Trump.
    """
    if bidding.is_four_card:
        raise InvalidBidError("PCC is only available on 8-card betting.")

    player_state.speech_count += 1
    bidding.highest_bid = PCC_BID_VALUE
    bidding.highest_bidder = seat
    bidding.consecutive_passes = 0
    bidding.is_pcc = True

    bidding.speeches.append(
        Speech(
            seat=seat,
            action=BidAction.PCC,
            speech_number=player_state.speech_count,
        )
    )

    advance_bidder(bidding, state.pcc_partner_out)
    return _check_bidding_end(state, bidding)


def _check_bidding_end(state: GameState, bidding: BiddingState) -> str | None:
    """Check if bidding has ended (3 consecutive passes) and return transition.

    Returns:
        Transition signal or ``None`` if bidding continues.
    """
    # When a bid has been established, 3 consecutive passes end bidding.
    # When no one has bid, all 4 players must pass for a redeal.
    passes_needed = 3 if bidding.highest_bidder is not None else 4
    if bidding.consecutive_passes < passes_needed:
        return None

    if bidding.is_four_card:
        if bidding.highest_bidder is None:
            # All 4 players passed — redeal
            return "redeal"
        else:
            # Bid established — move to trump selection
            return "trump_selection"
    else:
        # 8-card bidding ended
        if (
            bidding.highest_bid > 0
            and bidding.highest_bid != bidding.four_card_bid
        ):
            # New 8-card bid supersedes 4-card bid
            if bidding.is_pcc:
                return "pcc"
            return "new_8_card_trump"
        else:
            # No 8-card bids — proceed with 4-card bid
            return "pre_play"


def check_reshuffle_eligibility(state: GameState, seat: Seat) -> None:
    """Validate that a player can call a reshuffle on 4 cards.

    A reshuffle is allowed if:
    1. The game is in the 4-card betting phase.
    2. The caller is the player to the dealer's right (priority), OR
       their partner was given the turn via "partner" by the priority
       player (house rule).
    3. The caller's 4-card hand totals less than 15 points.

    Args:
        state: The current game state.
        seat: The seat requesting the reshuffle.

    Raises:
        InvalidPhaseError: If not in 4-card betting.
        InvalidBidError: If the player is not eligible or hand is too strong.
    """
    if state.phase != Phase.BETTING_4:
        raise InvalidPhaseError("Can only reshuffle during 4-card betting.")

    order = deal_order(state.dealer)
    priority_seat = order[0]

    # Check eligibility
    is_priority = seat == priority_seat
    is_partner_via_partner = (
        state.bidding is not None
        and state.bidding.player_state[seat].partner_used_by == priority_seat
    )
    if not is_priority and not is_partner_via_partner:
        raise InvalidBidError(
            "Only the player with priority (or their partner via 'partner') "
            "can reshuffle."
        )

    # Check hand points
    hand = state.hands.get(seat, [])
    points = hand_points(hand)
    if points >= RESHUFFLE_POINT_THRESHOLD:
        raise InvalidBidError(
            f"Hand has {points} points. Must be less than "
            f"{RESHUFFLE_POINT_THRESHOLD} to reshuffle."
        )


def check_redeal_8_eligibility(state: GameState, seat: Seat) -> None:
    """Validate that a player can call a redeal on 8 cards.

    A redeal is allowed if:
    1. The game is in the 8-card betting phase.
    2. The caller's 8-card hand totals less than 25 points.

    Args:
        state: The current game state.
        seat: The seat requesting the redeal.

    Raises:
        InvalidPhaseError: If not in 8-card betting.
        InvalidBidError: If hand is too strong.
    """
    if state.phase != Phase.BETTING_8:
        raise InvalidPhaseError("Can only redeal during 8-card betting.")

    hand = state.hands.get(seat, [])
    points = hand_points(hand)
    if points >= REDEAL_POINT_THRESHOLD:
        raise InvalidBidError(
            f"Hand has {points} points. Must be less than "
            f"{REDEAL_POINT_THRESHOLD} to redeal."
        )


def needs_full_shuffle(state: GameState) -> bool:
    """Check if the next shuffle should be a full (Fisher-Yates) shuffle.

    After 3 consecutive reshuffles, a full shuffle is performed to
    reset the pack (house rule safety valve).

    Args:
        state: The current game state.

    Returns:
        ``True`` if a full shuffle should be performed.
    """
    return state.consecutive_reshuffles >= MAX_CONSECUTIVE_RESHUFFLES
