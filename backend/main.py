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
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
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

from lobby import LobbyError, LobbyStore, new_player_id
from serializers import serialize_completed_round, serialize_game_view

app = FastAPI(title="304 Card Game API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory storage
# ---------------------------------------------------------------------------

sessions: dict[str, Match] = {}
lobby_store: LobbyStore = LobbyStore()

# matchId → {seat: playerId}. Populated when a lobby starts a match.
# When absent (solo/test path), endpoints fall back to reading ``seat``
# from the request body — no auth, but tests and solo dev keep working.
match_rosters: dict[str, dict[Seat, str]] = {}


def _resolve_seat(
    match_id: str,
    player_id: str | None,
    fallback_seat: str | None = None,
) -> Seat:
    """Resolve the acting seat for a request.

    If a roster exists for ``match_id``, ``player_id`` must be present
    and map to a seat — this is the lobby-authenticated path. Otherwise
    (solo/dev), fall back to ``fallback_seat`` from the request body.
    """
    roster = match_rosters.get(match_id)
    if roster is not None:
        if not player_id:
            raise HTTPException(
                403,
                detail={"error": "playerId required.", "errorType": "AuthError"},
            )
        for seat, pid in roster.items():
            if pid == player_id:
                return seat
        raise HTTPException(
            403,
            detail={
                "error": "You are not seated in this match.",
                "errorType": "AuthError",
            },
        )
    if fallback_seat is None:
        raise HTTPException(
            400, detail="seat or playerId required for this match"
        )
    return _seat(fallback_seat)


def _viewer_for(match_id: str, player_id: str | None) -> Seat | None:
    """Best-effort viewer lookup for redaction. None for solo path."""
    roster = match_rosters.get(match_id)
    if roster is None or not player_id:
        return None
    for seat, pid in roster.items():
        if pid == player_id:
            return seat
    return None


def _lobby_error_to_http(exc: LobbyError) -> HTTPException:
    """Map a LobbyError to an appropriate HTTP status.

    - 404: resource not found
    - 403: permission / authorisation failures (host-only actions, self-kick)
    - 409: resource state conflict (full lobby, already started, taken
      name/avatar, unbalanced teams, seats not filled)
    - 400: malformed or invalid input (bad seat name, bad avatar, etc.)
    """
    msg = str(exc)
    lower = msg.lower()
    if "not found" in lower:
        status = 404
    elif (
        "only the host" in lower
        or "kick yourself" in lower
        or "not in this lobby" in lower
    ):
        status = 403
    elif (
        "full" in lower
        or "already" in lower
        or "taken" in lower
        or "2 vs 2" in lower
        or "seats are filled" in lower
        or "started" in lower
    ):
        status = 409
    else:
        status = 400
    return HTTPException(status_code=status, detail={"error": msg, "errorType": "LobbyError"})


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


def _respond(
    match_id: str, game: Game, viewer: Seat | None = None
) -> dict[str, Any]:
    """Build the standard response: session ID + per-viewer game view."""
    view = serialize_game_view(game, viewer)
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
    """Create a solo/test match (no roster, no auth)."""
    rng = random.Random(req.seed) if req.seed is not None else None
    dealer = _seat(req.dealer)
    match_id = str(uuid.uuid4())

    match = Match(first_dealer=dealer, rng=rng)
    sessions[match_id] = match

    game = match.new_game()
    return _respond(match_id, game)


@app.post("/api/match/{match_id}/game/new")
def new_game(
    match_id: str, playerId: str | None = None
) -> dict[str, Any]:
    match = _get_match(match_id)
    try:
        game = match.new_game()
    except GameError as exc:
        raise _game_error_to_http(exc)
    return _respond(match_id, game, _viewer_for(match_id, playerId))


# ---------------------------------------------------------------------------
# Game action endpoints
# ---------------------------------------------------------------------------


class DealRequest(BaseModel):
    playerId: str | None = None


@app.post("/api/game/{match_id}/deal")
def deal(match_id: str, req: DealRequest | None = None) -> dict[str, Any]:
    game = _get_game(match_id)
    try:
        game.deal_four()
    except GameError as exc:
        raise _game_error_to_http(exc)
    pid = req.playerId if req else None
    return _respond(match_id, game, _viewer_for(match_id, pid))


class BidRequest(BaseModel):
    playerId: str | None = None
    seat: str | None = None
    action: str
    value: int | None = None


@app.post("/api/game/{match_id}/bid")
def bid(match_id: str, req: BidRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
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

    viewer = _viewer_for(match_id, req.playerId) or seat
    return _respond(match_id, game, viewer)


class SeatRequest(BaseModel):
    playerId: str | None = None
    seat: str | None = None


@app.post("/api/game/{match_id}/reshuffle")
def reshuffle(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
    try:
        game.call_reshuffle(seat)
        game.deal_four()
    except GameError as exc:
        raise _game_error_to_http(exc)
    viewer = _viewer_for(match_id, req.playerId) or seat
    return _respond(match_id, game, viewer)


@app.post("/api/game/{match_id}/redeal8")
def redeal8(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
    try:
        game.call_redeal_8(seat)
        game.deal_four()
    except GameError as exc:
        raise _game_error_to_http(exc)
    viewer = _viewer_for(match_id, req.playerId) or seat
    return _respond(match_id, game, viewer)


class TrumpRequest(BaseModel):
    playerId: str | None = None
    seat: str | None = None
    card: str


@app.post("/api/game/{match_id}/trump")
def select_trump(match_id: str, req: TrumpRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
    card = _card(req.card)
    try:
        game.select_trump(seat, card)
        # select_trump in the engine already deals 8 cards and
        # transitions to BETTING_8 internally
    except GameError as exc:
        raise _game_error_to_http(exc)
    viewer = _viewer_for(match_id, req.playerId) or seat
    return _respond(match_id, game, viewer)


class OpenTrumpRequest(BaseModel):
    playerId: str | None = None
    seat: str | None = None
    revealCard: str | None = None


@app.post("/api/game/{match_id}/open-trump")
def open_trump(match_id: str, req: OpenTrumpRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
    reveal_card = _card(req.revealCard) if req.revealCard else None
    try:
        game.declare_open_trump(seat, reveal_card)
    except GameError as exc:
        raise _game_error_to_http(exc)
    viewer = _viewer_for(match_id, req.playerId) or seat
    return _respond(match_id, game, viewer)


@app.post("/api/game/{match_id}/closed-trump")
def closed_trump(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
    try:
        game.proceed_closed_trump(seat)
    except GameError as exc:
        raise _game_error_to_http(exc)
    viewer = _viewer_for(match_id, req.playerId) or seat
    return _respond(match_id, game, viewer)


class PlayRequest(BaseModel):
    playerId: str | None = None
    seat: str | None = None
    card: str


@app.post("/api/game/{match_id}/play")
def play_card(match_id: str, req: PlayRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
    card = _card(req.card)
    try:
        completed_round = game.play_card(seat, card)
    except GameError as exc:
        raise _game_error_to_http(exc)

    viewer = _viewer_for(match_id, req.playerId) or seat
    response = _respond(match_id, game, viewer)
    if completed_round:
        response["completedRound"] = serialize_completed_round(
            completed_round, viewer
        )
    return response


class CapsRequest(BaseModel):
    playerId: str | None = None
    seat: str | None = None
    playOrder: list[str]


@app.post("/api/game/{match_id}/caps")
def call_caps(match_id: str, req: CapsRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
    play_order = [_card(c) for c in req.playOrder]
    try:
        game.call_caps(seat, play_order)
    except GameError as exc:
        raise _game_error_to_http(exc)
    viewer = _viewer_for(match_id, req.playerId) or seat
    return _respond(match_id, game, viewer)


@app.post("/api/game/{match_id}/spoilt")
def spoilt_trumps(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
    try:
        game.call_spoilt_trumps(seat)
    except GameError as exc:
        raise _game_error_to_http(exc)
    viewer = _viewer_for(match_id, req.playerId) or seat
    return _respond(match_id, game, viewer)


@app.post("/api/game/{match_id}/absolute")
def absolute_hand(match_id: str, req: SeatRequest) -> dict[str, Any]:
    game = _get_game(match_id)
    seat = _resolve_seat(match_id, req.playerId, req.seat)
    try:
        game.call_absolute_hand(seat)
    except GameError as exc:
        raise _game_error_to_http(exc)
    viewer = _viewer_for(match_id, req.playerId) or seat
    return _respond(match_id, game, viewer)


# ---------------------------------------------------------------------------
# Query endpoints
# ---------------------------------------------------------------------------


@app.get("/api/game/{match_id}/state")
def get_state(
    match_id: str,
    playerId: str | None = None,
    seat: str | None = None,
) -> dict[str, Any]:
    """Return the per-viewer game view.

    Lobby-spawned matches require ``playerId``; solo matches accept the
    legacy ``seat`` query parameter (or no parameter — full omniscient
    view, used by tests).
    """
    game = _get_game(match_id)
    viewer = _viewer_for(match_id, playerId)
    if viewer is None and seat is not None:
        viewer = _seat(seat)
    return _respond(match_id, game, viewer)


@app.get("/api/game/{match_id}/valid-plays/{seat_str}")
def valid_plays(
    match_id: str, seat_str: str, playerId: str | None = None
) -> dict[str, Any]:
    """Return valid plays for a seat. Auth-gated: in a lobby match, the
    requesting player can only query their own seat."""
    game = _get_game(match_id)
    seat = _seat(seat_str)
    roster = match_rosters.get(match_id)
    if roster is not None:
        viewer = _viewer_for(match_id, playerId)
        if viewer is None or viewer != seat:
            raise HTTPException(
                403,
                detail={
                    "error": "You may only query your own seat.",
                    "errorType": "AuthError",
                },
            )
    from serializers import serialize
    cards = [serialize(c) for c in game.valid_plays(seat)]
    return {"cards": cards}


@app.get("/api/game/{match_id}/hand/{seat_str}")
def get_hand(
    match_id: str, seat_str: str, playerId: str | None = None
) -> dict[str, Any]:
    """Return a hand. In a lobby match, only the player at that seat
    may request it (or anyone, once the game is COMPLETE)."""
    game = _get_game(match_id)
    seat = _seat(seat_str)
    roster = match_rosters.get(match_id)
    if roster is not None and game.phase != Phase.COMPLETE:
        viewer = _viewer_for(match_id, playerId)
        if viewer is None or viewer != seat:
            raise HTTPException(
                403,
                detail={
                    "error": "You may only request your own hand.",
                    "errorType": "AuthError",
                },
            )
    from serializers import serialize
    cards = [serialize(c) for c in game.get_hand(seat)]
    return {"cards": cards}


# ---------------------------------------------------------------------------
# Lobby endpoints
# ---------------------------------------------------------------------------


class LobbyHostRequest(BaseModel):
    playerId: str


class LobbyJoinRequest(BaseModel):
    playerId: str


class LobbyTeamRequest(BaseModel):
    playerId: str
    targetSeat: str
    newTeam: str


class LobbyProfileRequest(BaseModel):
    playerId: str
    name: str | None = None
    avatar: str | None = None


class LobbyKickRequest(BaseModel):
    playerId: str
    targetSeat: str


class LobbyPlayerRequest(BaseModel):
    playerId: str


def _lobby_response(code: str) -> dict[str, Any]:
    """Refresh staleness flags then serialize the lobby."""
    lobby_store.reap_stale()
    lobby = lobby_store.get(code)
    return lobby.to_view()


@app.post("/api/lobby/identity")
def lobby_identity() -> dict[str, str]:
    """Mint a fresh player ID for first-time clients.

    The client should persist the returned id in localStorage and
    pass it as ``playerId`` in subsequent requests.
    """
    return {"playerId": new_player_id()}


@app.post("/api/lobby/host")
def lobby_host(req: LobbyHostRequest) -> dict[str, Any]:
    try:
        lobby = lobby_store.create(req.playerId)
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)
    return {"code": lobby.code, "seat": "north", "lobby": lobby.to_view()}


@app.post("/api/lobby/{code}/join")
def lobby_join(code: str, req: LobbyJoinRequest) -> dict[str, Any]:
    try:
        lobby, seat = lobby_store.join(code, req.playerId)
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)
    return {"code": lobby.code, "seat": seat, "lobby": lobby.to_view()}


@app.post("/api/lobby/{code}/leave")
def lobby_leave(code: str, req: LobbyPlayerRequest) -> dict[str, Any]:
    try:
        result = lobby_store.leave(code, req.playerId)
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)
    return {"deleted": result is None, "lobby": result.to_view() if result else None}


@app.post("/api/lobby/{code}/team")
def lobby_team(code: str, req: LobbyTeamRequest) -> dict[str, Any]:
    try:
        lobby = lobby_store.update_team(code, req.playerId, req.targetSeat, req.newTeam)
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)
    return {"lobby": lobby.to_view()}


@app.post("/api/lobby/{code}/profile")
def lobby_profile(code: str, req: LobbyProfileRequest) -> dict[str, Any]:
    try:
        lobby = lobby_store.update_profile(
            code, req.playerId, name=req.name, avatar=req.avatar,
        )
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)
    return {"lobby": lobby.to_view()}


@app.post("/api/lobby/{code}/kick")
def lobby_kick(code: str, req: LobbyKickRequest) -> dict[str, Any]:
    try:
        lobby = lobby_store.kick(code, req.playerId, req.targetSeat)
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)
    return {"lobby": lobby.to_view()}


@app.post("/api/lobby/{code}/heartbeat")
def lobby_heartbeat(code: str, req: LobbyPlayerRequest) -> dict[str, Any]:
    try:
        lobby = lobby_store.heartbeat(code, req.playerId)
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)
    return {"lobby": lobby.to_view()}


@app.post("/api/lobby/{code}/reconnect")
def lobby_reconnect(code: str, req: LobbyPlayerRequest) -> dict[str, Any]:
    try:
        lobby, seat = lobby_store.reconnect(code, req.playerId)
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)
    return {"code": lobby.code, "seat": seat, "lobby": lobby.to_view()}


@app.post("/api/lobby/{code}/start")
def lobby_start(code: str, req: LobbyPlayerRequest) -> dict[str, Any]:
    """Lock the lobby and create the underlying engine match.

    Returns the matchId so the client can switch to the game view.
    """
    try:
        lobby, seats = lobby_store.start_game(code, req.playerId)
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)

    # Create a Match and prime the first game.
    match = Match(first_dealer=Seat.NORTH)
    match_id = str(uuid.uuid4())
    sessions[match_id] = match
    match.new_game()

    # Register seat → playerId so per-player auth and projection work.
    # ``seats`` is the rearranged mapping returned by start_game (teamA
    # = north/south, teamB = east/west).
    match_rosters[match_id] = {
        Seat(seat_str): player.player_id
        for seat_str, player in seats.items()
    }

    lobby_store.set_match_id(lobby.code, match_id)
    return {"matchId": match_id, "lobby": lobby.to_view()}


@app.get("/api/lobby/{code}")
def lobby_get(code: str) -> dict[str, Any]:
    try:
        return _lobby_response(code)
    except LobbyError as exc:
        raise _lobby_error_to_http(exc)


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------
#
# In production, ``frontend/dist`` is the built site (run ``npm run build``
# in ``frontend/`` first). It contains play.html (with the bundled React
# app), the other static pages (index/rules/stats), and hashed assets.
#
# This mount must come **after** every ``/api/...`` route so the API
# routes win the path match. ``StaticFiles(html=True)`` serves
# ``index.html`` for the bare ``/`` request.
#
# In dev, run ``npm run dev`` from ``frontend/`` instead — the Vite dev
# server has its own static-serving and proxies ``/api`` here. This
# mount is then unused.

_DIST_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
)
if os.path.isdir(_DIST_DIR):
    app.mount("/", StaticFiles(directory=_DIST_DIR, html=True), name="static")
