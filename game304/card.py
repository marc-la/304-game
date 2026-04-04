"""Card representation for the 304 card game.

Provides the ``Card`` class — a frozen dataclass that is hashable,
comparable within suit, and self-describing. Cards are the fundamental
unit of the game; 32 of them (ranks 7–A in four suits) form the pack.
"""

from __future__ import annotations

from dataclasses import dataclass
from game304.constants import POINT_VALUES
from game304.types import RANK_POWER, Rank, Suit


@dataclass(frozen=True, slots=True)
class Card:
    """An immutable playing card with a rank and suit.

    Cards are hashable and can be used in sets and as dict keys.
    The ``power`` property gives the rank's strength (lower = stronger),
    and ``points`` gives the card's point value in 304.

    Examples:
        >>> c = Card(Rank.JACK, Suit.CLUBS)
        >>> c.points
        30
        >>> c.power
        0
        >>> str(c)
        'Jc'
        >>> Card.from_str("10d")
        Card(rank=<Rank.TEN: '10'>, suit=<Suit.DIAMONDS: 'd'>)
    """

    rank: Rank
    suit: Suit

    @property
    def points(self) -> int:
        """Point value of this card (J=30, 9=20, A=11, 10=10, K=3, Q=2, 8=0, 7=0)."""
        return POINT_VALUES[self.rank]

    @property
    def power(self) -> int:
        """Rank power index. Lower is stronger (Jack=0, Seven=7)."""
        return RANK_POWER[self.rank]

    def beats(self, other: Card, led_suit: Suit, trump_suit: Suit | None) -> bool:
        """Whether this card beats ``other`` in a round.

        Rules for determining which card wins:
        1. A trump card beats any non-trump card.
        2. Among trump cards, the higher-powered card wins.
        3. Among cards of the led suit (when no trump is involved),
           the higher-powered card wins.
        4. A non-trump, non-led-suit card cannot beat anything.

        Args:
            other: The card to compare against.
            led_suit: The suit that was led in this round.
            trump_suit: The trump suit, or ``None`` if no trump.

        Returns:
            ``True`` if this card beats ``other``.
        """
        self_is_trump = trump_suit is not None and self.suit == trump_suit
        other_is_trump = trump_suit is not None and other.suit == trump_suit

        if self_is_trump and not other_is_trump:
            return True
        if not self_is_trump and other_is_trump:
            return False
        if self_is_trump and other_is_trump:
            return self.power < other.power
        # Neither is trump — only led-suit cards can win
        if self.suit == led_suit and other.suit != led_suit:
            return True
        if self.suit != led_suit and other.suit == led_suit:
            return False
        if self.suit == led_suit and other.suit == led_suit:
            return self.power < other.power
        # Both are off-suit, non-trump — neither beats the other
        return False

    @classmethod
    def from_str(cls, s: str) -> Card:
        """Parse a card from its string encoding (e.g. ``'Jc'``, ``'10d'``).

        The encoding is ``rank + suit_initial``, where ranks are
        ``J, 9, A, 10, K, Q, 8, 7`` and suit initials are
        ``c, d, h, s``.

        Args:
            s: The card string to parse.

        Returns:
            The corresponding ``Card`` instance.

        Raises:
            ValueError: If the string cannot be parsed as a valid card.
        """
        if len(s) == 3 and s.startswith("10"):
            rank_str, suit_str = "10", s[2]
        elif len(s) == 2:
            rank_str, suit_str = s[0], s[1]
        else:
            raise ValueError(f"Cannot parse card string: {s!r}")

        try:
            rank = Rank(rank_str)
        except ValueError:
            raise ValueError(f"Unknown rank: {rank_str!r} in card string {s!r}")
        try:
            suit = Suit(suit_str)
        except ValueError:
            raise ValueError(f"Unknown suit: {suit_str!r} in card string {s!r}")

        return cls(rank, suit)

    def __str__(self) -> str:
        """String encoding of the card (e.g. ``'Jc'``, ``'10d'``)."""
        return f"{self.rank.value}{self.suit.value}"

    def __repr__(self) -> str:
        return f"Card({self.rank.value}{self.suit.value})"


def hand_points(cards: list[Card]) -> int:
    """Sum the point values of a list of cards.

    Args:
        cards: A list of ``Card`` instances.

    Returns:
        The total point value.
    """
    return sum(c.points for c in cards)
