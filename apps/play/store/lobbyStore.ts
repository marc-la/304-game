/**
 * Lobby store — zustand.
 *
 * Models the lobby as a discriminated state machine:
 *   { kind: 'idle' }           — not yet connected
 *   { kind: 'entering' }       — host or join in progress
 *   { kind: 'in-room', lobby } — sitting in a lobby waiting for start
 *   { kind: 'in-game', matchId } — game has started; switch to game UI
 *
 * Polling (1.5s) and heartbeat (30s) are owned here. Both are stopped
 * automatically when leaving the lobby or transitioning to game.
 */

import { create } from 'zustand';
import { lobbyApi, type LobbyView, type Seat, type Team } from '../api/lobbyApi';

const PLAYER_ID_KEY = '304:playerId';
const LAST_CODE_KEY = '304:lobbyCode';
const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 30000;

export type LobbyPhase =
  | { kind: 'idle' }
  | { kind: 'entering' }
  | { kind: 'in-room'; lobby: LobbyView; mySeat: Seat }
  | { kind: 'in-game'; matchId: string; mySeat: Seat };

interface LobbyStore {
  playerId: string | null;
  phase: LobbyPhase;
  error: string | null;

  // Setup
  ensurePlayerId: () => Promise<string>;
  hydrate: () => Promise<void>;

  // Actions
  host: () => Promise<void>;
  join: (code: string) => Promise<void>;
  leave: () => Promise<void>;
  switchTeam: (targetSeat: Seat, newTeam: Team) => Promise<void>;
  updateProfile: (updates: { name?: string; avatar?: string }) => Promise<void>;
  kick: (targetSeat: Seat) => Promise<void>;
  start: () => Promise<void>;

  clearError: () => void;
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;

function stopTimers() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  if (heartbeatHandle) {
    clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }
}

