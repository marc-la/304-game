"""Game and Match orchestrators for the 304 card game.

``Game`` is the primary API surface — it owns a ``GameState`` and
exposes action methods that validate inputs, delegate to engine modules,
and manage phase transitions. All game logic flows through this class.

``Match`` wraps a series of ``Game`` instances, tracking stone across
games and managing dealer rotation. A match ends when one team reaches
0 stone.

Usage:
    >>> from game304 import Game, Seat, BidAction, Card
    >>> game = Game(dealer=Seat.NORTH)
    >>> game.deal_four()
    >>> game.place_bid(Seat.WEST, BidAction.BET, 160)
    >>> ...
"""

from __future__ import annotations

import random
from typing import Any

from game304.bidding import (
    check_redeal_8_eligibility,
    check_reshuffle_eligibility,
    init_bidding_state,
    needs_full_shuffle,
    place_bid as _place_bid,
)
from game304.caps import (
    check_caps_obligation,
    is_caps_late,
    track_caps_obligation,
    validate_caps_call,
)
from game304.card import Card, hand_points
from game304.constants import INITIAL_STONE, WRONG_CAPS_PENALTY
from game304.deck import Deck, create_pack
from game304.errors import (
    CapsError,
    GameError,
    InvalidPhaseError,
    InvalidPlayError,
    NotYourTurnError,
)
from game304.play import (
    advance_after_round,
    advance_turn,
    check_spoilt_trumps,
    get_valid_plays,
    is_round_complete,
    resolve_current_round,
    validate_and_play,
)
from game304.scoring import (
    apply_stone_changes,
    calculate_caps_result,
    calculate_result,
)
from game304.seating import deal_order, next_seat, partner_seat, team_of
from game304.state import (
    BiddingState,
    CapsCall,
    CompletedRound,
    GameResult,
    GameState,
    PlayState,
    TrumpState,
)
from game304.trump import (
    declare_open_trump as _declare_open_trump,
    proceed_closed_trump as _proceed_closed_trump,
    select_trump as _select_trump,
)
from game304.types import BidAction, Phase, Seat, Suit, Team


