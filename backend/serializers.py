"""Serialize game304 dataclasses and enums to JSON-safe dicts."""

from __future__ import annotations

import dataclasses
from enum import Enum
from typing import Any

from game304.card import Card
from game304.deck import Deck


def serialize(obj: Any) -> Any:
    """Recursively convert game304 objects to JSON-serializable form.

    - Enums -> their .value string
    - Card -> {rank, suit, str, points}
    - Deck -> None (internal state, not exposed)
    - Dataclasses -> dict of serialized fields
    - Lists/tuples -> list of serialized items
    - Dicts -> dict with serialized keys and values
    - Primitives -> pass through
    """
    if obj is None:
        return None

    if isinstance(obj, Card):
        return {
            "rank": obj.rank.value,
            "suit": obj.suit.value,
            "str": str(obj),
            "points": obj.points,
        }

    if isinstance(obj, Deck):
        return None

    if isinstance(obj, Enum):
        return obj.value

    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {
            f.name: serialize(getattr(obj, f.name))
            for f in dataclasses.fields(obj)
        }

    if isinstance(obj, dict):
        return {serialize(k): serialize(v) for k, v in obj.items()}

    if isinstance(obj, (list, tuple)):
        return [serialize(item) for item in obj]

    return obj


def serialize_game_view(game: Any) -> dict[str, Any]:
    """Build a complete frontend-friendly view of the current game.

    Denormalizes hands and valid_plays at the top level so the frontend
    doesn't need to compute them from nested state.
    """
    from game304.types import Phase, Seat

    state = serialize(game.state)

    whose_turn = game.whose_turn()

    # Build valid_plays for all seats during playing phase
    valid_plays: dict[str, Any] = {}
    if game.phase == Phase.PLAYING:
        for seat in Seat:
            valid_plays[seat.value] = [
                serialize(c) for c in game.valid_plays(seat)
            ]

    # Build hands for all seats
    hands: dict[str, Any] = {}
    for seat in Seat:
        hands[seat.value] = [serialize(c) for c in game.get_hand(seat)]

    return {
        "phase": game.phase.value,
        "whoseTurn": whose_turn.value if whose_turn else None,
        "state": state,
        "hands": hands,
        "validPlays": valid_plays,
    }
