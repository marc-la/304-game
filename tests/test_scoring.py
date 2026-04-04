"""Tests for scoring and stone exchange."""

from game304 import Team
from game304.constants import PCC_SCORING, SCORING_TABLE, ScoringEntry
from game304.scoring import apply_stone_changes
from game304.state import GameResult


class TestScoringTable:
    def test_all_bid_levels_present(self):
        expected_bids = [160, 170, 180, 190, 200, 205, 210, 215,
                         220, 225, 230, 235, 240, 245, 250]
        for bid in expected_bids:
            assert bid in SCORING_TABLE

    def test_low_bids_score_1_win_2_loss(self):
        for bid in [160, 170, 180, 190]:
            assert SCORING_TABLE[bid].win == 1
            assert SCORING_TABLE[bid].loss == 2

    def test_200_bids_score_2_win_3_loss(self):
        for bid in [200, 205, 210, 215, 220, 225, 230, 235, 240, 245]:
            assert SCORING_TABLE[bid].win == 2
            assert SCORING_TABLE[bid].loss == 3

    def test_250_scores_3_win_4_loss(self):
        assert SCORING_TABLE[250].win == 3
        assert SCORING_TABLE[250].loss == 4

    def test_pcc_scores_5_5(self):
        assert PCC_SCORING.win == 5
        assert PCC_SCORING.loss == 5

    def test_honest_name(self):
        assert SCORING_TABLE[220].name == "Honest"


class TestApplyStoneChanges:
    def test_bid_met_gives_stone(self):
        stone = {Team.TEAM_A: 10, Team.TEAM_B: 10}
        result = GameResult(
            reason="bid_met", stone_exchanged=1,
            stone_direction="give", winner_team=Team.TEAM_A,
            description="test",
        )
        apply_stone_changes(stone, result, Team.TEAM_A)
        assert stone[Team.TEAM_A] == 9  # gave 1 stone
        assert stone[Team.TEAM_B] == 10

    def test_bid_failed_receives_stone(self):
        stone = {Team.TEAM_A: 10, Team.TEAM_B: 10}
        result = GameResult(
            reason="bid_failed", stone_exchanged=2,
            stone_direction="receive", winner_team=Team.TEAM_B,
            description="test",
        )
        apply_stone_changes(stone, result, Team.TEAM_A)
        assert stone[Team.TEAM_A] == 12  # received 2 stone

    def test_stone_cannot_go_below_zero(self):
        stone = {Team.TEAM_A: 1, Team.TEAM_B: 10}
        result = GameResult(
            reason="bid_met", stone_exchanged=3,
            stone_direction="give", winner_team=Team.TEAM_A,
            description="test",
        )
        apply_stone_changes(stone, result, Team.TEAM_A)
        assert stone[Team.TEAM_A] == 0  # clamped to 0

    def test_no_exchange_on_void(self):
        stone = {Team.TEAM_A: 10, Team.TEAM_B: 10}
        result = GameResult(
            reason="spoilt_trumps", stone_exchanged=0,
            stone_direction="none", winner_team=None,
            description="test",
        )
        apply_stone_changes(stone, result, Team.TEAM_A)
        assert stone[Team.TEAM_A] == 10
        assert stone[Team.TEAM_B] == 10
