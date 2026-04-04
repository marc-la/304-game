"""Integration tests for the Game orchestrator."""

import random

import pytest

from game304 import (
    BidAction,
    Card,
    Game,
    InvalidPhaseError,
    Match,
    Phase,
    Seat,
    Team,
)


def play_full_game(game: Game) -> None:
    """Helper to play a full game with simple strategy.

    First bidder bids 160, rest pass. Trumper picks first card.
    All pass on 8 cards. Closed trump. Play first valid card each round.
    """
    # Deal
    game.deal_four()

    # 4-card bidding
    first = game.whose_turn()
    game.place_bid(first, BidAction.BET, 160)
    for _ in range(3):
        game.place_bid(game.whose_turn(), BidAction.PASS)

    # Trump selection
    trumper = game.whose_turn()
    hand = game.get_hand(trumper)
    game.select_trump(trumper, hand[0])

    # 8-card bidding (all pass)
    for _ in range(3):
        game.place_bid(game.whose_turn(), BidAction.PASS)

    # Proceed closed trump
    game.proceed_closed_trump(game.state.trump.trumper_seat)

    # Play 8 rounds
    while game.phase == Phase.PLAYING:
        current = game.whose_turn()
        valid = game.valid_plays(current)
        assert valid, f"No valid plays for {current}"
        game.play_card(current, valid[0])


class TestGameLifecycle:
    def test_full_game_completes(self):
        game = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(game)
        assert game.phase == Phase.COMPLETE
        assert game.state.result is not None

    def test_deal_requires_correct_phase(self):
        game = Game(dealer=Seat.NORTH, rng=random.Random(42))
        game.deal_four()
        with pytest.raises(InvalidPhaseError):
            game.deal_four()  # already dealt

    def test_stone_changes_after_game(self):
        game = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(game)
        stone = game.state.stone
        total = stone[Team.TEAM_A] + stone[Team.TEAM_B]
        # Stone is always conserved: 20 total, or 20 +/- win/loss
        # Actually stone is not conserved — it's given or received
        # by the betting team only
        assert stone[Team.TEAM_A] != 10 or stone[Team.TEAM_B] != 10

    def test_result_reason_is_valid(self):
        game = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(game)
        assert game.state.result.reason in (
            "bid_met", "bid_failed", "pcc_won", "pcc_lost",
            "caps_correct", "caps_late", "caps_wrong",
            "external_caps", "spoilt_trumps", "absolute_hand",
        )


class TestDeterminism:
    def test_same_seed_same_result(self):
        """Two games with the same seed produce identical results."""
        game1 = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(game1)
        game2 = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(game2)
        assert game1.state.result.reason == game2.state.result.reason
        assert game1.state.stone == game2.state.stone


class TestMatchLifecycle:
    def test_match_plays_multiple_games(self):
        match = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        for _ in range(5):
            if match.is_complete():
                break
            game = match.new_game()
            play_full_game(game)
        assert len(match.games) >= 1

    def test_match_cannot_start_game_when_incomplete(self):
        match = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        game = match.new_game()
        game.deal_four()  # started but not complete
        from game304.errors import GameError
        with pytest.raises(GameError):
            match.new_game()


class TestReshuffle:
    def test_reshuffle_same_dealer(self):
        """After a reshuffle, the same dealer deals again."""
        # Try seeds until we find one where the priority player has < 15 pts
        for seed in range(100):
            game = Game(dealer=Seat.NORTH, rng=random.Random(seed))
            game.deal_four()
            priority = game.whose_turn()
            hand = game.get_hand(priority)
            from game304 import hand_points
            if hand_points(hand) < 15:
                game.call_reshuffle(priority)
                assert game.state.dealer == Seat.NORTH  # same dealer
                assert game.phase == Phase.DEALING_4
                return
        pytest.skip("No seed found with < 15 point hand")
