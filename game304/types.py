"""Enumerations for the 304 card game.

Defines all enum types used throughout the game: suits, ranks, seats,
teams, game phases, and bidding actions.
"""

from enum import Enum


class Suit(Enum):
    """Card suits.

    The four standard suits. In 304, all suits are treated equally
    except the trump suit, which beats all others.
    """

    CLUBS = "c"
    DIAMONDS = "d"
    HEARTS = "h"
    SPADES = "s"


class Rank(Enum):
    """Card ranks ordered by power (highest to lowest).

    In 304, the rank order differs from standard card games:
    J > 9 > A > 10 > K > Q > 8 > 7.

    The ``power`` of a rank is its zero-based index in this ordering,
    so Jack has power 0 (strongest) and Seven has power 7 (weakest).
    """

    JACK = "J"
    NINE = "9"
    ACE = "A"
    TEN = "10"
    KING = "K"
    QUEEN = "Q"
    EIGHT = "8"
    SEVEN = "7"


# Rank power: lower number = higher power
RANK_POWER: dict[Rank, int] = {rank: i for i, rank in enumerate(Rank)}


class Seat(Enum):
    """Player seats at the table.

    Arranged anticlockwise: North -> West -> South -> East.
    Partners sit opposite: North/South (Team A) and East/West (Team B).
    """

    NORTH = "north"
    WEST = "west"
    SOUTH = "south"
    EAST = "east"


class Team(Enum):
    """The two partnerships.

    Team A: North and South (seated opposite).
    Team B: East and West (seated opposite).
    """

    TEAM_A = "team_a"
    TEAM_B = "team_b"


class Phase(Enum):
    """Sequential phases of a single game.

    A game proceeds through these phases in order:
    DEALING_4 -> BETTING_4 -> TRUMP_SELECTION -> DEALING_8 -> BETTING_8
    -> PRE_PLAY -> PLAYING -> ROUND_RESOLUTION -> SCRUTINY -> COMPLETE
    """

    DEALING_4 = "dealing_4"
    BETTING_4 = "betting_4"
    TRUMP_SELECTION = "trump_selection"
    DEALING_8 = "dealing_8"
    BETTING_8 = "betting_8"
    PRE_PLAY = "pre_play"
    PLAYING = "playing"
    ROUND_RESOLUTION = "round_resolution"
    SCRUTINY = "scrutiny"
    COMPLETE = "complete"


class BidAction(Enum):
    """Actions a player can take during the bidding phase.

    BET: Place a numeric bid higher than the current highest.
    PASS: Decline to bid. Counts as a speech.
    PARTNER: Ask your partner to bid in your place. Both players
        consume a speech; the partner may then BET_FOR_PARTNER
        or PASS_FOR_PARTNER.
    BET_FOR_PARTNER: The partner's bet placed on behalf of the
        original player who said "partner".
    PASS_FOR_PARTNER: The partner's pass on behalf of the original
        player who said "partner".
    PCC: Partner Closed Caps — the highest possible bid. Only
        available on 8-card betting. The trumper's partner sits out.
    """

    BET = "bet"
    PASS = "pass"
    PARTNER = "partner"
    BET_FOR_PARTNER = "bet_for_partner"
    PASS_FOR_PARTNER = "pass_for_partner"
    PCC = "pcc"
