"""End-to-end FastAPI integration tests.

Exercises the wiring between:
- the lobby endpoints and the in-memory ``LobbyStore``
- the lobby→match handoff (``/api/lobby/{code}/start`` → ``Match``)
- the existing game endpoints driven by the matchId returned from start
- the ``StaticFiles`` mount serving the Vite build output, when present

Uses FastAPI's ``TestClient`` — no live uvicorn needed.
"""

from __future__ import annotations

import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from main import app, lobby_store, sessions  # noqa: E402


@pytest.fixture
def client():
    """Fresh app state for every test."""
    lobby_store.reset()
    sessions.clear()
    with TestClient(app) as c:
        yield c


def _identity(client: TestClient) -> str:
    r = client.post("/api/lobby/identity")
    assert r.status_code == 200, r.text
    return r.json()["playerId"]


def _populate_full_lobby(client: TestClient) -> tuple[str, str, list[str]]:
    """Create a lobby with 4 players, return (host_id, code, [guest_ids])."""
    host = _identity(client)
    r = client.post("/api/lobby/host", json={"playerId": host})
    assert r.status_code == 200
    code = r.json()["code"]
    guests = [_identity(client) for _ in range(3)]
    for g in guests:
        r = client.post(f"/api/lobby/{code}/join", json={"playerId": g})
        assert r.status_code == 200, r.text
    return host, code, guests


# ---------------------------------------------------------------------------
# Lobby endpoint wiring
# ---------------------------------------------------------------------------


class TestIdentityEndpoint:
    def test_returns_unique_uuid_per_call(self, client):
        ids = {client.post("/api/lobby/identity").json()["playerId"] for _ in range(20)}
        assert len(ids) == 20


class TestHostJoinFlow:
    def test_host_returns_code_and_north_seat(self, client):
        host = _identity(client)
        r = client.post("/api/lobby/host", json={"playerId": host})
        assert r.status_code == 200
        body = r.json()
        assert body["seat"] == "north"
        assert len(body["code"]) == 4
        assert body["lobby"]["seats"]["north"]["playerId"] == host

    def test_join_unknown_code_returns_404(self, client):
        guest = _identity(client)
        r = client.post("/api/lobby/ZZZZ/join", json={"playerId": guest})
        assert r.status_code == 404
        assert "not found" in r.json()["detail"]["error"].lower()

    def test_join_full_lobby_returns_409(self, client):
        _, code, _ = _populate_full_lobby(client)
        extra = _identity(client)
        r = client.post(f"/api/lobby/{code}/join", json={"playerId": extra})
        assert r.status_code == 409

    def test_lobby_get_returns_full_view(self, client):
        host, code, _ = _populate_full_lobby(client)
        r = client.get(f"/api/lobby/{code}")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == code
        assert body["hostId"] == host
        assert body["status"] == "waiting"
        assert all(body["seats"][s] is not None for s in ["north", "east", "south", "west"])


class TestProfileAndKick:
    def test_profile_update_round_trips(self, client):
        host = _identity(client)
        code = client.post("/api/lobby/host", json={"playerId": host}).json()["code"]
        r = client.post(
            f"/api/lobby/{code}/profile",
            json={"playerId": host, "name": "Champ"},
        )
        assert r.status_code == 200
        assert r.json()["lobby"]["seats"]["north"]["name"] == "Champ"

    def test_profile_duplicate_name_409(self, client):
        host, code, guests = _populate_full_lobby(client)
        host_name = client.get(f"/api/lobby/{code}").json()["seats"]["north"]["name"]
        r = client.post(
            f"/api/lobby/{code}/profile",
            json={"playerId": guests[0], "name": host_name},
        )
        assert r.status_code == 409

    def test_kick_succeeds_for_host(self, client):
        host, code, _ = _populate_full_lobby(client)
        r = client.post(
            f"/api/lobby/{code}/kick",
            json={"playerId": host, "targetSeat": "east"},
        )
        assert r.status_code == 200
        assert r.json()["lobby"]["seats"]["east"] is None

    def test_kick_by_non_host_403(self, client):
        _, code, guests = _populate_full_lobby(client)
        r = client.post(
            f"/api/lobby/{code}/kick",
            json={"playerId": guests[0], "targetSeat": "south"},
        )
        assert r.status_code == 403


class TestHeartbeatReconnect:
    def test_heartbeat_succeeds(self, client):
        host, code, _ = _populate_full_lobby(client)
        r = client.post(f"/api/lobby/{code}/heartbeat", json={"playerId": host})
        assert r.status_code == 200

    def test_reconnect_returns_seat(self, client):
        host, code, _ = _populate_full_lobby(client)
        r = client.post(f"/api/lobby/{code}/reconnect", json={"playerId": host})
        assert r.status_code == 200
        assert r.json()["seat"] == "north"


