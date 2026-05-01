"""Scoring and stone exchange for the 304 card game.

Calculates game results and applies stone changes at the end of each
game. Handles normal scoring, PCC, caps modifiers, and special
endings (spoilt trumps, absolute hand).

Scoring rules:
- Betting team must meet or exceed their bid in points.
- Opposition threshold is ``304 - bid + 1``.
- Stone given (win) or received (loss) varies by bid level.
- Caps modifiers apply on top of normal scoring.
- PCC: 5 stone win or 5 stone loss.
"""

from __future__ import annotations

from game304.constants import (
    PCC_BID_VALUE,
    PCC_SCORING,
    SCORING_TABLE,
    WRONG_CAPS_PENALTY,
)
from game304.seating import team_of
from game304.state import GameResult, GameState
from game304.types import Seat, Team


def _other_team(team: Team) -> Team:
    """Return the opposing team."""
    return Team.TEAM_B if team == Team.TEAM_A else Team.TEAM_A


def calculate_result(state: GameState) -> GameResult:
    """Calculate the result of a completed game.

    Checks in priority order:
    1. Caps call results (already resolved during play).
    2. Late caps detection (player was obligated but never called).
    3. PCC scoring (all-or-nothing).
    4. Normal scoring (bid met or failed).

    Args:
        state: The completed game state.

    Returns:
        A ``GameResult`` describing the outcome.
    """
    bidding = state.bidding
    play = state.play
    trump = state.trump

    trumper_seat = trump.trumper_seat
    trumper_team = team_of(trumper_seat)
    opposition_team = _other_team(trumper_team)

    # 1. If caps was already called and resolved, return existing result
    if play.caps_call is not None and state.result is not None:
        return state.result

    # 2. PCC scoring — caps and external caps mechanics do not apply.
    #    Late-caps detection must be skipped before checking obligations.
    if bidding.is_pcc:
        all_won = all(
            team_of(r.winner) == trumper_team for r in play.completed_rounds
        )
        if all_won:
            return GameResult(
                reason="pcc_won",
                stone_exchanged=PCC_SCORING.win,
                stone_direction="give",
                winner_team=trumper_team,
                description=(
                    f"PCC successful! {PCC_SCORING.win} stone given."
                ),
            )
        else:
            return GameResult(
                reason="pcc_lost",
                stone_exchanged=PCC_SCORING.loss,
                stone_direction="receive",
                winner_team=opposition_team,
                description=(
                    f"PCC failed. {PCC_SCORING.loss} stone received."
                ),
            )

    # 3. Check for late caps (player was obligated but never called caps).
    #    A player obligated mid-game whose team did go on to win every
    #    remaining round is treated as Late Caps: the betting team's win
    #    flips to a loss + 1 stone (or the opposition's win to a loss + 1
    #    in the external case).
    if play.caps_obligations:
        for seat_key, obligation in play.caps_obligations.items():
            obligated_team = team_of(seat_key)
            rounds_after = [
                r
                for r in play.completed_rounds
                if r.round_number >= obligation.obligated_at_round
            ]
            all_won = bool(rounds_after) and all(
                team_of(r.winner) == obligated_team for r in rounds_after
            )
            # Also require: the obligated team won every round of the
            # game (the precondition for caps in the first place).
            won_everything = all(
                team_of(r.winner) == obligated_team
                for r in play.completed_rounds
            )
            if all_won and won_everything:
                scoring = _get_scoring(bidding)
                return GameResult(
                    reason="caps_late",
                    stone_exchanged=scoring.loss + 1,
                    stone_direction="receive",
                    winner_team=_other_team(obligated_team),
                    caps_by=seat_key,
                    description=(
                        f"Late Caps detected for {seat_key.value}. "
                        f"{scoring.loss + 1} stone penalty."
                    ),
                )

    # 4. Normal scoring
    bid = bidding.highest_bid
    scoring = SCORING_TABLE.get(bid)
    if scoring is None:
        return GameResult(
            reason="error",
            stone_exchanged=0,
            stone_direction="none",
            winner_team=None,
            description=f"Unknown bid value: {bid}",
        )

    trumper_points = play.points_won[trumper_team]
    opposition_points = play.points_won[opposition_team]

    if trumper_points >= bid:
        return GameResult(
            reason="bid_met",
            stone_exchanged=scoring.win,
            stone_direction="give",
            winner_team=trumper_team,
            trumper_points=trumper_points,
            opposition_points=opposition_points,
            bid=bid,
            description=(
                f"Bid of {scoring.name} met with {trumper_points} points. "
                f"{scoring.win} stone given."
            ),
        )
    else:
        return GameResult(
            reason="bid_failed",
            stone_exchanged=scoring.loss,
            stone_direction="receive",
            winner_team=opposition_team,
            trumper_points=trumper_points,
            opposition_points=opposition_points,
            bid=bid,
            description=(
                f"Bid of {scoring.name} failed with {trumper_points} "
                f"points (needed {bid}). {scoring.loss} stone received."
            ),
        )