class Game:
    """Top-level game engine for a single game of 304.

    A game consists of 8 rounds of trick-taking, preceded by
    dealing, bidding, and trump selection. The ``Game`` class
    manages the state machine and delegates to engine modules
    for validation and state mutation.

    All randomness is routed through an injectable ``random.Random``
    instance for deterministic testing.

    Args:
        dealer: The seat of the dealer for this game.
        stone: Initial stone counts. Defaults to 10 per team.
        rng: Random number generator for shuffling and dealing.
        game_number: The game number within the current match.

    Attributes:
        state: The complete game state (read-only access recommended;
            direct mutation is possible but bypasses validation).
    """

    def __init__(
        self,
        dealer: Seat = Seat.NORTH,
        stone: dict[Team, int] | None = None,
        rng: random.Random | None = None,
        game_number: int = 1,
    ) -> None:
        self._rng = rng if rng is not None else random.Random()
        self._state = GameState(
            game_number=game_number,
            dealer=dealer,
            stone=stone
            if stone is not None
            else {Team.TEAM_A: INITIAL_STONE, Team.TEAM_B: INITIAL_STONE},
        )

    @property
    def state(self) -> GameState:
        """The complete game state."""
        return self._state

    @property
    def phase(self) -> Phase:
        """The current game phase."""
        return self._state.phase

    # ------------------------------------------------------------------
    # Dealing
    # ------------------------------------------------------------------

    def deal_four(self) -> dict[Seat, list[Card]]:
        """Shuffle, cut, and deal 4 cards to each player.

        Creates a new deck, performs a minimal shuffle (1–4 overhand
        passes, or a full shuffle after 3 consecutive reshuffles),
        cuts, and deals 4 cards to each player starting with the
        player to the dealer's right.

        Returns:
            A dict mapping each seat to their 4 dealt cards.

        Raises:
            InvalidPhaseError: If not in the DEALING_4 phase.
        """
        if self._state.phase != Phase.DEALING_4:
            raise InvalidPhaseError("Not in the dealing phase.")

        # Create and shuffle deck
        deck = Deck(rng=self._rng)
        if needs_full_shuffle(self._state):
            deck.full_shuffle()
            self._state.consecutive_reshuffles = 0
        else:
            deck.minimal_shuffle()
        deck.cut()

        self._state.deck = deck

        # Deal 4 cards to each player
        hands = deck.deal(self._state.dealer, 4)
        self._state.hands = {seat: list(cards) for seat, cards in hands.items()}

        # Transition to 4-card betting
        self._state.phase = Phase.BETTING_4
        order = deal_order(self._state.dealer)
        self._state.bidding = init_bidding_state(
            first_bidder=order[0],
            is_four_card=True,
        )

        return hands

    def deal_eight(self) -> dict[Seat, list[Card]]:
        """Deal the remaining 4 cards to each player.

        Called internally after trump selection. Typically not called
        directly — ``select_trump`` handles this transition.

        Returns:
            A dict mapping each seat to their additional 4 cards.

        Raises:
            InvalidPhaseError: If not in the DEALING_8 phase.
        """
        if self._state.phase != Phase.DEALING_8:
            raise InvalidPhaseError("Not in the 8-card dealing phase.")

        deck = self._state.deck
        if deck is None:
            raise GameError("No deck available for dealing.")

        hands = deck.deal(self._state.dealer, 4)
        for seat, cards in hands.items():
            self._state.hands.setdefault(seat, []).extend(cards)

        self._state.phase = Phase.BETTING_8
        return hands

    # ------------------------------------------------------------------
    # Bidding
    # ------------------------------------------------------------------

    def place_bid(
        self,
        seat: Seat,
        action: BidAction,
        value: int = 0,
    ) -> None:
        """Place a bid (bet, pass, partner, or PCC).

        Validates the action and updates bidding state. If bidding
        ends (3 consecutive passes), transitions to the appropriate
        next phase.

        Args:
            seat: The seat taking the action.
            action: The bidding action.
            value: The bid value (only for BET actions).

        Raises:
            InvalidPhaseError: If not in a betting phase.
            NotYourTurnError: If it's not this seat's turn.
            InvalidBidError: If the bid violates bidding rules.
        """
        transition = _place_bid(self._state, seat, action, value)
        if transition is not None:
            self._handle_bidding_transition(transition)

    def call_reshuffle(self, seat: Seat) -> None:
        """Declare a reshuffle on 4 cards (hand < 15 points).

        The same dealer deals again with a reshuffled deck. After 3
        consecutive reshuffles, a full shuffle is performed.

        Per the rules: a reshuffle may be called by the player to
        the dealer's right, or their partner who was given the turn
        via "partner" (house rule).

        Args:
            seat: The seat requesting the reshuffle.

        Raises:
            InvalidPhaseError: If not in 4-card betting.
            InvalidBidError: If the player is not eligible or hand
                is too strong.
        """
        check_reshuffle_eligibility(self._state, seat)

        self._state.consecutive_reshuffles += 1

        # Reset for new deal with same dealer
        self._reset_for_deal(same_dealer=True)

    def call_redeal_8(self, seat: Seat) -> None:
        """Declare a redeal on 8 cards (hand < 25 points).

        The deal moves to the next dealer anticlockwise.

        Args:
            seat: The seat requesting the redeal.

        Raises:
            InvalidPhaseError: If not in 8-card betting.
            InvalidBidError: If hand is too strong.
        """
        check_redeal_8_eligibility(self._state, seat)
        self._reset_for_deal(same_dealer=False)

    # ------------------------------------------------------------------
    # Trump
    # ------------------------------------------------------------------

    def select_trump(self, seat: Seat, card: Card) -> None:
        """Select a trump card from the trumper's 4-card hand.

        The card is placed face-down. Its suit becomes the trump suit.
        The remaining 4 cards are dealt from the deck, and the game
        transitions to 8-card betting.

        Args:
            seat: The seat selecting the trump (must be the trumper).
            card: The card to place as the trump indicator.

        Raises:
            InvalidPhaseError: If not in trump selection.
            InvalidTrumpSelectionError: If invalid.
        """
        _select_trump(self._state, seat, card)

        # Initialise 8-card bidding
        order = deal_order(self._state.dealer)
        four_card_bid = self._state.bidding.highest_bid if self._state.bidding else None
        four_card_bidder = self._state.bidding.highest_bidder if self._state.bidding else None
        self._state.bidding = init_bidding_state(
            first_bidder=order[0],
            is_four_card=False,
            four_card_bid=four_card_bid,
            four_card_bidder=four_card_bidder,
        )

    def declare_open_trump(
        self,
        seat: Seat,
        reveal_card: Card | None = None,
    ) -> None:
        """Declare Open Trump before play begins.

        The trumper picks up the trump card and reveals any card of
        the trump suit. All subsequent play is face-up.

        Args:
            seat: The seat declaring Open Trump (must be the trumper).
            reveal_card: Any trump-suit card to show. If ``None``,
                the original trump card is implicitly revealed.

        Raises:
            InvalidPhaseError: If not in pre-play.
            InvalidTrumpSelectionError: If invalid.
        """
        _declare_open_trump(self._state, seat, reveal_card)

    def proceed_closed_trump(self, seat: Seat) -> None:
        """Proceed to play with Closed Trump (trump card stays face-down).

        Args:
            seat: The seat proceeding (must be the trumper).

        Raises:
            InvalidPhaseError: If not in pre-play.
            InvalidTrumpSelectionError: If PCC requires Open Trump.
        """
        _proceed_closed_trump(self._state, seat)

    # ------------------------------------------------------------------
    # Play
    # ------------------------------------------------------------------

    def play_card(self, seat: Seat, card: Card) -> CompletedRound | None:
        """Play a card from a player's hand.

        Validates the play, adds the card to the current round, and
        resolves the round if all players have played. Returns the
        completed round record if the round is done, or ``None`` if
        more cards are expected.

        If all 8 rounds are complete, transitions to scrutiny and
        calculates the game result.

        Args:
            seat: The seat playing the card.
            card: The card to play.

        Returns:
            The ``CompletedRound`` if the round is complete, or ``None``.

        Raises:
            InvalidPhaseError: If not in the play phase.
            NotYourTurnError: If it's not this seat's turn.
            InvalidPlayError: If the card play violates the rules.
        """
        validate_and_play(self._state, seat, card)

        # Track caps obligation (best-effort, non-fatal)
        track_caps_obligation(self._state, seat)

        if is_round_complete(self._state):
            completed = resolve_current_round(self._state)
            game_over = advance_after_round(self._state, completed)

            if game_over:
                self._finalize_game()

            return completed
        else:
            advance_turn(self._state, seat)
            return None

    def call_caps(self, seat: Seat, play_order: list[Card]) -> None:
        """Call Caps — declare guaranteed wins on all remaining rounds.

        The caller puts down their cards and states the order of play.
        The claim is verified: if invalid, a 5-stone penalty applies.
        If valid, the game ends with the appropriate caps result.

        Args:
            seat: The seat calling caps.
            play_order: The sequence of cards the caller will play
                to guarantee all remaining rounds.

        Raises:
            InvalidPhaseError: If not in the play phase.
            CapsError: If the team has already lost a round, or if
                the play order doesn't match the caller's hand.
        """
        if self._state.phase != Phase.PLAYING:
            raise InvalidPhaseError("Not in play phase.")

        play = self._state.play
        if play is None:
            raise InvalidPhaseError("Play state not initialised.")

        my_team = team_of(seat)
        trumper_team = team_of(self._state.trump.trumper_seat)
        is_external = my_team != trumper_team

        # Check if team has lost a round
        has_lost = any(
            team_of(r.winner) != my_team for r in play.completed_rounds
        )
        if has_lost:
            raise CapsError(
                "Cannot call Caps — your team has already lost a round."
            )

        # Validate play order matches hand
        my_hand = self._state.hands.get(seat, [])
        if sorted(play_order, key=str) != sorted(my_hand, key=str):
            raise CapsError(
                "Play order must contain exactly your remaining cards."
            )

        # Verify the claim
        is_valid = validate_caps_call(self._state, seat, play_order)

        # Record the call
        play.caps_call = CapsCall(
            called_by=seat,
            called_at_round=play.round_number,
            play_order=play_order,
            is_external=is_external,
            result="wrong_early" if not is_valid else (
                "late" if is_caps_late(self._state, seat) else "correct"
            ),
        )

        # Calculate result and end game
        result = calculate_caps_result(
            self._state, seat, is_valid, is_external
        )
        self._state.result = result
        self._state.phase = Phase.COMPLETE

        # Apply stone changes
        if not is_valid:
            # Wrong caps: penalty applied to calling team
            self._state.stone = dict(self._state.stone)  # ensure mutable
            self._state.stone[my_team] += WRONG_CAPS_PENALTY
        else:
            apply_stone_changes(
                self._state.stone, result, trumper_team
            )

    def call_spoilt_trumps(self, seat: Seat) -> None:
        """Declare Spoilt Trumps — opposition holds zero trump cards.

        The game is voided with no stone exchanged. Can be called by
        any player who notices, at any time before the last card of
        the last round is played.

        Args:
            seat: The seat calling Spoilt Trumps.

        Raises:
            InvalidPhaseError: If not during play or pre-play.
            GameError: If the opposition actually holds/held trump,
                or if it's too late to call.
        """
        if self._state.phase not in (Phase.PLAYING, Phase.PRE_PLAY):
            raise InvalidPhaseError(
                "Can only call Spoilt Trumps during play."
            )

        play = self._state.play
        if play is not None:
            expected = 3 if self._state.pcc_partner_out else 4
            if (
                play.round_number == 8
                and len(play.current_round) >= expected
            ):
                raise GameError(
                    "Too late to call Spoilt Trumps — the last card "
                    "has been played."
                )

        if not check_spoilt_trumps(self._state):
            raise GameError(
                "Opposition holds (or held) trump cards. "
                "Not Spoilt Trumps."
            )

        self._state.phase = Phase.COMPLETE
        self._state.result = GameResult(
            reason="spoilt_trumps",
            stone_exchanged=0,
            stone_direction="none",
            winner_team=None,
            description=(
                "Spoilt Trumps — opposition held zero trump cards "
                "from the deal."
            ),
        )

    def call_absolute_hand(self, seat: Seat) -> None:
        """Declare an Absolute Hand — guaranteed to win all 8 rounds.

        Must be called before play begins. The game is voided with
        no stone exchanged (house rule).

        Args:
            seat: The seat declaring the absolute hand.

        Raises:
            InvalidPhaseError: If not in pre-play.
        """
        if self._state.phase != Phase.PRE_PLAY:
            raise InvalidPhaseError(
                "Absolute Hand can only be declared before play begins."
            )

        self._state.phase = Phase.COMPLETE
        self._state.result = GameResult(
            reason="absolute_hand",
            stone_exchanged=0,
            stone_direction="none",
            winner_team=None,
            description=(
                "Absolute Hand declared — redeal with no stone exchanged."
            ),
        )

    # ------------------------------------------------------------------
    # Query methods
    # ------------------------------------------------------------------

    def get_hand(self, seat: Seat) -> list[Card]:
        """Return the cards currently in a player's hand.

        Args:
            seat: The seat to query.

        Returns:
            A list of cards (may be empty).
        """
        return list(self._state.hands.get(seat, []))

    def valid_plays(self, seat: Seat) -> list[Card]:
        """Return all cards a player can legally play right now.

        Args:
            seat: The seat to query.

        Returns:
            A list of legally playable cards.
        """
        return get_valid_plays(self._state, seat)

    def whose_turn(self) -> Seat | None:
        """Return the seat whose turn it is to act, or ``None``.

        Covers both bidding and play phases.

        Returns:
            The seat that should act next, or ``None`` if no action
            is expected (e.g. game is complete).
        """
        if self._state.phase in (Phase.BETTING_4, Phase.BETTING_8):
            bidding = self._state.bidding
            return bidding.current_bidder if bidding else None
        if self._state.phase == Phase.PLAYING:
            play = self._state.play
            return play.current_turn if play else None
        if self._state.phase in (Phase.TRUMP_SELECTION, Phase.PRE_PLAY):
            return self._state.trump.trumper_seat
        return None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _handle_bidding_transition(self, transition: str) -> None:
        """Handle the end-of-bidding transition.

        Args:
            transition: The transition signal from bidding.
        """
        if transition == "redeal":
            self._reset_for_deal(same_dealer=False)

        elif transition == "trump_selection":
            self._state.phase = Phase.TRUMP_SELECTION
            self._state.trump.trumper_seat = self._state.bidding.highest_bidder

        elif transition == "pre_play":
            # No 8-card bids — proceed with 4-card bid
            self._state.phase = Phase.PRE_PLAY

        elif transition == "new_8_card_trump":
            # New 8-card bid supersedes 4-card bid
            # Old trump card is returned if there was one
            if self._state.trump.trump_card is not None:
                old_trumper = self._state.trump.trumper_seat
                if old_trumper is not None:
                    self._state.hands.setdefault(old_trumper, []).append(
                        self._state.trump.trump_card
                    )

            self._state.trump = TrumpState(
                trumper_seat=self._state.bidding.highest_bidder,
            )
            self._state.phase = Phase.TRUMP_SELECTION

        elif transition == "pcc":
            # PCC bid — partner sits out
            pcc_bidder = self._state.bidding.highest_bidder
            self._state.pcc_partner_out = partner_seat(pcc_bidder)

            # Old trump card returned if there was one
            if self._state.trump.trump_card is not None:
                old_trumper = self._state.trump.trumper_seat
                if old_trumper is not None:
                    self._state.hands.setdefault(old_trumper, []).append(
                        self._state.trump.trump_card
                    )

            self._state.trump = TrumpState(
                trumper_seat=pcc_bidder,
            )
            self._state.phase = Phase.TRUMP_SELECTION

    def _reset_for_deal(self, same_dealer: bool) -> None:
        """Reset game state for a new deal.

        Args:
            same_dealer: If ``True``, same dealer deals again
                (reshuffle). If ``False``, dealer advances
                anticlockwise (redeal).
        """
        if not same_dealer:
            self._state.dealer = next_seat(self._state.dealer)
            self._state.consecutive_reshuffles = 0

        self._state.phase = Phase.DEALING_4
        self._state.hands = {}
        self._state.deck = None
        self._state.trump = TrumpState()
        self._state.bidding = None
        self._state.play = None
        self._state.pcc_partner_out = None

    def _finalize_game(self) -> None:
        """Calculate result and apply stone changes after all 8 rounds."""
        self._state.phase = Phase.SCRUTINY
        result = calculate_result(self._state)
        self._state.result = result

        trumper_team = team_of(self._state.trump.trumper_seat)
        apply_stone_changes(self._state.stone, result, trumper_team)

        self._state.phase = Phase.COMPLETE


