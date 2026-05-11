"""Tests for the simple Bot class and auto_play_bots orchestration."""
from __future__ import annotations

import pytest

from game304 import (
    BidAction,
    Card,
    Game,
    Seat,
)
from game304.bidding import init_bidding_state
from game304.bot import Bot, auto_play_bots
from game304.deck import Deck
from game304.seating import deal_order
from game304.types import Phase


HANDS = {
    Seat.NORTH: ["9h", "Ah", "10h", "Kh", "Qh", "8h", "7h", "Js"],
    Seat.WEST: ["Jc", "9c", "Ac", "Kc", "Qd", "8c", "7c", "Jh"],
    Seat.SOUTH: ["10c", "9d", "Ad", "10d", "Kd", "Jd", "8d", "7d"],
    Seat.EAST: ["9s", "As", "10s", "Ks", "Qs", "8s", "7s", "Qc"],
}


def _seed_game(dealer: Seat = Seat.NORTH) -> Game:
    """Inject a fixed deal and put the game in BETTING_4."""
    game = Game(dealer=dealer)
    hands = {
        seat: [Card.from_str(c) for c in cs] for seat, cs in HANDS.items()
    }
    first_four = {seat: hands[seat][:4] for seat in Seat}
    order = deal_order(dealer)
    reserve: list[Card] = []
    for seat in order:
        reserve.extend(hands[seat][4:])
    game.state.hands = {seat: list(first_four[seat]) for seat in Seat}
    game.state.deck = Deck(cards=reserve)
    game.state.phase = Phase.BETTING_4
    game.state.bidding = init_bidding_state(
        first_bidder=order[0], is_four_card=True,
    )
    return game


def _setup_closed_trump_game(game: Game) -> None:
    """West bids 160, picks Jc, all pass 8-card, closed trump."""
    game.place_bid(Seat.WEST, BidAction.BET, 160)
    game.place_bid(Seat.SOUTH, BidAction.PASS)
    game.place_bid(Seat.EAST, BidAction.PASS)
    game.place_bid(Seat.NORTH, BidAction.PASS)
    game.select_trump(Seat.WEST, Card.from_str("Jc"))
    game.place_bid(Seat.WEST, BidAction.PASS)
    game.place_bid(Seat.SOUTH, BidAction.PASS)
    game.place_bid(Seat.EAST, BidAction.PASS)
    game.place_bid(Seat.NORTH, BidAction.PASS)
    game.proceed_closed_trump(Seat.WEST)


class TestBot:
    def test_choose_bid_always_passes(self):
        g = _seed_game()
        bot = Bot(Seat.WEST)
        action, value = bot.choose_bid(g)
        assert action == BidAction.PASS
        assert value == 0

    def test_choose_trump_picks_longest_suit_highest_power(self):
        g = _seed_game()
        # North's first 4: 9h, Ah, 10h, Kh — all hearts. Highest power: 9h.
        bot = Bot(Seat.NORTH)
        assert bot.choose_trump(g) == Card.from_str("9h")

    def test_choose_play_matches_led_suit_with_highest(self):
        g = _seed_game()
        _setup_closed_trump_game(g)
        # West leads (dealer=north → priority=west).
        g.play_card(Seat.WEST, Card.from_str("Jh"))
        g.play_card(Seat.SOUTH, Card.from_str("7d"))
        g.play_card(Seat.EAST, Card.from_str("7s"))
        # North's turn — has hearts (9h is highest after Jh).
        bot = Bot(Seat.NORTH)
        assert bot.choose_play(g) == Card.from_str("9h")

    def test_choose_play_plays_lowest_when_cant_follow(self):
        g = _seed_game()
        _setup_closed_trump_game(g)
        g.play_card(Seat.WEST, Card.from_str("Jh"))
        # South can't follow hearts. Lowest power valid: 7d.
        bot = Bot(Seat.SOUTH)
        assert bot.choose_play(g) == Card.from_str("7d")


class TestAutoPlayBots:
    def test_full_game_with_user_as_south(self):
        g = _seed_game()
        bots = {
            Seat.NORTH: Bot(Seat.NORTH),
            Seat.WEST: Bot(Seat.WEST),
            Seat.EAST: Bot(Seat.EAST),
        }

        # West to bid first; auto_play_bots passes for west, yields to south.
        assert g.phase == Phase.BETTING_4
        assert g.whose_turn() == Seat.WEST
        auto_play_bots(g, bots)
        assert g.whose_turn() == Seat.SOUTH

        g.place_bid(Seat.SOUTH, BidAction.BET, 160)
        auto_play_bots(g, bots)
        assert g.phase == Phase.TRUMP_SELECTION
        assert g.whose_turn() == Seat.SOUTH

        g.select_trump(Seat.SOUTH, Card.from_str("9d"))
        auto_play_bots(g, bots)
        assert g.whose_turn() == Seat.SOUTH

        g.place_bid(Seat.SOUTH, BidAction.PASS)
        auto_play_bots(g, bots)
        assert g.phase == Phase.PRE_PLAY
        assert g.whose_turn() == Seat.SOUTH

        g.proceed_closed_trump(Seat.SOUTH)
        auto_play_bots(g, bots)
        assert g.whose_turn() == Seat.SOUTH

        # Play out with south using the same simple heuristic.
        s_bot = Bot(Seat.SOUTH)
        guard = 50
        while g.phase == Phase.PLAYING and guard > 0:
            g.play_card(Seat.SOUTH, s_bot.choose_play(g))
            auto_play_bots(g, bots)
            guard -= 1
        assert g.phase == Phase.COMPLETE
        assert g.state.result is not None
