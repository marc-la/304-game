"""Tests for the Card class, point values, and comparison logic."""

import pytest

from game304 import Card, Rank, Suit, hand_points


class TestCardCreation:
    def test_from_str_two_char(self):
        c = Card.from_str("Jc")
        assert c.rank == Rank.JACK
        assert c.suit == Suit.CLUBS

    def test_from_str_three_char(self):
        c = Card.from_str("10d")
        assert c.rank == Rank.TEN
        assert c.suit == Suit.DIAMONDS

    def test_from_str_all_ranks(self):
        for rank_str, rank in [
            ("J", Rank.JACK), ("9", Rank.NINE), ("A", Rank.ACE),
            ("10", Rank.TEN), ("K", Rank.KING), ("Q", Rank.QUEEN),
            ("8", Rank.EIGHT), ("7", Rank.SEVEN),
        ]:
            c = Card.from_str(f"{rank_str}c")
            assert c.rank == rank

    def test_from_str_invalid(self):
        with pytest.raises(ValueError):
            Card.from_str("XX")
        with pytest.raises(ValueError):
            Card.from_str("J")  # missing suit

    def test_str_roundtrip(self):
        for s in ["Jc", "9d", "Ah", "10s", "Ks", "Qh", "8d", "7c"]:
            assert str(Card.from_str(s)) == s

    def test_frozen(self):
        c = Card(Rank.JACK, Suit.CLUBS)
        with pytest.raises(AttributeError):
            c.rank = Rank.NINE

    def test_hashable(self):
        c1 = Card(Rank.JACK, Suit.CLUBS)
        c2 = Card(Rank.JACK, Suit.CLUBS)
        assert c1 == c2
        assert hash(c1) == hash(c2)
        assert len({c1, c2}) == 1


class TestCardPoints:
    def test_point_values(self):
        assert Card(Rank.JACK, Suit.CLUBS).points == 30
        assert Card(Rank.NINE, Suit.HEARTS).points == 20
        assert Card(Rank.ACE, Suit.SPADES).points == 11
        assert Card(Rank.TEN, Suit.DIAMONDS).points == 10
        assert Card(Rank.KING, Suit.CLUBS).points == 3
        assert Card(Rank.QUEEN, Suit.HEARTS).points == 2
        assert Card(Rank.EIGHT, Suit.SPADES).points == 0
        assert Card(Rank.SEVEN, Suit.DIAMONDS).points == 0

    def test_hand_points(self):
        hand = [
            Card(Rank.JACK, Suit.CLUBS),   # 30
            Card(Rank.NINE, Suit.CLUBS),   # 20
            Card(Rank.ACE, Suit.CLUBS),    # 11
            Card(Rank.SEVEN, Suit.HEARTS), # 0
        ]
        assert hand_points(hand) == 61

    def test_total_pack_points(self):
        """All 32 cards in the pack total 304 points."""
        from game304 import create_pack
        assert hand_points(create_pack()) == 304


class TestCardPower:
    def test_power_ordering(self):
        """Jack has the lowest power index (strongest), Seven the highest."""
        assert Card(Rank.JACK, Suit.CLUBS).power == 0
        assert Card(Rank.SEVEN, Suit.CLUBS).power == 7

    def test_jack_is_strongest(self):
        assert Card(Rank.JACK, Suit.CLUBS).power < Card(Rank.NINE, Suit.CLUBS).power
        assert Card(Rank.JACK, Suit.CLUBS).power < Card(Rank.ACE, Suit.CLUBS).power


class TestCardBeats:
    def test_same_suit_higher_power_wins(self):
        j = Card(Rank.JACK, Suit.CLUBS)
        nine = Card(Rank.NINE, Suit.CLUBS)
        assert j.beats(nine, Suit.CLUBS, None)
        assert not nine.beats(j, Suit.CLUBS, None)

    def test_trump_beats_non_trump(self):
        trump_7 = Card(Rank.SEVEN, Suit.HEARTS)
        non_trump_j = Card(Rank.JACK, Suit.CLUBS)
        assert trump_7.beats(non_trump_j, Suit.CLUBS, Suit.HEARTS)
        assert not non_trump_j.beats(trump_7, Suit.CLUBS, Suit.HEARTS)

    def test_off_suit_cannot_beat(self):
        """A non-trump, non-led-suit card cannot beat anything."""
        off = Card(Rank.JACK, Suit.DIAMONDS)
        led = Card(Rank.SEVEN, Suit.CLUBS)
        assert not off.beats(led, Suit.CLUBS, Suit.HEARTS)

    def test_no_trump_suit(self):
        """When trump_suit is None, only led-suit cards compete."""
        j = Card(Rank.JACK, Suit.CLUBS)
        nine = Card(Rank.NINE, Suit.CLUBS)
        assert j.beats(nine, Suit.CLUBS, None)
