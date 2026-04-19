"""FastAPI backend for the 304 card game.

Thin REST wrapper around game304.Game and game304.Match.
All game logic lives in the game304 package; this server only
manages sessions and serializes state.
"""

from __future__ import annotations

import os
import sys

# Ensure the parent directory (containing game304 package) is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import random
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from game304 import (
    BidAction,
    Card,
    Game,
    Match,
    Seat,
)
from game304.errors import (
    CapsError,
    GameError,
    InvalidBidError,
    InvalidPhaseError,
    InvalidPlayError,
    InvalidTrumpSelectionError,
    NotYourTurnError,
)
from game304.types import Phase

from serializers import serialize_game_view

app = FastAPI(title="304 Card Game API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory session storage
# ---------------------------------------------------------------------------

sessions: dict[str, Match] = {}


def _get_match(match_id: str) -> Match:
    match = sessions.get(match_id)
    if match is None:
        raise HTTPException(404, detail="Session not found")
    return match


def _get_game(match_id: str) -> Game:
    match = _get_match(match_id)
    game = match.current_game
    if game is None:
        raise HTTPException(409, detail="No active game in this match")
    return game


def _game_error_to_http(exc: GameError) -> HTTPException:
    """Map a GameError subclass to an appropriate HTTP status."""
    if isinstance(exc, (InvalidPhaseError, NotYourTurnError)):
        status = 409
    elif isinstance(exc, (InvalidBidError, InvalidPlayError,
                          InvalidTrumpSelectionError, CapsError)):
        status = 400
    else:
        status = 400
    return HTTPException(
        status_code=status,
        detail={"error": str(exc), "errorType": type(exc).__name__},
    )


def _seat(value: str) -> Seat:
    try:
        return Seat(value)
    except ValueError:
        raise HTTPException(400, detail=f"Invalid seat: {value}")


def _card(value: str) -> Card:
    try:
        return Card.from_str(value)
    except (ValueError, KeyError):
        raise HTTPException(400, detail=f"Invalid card: {value}")


def _bid_action(value: str) -> BidAction:
    try:
        return BidAction(value)
    except ValueError:
        raise HTTPException(400, detail=f"Invalid bid action: {value}")


def _respond(match_id: str, game: Game) -> dict[str, Any]:
    """Build the standard response: session ID + game view."""
    view = serialize_game_view(game)
    view["matchId"] = match_id
    # Include match-level info
    match = sessions.get(match_id)
    if match:
        view["matchComplete"] = match.is_complete()
        winner = match.winner()
        view["matchWinner"] = winner.value if winner else None
        view["gameCount"] = len(match.games) + (1 if match.current_game else 0)
    return view


# ---------------------------------------------------------------------------
# Match endpoints
# ---------------------------------------------------------------------------


class NewMatchRequest(BaseModel):
    seed: int | None = None
    dealer: str = "north"


@app.post("/api/match/new")
def new_match(req: NewMatchRequest) -> dict[str, Any]:
    rng = random.Random(req.seed) if req.seed is not None else None
    dealer = _seat(req.dealer)
    match_id = str(uuid.uuid4())

    match = Match(first_dealer=dealer, rng=rng)
    sessions[match_id] = match

    game = match.new_game()
    return _respond(match_id, game)


@app.post("/api/match/{match_id}/game/new")
def new_game(match_id: str) -> dict[str, Any]:
    match = _get_match(match_id)
    try:
        game = match.new_game()
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


# ---------------------------------------------------------------------------
# Game action endpoints
# ---------------------------------------------------------------------------


@app.post("/api/game/{match_id}/deal")
def deal(match_id: str) -> dict[str, Any]:
    game = _get_game(match_id)
    try:
        game.deal_four()
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


class BidRequest(BaseModel):
    seat: str
    action: str
    value: int | None = None


@app.post("/api/game/{match_id}/bid")
def bid(match_id: str, req: BidRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    action = _bid_action(req.action)
    value = req.value or 0
    try:
        game.place_bid(seat, action, value)
    except GameError as exc:
        raise _game_error_to_http(exc)

    # If deal_eight is needed (after trump selection triggers it internally),
    # the game engine handles it. But if phase is DEALING_8, auto-deal.
    if game.phase == Phase.DEALING_8:
        game.deal_eight()

    return _respond(match_id, game)


class SeatRequest(BaseModel):
    seat: str


@app.post("/api/game/{match_id}/reshuffle")
def reshuffle(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    try:
        game.call_reshuffle(seat)
        game.deal_four()
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


@app.post("/api/game/{match_id}/redeal8")
def redeal8(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    try:
        game.call_redeal_8(seat)
        game.deal_four()
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


class TrumpRequest(BaseModel):
    seat: str
    card: str


@app.post("/api/game/{match_id}/trump")
def select_trump(match_id: str, req: TrumpRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    card = _card(req.card)
    try:
        game.select_trump(seat, card)
        # select_trump in the engine already deals 8 cards and
        # transitions to BETTING_8 internally
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


class OpenTrumpRequest(BaseModel):
    seat: str
    revealCard: str | None = None


@app.post("/api/game/{match_id}/open-trump")
def open_trump(match_id: str, req: OpenTrumpRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    reveal_card = _card(req.revealCard) if req.revealCard else None
    try:
        game.declare_open_trump(seat, reveal_card)
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


@app.post("/api/game/{match_id}/closed-trump")
def closed_trump(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    try:
        game.proceed_closed_trump(seat)
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


class PlayRequest(BaseModel):
    seat: str
    card: str


@app.post("/api/game/{match_id}/play")
def play_card(match_id: str, req: PlayRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    card = _card(req.card)
    try:
        completed_round = game.play_card(seat, card)
    except GameError as exc:
        raise _game_error_to_http(exc)

    response = _respond(match_id, game)
    if completed_round:
        from serializers import serialize
        response["completedRound"] = serialize(completed_round)
    return response


class CapsRequest(BaseModel):
    seat: str
    playOrder: list[str]


@app.post("/api/game/{match_id}/caps")
def call_caps(match_id: str, req: CapsRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    play_order = [_card(c) for c in req.playOrder]
    try:
        game.call_caps(seat, play_order)
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


@app.post("/api/game/{match_id}/spoilt")
def spoilt_trumps(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    try:
        game.call_spoilt_trumps(seat)
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


@app.post("/api/game/{match_id}/absolute")
def absolute_hand(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(req.seat)
    try:
        game.call_absolute_hand(seat)
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game)


# ---------------------------------------------------------------------------
# Query endpoints
# ---------------------------------------------------------------------------


@app.get("/api/game/{match_id}/state")
def get_state(match_id: str) -> dict[str, Any]:
    game = _get_game(match_id)
    return _respond(match_id, game)


@app.get("/api/game/{match_id}/valid-plays/{seat_str}")
def valid_plays(match_id: str, seat_str: str) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(seat_str)
    from serializers import serialize
    cards = [serialize(c) for c in game.valid_plays(seat)]
    return {"cards": cards}


@app.get("/api/game/{match_id}/hand/{seat_str}")
def get_hand(match_id: str, seat_str: str) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _seat(seat_str)
    from serializers import serialize
    cards = [serialize(c) for c in game.get_hand(seat)]
    return {"cards": cards}
