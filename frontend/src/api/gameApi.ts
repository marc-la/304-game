import type { GameView, Seat, BidAction, CardData } from '../types/game';

const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    const detail = data.detail;
    if (typeof detail === 'object' && detail?.error) {
      throw new Error(`${detail.errorType}: ${detail.error}`);
    }
    throw new Error(typeof detail === 'string' ? detail : res.statusText);
  }
  return data as T;
}

/**
 * Game API. All actions take a ``playerId`` so the server can
 * authenticate against the match roster (populated when a lobby
 * starts a match). Solo dev matches have no roster — they were
 * historically created via /api/match/new with no auth, and that
 * path is preserved for tests but not used by the lobby flow.
 */
export const api = {
  newMatch(seed?: number, dealer: Seat = 'north') {
    return request<GameView>('/match/new', {
      method: 'POST',
      body: JSON.stringify({ seed: seed ?? null, dealer }),
    });
  },

  newGame(matchId: string, playerId: string) {
    const q = new URLSearchParams({ playerId });
    return request<GameView>(`/match/${matchId}/game/new?${q}`, {
      method: 'POST',
    });
  },

  getState(matchId: string, playerId: string) {
    const q = new URLSearchParams({ playerId });
    return request<GameView>(`/game/${matchId}/state?${q}`);
  },

  deal(matchId: string, playerId: string) {
    return request<GameView>(`/game/${matchId}/deal`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  bid(matchId: string, playerId: string, action: BidAction, value?: number) {
    return request<GameView>(`/game/${matchId}/bid`, {
      method: 'POST',
      body: JSON.stringify({ playerId, action, value: value ?? null }),
    });
  },

  reshuffle(matchId: string, playerId: string) {
    return request<GameView>(`/game/${matchId}/reshuffle`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  redeal8(matchId: string, playerId: string) {
    return request<GameView>(`/game/${matchId}/redeal8`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  selectTrump(matchId: string, playerId: string, card: string) {
    return request<GameView>(`/game/${matchId}/trump`, {
      method: 'POST',
      body: JSON.stringify({ playerId, card }),
    });
  },

  openTrump(matchId: string, playerId: string, revealCard?: string) {
    return request<GameView>(`/game/${matchId}/open-trump`, {
      method: 'POST',
      body: JSON.stringify({ playerId, revealCard: revealCard ?? null }),
    });
  },

  closedTrump(matchId: string, playerId: string) {
    return request<GameView>(`/game/${matchId}/closed-trump`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  playCard(matchId: string, playerId: string, card: string) {
    return request<GameView>(`/game/${matchId}/play`, {
      method: 'POST',
      body: JSON.stringify({ playerId, card }),
    });
  },

  callCaps(matchId: string, playerId: string, playOrder: string[]) {
    return request<GameView>(`/game/${matchId}/caps`, {
      method: 'POST',
      body: JSON.stringify({ playerId, playOrder }),
    });
  },

  spoiltTrumps(matchId: string, playerId: string) {
    return request<GameView>(`/game/${matchId}/spoilt`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  absoluteHand(matchId: string, playerId: string) {
    return request<GameView>(`/game/${matchId}/absolute`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },

  getValidPlays(matchId: string, playerId: string, seat: Seat) {
    const q = new URLSearchParams({ playerId });
    return request<{ cards: CardData[] }>(
      `/game/${matchId}/valid-plays/${seat}?${q}`,
    );
  },
};
