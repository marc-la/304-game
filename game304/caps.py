"""Caps obligation algorithm for the 304 card game.

Implements the outer single-dummy quantifiers of §5 of
``docs/caps_formalism.md``. The decomposition matches §11:

- :mod:`game304.info` builds the candidate caller's information set
  ``I_V(S)`` and enumerates every world ``W`` consistent with it.
- :mod:`game304.dd` solves a single world: does a fixed caller play
  order ``O`` win every remaining round (or, for Claim Balance,
  reach a points threshold) against any legal continuation by the
  other three seats?
- This module composes them: a player is caps-obligated iff there
  **exists** an order ``O`` such that for **every** world ``W``,
  ``O`` wins in ``W``.

Using ``state.hands`` directly here would be **double-dummy**
analysis — the implementation gap that the formalism §1 names as
the wrong test. The correct test consumes ``info.py``'s information
set and quantifies over the consistent worlds.

Two timing policies are exposed for Late-Caps detection (§8.3):

- **Lenient** (default; rules engine default per §C-3): ``V`` may
  call up to and including their next own-play turn. Late iff
  ``V`` has played a card since obligation arose.
- **Strict**: any subsequent observation event makes the call late.

The bonus eligibility window (§C-1, §C-13) is determined by the
round of *first* obligation — ``r(S*_V) < 7`` per formalism §8.4 —
not the round in which the call was placed.
"""

from __future__ import annotations

import itertools
from typing import Iterable

from game304.card import Card
from game304.dd import (
    InProgressEntry,
    PlaySnapshot,
    order_min_points_in_world,
    order_sweeps_world,
)
from game304.info import (
    InformationSet,
    World,
    build_info_set,
    enumerate_worlds,
)
from game304.seating import team_of
from game304.state import CapsObligation, GameState
from game304.types import Seat, Suit


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


#: Max consistent worlds enumerated per obligation check. If the cap
#: is reached we abort and treat obligation as undetermined (False) —
#: a caller who cannot bound their own world set cannot reasonably
#: deduce obligation either, so refusing to flag is the safe choice.
#: Late-game (the regime in which caps actually fires) the world set
#: is well under this bound; early-game the set explodes and we abort.
MAX_WORLDS = 5000

#: Max permutations of the caller's hand explored when searching for
#: a witness order. With ``H`` cards there are ``H!`` orderings; for
#: ``H ≤ 6`` we always exhaust them, beyond that we cap. Practical
#: caps situations typically have ``H ≤ 4``.
MAX_PERMUTATIONS = 5040  # 7!


# ---------------------------------------------------------------------------
# Public API — caps
# ---------------------------------------------------------------------------


def check_caps_obligation(state: GameState, seat: Seat) -> bool:
    """Return ``True`` iff ``seat`` is currently caps-obligated.

    Per formalism §5: there exists an order ``O`` of ``seat``'s
    remaining cards such that for every world ``W`` consistent with
    ``seat``'s information, and every legal adversary strategy, the
    caller's team wins every remaining round.

    Uses ``info.build_info_set`` to construct ``I_V(S)`` and
    ``info.enumerate_worlds`` to iterate consistent worlds, with a
    safety cap (:data:`MAX_WORLDS`) to handle pathologically large
    early-game world sets.
    """
    play = state.play
    if play is None:
        return False
    if state.pcc_partner_out == seat:
        return False
    try:
        info = build_info_set(state, seat)
    except ValueError:
        return False

    # Precondition: caller's team has won every completed round (§5).
    if not info.team_won_all_completed:
        return False
    if not info.own_hand:
        return False

    rounds_remaining = 8 - len(play.completed_rounds)
    if rounds_remaining <= 0:
        return False

    worlds = _enumerate_or_abort(info)
    if worlds is None:
        return False

    return _has_witness_order(
        info=info,
        seat=seat,
        play_state=play,
        worlds=worlds,
        rounds_remaining=rounds_remaining,
        pcc_partner_out=state.pcc_partner_out,
    )