# ---------------------------------------------------------------------------
# Lobby → Match handoff
# ---------------------------------------------------------------------------


class TestStartGame:
    def test_start_creates_match_and_links_id(self, client):
        host, code, _ = _populate_full_lobby(client)
        r = client.post(f"/api/lobby/{code}/start", json={"playerId": host})
        assert r.status_code == 200, r.text
        body = r.json()
        match_id = body["matchId"]
        assert match_id in sessions
        # The lobby is now linked to the match
        assert body["lobby"]["status"] == "in_game"
        assert body["lobby"]["matchId"] == match_id

    def test_start_by_non_host_403(self, client):
        _, code, guests = _populate_full_lobby(client)
        r = client.post(
            f"/api/lobby/{code}/start", json={"playerId": guests[0]},
        )
        assert r.status_code == 403

    def test_start_with_unbalanced_teams_409(self, client):
        host, code, _ = _populate_full_lobby(client)
        # Move everyone to teamA via host
        for s in ("east", "south", "west"):
            client.post(
                f"/api/lobby/{code}/team",
                json={"playerId": host, "targetSeat": s, "newTeam": "teamA"},
            )
        r = client.post(f"/api/lobby/{code}/start", json={"playerId": host})
        assert r.status_code == 409


# ---------------------------------------------------------------------------
# End-to-end: lobby start → game endpoints work
# ---------------------------------------------------------------------------


class TestEndToEndGameFlow:
    """Lobby starts → match exists → game endpoints respond."""

    def _start(self, client: TestClient) -> str:
        host, code, _ = _populate_full_lobby(client)
        r = client.post(f"/api/lobby/{code}/start", json={"playerId": host})
        return r.json()["matchId"]

    def test_match_state_endpoint_works_after_start(self, client):
        match_id = self._start(client)
        r = client.get(f"/api/game/{match_id}/state")
        assert r.status_code == 200
        # Initial phase before deal
        assert r.json()["phase"] in ("dealing_4", "betting_4")

    def test_deal_then_bid_and_full_round(self, client):
        match_id = self._start(client)
        # Deal 4
        r = client.post(f"/api/game/{match_id}/deal")
        assert r.status_code == 200
        assert r.json()["phase"] == "betting_4"

        # All four pass — pass-on triggers (dealer rotates)
        seats_in_order = ("west", "south", "east", "north")
        for seat in seats_in_order:
            r = client.post(
                f"/api/game/{match_id}/bid",
                json={"seat": seat, "action": "pass"},
            )
            assert r.status_code == 200, r.text
        # After 4 passes, phase resets to DEALING_4 with rotated dealer
        assert r.json()["phase"] == "dealing_4"

    def test_invalid_bid_returns_4xx(self, client):
        match_id = self._start(client)
        client.post(f"/api/game/{match_id}/deal")
        # Illegal bid step
        r = client.post(
            f"/api/game/{match_id}/bid",
            json={"seat": "west", "action": "bet", "value": 165},
        )
        assert r.status_code == 400
        body = r.json()
        assert "not a legal bid" in body["detail"]["error"].lower()


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------


_DIST_DIR = os.path.normpath(os.path.join(ROOT, "frontend", "dist"))
_HAS_DIST = os.path.isdir(_DIST_DIR) and os.path.isfile(
    os.path.join(_DIST_DIR, "play.html")
)


@pytest.mark.skipif(
    not _HAS_DIST,
    reason="frontend/dist not built — run `cd frontend && npm run build` first",
)
class TestStaticServing:
    def test_play_html_served(self, client):
        r = client.get("/play.html")
        assert r.status_code == 200
        body = r.text
        assert '<div id="root">' in body
        # The bundle URL is hashed; verify it's referenced
        assert "/assets/play-" in body and ".js" in body

    def test_index_html_served(self, client):
        r = client.get("/index.html")
        assert r.status_code == 200

    def test_root_serves_index(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert "304" in r.text  # any of the index content

    def test_assets_served(self, client):
        # Pull the JS asset URL from play.html and fetch it
        play = client.get("/play.html").text
        import re
        m = re.search(r'/assets/play-[A-Za-z0-9_-]+\.js', play)
        assert m, "no /assets/play-*.js URL in play.html"
        r = client.get(m.group(0))
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/javascript") or \
               r.headers.get("content-type", "").startswith("text/javascript")

    def test_api_routes_still_win_path_match(self, client):
        # /api/lobby/identity must NOT be served by the StaticFiles mount
        r = client.post("/api/lobby/identity")
        assert r.status_code == 200
        body = r.json()
        assert "playerId" in body
        # And a 404 on a non-existent API route shouldn't be swallowed by static
        r = client.get("/api/lobby/ZZZZZ")
        assert r.status_code == 404