def apply_stone_changes(
    stone: dict[Team, int],
    result: GameResult,
    trumper_team: Team,
) -> None:
    """Apply stone changes based on the game result.

    Modifies the stone dict in place.

    Args:
        stone: Current stone counts per team (mutated in place).
        result: The game result.
        trumper_team: The team that held the bid.
    """
    if result.stone_direction == "none":
        return

    if result.stone_direction == "give":
        # Betting team won — they give stone (subtract from count)
        stone[trumper_team] = max(0, stone[trumper_team] - result.stone_exchanged)
    elif result.stone_direction == "receive":
        # Betting team lost — they receive stone (add to count)
        stone[trumper_team] += result.stone_exchanged


def calculate_caps_result(
    state: GameState,
    seat: Seat,
    is_valid: bool,
    is_external: bool,
) -> GameResult:
    """Calculate the result of a caps call.

    Handles correct, late, and wrong/early caps for both regular
    and external (opposition) caps calls.

    Args:
        state: The game state.
        seat: The seat that called caps.
        is_valid: Whether the caps call is valid (can guarantee all rounds).
        is_external: Whether this is external caps (from the opposition).

    Returns:
        A ``GameResult`` describing the caps outcome.
    """
    my_team = team_of(seat)
    trumper_team = team_of(state.trump.trumper_seat)

    if not is_valid:
        # Wrong/Early Caps — 5 stone penalty to calling team
        return GameResult(
            reason="caps_wrong",
            stone_exchanged=WRONG_CAPS_PENALTY,
            stone_direction="receive",
            winner_team=_other_team(my_team),
            caps_by=seat,
            description=(
                f"Wrong/Early Caps by {seat.value}. "
                f"{WRONG_CAPS_PENALTY} stone penalty."
            ),
        )

    # Valid caps — check timing
    is_late = False
    play = state.play
    if play is not None:
        from game304.caps import is_caps_late

        is_late = is_caps_late(state, seat)

    is_before_round_7 = play is not None and play.round_number < 7
    scoring = _get_scoring(state.bidding)

    if is_late:
        # Late caps — loss + 1 stone penalty
        normal_loss = scoring.loss
        return GameResult(
            reason="caps_late",
            stone_exchanged=normal_loss + 1,
            stone_direction="receive",
            winner_team=_other_team(my_team),
            caps_by=seat,
            description=(
                f"Late Caps by {seat.value}. "
                f"{normal_loss + 1} stone penalty."
            ),
        )

    if is_before_round_7:
        # Correct caps before Round 7 — bonus stone
        if is_external:
            normal_loss = scoring.loss
            return GameResult(
                reason="external_caps",
                stone_exchanged=normal_loss + 1,
                stone_direction="receive",
                winner_team=my_team,
                caps_by=seat,
                description=(
                    f"External Caps (correct, before Round 7). "
                    f"Betting team receives {normal_loss + 1} stone."
                ),
            )
        else:
            normal_win = scoring.win
            return GameResult(
                reason="caps_correct",
                stone_exchanged=normal_win + 1,
                stone_direction="give",
                winner_team=my_team,
                caps_by=seat,
                description=(
                    f"Caps correct (before Round 7). "
                    f"Betting team gives {normal_win + 1} stone."
                ),
            )
    else:
        # Correct caps after Round 7 — no bonus, normal scoring
        if is_external:
            normal_loss = scoring.loss
            return GameResult(
                reason="external_caps",
                stone_exchanged=normal_loss,
                stone_direction="receive",
                winner_team=my_team,
                caps_by=seat,
                description=(
                    f"External Caps (correct, after Round 7). "
                    f"Normal loss applies."
                ),
            )
        else:
            normal_win = scoring.win
            return GameResult(
                reason="caps_correct",
                stone_exchanged=normal_win,
                stone_direction="give",
                winner_team=my_team,
                caps_by=seat,
                description=(
                    f"Caps correct (after Round 7). Normal win applies."
                ),
            )


def _get_scoring(bidding):
    """Get the scoring entry for the current bid."""
    if bidding.is_pcc:
        return PCC_SCORING
    return SCORING_TABLE.get(bidding.highest_bid, PCC_SCORING)