def validate_caps_call(
    state: GameState,
    seat: Seat,
    play_order: list[Card],
) -> bool:
    """Return ``True`` iff ``play_order`` is a valid caps witness.

    Per formalism §5: ``play_order`` must win every remaining round
    in **every** world consistent with the caller's information.
    Differs from ``check_caps_obligation`` only in fixing the order
    rather than searching for one.
    """
    play = state.play
    if play is None:
        return False
    if state.pcc_partner_out == seat:
        return False
    try:
        info = build_info_set(state, seat)
    except ValueError:
        return False
    if not info.team_won_all_completed:
        return False
    if sorted(play_order, key=str) != sorted(info.own_hand, key=str):
        return False

    rounds_remaining = 8 - len(play.completed_rounds)
    if rounds_remaining <= 0:
        return False

    worlds = _enumerate_or_abort(info)
    if worlds is None:
        return False

    return _order_wins_all_worlds(
        info=info,
        seat=seat,
        play_state=play,
        worlds=worlds,
        order=list(play_order),
        rounds_remaining=rounds_remaining,
        pcc_partner_out=state.pcc_partner_out,
    )


def track_caps_obligation(state: GameState) -> None:
    """Stamp first-obligation moments for every eligible seat.

    Invoked by the play loop after every card play and after every
    round resolution (where folded trumps may be revealed). Each
    seat's first-obligation event is recorded once and never
    overwritten — late-caps detection compares against this stamp.

    The call window closes at the final card of round 8; obligations
    arising precisely at that final state are never recorded
    (§rules: "Caps cannot be called after the final card of round 8
    is played"), but earlier stamps remain.
    """
    play = state.play
    if play is None:
        return

    expected_round_size = 3 if state.pcc_partner_out is not None else 4
    call_window_closed = (
        play.round_number == 8
        and len(play.current_round) >= expected_round_size
    )
    if call_window_closed:
        return

    for seat in Seat:
        if seat in play.caps_obligations:
            continue
        if state.pcc_partner_out == seat:
            continue
        try:
            obligated = check_caps_obligation(state, seat)
        except Exception:
            # Obligation tracking is best-effort; never crash the loop.
            continue
        if not obligated:
            continue
        v_played_in_current = any(
            entry.seat == seat for entry in play.current_round
        )
        v_plays_at_obligation = (play.round_number - 1) + (
            1 if v_played_in_current else 0
        )
        play.caps_obligations[seat] = CapsObligation(
            obligated_at_round=play.round_number,
            obligated_at_card=len(play.current_round),
            v_plays_at_obligation=v_plays_at_obligation,
        )


def is_caps_late(
    state: GameState, seat: Seat, *, policy: str = "lenient"
) -> bool:
    """Return ``True`` iff a caps call by ``seat`` would be late.

    Per formalism §8.3, three policies are recognised; this engine
    supports two:

    - ``'lenient'`` (rules engine default per §C-3 / rules.html
      §Caps): late iff ``seat`` has played a card since obligation
      first arose. Up to and including ``seat``'s next own-play turn
      the call is on-time.
    - ``'strict'``: late iff any observation event has occurred
      since obligation first arose (any seat played a card, any
      reveal happened, or a new round started).

    The default is lenient because that matches the rules' practical
    grace period.
    """
    play = state.play
    if play is None:
        return False
    obligation = play.caps_obligations.get(seat)
    if obligation is None:
        return False

    if policy == "strict":
        if obligation.obligated_at_round < play.round_number:
            return True
        if (
            obligation.obligated_at_round == play.round_number
            and obligation.obligated_at_card < len(play.current_round)
        ):
            return True
        return False

    # Lenient (default).
    v_played_in_current = any(
        entry.seat == seat for entry in play.current_round
    )
    v_plays_now = (play.round_number - 1) + (
        1 if v_played_in_current else 0
    )
    return v_plays_now > obligation.v_plays_at_obligation


