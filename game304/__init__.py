"""game304 — Python backend for the 304 card game.

A pure game-logic library implementing the 304 card game (a Sri Lankan
trick-taking game) with full support for bidding, trump selection,
trick play, caps, and match scoring.

Quick start:
    >>> from game304 import Game, Seat, BidAction, Card
    >>> game = Game(dealer=Seat.NORTH)
    >>> game.deal_four()
    >>> game.place_bid(Seat.WEST, BidAction.BET, 160)
"""

from game304.card import Card, hand_points
from game304.constants import (
    INITIAL_STONE,
    SCORING_TABLE,
    TOTAL_POINTS,
    ScoringEntry,
)
from game304.deck import Deck, create_pack
from game304.errors import (
    CapsError,
    GameError,
    InvalidBidError,
    InvalidPhaseError,
    InvalidPlayError,
    InvalidTrumpSelectionError,
    NotYourTurnError,
)
from game304.game import Game, Match
from game304.seating import (
    deal_order,
    next_seat,
    partner_seat,
    prev_seat,
    team_of,
)
from game304.state import (
    BiddingState,
    CapsCall,
    CapsObligation,
    CompletedRound,
    GameResult,
    GameState,
    PlayState,
    RoundEntry,
    TrumpState,
)
from game304.types import BidAction, Phase, Rank, Seat, Suit, Team

__all__ = [
    # Core types
    "Suit",
    "Rank",
    "Seat",
    "Team",
    "Phase",
    "BidAction",
    # Card and deck
    "Card",
    "Deck",
    "hand_points",
    "create_pack",
    # Game engine
    "Game",
    "Match",
    # State objects
    "GameState",
    "BiddingState",
    "TrumpState",
    "PlayState",
    "RoundEntry",
    "CompletedRound",
    "CapsCall",
    "CapsObligation",
    "GameResult",
    # Constants
    "INITIAL_STONE",
    "TOTAL_POINTS",
    "SCORING_TABLE",
    "ScoringEntry",
    # Seating helpers
    "next_seat",
    "prev_seat",
    "partner_seat",
    "deal_order",
    "team_of",
    # Errors
    "GameError",
    "InvalidPhaseError",
    "NotYourTurnError",
    "InvalidBidError",
    "InvalidPlayError",
    "InvalidTrumpSelectionError",
    "CapsError",
]
