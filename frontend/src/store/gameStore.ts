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

interface GameStore {
  // State from server
  matchId: string | null;
  gameState: GameState | null;
  phase: Phase | null;
  whoseTurn: Seat | null;
  hands: Record<string, CardData[]>;
  validPlays: Record<string, CardData[]>;
  matchComplete: boolean;
  matchWinner: Team | null;
  gameCount: number;
  lastCompletedRound: CompletedRound | null;

  // UI state
  activeSeat: Seat;
  error: string | null;
  log: LogEntry[];
  seed: number | null;
  peekMode: boolean;
  loading: boolean;

  // Actions
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
  setActiveSeat: (seat: Seat) => void;
  setSeed: (seed: number | null) => void;
  togglePeekMode: () => void;
  clearError: () => void;
}

let logIdCounter = 0;

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

function applyView(view: GameView) {
  return {
    matchId: view.matchId,
    gameState: view.state,
    phase: view.phase,
    whoseTurn: view.whoseTurn,
    hands: view.hands,
    validPlays: view.validPlays,
    matchComplete: view.matchComplete,
    matchWinner: view.matchWinner,
    gameCount: view.gameCount,
    lastCompletedRound: view.completedRound ?? null,
    loading: false,
    error: null,
  };
}

export const useGameStore = create<GameStore>((set, get) => ({
  matchId: null,
  gameState: null,
  phase: null,
  whoseTurn: null,
  hands: {},
  validPlays: {},
  matchComplete: false,
  matchWinner: null,
  gameCount: 0,
  lastCompletedRound: null,
  activeSeat: 'south',
  error: null,
  log: [],
  seed: null,
  peekMode: true,
  loading: false,

  async newMatch(seed?: number) {
    set({ loading: true, log: [], error: null });
    logIdCounter = 0;
    try {
      const s = seed ?? get().seed ?? undefined;
      const view = await api.newMatch(s);
      set({
        ...applyView(view),
        log: addLog([], `New match started (Game ${view.state.game_number})`, 'info'),
      });
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async nextGame() {
    const { matchId } = get();
    if (!matchId) return;
    set({ loading: true });
    try {
      const view = await api.newGame(matchId);
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, `Game ${view.state.game_number} started`, 'info'),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async deal() {
    const { matchId } = get();
    if (!matchId) return;
    set({ loading: true });
    try {
      const view = await api.deal(matchId);
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, `${SEAT_NAMES[view.state.dealer]} deals`, 'info', view.state.dealer),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async bid(action: BidAction, value?: number) {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.bid(matchId, whoseTurn, action, value);
      const bidName = value ? (BID_NAMES[value] || String(value)) : '';
      let msg = '';
      if (action === 'bet') msg = `${SEAT_NAMES[whoseTurn]} bids ${bidName} (${value})`;
      else if (action === 'pass') msg = `${SEAT_NAMES[whoseTurn]} passes`;
      else if (action === 'partner') msg = `${SEAT_NAMES[whoseTurn]} says "Partner"`;
      else if (action === 'bet_for_partner') msg = `${SEAT_NAMES[whoseTurn]} bids ${bidName} for partner`;
      else if (action === 'pass_for_partner') msg = `${SEAT_NAMES[whoseTurn]} passes for partner`;
      else if (action === 'pcc') msg = `${SEAT_NAMES[whoseTurn]} calls PCC!`;
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, msg, 'bid', whoseTurn),
      }));
    } catch (e: unknown) {
      set(state => ({
        loading: false,
        error: (e as Error).message,
        log: addLog(state.log, (e as Error).message, 'error', whoseTurn),
      }));
    }
  },

  async reshuffle() {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.reshuffle(matchId, whoseTurn);
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, `${SEAT_NAMES[whoseTurn]} calls reshuffle`, 'info', whoseTurn),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async redeal8() {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.redeal8(matchId, whoseTurn);
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, `${SEAT_NAMES[whoseTurn]} calls redeal`, 'info', whoseTurn),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async selectTrump(card: string) {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.selectTrump(matchId, whoseTurn, card);
      const suit = view.state.trump.trump_suit;
      const suitSym = suit ? SUIT_SYMBOLS[suit] : '?';
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, `${SEAT_NAMES[whoseTurn]} selects trump (${suitSym})`, 'trump', whoseTurn),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async openTrump(revealCard?: string) {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.openTrump(matchId, whoseTurn, revealCard);
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, `${SEAT_NAMES[whoseTurn]} declares Open Trump`, 'trump', whoseTurn),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async closedTrump() {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.closedTrump(matchId, whoseTurn);
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, `${SEAT_NAMES[whoseTurn]} proceeds with Closed Trump`, 'trump', whoseTurn),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async playCard(card: string) {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.playCard(matchId, whoseTurn, card);
      let msg = `${SEAT_NAMES[whoseTurn]} plays ${card}`;

      // Check if card was face-down
      const round = view.state.play?.current_round ?? [];
      const lastEntry = round.find(e => e.seat === whoseTurn);
      if (lastEntry?.face_down) {
        msg = `${SEAT_NAMES[whoseTurn]} plays face-down`;
      }

      const newLog = addLog(get().log, msg, 'play', whoseTurn);

      // If round completed
      if (view.completedRound) {
        const cr = view.completedRound;
        const winMsg = `${SEAT_NAMES[cr.winner]} wins Round ${cr.round_number} (${cr.points_won} pts)`;
        set({
          ...applyView(view),
          log: addLog(newLog, winMsg, 'result', cr.winner),
        });
      } else {
        set({ ...applyView(view), log: newLog });
      }

      // If game complete, log result
      if (view.phase === 'complete' && view.state.result) {
        const r = view.state.result;
        set(state => ({
          log: addLog(state.log, r.description, 'result'),
        }));
      }
    } catch (e: unknown) {
      set(state => ({
        loading: false,
        error: (e as Error).message,
        log: addLog(state.log, (e as Error).message, 'error', whoseTurn),
      }));
    }
  },

  async callCaps(playOrder: string[]) {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.callCaps(matchId, whoseTurn, playOrder);
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, `${SEAT_NAMES[whoseTurn]} calls CAPS!`, 'result', whoseTurn),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async spoiltTrumps() {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.spoiltTrumps(matchId, whoseTurn);
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, 'Spoilt Trumps called!', 'result'),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async absoluteHand() {
    const { matchId, whoseTurn } = get();
    if (!matchId || !whoseTurn) return;
    set({ loading: true });
    try {
      const view = await api.absoluteHand(matchId, whoseTurn);
      set(state => ({
        ...applyView(view),
        log: addLog(state.log, `${SEAT_NAMES[whoseTurn]} declares Absolute Hand`, 'result', whoseTurn),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  setActiveSeat(seat: Seat) {
    set({ activeSeat: seat });
  },

  setSeed(seed: number | null) {
    set({ seed });
  },

  togglePeekMode() {
    set(state => ({ peekMode: !state.peekMode }));
  },

  clearError() {
    set({ error: null });
  },
}));