export const useLobbyStore = create<LobbyStore>((set, get) => {
  /** Find which seat I'm in in a lobby snapshot. */
  function findMySeat(lobby: LobbyView, playerId: string): Seat | null {
    for (const seat of ['north', 'east', 'south', 'west'] as Seat[]) {
      const p = lobby.seats[seat];
      if (p && p.playerId === playerId) return seat;
    }
    return null;
  }

  /** Apply a fresh lobby snapshot to local state, handling kick/start. */
  function applySnapshot(lobby: LobbyView) {
    const playerId = get().playerId;
    if (!playerId) return;

    // Game started
    if (lobby.status === 'in_game' && lobby.matchId) {
      stopTimers();
      const seat = findMySeat(lobby, playerId);
      // No seat is impossible here (we were in the lobby) — fall back to north
      set({
        phase: { kind: 'in-game', matchId: lobby.matchId, mySeat: seat ?? 'north' },
      });
      sessionStorage.removeItem(LAST_CODE_KEY);
      return;
    }

    const mySeat = findMySeat(lobby, playerId);
    if (mySeat === null) {
      // We were kicked or the lobby was reset — drop back to idle
      stopTimers();
      sessionStorage.removeItem(LAST_CODE_KEY);
      set({
        phase: { kind: 'idle' },
        error: 'You were removed from the lobby.',
      });
      return;
    }

    set({ phase: { kind: 'in-room', lobby, mySeat } });
  }

  function startTimers(code: string, playerId: string) {
    stopTimers();
    pollHandle = setInterval(async () => {
      try {
        const lobby = await lobbyApi.get(code);
        applySnapshot(lobby);
      } catch (err: any) {
        // Lobby went away (e.g., host left and lobby was deleted)
        stopTimers();
        sessionStorage.removeItem(LAST_CODE_KEY);
        set({
          phase: { kind: 'idle' },
          error: err?.message ?? 'Lobby closed.',
        });
      }
    }, POLL_INTERVAL_MS);

    heartbeatHandle = setInterval(() => {
      lobbyApi.heartbeat(code, playerId).catch(() => {
        // Silent — staleness is recoverable
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  return {
    playerId: null,
    phase: { kind: 'idle' },
    error: null,

    async ensurePlayerId() {
      const cached = localStorage.getItem(PLAYER_ID_KEY);
      if (cached) {
        set({ playerId: cached });
        return cached;
      }
      const { playerId } = await lobbyApi.identity();
      localStorage.setItem(PLAYER_ID_KEY, playerId);
      set({ playerId });
      return playerId;
    },

    /**
     * Restore a previous lobby session if one is in sessionStorage.
     * Called on app mount.
     */
    async hydrate() {
      try {
        await get().ensurePlayerId();
      } catch (err: any) {
        set({ error: err?.message ?? 'Failed to identify.' });
        return;
      }
      const code = sessionStorage.getItem(LAST_CODE_KEY);
      if (!code) return;
      const playerId = get().playerId!;
      try {
        const { lobby, seat } = await lobbyApi.reconnect(code, playerId);
        if (lobby.status === 'in_game' && lobby.matchId) {
          set({ phase: { kind: 'in-game', matchId: lobby.matchId, mySeat: seat } });
        } else {
          set({ phase: { kind: 'in-room', lobby, mySeat: seat } });
          startTimers(code, playerId);
        }
      } catch {
        // Stale code — drop it
        sessionStorage.removeItem(LAST_CODE_KEY);
      }
    },

    async host() {
      set({ phase: { kind: 'entering' }, error: null });
      try {
        const playerId = await get().ensurePlayerId();
        const { code, seat, lobby } = await lobbyApi.host(playerId);
        sessionStorage.setItem(LAST_CODE_KEY, code);
        set({ phase: { kind: 'in-room', lobby, mySeat: seat } });
        startTimers(code, playerId);
      } catch (err: any) {
        set({ phase: { kind: 'idle' }, error: err?.message ?? 'Failed to host.' });
      }
    },

    async join(code: string) {
      const cleaned = code.toUpperCase().trim();
      if (cleaned.length !== 4) {
        set({ error: 'Enter a 4-letter code.' });
        return;
      }
      set({ phase: { kind: 'entering' }, error: null });
      try {
        const playerId = await get().ensurePlayerId();
        const { lobby, seat } = await lobbyApi.join(cleaned, playerId);
        sessionStorage.setItem(LAST_CODE_KEY, lobby.code);
        set({ phase: { kind: 'in-room', lobby, mySeat: seat } });
        startTimers(lobby.code, playerId);
      } catch (err: any) {
        set({ phase: { kind: 'idle' }, error: err?.message ?? 'Failed to join.' });
      }
    },

    async leave() {
      const phase = get().phase;
      if (phase.kind !== 'in-room') return;
      stopTimers();
      const code = phase.lobby.code;
      const playerId = get().playerId;
      sessionStorage.removeItem(LAST_CODE_KEY);
      set({ phase: { kind: 'idle' } });
      if (playerId) {
        // Best-effort
        await lobbyApi.leave(code, playerId).catch(() => {});
      }
    },

    async switchTeam(targetSeat: Seat, newTeam: Team) {
      const phase = get().phase;
      if (phase.kind !== 'in-room') return;
      const playerId = get().playerId;
      if (!playerId) return;
      try {
        const { lobby } = await lobbyApi.team(
          phase.lobby.code,
          playerId,
          targetSeat,
          newTeam,
        );
        applySnapshot(lobby);
      } catch (err: any) {
        set({ error: err?.message ?? 'Failed to switch team.' });
      }
    },

    async updateProfile(updates) {
      const phase = get().phase;
      if (phase.kind !== 'in-room') return;
      const playerId = get().playerId;
      if (!playerId) return;
      try {
        const { lobby } = await lobbyApi.profile(
          phase.lobby.code,
          playerId,
          updates,
        );
        applySnapshot(lobby);
      } catch (err: any) {
        set({ error: err?.message ?? 'Failed to update profile.' });
      }
    },

    async kick(targetSeat: Seat) {
      const phase = get().phase;
      if (phase.kind !== 'in-room') return;
      const playerId = get().playerId;
      if (!playerId) return;
      try {
        const { lobby } = await lobbyApi.kick(
          phase.lobby.code,
          playerId,
          targetSeat,
        );
        applySnapshot(lobby);
      } catch (err: any) {
        set({ error: err?.message ?? 'Failed to remove player.' });
      }
    },

    async start() {
      const phase = get().phase;
      if (phase.kind !== 'in-room') return;
      const playerId = get().playerId;
      if (!playerId) return;
      try {
        const { matchId, lobby } = await lobbyApi.start(
          phase.lobby.code,
          playerId,
        );
        const mySeat = findMySeat(lobby, playerId) ?? 'north';
        stopTimers();
        sessionStorage.removeItem(LAST_CODE_KEY);
        set({ phase: { kind: 'in-game', matchId, mySeat } });
      } catch (err: any) {
        set({ error: err?.message ?? 'Failed to start.' });
      }
    },

    clearError() {
      set({ error: null });
    },
  };
});
