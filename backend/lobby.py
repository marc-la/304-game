"""Lobby data model and operations.

Pure-Python module — no FastAPI imports. Can be exercised directly
from pytest. The FastAPI layer (``main.py``) calls into this for its
endpoints.

Identity model
--------------
Every player has a ``player_id`` (a UUID generated on first contact —
the client persists it in localStorage so reconnects map to the same
seat). The Firebase implementation used Anonymous Auth UIDs; we get
the same effect from a client-generated token.

Concurrency
-----------
All operations on a single lobby take ``Lobby._lock`` so two
concurrent host/join/start calls cannot interleave. The store-level
``LobbyStore`` lock guards the dict of lobbies (creation, lookup).
This is sufficient for an in-memory single-process server.

Persistence
-----------
In-memory only. Restart the process and lobbies are gone. Adequate
for local play and test environments. Move to Redis or Postgres
when you need durability.
"""

from __future__ import annotations

import random
import secrets
import string
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


CODE_LENGTH: int = 4
CODE_ALPHABET: str = "ABCDEFGHJKMNPQRSTUVWXYZ"  # excludes I, L, O
MAX_NAME_LENGTH: int = 12

SEATS: tuple[str, ...] = ("north", "east", "south", "west")
TEAMS: tuple[str, ...] = ("teamA", "teamB")
ALL_AVATARS: tuple[str, ...] = (
    "spade", "heart", "diamond", "club", "crown", "knight", "tower", "star",
)

# Player is considered disconnected if the last heartbeat is older than this.
HEARTBEAT_STALE_SECONDS: float = 60.0

LOBBY_STATUS_WAITING: str = "waiting"
LOBBY_STATUS_IN_GAME: str = "in_game"


# ---------------------------------------------------------------------------
# Default-name generator (304-themed)
# ---------------------------------------------------------------------------


_ADJECTIVES = (
    "Bold", "Swift", "Sly", "Lucky", "Sharp", "Keen", "Wild", "Grand",
    "Brave", "Deft", "Quick", "Wily", "Calm", "Firm",
)
_NOUNS = (
    "Trump", "Dealer", "Jack", "Bidder", "Ace", "Cutter", "Bluff",
    "Player", "Trick", "Suit", "Hand", "Stone", "Queen", "Knight",
)


def generate_default_name(rng: random.Random | None = None) -> str:
    r = rng or random
    return f"{r.choice(_ADJECTIVES)} {r.choice(_NOUNS)}"


