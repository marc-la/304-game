"""Deck management: creation, shuffling, cutting, and dealing.

The 304 pack consists of 32 cards (ranks 7–A in four suits). Shuffling
deliberately preserves partial card order from the previous game to
encourage higher bids — this is achieved via overhand-style shuffling
(1–4 partial passes). A full Fisher-Yates shuffle is used only after
three consecutive reshuffles (a house rule safety valve).
"""

from __future__ import annotations

import random

from game304.card import Card
from game304.seating import deal_order
from game304.types import Rank, Seat, Suit


def create_pack() -> list[Card]:
    """Create a fresh 32-card pack in standard order.

    Cards are ordered by suit (Clubs, Diamonds, Hearts, Spades),
    then by rank within each suit (J, 9, A, 10, K, Q, 8, 7).

    Returns:
        A list of 32 ``Card`` instances.
    """
    return [Card(rank, suit) for suit in Suit for rank in Rank]


class Deck:
    """A mutable deck of cards with shuffle, cut, and deal operations.

    All randomness is routed through an injectable ``random.Random``
    instance, making the deck fully deterministic when seeded. This
    is critical for reproducible tests.

    Args:
        cards: Initial cards in the deck. If ``None``, a fresh
            32-card pack is created.
        rng: Random number generator. Defaults to an unseeded
            ``random.Random()`` if not provided.

    Examples:
        >>> deck = Deck(rng=random.Random(42))
        >>> deck.minimal_shuffle()
        >>> hands = deck.deal(Seat.NORTH, 4)
        >>> len(hands[Seat.WEST])  # first to receive
        4
    """

    def __init__(
        self,
        cards: list[Card] | None = None,
        rng: random.Random | None = None,
    ) -> None:
        self._cards: list[Card] = cards if cards is not None else create_pack()
        self._rng: random.Random = rng if rng is not None else random.Random()

    @property
    def cards(self) -> list[Card]:
        """The current ordered list of cards in the deck."""
        return self._cards

    def __len__(self) -> int:
        return len(self._cards)

    # ------------------------------------------------------------------
    # Shuffling
    # ------------------------------------------------------------------

    def overhand_shuffle(self) -> None:
        """Perform a single overhand-style partial shuffle.

        Splits the deck into random chunks of 2–6 cards from the top
        and prepends each chunk to a result pile. This mimics a real
        overhand shuffle, preserving some card adjacency.

        Per the rules: "Minimal shuffling is key — this preserves the
        order of cards from the previous game to encourage high-value
        betting."
        """
        result: list[Card] = []
        remaining = list(self._cards)
        while remaining:
            chunk_size = min(
                2 + self._rng.randint(0, 4),
                len(remaining),
            )
            chunk = remaining[:chunk_size]
            remaining = remaining[chunk_size:]
            # Prepend chunk to result (place on top)
            result = chunk + result
        self._cards = result

    def minimal_shuffle(self) -> None:
        """Perform 1–4 overhand shuffles (minimal shuffling per rules).

        The number of passes is chosen randomly. This preserves
        partial card order from the previous game.
        """
        num_passes = 1 + self._rng.randint(0, 3)
        for _ in range(num_passes):
            self.overhand_shuffle()

    def full_shuffle(self) -> None:
        """Perform a Fisher-Yates shuffle (complete randomisation).

        Used after 3 consecutive reshuffles to reset the pack
        (house rule). This destroys all card-order information.
        """
        self._rng.shuffle(self._cards)

    # ------------------------------------------------------------------
    # Cutting
    # ------------------------------------------------------------------

    def cut(self) -> None:
        """Cut the deck at a random point.

        The cut point is chosen uniformly between index 1 and
        ``len - 2`` (inclusive), ensuring at least one card remains
        on each side.

        Per the rules: "The player to the left of the dealer may cut
        the pack once, or tap the top of the deck to decline the cut."
        """
        if len(self._cards) < 3:
            return
        cut_point = 1 + self._rng.randint(0, len(self._cards) - 3)
        self._cards = self._cards[cut_point:] + self._cards[:cut_point]

    # ------------------------------------------------------------------
    # Dealing
    # ------------------------------------------------------------------

    def deal(self, dealer: Seat, num_cards: int) -> dict[Seat, list[Card]]:
        """Deal cards from the top of the deck to each player.

        Cards are dealt one at a time in anticlockwise order, starting
        with the player to the dealer's right. Each player receives
        ``num_cards`` cards. Dealt cards are removed from the deck.

        Per the rules: "The dealer then deals the top 4 cards to the
        player on their right, then 4 to the next player
        (anticlockwise), and so on."

        Note: The JS implementation deals all ``num_cards`` to each
        player before moving to the next. The rules say "the top 4
        cards to the player on their right, then 4 to the next" which
        means each player gets a batch, not interleaved. We follow the
        JS implementation's batched dealing approach.

        Args:
            dealer: The seat of the dealer.
            num_cards: Number of cards to deal to each player.

        Returns:
            A dict mapping each ``Seat`` to their dealt cards.

        Raises:
            ValueError: If there aren't enough cards in the deck.
        """
        total_needed = num_cards * 4
        if len(self._cards) < total_needed:
            raise ValueError(
                f"Not enough cards to deal: need {total_needed}, "
                f"have {len(self._cards)}"
            )

        order = deal_order(dealer)
        hands: dict[Seat, list[Card]] = {seat: [] for seat in order}

        for _ in range(num_cards):
            for seat in order:
                hands[seat].append(self._cards.pop(0))

        return hands
