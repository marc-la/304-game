"""Tests for bidding logic."""

import random

import pytest

from game304 import (
    BidAction,
    Game,
    InvalidBidError,
    InvalidPhaseError,
    NotYourTurnError,
    Phase,
    Seat,
)


def make_game_at_betting_4(seed=42):
    """Create a game that has been dealt and is ready for 4-card betting."""
    game = Game(dealer=Seat.NORTH, rng=random.Random(seed))
    game.deal_four()
    return game


class TestBidValidation:
    def test_minimum_bid_160(self):
        game = make_game_at_betting_4()
        # First bidder is West (right of North)
        assert game.whose_turn() == Seat.WEST
        game.place_bid(Seat.WEST, BidAction.BET, 160)

    def test_bid_below_minimum_rejected(self):
        game = make_game_at_betting_4()
        with pytest.raises(InvalidBidError):
            game.place_bid(Seat.WEST, BidAction.BET, 150)

    def test_bid_increment_10_below_200(self):
        game = make_game_at_betting_4()
        game.place_bid(Seat.WEST, BidAction.BET, 160)
        game.place_bid(Seat.SOUTH, BidAction.BET, 170)
        # 165 is not a valid increment of 10
        with pytest.raises(InvalidBidError):
            game.place_bid(Seat.EAST, BidAction.BET, 165)

    def test_wrong_turn_rejected(self):
        game = make_game_at_betting_4()
        with pytest.raises(NotYourTurnError):
            game.place_bid(Seat.SOUTH, BidAction.BET, 160)

    def test_wrong_phase_rejected(self):
        game = Game(dealer=Seat.NORTH)
        # Still in DEALING_4
        with pytest.raises(InvalidPhaseError):
            game.place_bid(Seat.WEST, BidAction.BET, 160)


class TestBiddingFlow:
    def test_three_passes_end_bidding(self):
        game = make_game_at_betting_4()
        game.place_bid(Seat.WEST, BidAction.BET, 160)
        game.place_bid(Seat.SOUTH, BidAction.PASS)
        game.place_bid(Seat.EAST, BidAction.PASS)
        game.place_bid(Seat.NORTH, BidAction.PASS)
        assert game.phase == Phase.TRUMP_SELECTION

    def test_all_pass_triggers_redeal(self):
        game = make_game_at_betting_4()
        game.place_bid(Seat.WEST, BidAction.PASS)
        game.place_bid(Seat.SOUTH, BidAction.PASS)
        game.place_bid(Seat.EAST, BidAction.PASS)
        game.place_bid(Seat.NORTH, BidAction.PASS)
        # All 4 players passed = redeal
        assert game.phase == Phase.DEALING_4
        # Dealer advances anticlockwise
        assert game.state.dealer == Seat.WEST

    def test_bid_below_200_only_on_first_speech(self):
        game = make_game_at_betting_4()
        game.place_bid(Seat.WEST, BidAction.BET, 160)
        game.place_bid(Seat.SOUTH, BidAction.BET, 170)
        game.place_bid(Seat.EAST, BidAction.PASS)
        game.place_bid(Seat.NORTH, BidAction.PASS)
        # West has spoken before — minimum is now 200
        with pytest.raises(InvalidBidError):
            game.place_bid(Seat.WEST, BidAction.BET, 180)
        # 200 should work
        game.place_bid(Seat.WEST, BidAction.BET, 200)


class TestPartnerAction:
    def test_partner_action(self):
        game = make_game_at_betting_4()
        # West says "partner" — East (West's partner) bids on West's behalf
        game.place_bid(Seat.WEST, BidAction.PARTNER)
        assert game.whose_turn() == Seat.EAST  # partner bids
        game.place_bid(Seat.EAST, BidAction.BET, 160)
        # East's own turn later is skipped; next is North
        # (South → East(skipped) → North)
        assert game.whose_turn() == Seat.SOUTH

    def test_partner_pass(self):
        game = make_game_at_betting_4()
        game.place_bid(Seat.WEST, BidAction.PARTNER)
        assert game.whose_turn() == Seat.EAST
        game.place_bid(Seat.EAST, BidAction.PASS)
        # Next after East's response: South → East(skipped) → ...
        assert game.whose_turn() == Seat.SOUTH
