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

export const api = {
  newMatch(seed?: number, dealer: Seat = 'north') {
    return request<GameView>('/match/new', {
      method: 'POST',
      body: JSON.stringify({ seed: seed ?? null, dealer }),
    });
  },

  newGame(matchId: string) {
    return request<GameView>(`/match/${matchId}/game/new`, { method: 'POST' });
  },

  deal(matchId: string) {
    return request<GameView>(`/game/${matchId}/deal`, { method: 'POST' });
  },

  bid(matchId: string, seat: Seat, action: BidAction, value?: number) {
    return request<GameView>(`/game/${matchId}/bid`, {
      method: 'POST',
      body: JSON.stringify({ seat, action, value: value ?? null }),
    });
  },

  reshuffle(matchId: string, seat: Seat) {
    return request<GameView>(`/game/${matchId}/reshuffle`, {
      method: 'POST',
      body: JSON.stringify({ seat }),
    });
  },

  redeal8(matchId: string, seat: Seat) {
    return request<GameView>(`/game/${matchId}/redeal8`, {
      method: 'POST',
      body: JSON.stringify({ seat }),
    });
  },

  selectTrump(matchId: string, seat: Seat, card: string) {
    return request<GameView>(`/game/${matchId}/trump`, {
      method: 'POST',
      body: JSON.stringify({ seat, card }),
    });
  },

  openTrump(matchId: string, seat: Seat, revealCard?: string) {
    return request<GameView>(`/game/${matchId}/open-trump`, {
      method: 'POST',
      body: JSON.stringify({ seat, revealCard: revealCard ?? null }),
    });
  },

  closedTrump(matchId: string, seat: Seat) {
    return request<GameView>(`/game/${matchId}/closed-trump`, {
      method: 'POST',
      body: JSON.stringify({ seat }),
    });
  },

  playCard(matchId: string, seat: Seat, card: string) {
    return request<GameView>(`/game/${matchId}/play`, {
      method: 'POST',
      body: JSON.stringify({ seat, card }),
    });
  },

  callCaps(matchId: string, seat: Seat, playOrder: string[]) {
    return request<GameView>(`/game/${matchId}/caps`, {
      method: 'POST',
      body: JSON.stringify({ seat, playOrder }),
    });
  },

  spoiltTrumps(matchId: string, seat: Seat) {
    return request<GameView>(`/game/${matchId}/spoilt`, {
      method: 'POST',
      body: JSON.stringify({ seat }),
    });
  },

  absoluteHand(matchId: string, seat: Seat) {
    return request<GameView>(`/game/${matchId}/absolute`, {
      method: 'POST',
      body: JSON.stringify({ seat }),
    });
  },

  getState(matchId: string) {
    return request<GameView>(`/game/${matchId}/state`);
  },

  getValidPlays(matchId: string, seat: Seat) {
    return request<{ cards: CardData[] }>(`/game/${matchId}/valid-plays/${seat}`);
  },
};
