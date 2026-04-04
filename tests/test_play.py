"""Tests for card play and round resolution."""

from game304 import Card, Rank, Suit
from game304.play import resolve_round
from game304.state import RoundEntry
from game304.types import Seat


class TestResolveRound:
    def test_highest_led_suit_wins(self):
        """When no trump is played, highest card of led suit wins."""
        cards = [
            RoundEntry(Seat.NORTH, Card(Rank.SEVEN, Suit.CLUBS)),
            RoundEntry(Seat.WEST, Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(Seat.SOUTH, Card(Rank.NINE, Suit.CLUBS)),
            RoundEntry(Seat.EAST, Card(Rank.ACE, Suit.CLUBS)),
        ]
        winner, pts, trump_found, revealed = resolve_round(
            cards, Suit.HEARTS, True
        )
        assert winner == Seat.WEST  # Jack is highest
        assert pts == 30 + 20 + 11 + 0  # J + 9 + A + 7
        assert not trump_found

    def test_trump_beats_led_suit(self):
        """A trump card (even the lowest) beats the led suit."""
        cards = [
            RoundEntry(Seat.NORTH, Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(Seat.WEST, Card(Rank.SEVEN, Suit.HEARTS)),  # trump
            RoundEntry(Seat.SOUTH, Card(Rank.NINE, Suit.CLUBS)),
            RoundEntry(Seat.EAST, Card(Rank.ACE, Suit.CLUBS)),
        ]
        winner, pts, trump_found, revealed = resolve_round(
            cards, Suit.HEARTS, True
        )
        assert winner == Seat.WEST  # 7 of trump beats all clubs

    def test_highest_trump_wins_overcut(self):
        """When multiple trumps are played, the highest wins."""
        cards = [
            RoundEntry(Seat.NORTH, Card(Rank.ACE, Suit.CLUBS)),
            RoundEntry(Seat.WEST, Card(Rank.SEVEN, Suit.HEARTS)),  # trump
            RoundEntry(Seat.SOUTH, Card(Rank.NINE, Suit.HEARTS)),  # trump (higher)
            RoundEntry(Seat.EAST, Card(Rank.KING, Suit.CLUBS)),
        ]
        winner, pts, trump_found, revealed = resolve_round(
            cards, Suit.HEARTS, True
        )
        assert winner == Seat.SOUTH  # 9 of trump beats 7 of trump

    def test_face_down_trump_reveals_and_wins(self):
        """In closed trump, face-down trump cards are revealed and win."""
        cards = [
            RoundEntry(Seat.NORTH, Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(Seat.WEST, Card(Rank.NINE, Suit.HEARTS), face_down=True),  # trump cut
            RoundEntry(Seat.SOUTH, Card(Rank.ACE, Suit.CLUBS)),
            RoundEntry(Seat.EAST, Card(Rank.KING, Suit.CLUBS)),
        ]
        winner, pts, trump_found, revealed = resolve_round(
            cards, Suit.HEARTS, False
        )
        assert winner == Seat.WEST
        assert trump_found
        assert Card(Rank.NINE, Suit.HEARTS) in revealed

    def test_face_down_non_trump_stays_hidden(self):
        """Face-down cards that are not trump don't win."""
        cards = [
            RoundEntry(Seat.NORTH, Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(Seat.WEST, Card(Rank.NINE, Suit.DIAMONDS), face_down=True),  # wrong suit
            RoundEntry(Seat.SOUTH, Card(Rank.ACE, Suit.CLUBS)),
            RoundEntry(Seat.EAST, Card(Rank.KING, Suit.CLUBS)),
        ]
        winner, pts, trump_found, revealed = resolve_round(
            cards, Suit.HEARTS, False
        )
        assert winner == Seat.NORTH  # Jack of led suit
        assert not trump_found
        assert revealed == []

    def test_all_points_counted_including_face_down(self):
        """All cards contribute points, even face-down ones."""
        cards = [
            RoundEntry(Seat.NORTH, Card(Rank.JACK, Suit.CLUBS)),     # 30
            RoundEntry(Seat.WEST, Card(Rank.NINE, Suit.HEARTS), face_down=True),  # 20 (face down)
            RoundEntry(Seat.SOUTH, Card(Rank.SEVEN, Suit.CLUBS)),    # 0
            RoundEntry(Seat.EAST, Card(Rank.EIGHT, Suit.CLUBS)),     # 0
        ]
        _, pts, _, _ = resolve_round(cards, Suit.HEARTS, False)
        assert pts == 50  # 30 + 20 + 0 + 0