def deduce_exhausted_suits(state: GameState) -> dict[Seat, set[Suit]]:
    """Deduce which suits each player is publicly known to be out of.

    Retained as a convenience for downstream code (e.g. UI hinting).
    The caps engine itself routes suit-exhaustion through
    :func:`game304.info.build_info_set` and does not call this.
    """
    exhausted: dict[Seat, set[Suit]] = {s: set() for s in Seat}
    play = state.play
    if play is None:
        return exhausted

    for r in play.completed_rounds:
        if not r.cards:
            continue
        led_suit: Suit | None = None
        for entry in r.cards:
            if not entry.face_down:
                led_suit = entry.card.suit
                break
        if led_suit is None:
            continue
        for entry in r.cards:
            if entry.face_down or entry.card.suit != led_suit:
                exhausted[entry.seat].add(led_suit)
    return exhausted


# ---------------------------------------------------------------------------
# Public API — claim balance (analogous mechanic; §6, §penalties).
# ---------------------------------------------------------------------------


def check_claim_balance(
    state: GameState, seat: Seat, threshold: int
) -> bool:
    """Return ``True`` iff ``seat`` can guarantee reaching ``threshold``.

    Single-dummy claim adjudication on the points threshold (§6 of
    the formalism). The team's currently-won points contribute; the
    test is whether some announced order brings the worst-case
    minimum-points-from-here above the gap.

    Used to validate Claim Balance calls. Wrong claim is punished by
    the severe penalty per ``rules.html#penalties``.
    """
    play = state.play
    if play is None:
        return False
    if state.pcc_partner_out == seat:
        return False
    try:
        info = build_info_set(state, seat)
    except ValueError:
        return False
    if not info.own_hand:
        return False

    rounds_remaining = 8 - len(play.completed_rounds)
    my_team = team_of(seat)
    points_so_far = play.points_won.get(my_team, 0)
    if points_so_far >= threshold:
        return True
    if rounds_remaining <= 0:
        return False

    worlds = _enumerate_or_abort(info)
    if worlds is None:
        return False

    gap = threshold - points_so_far
    return _has_balance_witness(
        info=info,
        seat=seat,
        play_state=play,
        worlds=worlds,
        rounds_remaining=rounds_remaining,
        pcc_partner_out=state.pcc_partner_out,
        gap=gap,
    )


def validate_claim_balance(
    state: GameState,
    seat: Seat,
    play_order: list[Card],
    threshold: int,
) -> bool:
    """Return ``True`` iff the announced order guarantees ``threshold``.

    Fixed-order analogue of :func:`check_claim_balance`.
    """
    play = state.play
    if play is None:
        return False
    if state.pcc_partner_out == seat:
        return False
    try:
        info = build_info_set(state, seat)
    except ValueError:
        return False
    if sorted(play_order, key=str) != sorted(info.own_hand, key=str):
        return False

    rounds_remaining = 8 - len(play.completed_rounds)
    my_team = team_of(seat)
    points_so_far = play.points_won.get(my_team, 0)
    if points_so_far >= threshold:
        return True
    if rounds_remaining <= 0:
        return False

    worlds = _enumerate_or_abort(info)
    if worlds is None:
        return False

    gap = threshold - points_so_far
    for world in worlds:
        snapshot = _resolve_snapshot(play, info, world, seat)
        if snapshot is None:
            return False
        min_pts = order_min_points_in_world(
            world=world,
            caller_seat=seat,
            caller_order=list(play_order),
            snapshot=snapshot,
            pcc_partner_out=state.pcc_partner_out,
            rounds_remaining=rounds_remaining,
        )
        if min_pts < gap:
            return False
    return True


# ---------------------------------------------------------------------------
# Internal: world enumeration with safety cap
# ---------------------------------------------------------------------------


def _enumerate_or_abort(info: InformationSet) -> list[World] | None:
    """Materialise consistent worlds, or ``None`` if the cap is hit.

    Hitting the cap is treated as "obligation cannot be proved" — the
    safe answer when the world set is too large to enumerate.
    """
    worlds: list[World] = []
    for w in enumerate_worlds(info, max_worlds=MAX_WORLDS + 1):
        worlds.append(w)
        if len(worlds) > MAX_WORLDS:
            return None
    if not worlds:
        return None
    return worlds


