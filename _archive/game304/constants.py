"""Game constants, scoring tables, and thresholds for 304.

All numeric constants governing bidding, scoring, reshuffles, and
match progression are defined here. Lobby-related constants (codes,
heartbeats, avatars) are omitted as they are not part of the core
game logic.
"""

from dataclasses import dataclass

from game304.types import Rank


# ---------------------------------------------------------------------------
# Point values per rank
# ---------------------------------------------------------------------------

POINT_VALUES: dict[Rank, int] = {
    Rank.JACK: 30,
    Rank.NINE: 20,
    Rank.ACE: 11,
    Rank.TEN: 10,
    Rank.KING: 3,
    Rank.QUEEN: 2,
    Rank.EIGHT: 0,
    Rank.SEVEN: 0,
}

TOTAL_POINTS: int = 304

# ---------------------------------------------------------------------------
# Bidding thresholds and increments
# ---------------------------------------------------------------------------

MIN_BID_4_CARD: int = 160
"""Minimum opening bid on 4 cards."""

MIN_BID_8_CARD: int = 220
"""Minimum opening bid on 8 cards (called 'Honest')."""

THRESHOLD_4_CARD: int = 200
"""After first speech on 4-card bidding, minimum bid becomes this."""

THRESHOLD_8_CARD: int = 250
"""After first speech on 8-card bidding, minimum bid becomes this."""

INCREMENT_BELOW_200: int = 10
"""Bid increment for bids below 200."""

INCREMENT_200_PLUS: int = 5
"""Bid increment for bids of 200 and above."""

PCC_BID_VALUE: int = 999
"""Sentinel value representing a PCC bid (always highest)."""

# ---------------------------------------------------------------------------
# Reshuffle and redeal thresholds
# ---------------------------------------------------------------------------

RESHUFFLE_POINT_THRESHOLD: int = 15
"""4-card hand must have fewer than this many points to reshuffle."""

REDEAL_POINT_THRESHOLD: int = 25
"""8-card hand must have fewer than this many points to redeal."""

MAX_CONSECUTIVE_RESHUFFLES: int = 3
"""After this many consecutive reshuffles, a full shuffle is performed."""

# ---------------------------------------------------------------------------
# Match scoring
# ---------------------------------------------------------------------------

INITIAL_STONE: int = 10
"""Each team begins a match with this many stone."""

WRONG_CAPS_PENALTY: int = 5
"""Stone penalty for calling caps incorrectly or too early."""


@dataclass(frozen=True, slots=True)
class ScoringEntry:
    """A row in the scoring table.

    Attributes:
        win: Stone given by the betting team when the bid is met.
        loss: Stone received by the betting team when the bid is not met.
        name: Common spoken name for this bid level.
    """

    win: int
    loss: int
    name: str


SCORING_TABLE: dict[int, ScoringEntry] = {
    160: ScoringEntry(win=1, loss=2, name="60"),
    170: ScoringEntry(win=1, loss=2, name="70"),
    180: ScoringEntry(win=1, loss=2, name="80"),
    190: ScoringEntry(win=1, loss=2, name="90"),
    200: ScoringEntry(win=2, loss=3, name="100"),
    205: ScoringEntry(win=2, loss=3, name="105"),
    210: ScoringEntry(win=2, loss=3, name="110"),
    215: ScoringEntry(win=2, loss=3, name="115"),
    220: ScoringEntry(win=2, loss=3, name="Honest"),
    225: ScoringEntry(win=2, loss=3, name="Honest 5"),
    230: ScoringEntry(win=2, loss=3, name="Honest 10"),
    235: ScoringEntry(win=2, loss=3, name="Honest 15"),
    240: ScoringEntry(win=2, loss=3, name="Honest 20"),
    245: ScoringEntry(win=2, loss=3, name="Honest 25"),
    250: ScoringEntry(win=3, loss=4, name="250"),
}

PCC_SCORING: ScoringEntry = ScoringEntry(win=5, loss=5, name="PCC")
"""Scoring for Partner Closed Caps — 5 stone win or 5 stone loss."""
