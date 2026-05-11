"""Per-world double-dummy solver for caps obligation.

Implements the inner minimax of §5 of ``docs/caps_formalism.md``:
given a fixed :class:`game304.info.World` (a concrete card location
for every seat) and a fixed caller play order, decide whether the
order wins every remaining round against any legal continuation by
the other three seats.

The outer single-dummy quantifiers — universal over consistent worlds
and existential over orders — live in :mod:`game304.caps`. This
module is a leaf: it knows nothing about information sets.

Two predicates are exposed:

- :func:`order_sweeps_world` — caps test. The caller's order must
  win every remaining round against the worst-case adversary play.
- :func:`order_min_points_in_world` — claim-balance test.  Returns
  the minimum points the caller's team is guaranteed to collect from
  the remaining play, against the worst-case adversary play. The
  caller's order is fixed; the other three seats minimise.

Adversary legality covers must-follow-suit and the exhausted-trumps
rule (the leader holding all remaining trumps must lead trump). The
closed-trump face-down rules and the in-hand-trump fold restriction
are not enforced in the witness because the announced caps order is
played face-up; once the caller exposes their hand, fold semantics
are moot.
"""

from __future__ import annotations

from dataclasses import dataclass

from game304.card import Card
from game304.info import World
from game304.seating import next_seat, team_of
from game304.types import Seat, Suit, Team


@dataclass(frozen=True)
class InProgressEntry:
    """A play already made in the in-progress round, identity resolved.

    Identities of face-down entries hidden from the viewer must be
    materialised by the caller using the world's hidden-slot
    assignments before being passed to the solver.
    """

    seat: Seat
    card: Card


@dataclass(frozen=True)
class PlaySnapshot:
    """The state of the in-progress round at the moment of analysis.

    Attributes:
        leader: The seat that leads the in-progress round (the seat
            with priority).
        entries: Plays already made in the in-progress round, in play
            order, with face-down identities resolved per the world.
    """

    leader: Seat
    entries: tuple[InProgressEntry, ...]


# ---------------------------------------------------------------------------
# Public predicates
# ---------------------------------------------------------------------------


def order_sweeps_world(
    *,
    world: World,
    caller_seat: Seat,
    caller_order: list[Card],
    snapshot: PlaySnapshot,
    pcc_partner_out: Seat | None,
    rounds_remaining: int,
) -> bool:
    """Return ``True`` iff ``caller_order`` wins every remaining round.

    Adversaries (the other three seats) play minimax-optimally to
    break the sweep. Forced plays (one-card-of-led-suit, exhausted
    trumps that force a trump lead) collapse the adversarial branch
    automatically — that is the deducible-via-partner machinery from
    §5.

    The caller's order must contain exactly the caller's remaining
    cards. ``rounds_remaining`` is the number of rounds left to play
    (including the in-progress one if it has plays).
    """
    sim_hands = {seat: list(cards) for seat, cards in world.hands.items()}
    in_progress = [(e.seat, e.card) for e in snapshot.entries]
    return _solve_caps(
        sim_hands=sim_hands,
        caller_seat=caller_seat,
        caller_order=caller_order,
        caller_index=0,
        leader=snapshot.leader,
        in_progress=in_progress,
        rounds_remaining=rounds_remaining,
        trump_suit=world.trump_suit,
        my_team=team_of(caller_seat),
        pcc_partner_out=pcc_partner_out,
    )


def order_min_points_in_world(
    *,
    world: World,
    caller_seat: Seat,
    caller_order: list[Card],
    snapshot: PlaySnapshot,
    pcc_partner_out: Seat | None,
    rounds_remaining: int,
) -> int:
    """Return the minimum points the caller's team is guaranteed to win.

    Computed against worst-case adversary play. The caller's order is
    fixed; the other three seats play any legal continuation, and the
    return value is the minimum total points scored by the caller's
    team across the remaining rounds.

    Used by Claim Balance: the predicate "we will reach our threshold"
    is equivalent to ``points_already_won + min_points >= threshold``.
    """
    sim_hands = {seat: list(cards) for seat, cards in world.hands.items()}
    in_progress = [(e.seat, e.card) for e in snapshot.entries]
    return _solve_min_points(
        sim_hands=sim_hands,
        caller_seat=caller_seat,
        caller_order=caller_order,
        caller_index=0,
        leader=snapshot.leader,
        in_progress=in_progress,
        rounds_remaining=rounds_remaining,
        trump_suit=world.trump_suit,
        my_team=team_of(caller_seat),
        pcc_partner_out=pcc_partner_out,
    )


# ---------------------------------------------------------------------------
# Internals — round mechanics shared by both solvers
# ---------------------------------------------------------------------------


