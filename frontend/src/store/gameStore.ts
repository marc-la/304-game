import { create } from 'zustand';
import { api } from '../api/gameApi';
import type {
  GameView,
  GameState,
  Phase,
  Seat,
  BidAction,
  CardData,
  LogEntry,
  Team,
  CompletedRound,
} from '../types/game';
import { SEAT_NAMES, SEAT_TEAM, BID_NAMES, SUIT_SYMBOLS } from '../types/game';

const POLL_INTERVAL_MS = 1500;

interface GameStore {
  // Identity (set by enterGame; null in solo mode)
  matchId: string | null;
  mySeat: Seat | null;
  playerId: string | null;

  // Server-derived state
  gameState: GameState | null;
  phase: Phase | null;
  whoseTurn: Seat | null;
  hands: Record<string, CardData[]>;
  handCounts: Record<string, number>;
  validPlays: Record<string, CardData[]>;
  matchComplete: boolean;
  matchWinner: Team | null;
  gameCount: number;
  lastCompletedRound: CompletedRound | null;

  // UI
  error: string | null;
  log: LogEntry[];
  loading: boolean;

  // Lifecycle
  enterGame: (matchId: string, mySeat: Seat, playerId: string) => Promise<void>;
  exitGame: () => void;
  refresh: () => Promise<void>;

  // Actions — all derive the acting seat from playerId server-side
  newMatch: (seed?: number) => Promise<void>;
  nextGame: () => Promise<void>;
  deal: () => Promise<void>;
  bid: (action: BidAction, value?: number) => Promise<void>;
  reshuffle: () => Promise<void>;
  redeal8: () => Promise<void>;
  selectTrump: (card: string) => Promise<void>;
  openTrump: (revealCard?: string) => Promise<void>;
  closedTrump: () => Promise<void>;
  playCard: (card: string) => Promise<void>;
  callCaps: (playOrder: string[]) => Promise<void>;
  spoiltTrumps: () => Promise<void>;
  absoluteHand: () => Promise<void>;

  // Solo/dev affordances (no-ops in lobby mode — see ControlBar)
  setSeed: (seed: number | null) => void;
  seed: number | null;
  togglePeekMode: () => void;
  peekMode: boolean;

  clearError: () => void;
}

let logIdCounter = 0;
let pollHandle: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

function applyView(view: GameView) {
  return {
    matchId: view.matchId,
    gameState: view.state,
    phase: view.phase,
    whoseTurn: view.whoseTurn,
    hands: view.hands,
    handCounts: view.handCounts ?? {},
    validPlays: view.validPlays,
    matchComplete: view.matchComplete,
    matchWinner: view.matchWinner,
    gameCount: view.gameCount,
    lastCompletedRound: view.completedRound ?? null,
    loading: false,
    error: null,
  };
}

function addLog(
  log: LogEntry[],
  message: string,
  type: LogEntry['type'],
  seat?: Seat,
): LogEntry[] {
  return [
    ...log,
    {
      id: ++logIdCounter,
      message,
      type,
      seat,
      team: seat ? SEAT_TEAM[seat] : undefined,
    },
  ];
}

