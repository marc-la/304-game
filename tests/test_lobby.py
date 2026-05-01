"""Tests for the lobby data model in ``backend/lobby.py``.

Pure-Python tests — no FastAPI involvement. These exercise every
state-machine transition the lobby supports plus the failure modes of
the previous Firebase implementation that we explicitly want to avoid.
"""

from __future__ import annotations

import os
import sys
import threading
import time

import pytest

# Make backend/ importable
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from lobby import (  # noqa: E402
    HEARTBEAT_STALE_SECONDS,
    LOBBY_STATUS_IN_GAME,
    LOBBY_STATUS_WAITING,
    LobbyError,
    LobbyStore,
    new_player_id,
)


@pytest.fixture
def store():
    return LobbyStore()


# ---------------------------------------------------------------------------
# Create / join / leave
# ---------------------------------------------------------------------------


class TestCreate:
    def test_host_seated_at_north_on_team_a(self, store):
        host = new_player_id()
        lobby = store.create(host)
        assert lobby.host_id == host
        assert lobby.seats["north"].player_id == host
        assert lobby.seats["north"].team == "teamA"
        assert lobby.seats["east"] is None
        assert lobby.status == LOBBY_STATUS_WAITING

    def test_codes_are_unique(self, store):
        codes = {store.create(new_player_id()).code for _ in range(50)}
        assert len(codes) == 50

    def test_blank_player_id_rejected(self, store):
        with pytest.raises(LobbyError, match="player_id"):
            store.create("")


