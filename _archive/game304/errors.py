"""Custom exception hierarchy for 304 game errors.

All game-logic errors inherit from ``GameError``. Callers can catch
``GameError`` for any game-related issue, or catch specific subclasses
for finer control.
"""


class GameError(Exception):
    """Base exception for all 304 game errors."""


class InvalidPhaseError(GameError):
    """Raised when an action is attempted in the wrong game phase."""


class NotYourTurnError(GameError):
    """Raised when a player attempts to act out of turn."""


class InvalidBidError(GameError):
    """Raised when a bid violates bidding rules.

    This covers: bid below minimum, wrong increment, undercutting
    partner, bidding after partnering restrictions, etc.
    """


class InvalidPlayError(GameError):
    """Raised when a card play violates the rules.

    This covers: not following suit, playing the trump card illegally,
    leading trump on the first round in closed trump, etc.
    """


class InvalidTrumpSelectionError(GameError):
    """Raised when trump selection violates the rules.

    This covers: selecting a card not in hand, non-trumper selecting,
    selecting after the wrong phase, etc.
    """


class CapsError(GameError):
    """Raised for caps-related errors.

    This covers: calling caps incorrectly, calling caps when not
    possible, wrong play order, etc.
    """