def _round_turn_order(
    leader: Seat, pcc_partner_out: Seat | None
) -> list[Seat]:
    """Anticlockwise turn order for one round, skipping the PCC-out seat."""
    target = 3 if pcc_partner_out is not None else 4
    order: list[Seat] = [leader]
    cur = leader
    while len(order) < target:
        cur = next_seat(cur)
        if cur == leader:
            break
        if cur == pcc_partner_out:
            continue
        order.append(cur)
    return order


def _round_winner(
    plays: list[tuple[Seat, Card]], trump_suit: Suit | None
) -> Seat:
    """Return the winning seat of a complete round."""
    if not plays:
        raise ValueError("No plays to resolve")
    led_suit = plays[0][1].suit
    trumps = [
        (s, c) for s, c in plays
        if trump_suit is not None and c.suit == trump_suit
    ]
    if trumps:
        return min(trumps, key=lambda sc: sc[1].power)[0]
    led = [(s, c) for s, c in plays if c.suit == led_suit]
    if not led:
        return plays[0][0]
    return min(led, key=lambda sc: sc[1].power)[0]


def _round_points(plays: list[tuple[Seat, Card]]) -> int:
    """Sum of point values for a complete round."""
    return sum(c.points for _, c in plays)


def _legal_plays(
    *,
    hand: list[Card],
    led_suit: Suit | None,
    trump_suit: Suit | None,
    is_lead: bool,
    seats_with_trumps: set[Seat],
    seat: Seat,
) -> list[Card]:
    """Cards this ``seat`` can legally play given the round state.

    Enforces:

    - **Follow suit**: when not leading and holding the led suit,
      only led-suit cards are legal.
    - **Exhausted trumps**: when leading and this seat is the only
      seat holding any remaining trump, the seat must lead trump (if
      they have any) until their own trumps are gone.

    Closed-trump face-down semantics are intentionally absent: caps
    cards are exposed face-up, so the fold rules do not apply to a
    declared play order.
    """
    if not is_lead:
        suited = [c for c in hand if c.suit == led_suit]
        return suited if suited else list(hand)
    # Leading.
    if (
        trump_suit is not None
        and seats_with_trumps == {seat}
        and any(c.suit == trump_suit for c in hand)
    ):
        return [c for c in hand if c.suit == trump_suit]
    return list(hand)


def _seats_holding_trump(
    sim_hands: dict[Seat, list[Card]], trump_suit: Suit | None
) -> set[Seat]:
    if trump_suit is None:
        return set()
    return {
        s for s, h in sim_hands.items()
        if any(c.suit == trump_suit for c in h)
    }


def _hand_remove(
    sim_hands: dict[Seat, list[Card]], seat: Seat, card: Card
) -> dict[Seat, list[Card]]:
    new = {s: list(cs) for s, cs in sim_hands.items()}
    new[seat].remove(card)
    return new


# ---------------------------------------------------------------------------
# Caps solver — boolean: caller's team wins every round.
# ---------------------------------------------------------------------------


def _solve_caps(
    *,
    sim_hands: dict[Seat, list[Card]],
    caller_seat: Seat,
    caller_order: list[Card],
    caller_index: int,
    leader: Seat,
    in_progress: list[tuple[Seat, Card]],
    rounds_remaining: int,
    trump_suit: Suit | None,
    my_team: Team,
    pcc_partner_out: Seat | None,
) -> bool:
    if rounds_remaining <= 0:
        return True

    turn_order = _round_turn_order(leader, pcc_partner_out)
    next_idx = len(in_progress)

    if next_idx >= len(turn_order):
        winner = _round_winner(in_progress, trump_suit)
        if team_of(winner) != my_team:
            return False
        if rounds_remaining == 1:
            return True
        return _solve_caps(
            sim_hands=sim_hands,
            caller_seat=caller_seat,
            caller_order=caller_order,
            caller_index=caller_index,
            leader=winner,
            in_progress=[],
            rounds_remaining=rounds_remaining - 1,
            trump_suit=trump_suit,
            my_team=my_team,
            pcc_partner_out=pcc_partner_out,
        )

    next_seat_to_play = turn_order[next_idx]
    led_suit: Suit | None = in_progress[0][1].suit if in_progress else None
    is_lead = not in_progress
    seats_with_trumps = _seats_holding_trump(sim_hands, trump_suit)

    if next_seat_to_play == caller_seat:
        if caller_index >= len(caller_order):
            return False
        card = caller_order[caller_index]
        hand = sim_hands.get(caller_seat, [])
        if card not in hand:
            return False
        legal = _legal_plays(
            hand=hand,
            led_suit=led_suit,
            trump_suit=trump_suit,
            is_lead=is_lead,
            seats_with_trumps=seats_with_trumps,
            seat=caller_seat,
        )
        if card not in legal:
            return False
        return _solve_caps(
            sim_hands=_hand_remove(sim_hands, caller_seat, card),
            caller_seat=caller_seat,
            caller_order=caller_order,
            caller_index=caller_index + 1,
            leader=leader,
            in_progress=in_progress + [(caller_seat, card)],
            rounds_remaining=rounds_remaining,
            trump_suit=trump_suit,
            my_team=my_team,
            pcc_partner_out=pcc_partner_out,
        )

    # Adversary: every legal choice must still preserve the sweep.
    other_hand = sim_hands.get(next_seat_to_play, [])
    if not other_hand:
        return False
    legal = _legal_plays(
        hand=other_hand,
        led_suit=led_suit,
        trump_suit=trump_suit,
        is_lead=is_lead,
        seats_with_trumps=seats_with_trumps,
        seat=next_seat_to_play,
    )
    if not legal:
        return False
    for chosen in legal:
        ok = _solve_caps(
            sim_hands=_hand_remove(sim_hands, next_seat_to_play, chosen),
            caller_seat=caller_seat,
            caller_order=caller_order,
            caller_index=caller_index,
            leader=leader,
            in_progress=in_progress + [(next_seat_to_play, chosen)],
            rounds_remaining=rounds_remaining,
            trump_suit=trump_suit,
            my_team=my_team,
            pcc_partner_out=pcc_partner_out,
        )
        if not ok:
            return False
    return True


