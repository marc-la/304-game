"""Tests for caps obligation detection."""

from game304 import Card, Rank, Seat, Suit, Team
from game304.caps import check_caps_obligation
from game304.state import CompletedRound, GameState, PlayState, RoundEntry, TrumpState
from game304.types import Phase


def make_play_state(
    completed_rounds: list[CompletedRound],
    round_number: int = 5,
    priority: Seat = Seat.NORTH,
) -> PlayState:
    return PlayState(
        round_number=round_number,
        priority=priority,
        current_turn=priority,
        completed_rounds=completed_rounds,
        points_won={Team.TEAM_A: 0, Team.TEAM_B: 0},
    )


class TestCapsObligation:
    def test_not_obligated_if_team_lost_round(self):
        """If the team has lost a round, caps is impossible."""
        state = GameState(phase=Phase.PLAYING)
        state.trump = TrumpState(
            trumper_seat=Seat.NORTH,
            trump_suit=Suit.CLUBS,
            is_revealed=True,
            is_open=True,
        )
        state.play = make_play_state(
            completed_rounds=[
                CompletedRound(
                    round_number=1,
                    cards=[],
                    winner=Seat.EAST,  # opponent won
                    points_won=30,
                ),
            ],
        )
        state.hands = {
            Seat.NORTH: [Card(Rank.JACK, Suit.CLUBS)],
            Seat.WEST: [],
            Seat.SOUTH: [],
            Seat.EAST: [],
        }
        assert not check_caps_obligation(state, Seat.NORTH)

    def test_obligated_with_top_trump_cards(self):
        """If the player holds the highest remaining trumps, they are obligated."""
        state = GameState(phase=Phase.PLAYING)
        state.trump = TrumpState(
            trumper_seat=Seat.NORTH,
            trump_suit=Suit.CLUBS,
            is_revealed=True,
            is_open=True,
        )
        # North holds J, 9, A of clubs (top 3 trumps)
        # All rounds so far won by Team A
        state.play = make_play_state(
            completed_rounds=[
                CompletedRound(
                    round_number=i,
                    cards=[],
                    winner=Seat.NORTH,
                    points_won=30,
                )
                for i in range(1, 6)
            ],
            round_number=6,
            priority=Seat.NORTH,
        )
        state.hands = {
            Seat.NORTH: [
                Card(Rank.JACK, Suit.CLUBS),
                Card(Rank.NINE, Suit.CLUBS),
                Card(Rank.ACE, Suit.CLUBS),
            ],
            Seat.WEST: [
                Card(Rank.SEVEN, Suit.DIAMONDS),
                Card(Rank.EIGHT, Suit.DIAMONDS),
                Card(Rank.SEVEN, Suit.HEARTS),
            ],
            Seat.SOUTH: [
                Card(Rank.SEVEN, Suit.SPADES),
                Card(Rank.EIGHT, Suit.SPADES),
                Card(Rank.EIGHT, Suit.HEARTS),
            ],
            Seat.EAST: [
                Card(Rank.KING, Suit.DIAMONDS),
                Card(Rank.QUEEN, Suit.DIAMONDS),
                Card(Rank.QUEEN, Suit.HEARTS),
            ],
        }
        assert check_caps_obligation(state, Seat.NORTH)