class TestJoin:
    def test_join_picks_first_empty_seat(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        _, seat = store.join(lobby.code, guest)
        assert seat == "east"  # first empty after north
        assert lobby.seats["east"].player_id == guest

    def test_join_auto_balances_teams(self, store):
        host = new_player_id()
        lobby = store.create(host)
        # Host on teamA (north). Guest 1 should land on teamB.
        _, _ = store.join(lobby.code, new_player_id())
        teams = [s.team for s in lobby.seats.values() if s is not None]
        assert teams.count("teamA") == 1 and teams.count("teamB") == 1

    def test_join_full_lobby_rejected(self, store):
        host = new_player_id()
        lobby = store.create(host)
        for _ in range(3):
            store.join(lobby.code, new_player_id())
        with pytest.raises(LobbyError, match="full"):
            store.join(lobby.code, new_player_id())

    def test_join_unknown_code_rejected(self, store):
        with pytest.raises(LobbyError, match="not found"):
            store.join("ZZZZ", new_player_id())

    def test_join_after_start_rejected(self, store):
        host = new_player_id()
        lobby = store.create(host)
        for _ in range(3):
            store.join(lobby.code, new_player_id())
        store.start_game(lobby.code, host)
        with pytest.raises(LobbyError, match="already started"):
            store.join(lobby.code, new_player_id())

    def test_join_idempotent_for_existing_player(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        _, seat1 = store.join(lobby.code, guest)
        _, seat2 = store.join(lobby.code, guest)
        assert seat1 == seat2

    def test_unique_avatars_assigned_on_join(self, store):
        host = new_player_id()
        lobby = store.create(host)
        for _ in range(3):
            store.join(lobby.code, new_player_id())
        avatars = [p.avatar for p in lobby.seats.values() if p]
        assert len(set(avatars)) == 4


class TestLeave:
    def test_leave_frees_seat(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        store.join(lobby.code, guest)
        store.leave(lobby.code, guest)
        assert lobby.seats["east"] is None

    def test_host_leaves_promotes_next_player(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        store.join(lobby.code, guest)
        store.leave(lobby.code, host)
        assert lobby.host_id == guest

    def test_last_player_leaves_deletes_lobby(self, store):
        host = new_player_id()
        lobby = store.create(host)
        result = store.leave(lobby.code, host)
        assert result is None
        with pytest.raises(LobbyError):
            store.get(lobby.code)

    def test_leave_after_start_rejected(self, store):
        host = new_player_id()
        lobby = store.create(host)
        for _ in range(3):
            store.join(lobby.code, new_player_id())
        store.start_game(lobby.code, host)
        with pytest.raises(LobbyError, match="already started|started"):
            store.leave(lobby.code, host)

    def test_leave_unknown_lobby_silent(self, store):
        result = store.leave("ZZZZ", new_player_id())
        assert result is None


# ---------------------------------------------------------------------------
# Team / profile / kick
# ---------------------------------------------------------------------------


class TestUpdateTeam:
    def test_self_switch_allowed(self, store):
        host = new_player_id()
        lobby = store.create(host)
        store.update_team(lobby.code, host, "north", "teamB")
        assert lobby.seats["north"].team == "teamB"

    def test_non_host_cannot_switch_others(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        store.join(lobby.code, guest)
        with pytest.raises(LobbyError, match="host"):
            store.update_team(lobby.code, guest, "north", "teamB")

    def test_host_can_switch_others(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        store.join(lobby.code, guest)
        store.update_team(lobby.code, host, "east", "teamA")
        assert lobby.seats["east"].team == "teamA"


class TestUpdateProfile:
    def test_name_must_be_unique(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        store.join(lobby.code, guest)
        host_name = lobby.seats["north"].name
        with pytest.raises(LobbyError, match="taken"):
            store.update_profile(lobby.code, guest, name=host_name)

    def test_avatar_must_be_unique(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        store.join(lobby.code, guest)
        host_avatar = lobby.seats["north"].avatar
        with pytest.raises(LobbyError, match="taken"):
            store.update_profile(lobby.code, guest, avatar=host_avatar)

    def test_empty_name_rejected(self, store):
        host = new_player_id()
        lobby = store.create(host)
        with pytest.raises(LobbyError, match="empty"):
            store.update_profile(lobby.code, host, name="   ")

    def test_long_name_truncated(self, store):
        host = new_player_id()
        lobby = store.create(host)
        store.update_profile(lobby.code, host, name="A" * 50)
        assert len(lobby.seats["north"].name) == 12

    def test_invalid_avatar_rejected(self, store):
        host = new_player_id()
        lobby = store.create(host)
        with pytest.raises(LobbyError, match="Invalid avatar"):
            store.update_profile(lobby.code, host, avatar="dragon")


class TestKick:
    def test_host_kicks_other_player(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        store.join(lobby.code, guest)
        store.kick(lobby.code, host, "east")
        assert lobby.seats["east"] is None

    def test_non_host_cannot_kick(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        store.join(lobby.code, guest)
        with pytest.raises(LobbyError, match="host"):
            store.kick(lobby.code, guest, "north")

    def test_host_cannot_kick_self(self, store):
        host = new_player_id()
        lobby = store.create(host)
        with pytest.raises(LobbyError, match="kick yourself"):
            store.kick(lobby.code, host, "north")


# ---------------------------------------------------------------------------
# Heartbeat / staleness / reconnect
# ---------------------------------------------------------------------------


class TestHeartbeat:
    def test_heartbeat_marks_connected_and_refreshes(self, store):
        host = new_player_id()
        lobby = store.create(host)
        old = lobby.seats["north"].last_seen
        time.sleep(0.01)
        store.heartbeat(lobby.code, host)
        assert lobby.seats["north"].connected
        assert lobby.seats["north"].last_seen > old

    def test_reap_stale_marks_disconnected(self, store):
        host = new_player_id()
        lobby = store.create(host)
        # Forge an old last_seen
        lobby.seats["north"].last_seen = time.time() - HEARTBEAT_STALE_SECONDS - 1
        store.reap_stale()
        assert lobby.seats["north"].connected is False

    def test_reconnect_returns_seat_and_refreshes(self, store):
        host = new_player_id()
        lobby = store.create(host)
        lobby.seats["north"].connected = False
        _, seat = store.reconnect(lobby.code, host)
        assert seat == "north"
        assert lobby.seats["north"].connected

    def test_reconnect_unknown_player_rejected(self, store):
        host = new_player_id()
        lobby = store.create(host)
        with pytest.raises(LobbyError, match="not in this lobby"):
            store.reconnect(lobby.code, new_player_id())


# ---------------------------------------------------------------------------
# Start game
# ---------------------------------------------------------------------------


class TestStartGame:
    def test_start_requires_4_players(self, store):
        host = new_player_id()
        lobby = store.create(host)
        with pytest.raises(LobbyError, match="seats are filled"):
            store.start_game(lobby.code, host)

    def test_start_requires_balanced_teams(self, store):
        host = new_player_id()
        lobby = store.create(host)
        # Force an unbalanced 3-1 split
        for _ in range(3):
            store.join(lobby.code, new_player_id())
        # Move everyone to teamA
        for s in ("east", "south", "west"):
            store.update_team(lobby.code, host, s, "teamA")
        with pytest.raises(LobbyError, match="2 vs 2"):
            store.start_game(lobby.code, host)

    def test_start_requires_host(self, store):
        host = new_player_id()
        guest = new_player_id()
        lobby = store.create(host)
        store.join(lobby.code, guest)
        for _ in range(2):
            store.join(lobby.code, new_player_id())
        with pytest.raises(LobbyError, match="host"):
            store.start_game(lobby.code, guest)

    def test_start_rearranges_seats_team_a_north_south(self, store):
        host = new_player_id()
        guests = [new_player_id() for _ in range(3)]
        lobby = store.create(host)
        for g in guests:
            store.join(lobby.code, g)
        # Force an arrangement where teamA is split across north and east
        # before start (auto-balance might have placed them differently).
        # We rebalance manually then start.
        seat_a = ["north", "east"]  # teamA in unusual seats
        seat_b = ["south", "west"]
        # Set everyone's team to fit our chosen split
        for s in seat_a:
            if lobby.seats[s] is not None:
                store.update_team(lobby.code, host, s, "teamA")
        for s in seat_b:
            if lobby.seats[s] is not None:
                store.update_team(lobby.code, host, s, "teamB")

        lobby, _ = store.start_game(lobby.code, host)
        # After start, north/south must be teamA and east/west teamB
        assert lobby.seats["north"].team == "teamA"
        assert lobby.seats["south"].team == "teamA"
        assert lobby.seats["east"].team == "teamB"
        assert lobby.seats["west"].team == "teamB"
        assert lobby.status == LOBBY_STATUS_IN_GAME

    def test_double_start_rejected(self, store):
        host = new_player_id()
        lobby = store.create(host)
        for _ in range(3):
            store.join(lobby.code, new_player_id())
        store.start_game(lobby.code, host)
        with pytest.raises(LobbyError, match="already started"):
            store.start_game(lobby.code, host)


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------


class TestConcurrency:
    def test_simultaneous_join_only_one_succeeds_per_seat(self, store):
        """Two threads racing for the last seat — only one wins."""
        host = new_player_id()
        lobby = store.create(host)
        for _ in range(2):
            store.join(lobby.code, new_player_id())
        # 1 seat left; race two joins
        results: list[str | Exception] = []
        barrier = threading.Barrier(2)

        def attempt():
            barrier.wait()
            try:
                _, seat = store.join(lobby.code, new_player_id())
                results.append(seat)
            except LobbyError as e:
                results.append(e)

        threads = [threading.Thread(target=attempt) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Exactly one success and one "full" rejection
        successes = [r for r in results if isinstance(r, str)]
        failures = [r for r in results if isinstance(r, Exception)]
        assert len(successes) == 1
        assert len(failures) == 1
        assert "full" in str(failures[0]).lower()