class Match:
    """Orchestrates a series of games until one team reaches 0 stone.

    A match begins with both teams holding 10 stone each. Games are
    played sequentially with the dealer rotating anticlockwise. The
    first team to give away all their stone wins the match.

    Args:
        first_dealer: The seat of the first dealer.
        rng: Random number generator (shared across all games).

    Attributes:
        stone: Current stone counts per team.
        games: List of completed ``Game`` instances.
        current_game: The game currently in progress.
    """

    def __init__(
        self,
        first_dealer: Seat = Seat.NORTH,
        rng: random.Random | None = None,
    ) -> None:
        self._rng = rng if rng is not None else random.Random()
        self._stone: dict[Team, int] = {
            Team.TEAM_A: INITIAL_STONE,
            Team.TEAM_B: INITIAL_STONE,
        }
        self._games: list[Game] = []
        self._next_dealer = first_dealer
        self._current_game: Game | None = None

    @property
    def stone(self) -> dict[Team, int]:
        """Current stone counts per team."""
        return dict(self._stone)

    @property
    def games(self) -> list[Game]:
        """List of completed games in this match."""
        return list(self._games)

    @property
    def current_game(self) -> Game | None:
        """The game currently in progress, or ``None``."""
        return self._current_game

    def is_complete(self) -> bool:
        """Check if the match is over (a team has 0 stone).

        Returns:
            ``True`` if the match is complete.
        """
        return self._stone[Team.TEAM_A] <= 0 or self._stone[Team.TEAM_B] <= 0

    def winner(self) -> Team | None:
        """Return the winning team, or ``None`` if match is ongoing.

        Returns:
            The team with 0 (or fewer) stone, or ``None``.
        """
        if self._stone[Team.TEAM_A] <= 0:
            return Team.TEAM_A
        if self._stone[Team.TEAM_B] <= 0:
            return Team.TEAM_B
        return None

    def new_game(self) -> Game:
        """Start a new game within the match.

        Uses the current stone counts and advances the dealer.

        Returns:
            The new ``Game`` instance.

        Raises:
            GameError: If the current game is not complete, or if
                the match is already over.
        """
        if self._current_game is not None:
            if self._current_game.phase != Phase.COMPLETE:
                raise GameError("Current game is not complete.")

            # Archive the completed game
            self._games.append(self._current_game)

            # Sync stone from completed game
            self._stone = dict(self._current_game.state.stone)

            # Advance dealer
            self._next_dealer = next_seat(
                self._current_game.state.dealer
            )

        if self.is_complete():
            raise GameError("Match is already complete.")

        game = Game(
            dealer=self._next_dealer,
            stone=dict(self._stone),
            rng=self._rng,
            game_number=len(self._games) + 1,
        )
        self._current_game = game
        return game