def generate_code(
    existing: set[str] | None = None,
    rng: random.Random | None = None,
    max_attempts: int = 20,
) -> str:
    r = rng or random
    existing = existing or set()
    for _ in range(max_attempts):
        code = "".join(r.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if code not in existing:
            return code
    raise LobbyError("Could not generate a unique lobby code; try again.")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class LobbyError(Exception):
    """Raised for any user-facing lobby failure."""


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class Player:
    """A player occupying a seat in a lobby."""

    player_id: str
    name: str
    avatar: str
    team: str  # "teamA" | "teamB"
    last_seen: float  # epoch seconds
    connected: bool = True

    def to_view(self) -> dict[str, Any]:
        return {
            "playerId": self.player_id,
            "name": self.name,
            "avatar": self.avatar,
            "team": self.team,
            "connected": self.connected,
            "lastSeen": self.last_seen,
        }


@dataclass
class Lobby:
    """A single 4-seat lobby.

    Seat keys are the strings in :data:`SEATS`. ``host_id`` may not
    correspond to any current seat (host promotion only triggers when
    they leave; if the host is kicked the host_id stays the same — but
    no one can be kicked except by the host, so this is unreachable
    via the public API).
    """

    code: str
    host_id: str
    seats: dict[str, Player | None]
    status: str = LOBBY_STATUS_WAITING
    match_id: str | None = None  # set when the game starts
    created_at: float = field(default_factory=time.time)

    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    # ------------------------------------------------------------------
    # Read-only helpers
    # ------------------------------------------------------------------

    def occupied_seats(self) -> list[str]:
        return [s for s in SEATS if self.seats[s] is not None]

    def get_seat_of(self, player_id: str) -> str | None:
        for s in SEATS:
            p = self.seats[s]
            if p is not None and p.player_id == player_id:
                return s
        return None

    def is_full(self) -> bool:
        return all(self.seats[s] is not None for s in SEATS)

    def teams_balanced(self) -> bool:
        team_a = sum(1 for s in SEATS if self.seats[s] and self.seats[s].team == "teamA")
        return team_a == 2 and self.is_full()

    def to_view(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "hostId": self.host_id,
            "status": self.status,
            "matchId": self.match_id,
            "createdAt": self.created_at,
            "seats": {
                s: (self.seats[s].to_view() if self.seats[s] else None)
                for s in SEATS
            },
        }

    # ------------------------------------------------------------------
    # Helpers used internally
    # ------------------------------------------------------------------

    def _taken_names(self, except_player: str | None = None) -> set[str]:
        return {
            self.seats[s].name.lower()
            for s in SEATS
            if self.seats[s] and self.seats[s].player_id != except_player
        }

    def _taken_avatars(self, except_player: str | None = None) -> set[str]:
        return {
            self.seats[s].avatar
            for s in SEATS
            if self.seats[s] and self.seats[s].player_id != except_player
        }


# ---------------------------------------------------------------------------
# LobbyStore — the dict-of-lobbies + the operations
# ---------------------------------------------------------------------------


class LobbyStore:
    """Thread-safe registry of lobbies and the operations on them.

    Operations enforce all invariants:
    - Lobby codes are unique and case-insensitive.
    - Each player_id occupies at most one seat in any given lobby.
    - Names and avatars are unique within a lobby.
    - Status transitions are one-way: ``waiting`` → ``in_game``.
    - Once ``in_game``, no seat changes are permitted.
    """

    def __init__(self, *, rng: random.Random | None = None) -> None:
        self._rng = rng or random.Random()
        self._lobbies: dict[str, Lobby] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Read access
    # ------------------------------------------------------------------

    def get(self, code: str) -> Lobby:
        code = code.upper().strip()
        with self._lock:
            lobby = self._lobbies.get(code)
            if lobby is None:
                raise LobbyError("Lobby not found.")
            return lobby

    def all_codes(self) -> list[str]:
        with self._lock:
            return list(self._lobbies.keys())

    # ------------------------------------------------------------------
    # Mutations
    # ------------------------------------------------------------------

    def create(self, host_id: str) -> Lobby:
        """Create a new lobby with ``host_id`` seated at north on teamA."""
        host_id = _validate_player_id(host_id)
        with self._lock:
            code = generate_code(set(self._lobbies), self._rng)
            now = time.time()
            host = Player(
                player_id=host_id,
                name=generate_default_name(self._rng),
                avatar=self._rng.choice(ALL_AVATARS),
                team="teamA",
                last_seen=now,
            )
            lobby = Lobby(
                code=code,
                host_id=host_id,
                seats={
                    "north": host, "east": None, "south": None, "west": None,
                },
            )
            self._lobbies[code] = lobby
            return lobby

    def join(self, code: str, player_id: str) -> tuple[Lobby, str]:
        """Join an existing lobby. Returns ``(lobby, seat)``.

        If the player is already seated, returns their existing seat
        (idempotent — useful for retries).
        """
        player_id = _validate_player_id(player_id)
        lobby = self.get(code)
        with lobby._lock:
            if lobby.status != LOBBY_STATUS_WAITING:
                raise LobbyError("Game has already started.")

            existing_seat = lobby.get_seat_of(player_id)
            if existing_seat is not None:
                return lobby, existing_seat

            empty_seat = next(
                (s for s in SEATS if lobby.seats[s] is None), None,
            )
            if empty_seat is None:
                raise LobbyError("Lobby is full.")

            taken_names = lobby._taken_names()
            taken_avatars = lobby._taken_avatars()

            # Auto-balance to the team with fewer players
            team_a_count = sum(
                1 for s in SEATS
                if lobby.seats[s] and lobby.seats[s].team == "teamA"
            )
            team_b_count = sum(
                1 for s in SEATS
                if lobby.seats[s] and lobby.seats[s].team == "teamB"
            )
            team = "teamA" if team_a_count <= team_b_count else "teamB"

            # Pick first available avatar
            avatar = next(
                (a for a in ALL_AVATARS if a not in taken_avatars), "spade",
            )

            # Find a non-conflicting default name
            name = generate_default_name(self._rng)
            for _ in range(20):
                if name.lower() not in taken_names:
                    break
                name = generate_default_name(self._rng)

            lobby.seats[empty_seat] = Player(
                player_id=player_id,
                name=name,
                avatar=avatar,
                team=team,
                last_seen=time.time(),
            )
            return lobby, empty_seat

    def leave(self, code: str, player_id: str) -> Lobby | None:
        """Remove a player. Returns the lobby, or None if the lobby was deleted.

        If the host leaves and other players remain, host is promoted
        to the next occupied seat. If the lobby empties, it is removed
        from the store. Cannot leave once the game has started.
        """
        player_id = _validate_player_id(player_id)
        with self._lock:
            lobby = self._lobbies.get(code.upper().strip())
            if lobby is None:
                return None
            with lobby._lock:
                if lobby.status != LOBBY_STATUS_WAITING:
                    raise LobbyError("Cannot leave a game that has started.")

                seat = lobby.get_seat_of(player_id)
                if seat is None:
                    return lobby  # already gone, no-op
                lobby.seats[seat] = None

                if not lobby.occupied_seats():
                    # Lobby is empty — remove from store
                    del self._lobbies[lobby.code]
                    return None

                if lobby.host_id == player_id:
                    # Promote next occupied seat to host
                    next_seat = lobby.occupied_seats()[0]
                    lobby.host_id = lobby.seats[next_seat].player_id

                return lobby

    def update_team(
        self,
        code: str,
        caller_id: str,
        target_seat: str,
        new_team: str,
    ) -> Lobby:
        """Switch ``target_seat`` to ``new_team``.

        Self-switch is always allowed. Switching another seat requires
        the caller to be the host.
        """
        caller_id = _validate_player_id(caller_id)
        if target_seat not in SEATS:
            raise LobbyError("Invalid seat.")
        if new_team not in TEAMS:
            raise LobbyError("Invalid team.")

        lobby = self.get(code)
        with lobby._lock:
            if lobby.status != LOBBY_STATUS_WAITING:
                raise LobbyError("Game has already started.")
            target = lobby.seats[target_seat]
            if target is None:
                raise LobbyError("No player in that seat.")

            caller_seat = lobby.get_seat_of(caller_id)
            if caller_seat != target_seat and lobby.host_id != caller_id:
                raise LobbyError(
                    "Only the host can change another player's team."
                )

            target.team = new_team
            return lobby

    def update_profile(
        self,
        code: str,
        caller_id: str,
        *,
        name: str | None = None,
        avatar: str | None = None,
    ) -> Lobby:
        """Update the caller's own name and/or avatar.

        Both fields are unique per lobby. Empty name is rejected; over-
        long names are truncated to ``MAX_NAME_LENGTH``.
        """
        caller_id = _validate_player_id(caller_id)
        lobby = self.get(code)
        with lobby._lock:
            if lobby.status != LOBBY_STATUS_WAITING:
                raise LobbyError("Game has already started.")

            caller_seat = lobby.get_seat_of(caller_id)
            if caller_seat is None:
                raise LobbyError("You are not in this lobby.")
            me = lobby.seats[caller_seat]
            assert me is not None  # narrowed by get_seat_of

            if name is not None:
                trimmed = name.strip()[:MAX_NAME_LENGTH]
                if not trimmed:
                    raise LobbyError("Name cannot be empty.")
                if trimmed.lower() in lobby._taken_names(except_player=caller_id):
                    raise LobbyError("That name is already taken.")
                me.name = trimmed

            if avatar is not None:
                if avatar not in ALL_AVATARS:
                    raise LobbyError("Invalid avatar.")
                if avatar in lobby._taken_avatars(except_player=caller_id):
                    raise LobbyError("That avatar is already taken.")
                me.avatar = avatar

            return lobby

    def kick(self, code: str, caller_id: str, target_seat: str) -> Lobby:
        """Host removes a player. Cannot kick yourself."""
        caller_id = _validate_player_id(caller_id)
        if target_seat not in SEATS:
            raise LobbyError("Invalid seat.")
        lobby = self.get(code)
        with lobby._lock:
            if lobby.status != LOBBY_STATUS_WAITING:
                raise LobbyError("Game has already started.")
            if lobby.host_id != caller_id:
                raise LobbyError("Only the host can kick players.")
            target = lobby.seats[target_seat]
            if target is None:
                raise LobbyError("No player in that seat.")
            if target.player_id == caller_id:
                raise LobbyError("You cannot kick yourself.")
            lobby.seats[target_seat] = None
            return lobby

    def heartbeat(self, code: str, player_id: str) -> Lobby:
        """Update ``last_seen`` for the caller and mark them connected."""
        player_id = _validate_player_id(player_id)
        lobby = self.get(code)
        with lobby._lock:
            seat = lobby.get_seat_of(player_id)
            if seat is None:
                raise LobbyError("You are not in this lobby.")
            p = lobby.seats[seat]
            assert p is not None
            p.last_seen = time.time()
            p.connected = True
            return lobby

    def reap_stale(self, *, now: float | None = None) -> None:
        """Mark seats with stale heartbeats as disconnected.

        Does *not* remove them — a stale player can still reconnect.
        Call this from a background task or before serializing the
        lobby for the wire.
        """
        cutoff = (now if now is not None else time.time()) - HEARTBEAT_STALE_SECONDS
        with self._lock:
            for lobby in self._lobbies.values():
                with lobby._lock:
                    for s in SEATS:
                        p = lobby.seats[s]
                        if p is not None and p.last_seen < cutoff:
                            p.connected = False

    def reconnect(self, code: str, player_id: str) -> tuple[Lobby, str]:
        """Refresh a player's heartbeat. Returns ``(lobby, seat)``."""
        player_id = _validate_player_id(player_id)
        lobby = self.get(code)
        with lobby._lock:
            seat = lobby.get_seat_of(player_id)
            if seat is None:
                raise LobbyError("You are not in this lobby.")
            p = lobby.seats[seat]
            assert p is not None
            p.connected = True
            p.last_seen = time.time()
            return lobby, seat

    def start_game(
        self,
        code: str,
        caller_id: str,
    ) -> tuple[Lobby, dict[str, Player]]:
        """Validate and lock the lobby; return final seat assignments.

        The caller must be the host. All 4 seats must be filled with
        2 players per team. The function rearranges seats so that
        ``teamA`` occupies north+south and ``teamB`` occupies east+
        west — this is what the game engine expects.

        On success, the lobby is moved to ``in_game`` status. The
        caller is responsible for creating the underlying ``Match``
        and writing back the resulting ``match_id`` via
        :meth:`set_match_id`.

        Returns ``(lobby, seat_assignments)`` where ``seat_assignments``
        is the post-rearrangement mapping ``seat → Player``.
        """
        caller_id = _validate_player_id(caller_id)
        lobby = self.get(code)
        with lobby._lock:
            if lobby.host_id != caller_id:
                raise LobbyError("Only the host can start the game.")
            if lobby.status != LOBBY_STATUS_WAITING:
                raise LobbyError("Game has already started.")
            if not lobby.is_full():
                raise LobbyError("Not all seats are filled.")
            if not lobby.teams_balanced():
                raise LobbyError("Teams must be 2 vs 2.")

            # Rearrange seats so teamA = north/south, teamB = east/west
            team_a_players = [
                lobby.seats[s] for s in SEATS
                if lobby.seats[s] and lobby.seats[s].team == "teamA"
            ]
            team_b_players = [
                lobby.seats[s] for s in SEATS
                if lobby.seats[s] and lobby.seats[s].team == "teamB"
            ]
            assert len(team_a_players) == 2 and len(team_b_players) == 2

            new_seats: dict[str, Player] = {
                "north": team_a_players[0],
                "south": team_a_players[1],
                "east": team_b_players[0],
                "west": team_b_players[1],
            }
            lobby.seats = {s: new_seats[s] for s in SEATS}
            lobby.status = LOBBY_STATUS_IN_GAME
            return lobby, new_seats

    def set_match_id(self, code: str, match_id: str) -> Lobby:
        """Stamp the lobby with the engine match ID (after Match creation)."""
        lobby = self.get(code)
        with lobby._lock:
            lobby.match_id = match_id
            return lobby

    # Test/admin helpers
    def reset(self) -> None:
        with self._lock:
            self._lobbies.clear()


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def _validate_player_id(player_id: str) -> str:
    if not isinstance(player_id, str) or not player_id.strip():
        raise LobbyError("player_id is required.")
    return player_id.strip()


def new_player_id() -> str:
    """Generate a fresh player ID. Clients should persist this in localStorage."""
    return str(uuid.uuid4())
