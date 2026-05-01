/**
 * Lobby API client.
 *
 * Talks to the FastAPI backend defined in backend/main.py. All endpoints
 * are POST except `getLobby` (GET). Errors raise with `{errorType, error}`
 * preserved when available.
 */

const BASE = '/api/lobby';

export type Team = 'teamA' | 'teamB';
export type Seat = 'north' | 'east' | 'south' | 'west';

export interface PlayerView {
  playerId: string;
  name: string;
  avatar: string;
  team: Team;
  connected: boolean;
  lastSeen: number;
}

export interface LobbyView {
  code: string;
  hostId: string;
  status: 'waiting' | 'in_game';
  matchId: string | null;
  createdAt: number;
  seats: Record<Seat, PlayerView | null>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json();
  if (!res.ok) {
    const detail = body.detail;
    const msg =
      typeof detail === 'object' && detail !== null && 'error' in detail
        ? detail.error
        : typeof detail === 'string'
        ? detail
        : res.statusText;
    throw new Error(msg);
  }
  return body as T;
}

export const lobbyApi = {
  identity(): Promise<{ playerId: string }> {
    return request('/identity', { method: 'POST' });
  },

  host(playerId: string): Promise<{ code: string; seat: Seat; lobby: LobbyView }> {
    return request('/host', {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  join(
    code: string,
    playerId: string,
  ): Promise<{ code: string; seat: Seat; lobby: LobbyView }> {
    return request(`/${code}/join`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  leave(code: string, playerId: string): Promise<{ deleted: boolean; lobby: LobbyView | null }> {
    return request(`/${code}/leave`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  team(
    code: string,
    playerId: string,
    targetSeat: Seat,
    newTeam: Team,
  ): Promise<{ lobby: LobbyView }> {
    return request(`/${code}/team`, {
      method: 'POST',
      body: JSON.stringify({ playerId, targetSeat, newTeam }),
    });
  },

  profile(
    code: string,
    playerId: string,
    updates: { name?: string; avatar?: string },
  ): Promise<{ lobby: LobbyView }> {
    return request(`/${code}/profile`, {
      method: 'POST',
      body: JSON.stringify({ playerId, ...updates }),
    });
  },

  kick(
    code: string,
    playerId: string,
    targetSeat: Seat,
  ): Promise<{ lobby: LobbyView }> {
    return request(`/${code}/kick`, {
      method: 'POST',
      body: JSON.stringify({ playerId, targetSeat }),
    });
  },

  heartbeat(code: string, playerId: string): Promise<{ lobby: LobbyView }> {
    return request(`/${code}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  reconnect(
    code: string,
    playerId: string,
  ): Promise<{ code: string; seat: Seat; lobby: LobbyView }> {
    return request(`/${code}/reconnect`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  start(
    code: string,
    playerId: string,
  ): Promise<{ matchId: string; lobby: LobbyView }> {
    return request(`/${code}/start`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  get(code: string): Promise<LobbyView> {
    return request(`/${code}`, { method: 'GET' });
  },
};