export const useGameStore = create<GameStore>((set, get) => {
  /** Resolve identity for an action; returns null if not in lobby mode. */
  function ident(): { matchId: string; playerId: string } | null {
    const { matchId, playerId } = get();
    if (!matchId || !playerId) return null;
    return { matchId, playerId };
  }

  function startPolling() {
    stopPolling();
    pollHandle = setInterval(async () => {
      const id = ident();
      if (!id) return;
      try {
        const view = await api.getState(id.matchId, id.playerId);
        // Don't clobber log on refresh; only sync server-derived fields.
        set(state => ({ ...applyView(view), log: state.log }));
      } catch {
        // Soft-fail: a single missed poll is fine.
      }
    }, POLL_INTERVAL_MS);
  }

  return {
    matchId: null,
    mySeat: null,
    playerId: null,
    gameState: null,
    phase: null,
    whoseTurn: null,
    hands: {},
    handCounts: {},
    validPlays: {},
    matchComplete: false,
    matchWinner: null,
    gameCount: 0,
    lastCompletedRound: null,
    error: null,
    log: [],
    loading: false,
    seed: null,
    peekMode: false,

    async enterGame(matchId, mySeat, playerId) {
      logIdCounter = 0;
      set({ matchId, mySeat, playerId, loading: true, log: [], error: null });
      try {
        const view = await api.getState(matchId, playerId);
        set({
          ...applyView(view),
          log: addLog([], `You are ${SEAT_NAMES[mySeat]}`, 'info', mySeat),
        });
        startPolling();
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    exitGame() {
      stopPolling();
      set({
        matchId: null,
        mySeat: null,
        playerId: null,
        gameState: null,
        phase: null,
        whoseTurn: null,
        hands: {},
        handCounts: {},
        validPlays: {},
        matchComplete: false,
        matchWinner: null,
        gameCount: 0,
        lastCompletedRound: null,
        log: [],
        error: null,
        loading: false,
      });
    },

    async refresh() {
      const id = ident();
      if (!id) return;
      try {
        const view = await api.getState(id.matchId, id.playerId);
        set(state => ({ ...applyView(view), log: state.log }));
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },

    async newMatch(seed) {
      // Solo/dev path. Lobby flow uses enterGame instead.
      stopPolling();
      logIdCounter = 0;
      set({ loading: true, log: [], error: null });
      try {
        const s = seed ?? get().seed ?? undefined;
        const view = await api.newMatch(s);
        set({
          ...applyView(view),
          mySeat: null,
          playerId: null,
          log: addLog(
            [],
            `New match started (Game ${view.state.game_number})`,
            'info',
          ),
        });
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async nextGame() {
      const id = ident();
      const { matchId } = get();
      if (!matchId) return;
      set({ loading: true });
      try {
        const view = id
          ? await api.newGame(matchId, id.playerId)
          : await api.newGame(matchId, '');
        set(state => ({
          ...applyView(view),
          log: addLog(
            state.log,
            `Game ${view.state.game_number} started`,
            'info',
          ),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async deal() {
      const id = ident();
      const { matchId } = get();
      if (!matchId) return;
      set({ loading: true });
      try {
        const view = await api.deal(matchId, id?.playerId ?? '');
        set(state => ({
          ...applyView(view),
          log: addLog(
            state.log,
            `${SEAT_NAMES[view.state.dealer]} deals`,
            'info',
            view.state.dealer,
          ),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async bid(action, value) {
      const id = ident();
      const { matchId, mySeat } = get();
      if (!matchId) return;
      const actor = mySeat ?? get().whoseTurn;
      if (!actor) return;
      set({ loading: true });
      try {
        const view = await api.bid(matchId, id?.playerId ?? '', action, value);
        const bidName = value ? BID_NAMES[value] || String(value) : '';
        let msg = '';
        if (action === 'bet') msg = `${SEAT_NAMES[actor]} bids ${bidName} (${value})`;
        else if (action === 'pass') msg = `${SEAT_NAMES[actor]} passes`;
        else if (action === 'partner') msg = `${SEAT_NAMES[actor]} says "Partner"`;
        else if (action === 'bet_for_partner') msg = `${SEAT_NAMES[actor]} bids ${bidName} for partner`;
        else if (action === 'pass_for_partner') msg = `${SEAT_NAMES[actor]} passes for partner`;
        else if (action === 'pcc') msg = `${SEAT_NAMES[actor]} calls PCC!`;
        set(state => ({
          ...applyView(view),
          log: addLog(state.log, msg, 'bid', actor),
        }));
      } catch (e) {
        set(state => ({
          loading: false,
          error: (e as Error).message,
          log: addLog(state.log, (e as Error).message, 'error', actor),
        }));
      }
    },

    async reshuffle() {
      const id = ident();
      const { matchId, mySeat } = get();
      if (!matchId) return;
      const actor = mySeat ?? get().whoseTurn;
      set({ loading: true });
      try {
        const view = await api.reshuffle(matchId, id?.playerId ?? '');
        set(state => ({
          ...applyView(view),
          log: addLog(state.log, `${actor ? SEAT_NAMES[actor] : 'Player'} calls reshuffle`, 'info', actor ?? undefined),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async redeal8() {
      const id = ident();
      const { matchId, mySeat } = get();
      if (!matchId) return;
      const actor = mySeat ?? get().whoseTurn;
      set({ loading: true });
      try {
        const view = await api.redeal8(matchId, id?.playerId ?? '');
        set(state => ({
          ...applyView(view),
          log: addLog(state.log, `${actor ? SEAT_NAMES[actor] : 'Player'} calls redeal`, 'info', actor ?? undefined),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async selectTrump(card) {
      const id = ident();
      const { matchId, mySeat } = get();
      if (!matchId) return;
      const actor = mySeat ?? get().whoseTurn;
      set({ loading: true });
      try {
        const view = await api.selectTrump(matchId, id?.playerId ?? '', card);
        const suit = view.state.trump.trump_suit;
        const suitSym = suit ? SUIT_SYMBOLS[suit] : '?';
        set(state => ({
          ...applyView(view),
          log: addLog(state.log, `${actor ? SEAT_NAMES[actor] : 'Trumper'} selects trump (${suitSym})`, 'trump', actor ?? undefined),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async openTrump(revealCard) {
      const id = ident();
      const { matchId, mySeat } = get();
      if (!matchId) return;
      const actor = mySeat ?? get().whoseTurn;
      set({ loading: true });
      try {
        const view = await api.openTrump(matchId, id?.playerId ?? '', revealCard);
        set(state => ({
          ...applyView(view),
          log: addLog(state.log, `${actor ? SEAT_NAMES[actor] : 'Trumper'} declares Open Trump`, 'trump', actor ?? undefined),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async closedTrump() {
      const id = ident();
      const { matchId, mySeat } = get();
      if (!matchId) return;
      const actor = mySeat ?? get().whoseTurn;
      set({ loading: true });
      try {
        const view = await api.closedTrump(matchId, id?.playerId ?? '');
        set(state => ({
          ...applyView(view),
          log: addLog(state.log, `${actor ? SEAT_NAMES[actor] : 'Trumper'} proceeds with Closed Trump`, 'trump', actor ?? undefined),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async playCard(card) {
      const id = ident();
      const { matchId, mySeat } = get();
      if (!matchId) return;
      const actor = mySeat ?? get().whoseTurn;
      if (!actor) return;
      set({ loading: true });
      try {
        const view = await api.playCard(matchId, id?.playerId ?? '', card);
        let msg = `${SEAT_NAMES[actor]} plays ${card}`;
        const round = view.state.play?.current_round ?? [];
        const lastEntry = round.find(e => e.seat === actor);
        if (lastEntry?.face_down) {
          msg = `${SEAT_NAMES[actor]} plays face-down`;
        }
        let newLog = addLog(get().log, msg, 'play', actor);
        if (view.completedRound) {
          const cr = view.completedRound;
          const winMsg = `${SEAT_NAMES[cr.winner]} wins Round ${cr.round_number} (${cr.points_won} pts)`;
          newLog = addLog(newLog, winMsg, 'result', cr.winner);
        }
        set({ ...applyView(view), log: newLog });
        if (view.phase === 'complete' && view.state.result) {
          const r = view.state.result;
          set(state => ({
            log: addLog(state.log, r.description, 'result'),
          }));
        }
      } catch (e) {
        set(state => ({
          loading: false,
          error: (e as Error).message,
          log: addLog(state.log, (e as Error).message, 'error', actor ?? undefined),
        }));
      }
    },

    async callCaps(playOrder) {
      const id = ident();
      const { matchId, mySeat } = get();
      if (!matchId) return;
      const actor = mySeat ?? get().whoseTurn;
      set({ loading: true });
      try {
        const view = await api.callCaps(matchId, id?.playerId ?? '', playOrder);
        set(state => ({
          ...applyView(view),
          log: addLog(state.log, `${actor ? SEAT_NAMES[actor] : 'Player'} calls CAPS!`, 'result', actor ?? undefined),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async spoiltTrumps() {
      const id = ident();
      const { matchId } = get();
      if (!matchId) return;
      set({ loading: true });
      try {
        const view = await api.spoiltTrumps(matchId, id?.playerId ?? '');
        set(state => ({
          ...applyView(view),
          log: addLog(state.log, 'Spoilt Trumps called!', 'result'),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async absoluteHand() {
      const id = ident();
      const { matchId, mySeat } = get();
      if (!matchId) return;
      const actor = mySeat ?? get().whoseTurn;
      set({ loading: true });
      try {
        const view = await api.absoluteHand(matchId, id?.playerId ?? '');
        set(state => ({
          ...applyView(view),
          log: addLog(state.log, `${actor ? SEAT_NAMES[actor] : 'Player'} declares Absolute Hand`, 'result', actor ?? undefined),
        }));
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    setSeed(seed) {
      set({ seed });
    },

    togglePeekMode() {
      set(state => ({ peekMode: !state.peekMode }));
    },

    clearError() {
      set({ error: null });
    },
  };
});
