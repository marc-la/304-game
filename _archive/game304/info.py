"""Information-set construction and world enumeration for caps analysis.

Implements §3 (information sets) and §4 (worlds) of
``docs/caps_formalism.md``. Caps obligation is a property of what a
player knows, not of the actual deal — this module is the bridge
between the authoritative game state and the candidate caller's
epistemic view.

Two public entry points:

- :func:`build_info_set` returns the candidate caller's
  :class:`InformationSet` at the current play-phase state.
- :func:`enumerate_worlds` yields every consistent :class:`World`: a
  card assignment to every other seat's future-playable hand (and to
  every face-down completed-round entry whose identity the viewer
  cannot see) that respects every constraint in the information set.

A third helper, :func:`world_is_consistent`, verifies a world against
an information set — useful for tests and for sanity-checking the
actual deal against the enumerator output.

This module performs no game-tree search. It is purely a finite-CSP
solver over card locations.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from typing import Iterator

from game304.card import Card
from game304.deck import create_pack
from game304.seating import team_of
from game304.state import GameState, RoundEntry
from game304.types import Seat, Suit, Team


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HiddenSlot:
    """A face-down completed-round entry whose identity the viewer cannot see.

    Concretely: an opponent or partner minus when the viewer is not the
    trumper, or any face-down play whose identity the viewer never
    learned. The slot constrains whatever card eventually fills it via
    W4 — its suit cannot be the led suit of its round, and (when the
    trump suit is fixed) cannot be the trump suit either.

    Attributes:
        seat: The player who folded the card.
        round_number: The round in which the card was folded.
        led_suit: The led suit of that round.
    """

    seat: Seat
    round_number: int
    led_suit: Suit


@dataclass
class InformationSet:
    """``I_V(S)`` — everything viewer ``V`` knows at play-phase state ``S``.

    Built by :func:`build_info_set`; consumed by
    :func:`enumerate_worlds`. Maps directly onto the six clauses of
    §3 in ``docs/caps_formalism.md``.

    Attributes:
        viewer: The seat whose information set this is.
        own_hand: ``V``'s current playable cards (excluding the folded
            trump card when ``V`` is the trumper — that is held in
            ``known_folded_trump_card``).
        trump_suit: Trump suit if known to ``V``, else ``None``. Known
            iff ``V`` is the trumper, or trump has been revealed, or
            Open Trump was declared.
        known_folded_trump_card: Identity of the folded trump card on
            the table, if ``V`` knows it. Set iff ``V`` is the trumper
            and the folded card is still on the table.
        folded_trump_on_table: Whether the folded trump card is on the
            table at all (independent of whether ``V`` knows its
            identity). When True and ``V`` is not the trumper, an
            extra unknown card slot belongs to the trumper.
        trumper_seat: The trumper's seat (None if uninitialised).
        hand_sizes: Future-playable hand size per non-PCC-out seat.
            Excludes the folded trump card; that's tracked separately
            via ``folded_trump_on_table``.
        exhausted_suits: Suits each seat is publicly known to be out of
            (clause 5). Includes the viewer's own seat for symmetry —
            naturally empty for the viewer themselves since they know
            their hand directly.
        known_played: All card identities ``V`` knows are in completed
            rounds or in the in-progress round.
        hidden_slots: Face-down completed-round entries whose identity
            is hidden from ``V`` (and the in-progress face-down entries
            whose identity is hidden, treated symmetrically).
        pcc_partner_out: The PCC-out seat, or ``None``.
        completed_round_winners: Per-round winner sequence so far.
        team_won_all_completed: Whether ``V``'s team has won every
            completed round (the obligation precondition).
        is_viewer_trumper: Convenience flag.
    """

    viewer: Seat
    own_hand: tuple[Card, ...]
    trump_suit: Suit | None
    known_folded_trump_card: Card | None
    folded_trump_on_table: bool
    trumper_seat: Seat | None
    hand_sizes: dict[Seat, int]
    exhausted_suits: dict[Seat, frozenset[Suit]]
    known_played: frozenset[Card]
    hidden_slots: tuple[HiddenSlot, ...]
    pcc_partner_out: Seat | None
    completed_round_winners: tuple[Seat, ...]
    team_won_all_completed: bool
    is_viewer_trumper: bool


@dataclass(frozen=True)
class World:
    """A consistent allocation of every unaccounted-for card.

    A world fixes:

    - The future-playable hand of every non-PCC-out seat (including
      the viewer's, copied from their known hand).
    - The trump suit (resolved to a concrete suit even if the viewer
      did not know it directly).
    - The identity of the folded trump card if it's still on the table.
    - The identity of every hidden face-down entry.

    The folded trump card, when on the table in a world, is *not*
    duplicated in ``hands[trumper]`` — it lives separately in
    ``folded_trump_card``. Consumers wanting the trumper's full
    playable set should union the two.

    Worlds are yielded in deterministic order so tests are
    reproducible.

    Attributes:
        hands: ``seat → tuple[Card, ...]`` for every non-PCC-out seat,
            including the viewer.
        trump_suit: The trump suit in this world.
        folded_trump_card: The folded trump card if still on the table
            in this world, else ``None``.
        hidden_slot_assignments: Card identity assigned to each hidden
            slot, keyed by the slot's ``(seat, round_number)`` pair.
    """

    hands: dict[Seat, tuple[Card, ...]]
    trump_suit: Suit
    folded_trump_card: Card | None
    hidden_slot_assignments: dict[tuple[Seat, int], Card]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_info_set(state: GameState, viewer: Seat) -> InformationSet:
    """Construct ``I_V(S)`` for ``viewer`` at the current play-phase state.

    Implements §3 of ``docs/caps_formalism.md``. The viewer must be a
    non-PCC-out seat with cards in play.

    Raises:
        ValueError: If the state is not in the play phase, or the
            viewer is the PCC-out seat, or the play state is missing.
    """
    play = state.play
    if play is None:
        raise ValueError("Cannot build information set outside the play phase.")
    if state.pcc_partner_out == viewer:
        raise ValueError("PCC-out seat has no information set in play.")

    trump = state.trump
    is_viewer_trumper = viewer == trump.trumper_seat
    folded_on_table = (
        trump.trump_card is not None and not trump.trump_card_in_hand
    )
    trump_suit_known = (
        is_viewer_trumper or trump.is_revealed or trump.is_open
    )
    trump_suit = trump.trump_suit if trump_suit_known else None
    known_folded_card = (
        trump.trump_card if (is_viewer_trumper and folded_on_table) else None
    )

    own_hand = tuple(state.hands.get(viewer, []))

    hand_sizes: dict[Seat, int] = {}
    for s in Seat:
        if state.pcc_partner_out == s:
            continue
        hand_sizes[s] = len(state.hands.get(s, []))

    # Suit exhaustion (clause 5): off-suit plays to a led-suit round.
    # Both completed rounds and the in-progress round contribute, since
    # exhaustion deduced mid-round is equally valid information.
    exhausted: dict[Seat, set[Suit]] = {s: set() for s in Seat}
    for r in play.completed_rounds:
        led = _entry_led_suit(r.cards)
        if led is None:
            continue
        for entry in r.cards:
            if _is_off_led_suit(entry, led):
                exhausted[entry.seat].add(led)
    if play.current_round:
        cur_led = _entry_led_suit(play.current_round)
        if cur_led is not None:
            for entry in play.current_round:
                if _is_off_led_suit(entry, cur_led):
                    exhausted[entry.seat].add(cur_led)

    # Known-played identities and hidden slots, per V's perspective.
    known_played: set[Card] = set()
    hidden_slots: list[HiddenSlot] = []

    def absorb_round(
        round_number: int, cards: list[RoundEntry], in_completed: bool
    ) -> None:
        led = _entry_led_suit(cards)
        for entry in cards:
            if _viewer_knows_identity(
                entry, viewer, is_viewer_trumper, in_completed
            ):
                known_played.add(entry.card)
            else:
                # Face-down, identity unknown to V. We require the led
                # suit to be defined (the leader plays face-up, so this
                # is always true in legal states); if not, skip
                # defensively.
                if led is None:
                    continue
                hidden_slots.append(
                    HiddenSlot(
                        seat=entry.seat,
                        round_number=round_number,
                        led_suit=led,
                    )
                )

    for r in play.completed_rounds:
        absorb_round(r.round_number, r.cards, in_completed=True)
    if play.current_round:
        absorb_round(play.round_number, play.current_round, in_completed=False)

    # Did V's team win every completed round so far?
    my_team = team_of(viewer)
    team_won_all = all(
        team_of(r.winner) == my_team for r in play.completed_rounds
    )

    return InformationSet(
        viewer=viewer,
        own_hand=own_hand,
        trump_suit=trump_suit,
        known_folded_trump_card=known_folded_card,
        folded_trump_on_table=folded_on_table,
        trumper_seat=trump.trumper_seat,
        hand_sizes=hand_sizes,
        exhausted_suits={s: frozenset(v) for s, v in exhausted.items()},
        known_played=frozenset(known_played),
        hidden_slots=tuple(hidden_slots),
        pcc_partner_out=state.pcc_partner_out,
        completed_round_winners=tuple(r.winner for r in play.completed_rounds),
        team_won_all_completed=team_won_all,
        is_viewer_trumper=is_viewer_trumper,
    )


def enumerate_worlds(
    info: InformationSet,
    *,
    max_worlds: int | None = None,
) -> Iterator[World]:
    """Yield every world consistent with ``info``.

    Implements §4 of ``docs/caps_formalism.md`` (constraints W1–W5).
    Worlds are yielded in deterministic order so tests are
    reproducible.

    The actual deal at the time the information set was built is
    always among the yielded worlds (verifiable via
    :func:`world_is_consistent`).

    Args:
        info: The viewer's information set.
        max_worlds: If set, stop after yielding this many worlds. Used
            by callers that want to bail out of pathologically large
            world spaces (e.g. round 1, no exhaustion). The natural
            late-game count is small enough that this is rarely
            needed.

    Yields:
        Worlds, one per consistent assignment.
    """
    pack = frozenset(create_pack())

    # Cards V already knows the location of:
    #   - own hand
    #   - all known_played
    #   - the folded trump card if V is the trumper
    own_known: set[Card] = set(info.own_hand)
    if info.known_folded_trump_card is not None:
        own_known.add(info.known_folded_trump_card)
    own_known |= info.known_played

    unknown = sorted(pack - own_known, key=str)
    # ``unknown`` is the union of:
    #   - cards in other seats' future-playable hands,
    #   - cards in hidden face-down slots,
    #   - the folded trump card (when V is not the trumper but it's on
    #     the table).
    # Total slot capacity must equal len(unknown); this is W1.

    # Trump-suit hypotheses.
    if info.trump_suit is not None:
        trump_candidates: list[Suit] = [info.trump_suit]
    else:
        trump_candidates = list(Suit)

    yielded = 0
    for trump_suit in trump_candidates:
        for world in _enumerate_for_trump(info, trump_suit, unknown):
            yield world
            yielded += 1
            if max_worlds is not None and yielded >= max_worlds:
                return


def world_is_consistent(world: World, info: InformationSet) -> bool:
    """Check whether ``world`` satisfies every constraint of ``info``.

    Implements W1–W5 as a verifier. Symmetric with
    :func:`enumerate_worlds`: every world the enumerator yields must
    satisfy this predicate, and every world that satisfies this
    predicate is in the enumerator's output.

    Useful for testing and for confirming the actual deal lies in the
    enumerated space.
    """
    pack = frozenset(create_pack())

    # Trump suit must agree with V's knowledge if V knew it.
    if info.trump_suit is not None and world.trump_suit != info.trump_suit:
        return False

    # All seats present.
    expected_seats = {s for s in Seat if s != info.pcc_partner_out}
    if set(world.hands) != expected_seats:
        return False

    # Hand sizes match (W2). Trumper holds an extra slot for the folded
    # card when on the table — that's the folded_trump_card field, not
    # part of hands[trumper].
    for seat, expected in info.hand_sizes.items():
        if len(world.hands.get(seat, ())) != expected:
            return False

    # Folded trump card status (W1 + trumper bookkeeping).
    if info.folded_trump_on_table:
        if world.folded_trump_card is None:
            return False
        if world.folded_trump_card.suit != world.trump_suit:
            return False
        if (
            info.known_folded_trump_card is not None
            and world.folded_trump_card != info.known_folded_trump_card
        ):
            return False
    else:
        if world.folded_trump_card is not None:
            return False

    # Suit exhaustion (W3).
    for seat, suits in info.exhausted_suits.items():
        if seat not in world.hands:
            continue
        for c in world.hands[seat]:
            if c.suit in suits:
                return False

    # Hidden-slot identities (W4): suit ≠ led_suit of the round, and
    # suit ≠ trump_suit.
    slot_index = {
        (s.seat, s.round_number): s for s in info.hidden_slots
    }
    if set(world.hidden_slot_assignments) != set(slot_index):
        return False
    for key, card in world.hidden_slot_assignments.items():
        slot = slot_index[key]
        if card.suit == slot.led_suit or card.suit == world.trump_suit:
            return False

    # Identity agreement and viewer's own hand (W5).
    if set(world.hands.get(info.viewer, ())) != set(info.own_hand):
        return False

    # Card conservation (W1) — the disjoint union of every location
    # equals the pack.
    seen: list[Card] = []
    for cards in world.hands.values():
        seen.extend(cards)
    if world.folded_trump_card is not None:
        seen.append(world.folded_trump_card)
    seen.extend(world.hidden_slot_assignments.values())
    seen.extend(info.known_played)
    if len(seen) != len(set(seen)):
        return False  # duplicate
    if frozenset(seen) != pack:
        return False  # missing cards somewhere

    return True


# ---------------------------------------------------------------------------
# Internal: world enumeration
# ---------------------------------------------------------------------------


def _enumerate_for_trump(
    info: InformationSet,
    trump_suit: Suit,
    unknown: list[Card],
) -> Iterator[World]:
    """Yield all consistent worlds for one trump-suit hypothesis."""
    # Build the slot list. Order matters for performance: the most
    # constrained slots (single-card with strict suit constraints)
    # come first.

    slots: list[_Slot] = []

    # Hidden face-down slots: 1 card each, suit not in {led_suit, trump_suit}.
    for hs in info.hidden_slots:
        forbidden = frozenset({hs.led_suit, trump_suit})
        slots.append(
            _Slot(
                key=("hidden", hs.seat, hs.round_number),
                size=1,
                forbidden_suits=forbidden,
                allowed_suits=None,
            )
        )

    # Folded trump card (only if V doesn't already know it).
    folded_slot_key: tuple | None = None
    if info.folded_trump_on_table and info.known_folded_trump_card is None:
        folded_slot_key = ("folded_trump", info.trumper_seat)
        slots.append(
            _Slot(
                key=folded_slot_key,
                size=1,
                forbidden_suits=frozenset(),
                allowed_suits=frozenset({trump_suit}),
            )
        )

    # Each non-V, non-PCC-out seat's hand.
    hand_slots_by_seat: dict[Seat, _Slot] = {}
    for seat, size in info.hand_sizes.items():
        if seat == info.viewer:
            continue
        slot = _Slot(
            key=("hand", seat),
            size=size,
            forbidden_suits=info.exhausted_suits.get(seat, frozenset()),
            allowed_suits=None,
        )
        hand_slots_by_seat[seat] = slot
        slots.append(slot)

    # Sanity: total capacity must match unknown card count (W1).
    total_capacity = sum(s.size for s in slots)
    if total_capacity != len(unknown):
        return

    # Backtracking distribution: assign cards to slots one slot at a
    # time, smallest (most constrained) first.
    slots_sorted = sorted(slots, key=_slot_priority)

    def materialise(
        assignments: dict[tuple, list[Card]],
    ) -> World:
        hands: dict[Seat, tuple[Card, ...]] = {}
        # Viewer's hand is fixed.
        hands[info.viewer] = tuple(sorted(info.own_hand, key=str))
        for seat in info.hand_sizes:
            if seat == info.viewer:
                continue
            cards = assignments.get(("hand", seat), [])
            hands[seat] = tuple(sorted(cards, key=str))

        folded: Card | None
        if info.folded_trump_on_table:
            if info.known_folded_trump_card is not None:
                folded = info.known_folded_trump_card
            else:
                folded = assignments[folded_slot_key][0]  # type: ignore[index]
        else:
            folded = None

        hidden_assigns: dict[tuple[Seat, int], Card] = {}
        for hs in info.hidden_slots:
            cards = assignments[("hidden", hs.seat, hs.round_number)]
            hidden_assigns[(hs.seat, hs.round_number)] = cards[0]

        return World(
            hands=hands,
            trump_suit=trump_suit,
            folded_trump_card=folded,
            hidden_slot_assignments=hidden_assigns,
        )

    yield from _backtrack(
        slots_sorted, unknown, {}, materialise
    )


@dataclass
class _Slot:
    """Internal: a destination needing ``size`` cards under suit constraints."""

    key: tuple
    size: int
    forbidden_suits: frozenset[Suit]
    allowed_suits: frozenset[Suit] | None  # None = any suit not in forbidden


def _slot_priority(slot: _Slot) -> tuple:
    """Sort key: smaller size first, then more restrictive constraints first."""
    restrictiveness = (
        0 if slot.allowed_suits is not None else len(slot.forbidden_suits)
    )
    # Negative restrictiveness so that more-restrictive comes first.
    return (slot.size, -restrictiveness)


def _slot_accepts(slot: _Slot, card: Card) -> bool:
    if slot.allowed_suits is not None and card.suit not in slot.allowed_suits:
        return False
    if card.suit in slot.forbidden_suits:
        return False
    return True


def _backtrack(
    slots: list[_Slot],
    remaining: list[Card],
    assignments: dict[tuple, list[Card]],
    materialise,
) -> Iterator[World]:
    if not slots:
        if not remaining:
            yield materialise(assignments)
        return

    head, *tail = slots
    eligible = [c for c in remaining if _slot_accepts(head, c)]
    if len(eligible) < head.size:
        return

    # Use combinations over the indices of ``remaining`` so we can
    # cheaply build the leftover list.
    eligible_set = set(eligible)
    for combo in itertools.combinations(eligible, head.size):
        chosen = list(combo)
        chosen_set = set(chosen)
        new_remaining = [c for c in remaining if c not in chosen_set]
        # Only correct because cards are unique within the pack.
        assignments[head.key] = chosen
        yield from _backtrack(tail, new_remaining, assignments, materialise)
        del assignments[head.key]
    # Suppress unused-variable warning for the eligibility precheck.
    del eligible_set


# ---------------------------------------------------------------------------
# Internal: helpers
# ---------------------------------------------------------------------------


def _entry_led_suit(entries: list[RoundEntry]) -> Suit | None:
    """Suit of the first face-up entry, or None if none yet face-up."""
    for entry in entries:
        if not entry.face_down:
            return entry.card.suit
    return None


def _is_off_led_suit(entry: RoundEntry, led_suit: Suit) -> bool:
    """Whether this entry establishes its seat as exhausted of ``led_suit``.

    A face-down play in closed-trump pre-reveal *always* indicates
    inability to follow (per the closed-trump rules). A face-up play
    of a different suit also indicates inability to follow.
    """
    if entry.face_down:
        return True
    return entry.card.suit != led_suit


def _viewer_knows_identity(
    entry: RoundEntry,
    viewer: Seat,
    viewer_is_trumper: bool,
    in_completed_round: bool,
) -> bool:
    """Whether the viewer can identify this round entry.

    Identity is known when:

    - the entry was face-up (everyone sees it);
    - the entry was face-down but later revealed (everyone sees it);
    - the viewer played the entry themselves;
    - the viewer is the trumper **and** the entry sits in a completed
      round (the trumper inspects face-downs at end-of-round
      resolution — not before; so in-progress face-downs remain hidden
      to the trumper too, per ``docs/caps_formalism.md`` §3 clause 6).
    """
    if not entry.face_down:
        return True
    if entry.revealed:
        return True
    if entry.seat == viewer:
        return True
    if viewer_is_trumper and in_completed_round:
        return True
    return False
