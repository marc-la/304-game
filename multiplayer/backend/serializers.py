"""Serialize game304 dataclasses and enums to JSON-safe dicts.

The view is **per-viewer**: hands, validPlays, the folded trump card,
trump suit (in Closed Trump pre-reveal), face-down round entries, and
caps obligations are all redacted based on the viewer's seat. Pass
``viewer_seat=None`` only for solo/test paths where no roster has been
registered for the match — otherwise multi-player secrecy is broken.
"""

from __future__ import annotations

import dataclasses
from enum import Enum
from typing import Any

from game304.card import Card
from game304.deck import Deck
from game304.state import CompletedRound, RoundEntry
from game304.types import Phase, Seat


def serialize(obj: Any) -> Any:
    """Recursively convert game304 objects to JSON-serializable form."""
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


def _redact_entry(entry: RoundEntry, viewer_seat: Seat | None) -> dict[str, Any]:
    """Hide a face-down, unrevealed card unless the viewer played it.

    Per invariant S7: revealed face-down cards (= face-down trumps after
    a cut) are visible to all; unrevealed face-down cards (= minuses)
    stay hidden to everyone except the player who played them.
    """
    visible = (
        not entry.face_down
        or entry.revealed
        or (viewer_seat is not None and entry.seat == viewer_seat)
    )
    return {
        "seat": entry.seat.value,
        "face_down": entry.face_down,
        "revealed": entry.revealed,
        "card": serialize(entry.card) if visible else None,
    }


def _redact_completed(
    cr: CompletedRound, viewer_seat: Seat | None
) -> dict[str, Any]:
    return {
        "round_number": cr.round_number,
        "winner": cr.winner.value,
        "points_won": cr.points_won,
        "trump_revealed": cr.trump_revealed,
        "cards": [_redact_entry(e, viewer_seat) for e in cr.cards],
    }


def serialize_completed_round(
    cr: CompletedRound, viewer_seat: Seat | None
) -> dict[str, Any]:
    """Per-viewer projection of a completed round (for play responses)."""
    return _redact_completed(cr, viewer_seat)


def serialize_game_view(
    game: Any, viewer_seat: Seat | None = None
) -> dict[str, Any]:
    """Build a per-viewer game view.

    Hand secrecy:
    - Only ``viewer_seat``'s hand is included as cards. Other seats
      report their card count via ``handCounts`` (for face-down stack
      rendering); ``hands[other]`` is an empty list.
    - Trump card and trump suit are redacted in Closed Trump pre-reveal
      for non-trumpers.
    - Face-down round entries hide the actual card unless revealed or
      played by the viewer.
    - ``caps_obligations`` is filtered to the viewer's own entry.
    - When the game is COMPLETE, all hands are revealed for scrutiny.
    """
    state_dict = serialize(game.state)
    is_complete = game.phase == Phase.COMPLETE
    trump = game.state.trump
    is_trumper = (
        viewer_seat is not None and viewer_seat == trump.trumper_seat
    )
    trump_known = (
        is_trumper or trump.is_revealed or trump.is_open or is_complete
    )

    # Hands (cards) and handCounts (counts visible to all).
    hands: dict[str, list[Any]] = {}
    hand_counts: dict[str, int] = {}
    for seat in Seat:
        cards = game.get_hand(seat)
        hand_counts[seat.value] = len(cards)
        if (
            viewer_seat is None
            or is_complete
            or seat == viewer_seat
        ):
            hands[seat.value] = [serialize(c) for c in cards]
        else:
            hands[seat.value] = []

    # Valid plays — only the viewer's, and only during the play phase.
    valid_plays: dict[str, list[Any]] = {}
    if game.phase == Phase.PLAYING:
        if viewer_seat is None:
            # Solo/test path — emit for all seats (legacy behaviour).
            for seat in Seat:
                valid_plays[seat.value] = [
                    serialize(c) for c in game.valid_plays(seat)
                ]
        else:
            valid_plays[viewer_seat.value] = [
                serialize(c) for c in game.valid_plays(viewer_seat)
            ]

    # Trump card / suit redaction in Closed Trump pre-reveal.
    if not trump_known and state_dict.get("trump"):
        state_dict["trump"]["trump_card"] = None
        state_dict["trump"]["trump_suit"] = None

    # Round entry redaction.
    play = game.state.play
    if play is not None and state_dict.get("play") is not None:
        state_dict["play"]["current_round"] = [
            _redact_entry(e, viewer_seat) for e in play.current_round
        ]
        state_dict["play"]["completed_rounds"] = [
            _redact_completed(cr, viewer_seat) for cr in play.completed_rounds
        ]
        if viewer_seat is not None:
            obs = play.caps_obligations.get(viewer_seat)
            state_dict["play"]["caps_obligations"] = (
                {viewer_seat.value: serialize(obs)} if obs else {}
            )

    whose_turn = game.whose_turn()
    return {
        "phase": game.phase.value,
        "whoseTurn": whose_turn.value if whose_turn else None,
        "viewerSeat": viewer_seat.value if viewer_seat else None,
        "state": state_dict,
        "hands": hands,
        "handCounts": hand_counts,
        "validPlays": valid_plays,
    }
