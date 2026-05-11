"""Random-self-play fuzzer for the play phase.

Plays a few hundred random games end-to-end. After every legal action,
runs every invariant defined in ``tools/state_walker.py`` against the
resulting state. The first failing assertion stops the run with full
context — seed, scenario, policy, and the per-invariant failure list.

This catches structural bugs (no crashes, card conservation, hand
sizes, state-machine consistency, trumper face-down legality) without
needing to enumerate cases by hand. It is the cheapest way to get
broad coverage of the engine.
"""

from __future__ import annotations

import os
import random
import sys

import pytest

# Make tools/ importable
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from game304 import Phase, Seat  # noqa: E402
from tools.state_walker import (  # noqa: E402
    SCENARIOS,
    all_invariants,
    policy_first,
    policy_random,
    walk_play,
)


# Number of random games per (scenario, policy) combo. Bumped up via
# the FUZZ_GAMES env var when you want a deeper sweep.
N_GAMES = int(os.environ.get("FUZZ_GAMES", "200"))


@pytest.fixture(autouse=True)
def _disable_caps_tracking(monkeypatch):
    """Caps-obligation tracking is brute-force-permutation slow.

    The fuzzer tests *structural* invariants (card conservation, hand
    sizes, state-machine consistency) — caps semantics are exercised
    by the targeted tests in ``test_rule_edges.py``. Stub out the
    tracker for fuzz so a 200-game sweep finishes in seconds, not
    hours.
    """
    import game304.caps as caps_module
    import game304.game as game_module

    noop = lambda *args, **kwargs: None  # noqa: E731
    monkeypatch.setattr(caps_module, "track_caps_obligation", noop)
    monkeypatch.setattr(game_module, "track_caps_obligation", noop)


@pytest.mark.parametrize("scenario", list(SCENARIOS))
@pytest.mark.parametrize("policy_name", ["first", "random"])
def test_invariants_hold_across_random_games(scenario, policy_name):
    """For every (scenario, policy) pair: play N games, assert no invariant fails.

    A single failure stops the test with the seed and the full failure
    list, so reproducing the bug is just::

        python tools/state_walker.py --scenario <scenario> --seed <seed>
    """
    failures: list[tuple[int, int, list[tuple[str, str | None]]]] = []

    for seed in range(N_GAMES):
        rng = random.Random(seed)
        g = SCENARIOS[scenario](seed)

        # Snapshot reference values used by some invariants
        original_folded = g.state.trump.trump_card
        frozen_pcc = (
            list(g.state.hands.get(g.state.pcc_partner_out, []))
            if g.state.pcc_partner_out
            else None
        )

        # Initial state must already be invariant-clean
        results = all_invariants(
            g, original_folded=original_folded, frozen_pcc_hand=frozen_pcc,
        )
        if any(m for _, m in results):
            failures.append((seed, 0, results))
            continue

        if policy_name == "first":
            policy = policy_first
        else:
            policy = policy_random(rng)

        step_no = 0
        try:
            for _ in walk_play(g, policy):
                step_no += 1
                results = all_invariants(
                    g,
                    original_folded=original_folded,
                    frozen_pcc_hand=frozen_pcc,
                )
                if any(m for _, m in results):
                    failures.append((seed, step_no, results))
                    break
        except Exception as exc:
            pytest.fail(
                f"\n[scenario={scenario}, policy={policy_name}, "
                f"seed={seed}, step={step_no}] crash: {exc!r}"
            )

        # Final state (Phase.COMPLETE) must also satisfy invariants.
        if g.phase == Phase.COMPLETE:
            results = all_invariants(
                g,
                original_folded=original_folded,
                frozen_pcc_hand=frozen_pcc,
            )
            if any(m for _, m in results):
                failures.append((seed, step_no + 1, results))

    if failures:
        seed, step, results = failures[0]
        fail_msgs = [f"  - {n}: {m}" for n, m in results if m]
        pytest.fail(
            f"\n[scenario={scenario}, policy={policy_name}] "
            f"{len(failures)} seed(s) failed; first failure at "
            f"seed={seed}, step={step}:\n" + "\n".join(fail_msgs)
            + f"\n\nReproduce with: "
            f"python tools/state_walker.py --scenario {scenario} --seed {seed}"
        )


def test_terminal_state_card_total_is_304():
    """Sum of points across all completed-round cards is exactly 304."""
    for seed in range(20):
        g = SCENARIOS["simple"](seed)
        for _ in walk_play(g, policy_first):
            pass
        if g.phase != Phase.COMPLETE:
            continue
        play = g.state.play
        if play is None:
            continue
        total_points = sum(
            sum(e.card.points for e in r.cards)
            for r in play.completed_rounds
        )
        # Skip games that ended early (spoilt trumps, absolute hand)
        if len(play.completed_rounds) == 8:
            assert total_points == 304, (
                f"seed={seed}: completed rounds sum to {total_points}, "
                f"expected 304"
            )


def test_completed_rounds_count_matches_round_number():
    """While in PLAYING, len(completed_rounds) == round_number - 1."""
    for seed in range(10):
        g = SCENARIOS["simple"](seed)
        for _ in walk_play(g, policy_first):
            play = g.state.play
            if play is None or g.phase != Phase.PLAYING:
                continue
            assert len(play.completed_rounds) == play.round_number - 1, (
                f"seed={seed}: completed_rounds={len(play.completed_rounds)}, "
                f"round_number={play.round_number}"
            )