# ---------------------------------------------------------------------------
# Claim-balance solver — integer: minimum points caller's team wins.
# ---------------------------------------------------------------------------


def _solve_min_points(
    *,
    sim_hands: dict[Seat, list[Card]],
    caller_seat: Seat,
    caller_order: list[Card],
    caller_index: int,
    leader: Seat,
    in_progress: list[tuple[Seat, Card]],
    rounds_remaining: int,
    trump_suit: Suit | None,
    my_team: Team,
    pcc_partner_out: Seat | None,
) -> int:
    if rounds_remaining <= 0:
        return 0

    turn_order = _round_turn_order(leader, pcc_partner_out)
    next_idx = len(in_progress)

    if next_idx >= len(turn_order):
        winner = _round_winner(in_progress, trump_suit)
        gained = _round_points(in_progress) if team_of(winner) == my_team else 0
        if rounds_remaining == 1:
            return gained
        return gained + _solve_min_points(
            sim_hands=sim_hands,
            caller_seat=caller_seat,
            caller_order=caller_order,
            caller_index=caller_index,
            leader=winner,
            in_progress=[],
            rounds_remaining=rounds_remaining - 1,
            trump_suit=trump_suit,
            my_team=my_team,
            pcc_partner_out=pcc_partner_out,
        )

    next_seat_to_play = turn_order[next_idx]
    led_suit: Suit | None = in_progress[0][1].suit if in_progress else None
    is_lead = not in_progress
    seats_with_trumps = _seats_holding_trump(sim_hands, trump_suit)

    if next_seat_to_play == caller_seat:
        if caller_index >= len(caller_order):
            return 0
        card = caller_order[caller_index]
        hand = sim_hands.get(caller_seat, [])
        if card not in hand:
            return 0
        legal = _legal_plays(
            hand=hand,
            led_suit=led_suit,
            trump_suit=trump_suit,
            is_lead=is_lead,
            seats_with_trumps=seats_with_trumps,
            seat=caller_seat,
        )
        if card not in legal:
            return 0
        return _solve_min_points(
            sim_hands=_hand_remove(sim_hands, caller_seat, card),
            caller_seat=caller_seat,
            caller_order=caller_order,
            caller_index=caller_index + 1,
            leader=leader,
            in_progress=in_progress + [(caller_seat, card)],
            rounds_remaining=rounds_remaining,
            trump_suit=trump_suit,
            my_team=my_team,
            pcc_partner_out=pcc_partner_out,
        )

    other_hand = sim_hands.get(next_seat_to_play, [])
    if not other_hand:
        return 0
    legal = _legal_plays(
        hand=other_hand,
        led_suit=led_suit,
        trump_suit=trump_suit,
        is_lead=is_lead,
        seats_with_trumps=seats_with_trumps,
        seat=next_seat_to_play,
    )
    if not legal:
        return 0
    # Adversary minimises caller's-team points.
    best: int | None = None
    for chosen in legal:
        v = _solve_min_points(
            sim_hands=_hand_remove(sim_hands, next_seat_to_play, chosen),
            caller_seat=caller_seat,
            caller_order=caller_order,
            caller_index=caller_index,
            leader=leader,
            in_progress=in_progress + [(next_seat_to_play, chosen)],
            rounds_remaining=rounds_remaining,
            trump_suit=trump_suit,
            my_team=my_team,
            pcc_partner_out=pcc_partner_out,
        )
        if best is None or v < best:
            best = v
    return best if best is not None else 0