# ---------------------------------------------------------------------------
# Internal: in-progress round snapshot resolution per world
# ---------------------------------------------------------------------------


def _resolve_snapshot(
    play_state, info: InformationSet, world: World, viewer: Seat
) -> PlaySnapshot | None:
    """Build a per-world :class:`PlaySnapshot` for the in-progress round.

    Face-down identities hidden from ``viewer`` are resolved through
    the world's ``hidden_slot_assignments`` mapping.
    """
    leader = play_state.priority if play_state.priority is not None else viewer
    entries: list[InProgressEntry] = []
    for entry in play_state.current_round:
        if entry.face_down and not entry.revealed and entry.seat != viewer:
            # Resolve via hidden-slot assignment for this in-progress round.
            key = (entry.seat, play_state.round_number)
            card = world.hidden_slot_assignments.get(key)
            if card is None:
                return None
            entries.append(InProgressEntry(seat=entry.seat, card=card))
        else:
            entries.append(InProgressEntry(seat=entry.seat, card=entry.card))
    return PlaySnapshot(leader=leader, entries=tuple(entries))


# ---------------------------------------------------------------------------
# Internal: outer-quantifier search
# ---------------------------------------------------------------------------


def _has_witness_order(
    *,
    info: InformationSet,
    seat: Seat,
    play_state,
    worlds: list[World],
    rounds_remaining: int,
    pcc_partner_out: Seat | None,
) -> bool:
    """Return ``True`` iff some order of own_hand sweeps every world.

    Iterates orderings, short-circuiting on the first ordering whose
    sweep holds in every world. World-failure within an ordering
    short-circuits to the next ordering.
    """
    cards = list(info.own_hand)
    permutations: Iterable[tuple[Card, ...]] = itertools.permutations(cards)

    n_perms = 1
    for k in range(1, len(cards) + 1):
        n_perms *= k
    if n_perms > MAX_PERMUTATIONS:
        # Hand is too large to brute-force orderings; refuse to flag
        # rather than falsely concluding obligation. In practice this
        # only matters early-game where the world set is also blown
        # past the cap, so we already returned False.
        return False

    for ordering in permutations:
        if _order_wins_all_worlds(
            info=info,
            seat=seat,
            play_state=play_state,
            worlds=worlds,
            order=list(ordering),
            rounds_remaining=rounds_remaining,
            pcc_partner_out=pcc_partner_out,
        ):
            return True
    return False


def _order_wins_all_worlds(
    *,
    info: InformationSet,
    seat: Seat,
    play_state,
    worlds: list[World],
    order: list[Card],
    rounds_remaining: int,
    pcc_partner_out: Seat | None,
) -> bool:
    """``order`` wins every remaining round in every world, or False."""
    for world in worlds:
        snapshot = _resolve_snapshot(play_state, info, world, seat)
        if snapshot is None:
            return False
        if not order_sweeps_world(
            world=world,
            caller_seat=seat,
            caller_order=order,
            snapshot=snapshot,
            pcc_partner_out=pcc_partner_out,
            rounds_remaining=rounds_remaining,
        ):
            return False
    return True


def _has_balance_witness(
    *,
    info: InformationSet,
    seat: Seat,
    play_state,
    worlds: list[World],
    rounds_remaining: int,
    pcc_partner_out: Seat | None,
    gap: int,
) -> bool:
    cards = list(info.own_hand)
    n_perms = 1
    for k in range(1, len(cards) + 1):
        n_perms *= k
    if n_perms > MAX_PERMUTATIONS:
        return False

    for ordering in itertools.permutations(cards):
        ok = True
        for world in worlds:
            snapshot = _resolve_snapshot(play_state, info, world, seat)
            if snapshot is None:
                ok = False
                break
            min_pts = order_min_points_in_world(
                world=world,
                caller_seat=seat,
                caller_order=list(ordering),
                snapshot=snapshot,
                pcc_partner_out=pcc_partner_out,
                rounds_remaining=rounds_remaining,
            )
            if min_pts < gap:
                ok = False
                break
        if ok:
            return True
    return False
