"""Game state dataclasses for the 304 card game.

These mutable dataclasses represent the complete state of a game at any
point in time. The ``GameState`` is the root object, containing sub-states
for bidding, trump, and play. Engine modules read and mutate these
dataclasses directly; the ``Game`` orchestrator ensures mutations happen
in the correct order.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from game304.card import Card
from game304.constants import INITIAL_STONE
from game304.deck import Deck
from game304.types import BidAction, Phase, Seat, Suit, Team


# ---------------------------------------------------------------------------
# Bidding sub-state
# ---------------------------------------------------------------------------


@dataclass
class PlayerBidState:
    """Per-player bidding state within a single bidding phase.

    Attributes:
        speech_count: Number of times this player has spoken (bet,
            passed, or partnered).
        has_partnered: Whether this player has invoked the "partner"
            action.
        partner_used_by: If this player was asked to bid via "partner",
            the seat of the player who asked.
        skipped: Whether this player's normal turn was consumed by
            being called via "partner" earlier.
    """

    speech_count: int = 0
    has_partnered: bool = False
    partner_used_by: Seat | None = None
    skipped: bool = False


@dataclass
class Speech:
    """A single speech (action) recorded during bidding.

    Attributes:
        seat: The seat that took the action.
        action: The bidding action taken.
        value: The bid value (only for BET / BET_FOR_PARTNER actions).
        speech_number: Which speech this was for the player (1-indexed).
        on_behalf_of: If this was a partner action, the seat that
            was acting on behalf of another.
    """

    seat: Seat
    action: BidAction
    value: int | None = None
    speech_number: int = 1
    on_behalf_of: Seat | None = None


@dataclass
class PendingPartnerResponse:
    """Tracks a pending "partner" action awaiting the partner's response.

    Attributes:
        original_seat: The seat that said "partner".
        partner_seat: The partner who must now respond.
    """

    original_seat: Seat
    partner_seat: Seat


@dataclass
class BiddingState:
    """Complete state of a bidding phase (4-card or 8-card).

    Attributes:
        is_four_card: ``True`` for 4-card bidding, ``False`` for 8-card.
        current_bidder: The seat whose turn it is to bid.
        highest_bid: The current highest bid value (0 if no bids yet).
        highest_bidder: The seat holding the highest bid.
        consecutive_passes: Count of consecutive passes (3 ends bidding).
        speeches: Ordered list of all speeches made.
        player_state: Per-player bidding state.
        is_pcc: Whether a PCC bid has been placed.
        pending_partner: If a "partner" action is awaiting response.
        four_card_bid: Stored 4-card bid when transitioning to 8-card
            bidding (``None`` during 4-card phase).
        four_card_bidder: The seat that won 4-card bidding.
    """

    is_four_card: bool = True
    current_bidder: Seat = Seat.NORTH
    highest_bid: int = 0
    highest_bidder: Seat | None = None
    consecutive_passes: int = 0
    speeches: list[Speech] = field(default_factory=list)
    player_state: dict[Seat, PlayerBidState] = field(default_factory=dict)
    is_pcc: bool = False
    pending_partner: PendingPartnerResponse | None = None
    four_card_bid: int | None = None
    four_card_bidder: Seat | None = None


# ---------------------------------------------------------------------------
# Trump sub-state
# ---------------------------------------------------------------------------


@dataclass
class TrumpState:
    """State of the trump card and suit.

    Attributes:
        trumper_seat: The seat of the player who chose the trump card.
        trump_suit: The suit of the trump card.
        trump_card: The specific card placed face-down as the trump
            indicator. ``None`` once picked up.
        is_revealed: Whether the trump suit has been revealed to all
            players (by a face-down trump being played, or Open Trump).
        is_open: Whether the game is playing Open Trump (all cards
            face-up after declaration).
        trump_card_in_hand: Whether the trumper has picked up the
            trump card into their hand.
    """

    trumper_seat: Seat | None = None
    trump_suit: Suit | None = None
    trump_card: Card | None = None
    is_revealed: bool = False
    is_open: bool = False
    trump_card_in_hand: bool = False


# ---------------------------------------------------------------------------
# Play sub-state
# ---------------------------------------------------------------------------


@dataclass
class RoundEntry:
    """A single card played in a round.

    Attributes:
        seat: The player who played this card.
        card: The card that was played.
        face_down: Whether the card was played face-down (closed trump).
        revealed: Whether a face-down card has been revealed (because
            it was a trump card, triggering trump reveal).
    """

    seat: Seat
    card: Card
    face_down: bool = False
    revealed: bool = False


@dataclass
class CompletedRound:
    """Record of a completed round.

    Attributes:
        round_number: Which round this was (1–8).
        cards: The cards played in this round, in play order.
        winner: The seat that won this round.
        points_won: Total point value of cards in this round.
        trump_revealed: Whether trump was revealed during this round.
    """

    round_number: int
    cards: list[RoundEntry]
    winner: Seat
    points_won: int
    trump_revealed: bool = False


@dataclass
class CapsObligation:
    """Records when a player became obligated to call caps.

    Used for detecting late caps — if a player was obligated at an
    earlier point but only called later (or never called).

    The timing fields capture two views of the obligation moment so
    both **strict** and **lenient** timing policies can be evaluated
    (per ``docs/caps_formalism.md`` §8.3):

    - *Strict*: any subsequent observation event (any seat plays a
      card, any reveal) makes a later call late.
    - *Lenient*: the call is on-time up to and including ``V``'s next
      own-play turn — late only when ``V`` has played a card since
      obligation arose.

    Attributes:
        obligated_at_round: The round number when obligation arose.
        obligated_at_card: Number of cards played in the in-progress
            round at the obligation moment (any seat). Used by strict
            policy.
        v_plays_at_obligation: Total cards the obligated seat itself
            had played at the obligation moment (= completed rounds
            in which they played + 1 if they had already played in
            the current round). Used by lenient policy.
    """

    obligated_at_round: int
    obligated_at_card: int
    v_plays_at_obligation: int = 0


@dataclass
class CapsCall:
    """Records a caps call and its outcome.

    Attributes:
        called_by: The seat that called caps.
        called_at_round: The round when caps was called.
        play_order: The sequence of cards the caller claims will
            guarantee all remaining rounds.
        is_external: ``True`` if called by the non-trumping team.
        result: Outcome of the call — ``'correct'``, ``'late'``,
            or ``'wrong_early'``.
    """

    called_by: Seat
    called_at_round: int
    play_order: list[Card]
    is_external: bool = False
    result: str | None = None


@dataclass
class PlayState:
    """Complete state of the play phase (8 rounds of trick-taking).

    Attributes:
        round_number: Current round (1–8).
        priority: Seat with priority (leads the current round).
        current_turn: Seat whose turn it is to play a card.
        current_round: Cards played so far in the current round.
        completed_rounds: Records of all completed rounds.
        points_won: Points accumulated by each team.
        caps_call: If caps has been called, the details.
        caps_obligations: Tracked caps obligations per player.
    """

    round_number: int = 1
    priority: Seat | None = None
    current_turn: Seat | None = None
    current_round: list[RoundEntry] = field(default_factory=list)
    completed_rounds: list[CompletedRound] = field(default_factory=list)
    points_won: dict[Team, int] = field(
        default_factory=lambda: {Team.TEAM_A: 0, Team.TEAM_B: 0}
    )
    caps_call: CapsCall | None = None
    caps_obligations: dict[Seat, CapsObligation] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Game result
# ---------------------------------------------------------------------------


@dataclass
class GameResult:
    """Outcome of a completed game.

    Attributes:
        reason: Why the game ended. One of: ``'bid_met'``,
            ``'bid_failed'``, ``'pcc_won'``, ``'pcc_lost'``,
            ``'caps_correct'``, ``'caps_late'``, ``'caps_wrong'``,
            ``'external_caps'``, ``'spoilt_trumps'``,
            ``'absolute_hand'``.
        stone_exchanged: Number of stone changing hands.
        stone_direction: ``'give'`` (betting team gives stone, good
            for them), ``'receive'`` (betting team receives stone,
            bad for them), or ``'none'`` (no exchange).
        winner_team: The team that won, or ``None`` for void games.
        description: Human-readable description of the result.
        trumper_points: Points won by the trumper's team.
        opposition_points: Points won by the opposition.
        bid: The final bid value.
        caps_by: If caps was involved, who called it.
    """

    reason: str
    stone_exchanged: int
    stone_direction: str
    winner_team: Team | None
    description: str
    trumper_points: int | None = None
    opposition_points: int | None = None
    bid: int | None = None
    caps_by: Seat | None = None


# ---------------------------------------------------------------------------
# Root game state
# ---------------------------------------------------------------------------


@dataclass
class GameState:
    """Complete state of a single game of 304.

    This is the root state object that contains all sub-states. A new
    ``GameState`` is created for each game within a match.

    Attributes:
        game_number: The game number within the current match (1-indexed).
        dealer: The seat of the current dealer.
        phase: The current game phase.
        stone: Stone counts per team for the current match.
        hands: Cards held by each player.
        deck: The deck being dealt from.
        trump: Trump card/suit state.
        bidding: Current bidding phase state.
        play: Current play phase state.
        result: The game result (set when phase is COMPLETE).
        consecutive_reshuffles: How many consecutive reshuffles have
            occurred in this dealing sequence.
        pcc_partner_out: If PCC was bid, the seat of the partner who
            sits out.
    """

    game_number: int = 1
    dealer: Seat = Seat.NORTH
    phase: Phase = Phase.DEALING_4
    stone: dict[Team, int] = field(
        default_factory=lambda: {Team.TEAM_A: 10, Team.TEAM_B: 10}
    )
    hands: dict[Seat, list[Card]] = field(default_factory=dict)
    deck: Deck | None = None
    trump: TrumpState = field(default_factory=TrumpState)
    bidding: BiddingState | None = None
    play: PlayState | None = None
    result: GameResult | None = None
    consecutive_reshuffles: int = 0
    pcc_partner_out: Seat | None = None
