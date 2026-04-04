"""Tests for deck operations: creation, shuffling, cutting, dealing."""

import random

from game304 import Card, Deck, Seat, create_pack, hand_points


class TestCreatePack:
    def test_pack_has_32_cards(self):
        assert len(create_pack()) == 32

    def test_pack_has_unique_cards(self):
        pack = create_pack()
        assert len(set(pack)) == 32

    def test_pack_totals_304(self):
        assert hand_points(create_pack()) == 304


class TestDeckShuffle:
    def test_deterministic_with_seed(self):
        d1 = Deck(rng=random.Random(42))
        d1.minimal_shuffle()
        d2 = Deck(rng=random.Random(42))
        d2.minimal_shuffle()
        assert d1.cards == d2.cards

    def test_shuffle_preserves_cards(self):
        d = Deck(rng=random.Random(1))
        original = set(d.cards)
        d.minimal_shuffle()
        assert set(d.cards) == original

    def test_full_shuffle_preserves_cards(self):
        d = Deck(rng=random.Random(1))
        original = set(d.cards)
        d.full_shuffle()
        assert set(d.cards) == original

    def test_shuffle_changes_order(self):
        """Shuffling should (almost certainly) change the order."""
        d = Deck(rng=random.Random(42))
        original = list(d.cards)
        d.minimal_shuffle()
        assert d.cards != original


class TestDeckCut:
    def test_cut_preserves_cards(self):
        d = Deck(rng=random.Random(1))
        original = set(d.cards)
        d.cut()
        assert set(d.cards) == original

    def test_cut_changes_order(self):
        d = Deck(rng=random.Random(42))
        original = list(d.cards)
        d.cut()
        assert d.cards != original


class TestDeckDeal:
    def test_deal_four_cards_each(self):
        d = Deck(rng=random.Random(42))
        d.minimal_shuffle()
        hands = d.deal(Seat.NORTH, 4)
        assert all(len(h) == 4 for h in hands.values())
        assert len(d) == 16

    def test_deal_all_cards(self):
        d = Deck(rng=random.Random(42))
        d.minimal_shuffle()
        h1 = d.deal(Seat.NORTH, 4)
        h2 = d.deal(Seat.NORTH, 4)
        assert len(d) == 0
        all_cards = []
        for h in [h1, h2]:
            for cards in h.values():
                all_cards.extend(cards)
        assert len(set(all_cards)) == 32

    def test_deal_order_starts_right_of_dealer(self):
        """Dealer=North -> first to receive is West (right of North)."""
        d = Deck(rng=random.Random(42))
        hands = d.deal(Seat.NORTH, 1)
        # West should get the first card (top of deck)
        assert Seat.WEST in hands
        assert len(hands[Seat.WEST]) == 1
