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
// Delay between automatic bot card-plays during animation. Long enough
// for the user to read each card; short enough that a round still
// completes in 2-3 seconds.
const BOT_TURN_DELAY_MS = 700;

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

  // Display preferences (persisted in localStorage)
  showPoints: boolean;
  toggleShowPoints: () => void;

  // Bot-match pacing
  isBotMatch: boolean;
  pendingRoundContinue: boolean;
  continueRound: () => void;
  enterBotMatch: (matchId: string, mySeat: Seat, playerId: string) => Promise<void>;

  clearError: () => void;
}

let logIdCounter = 0;
let pollHandle: ReturnType<typeof setInterval> | null = null;
let botStepTimer: ReturnType<typeof setTimeout> | null = null;

function cancelBotStep() {
  if (botStepTimer !== null) {
    clearTimeout(botStepTimer);
    botStepTimer = null;
  }
}

// Display preferences — persisted across sessions.
const SHOW_POINTS_KEY = '304:showPoints';
const loadShowPoints = (): boolean => {
  try {
    return localStorage.getItem(SHOW_POINTS_KEY) === '1';
  } catch {
    return false;
  }
};
const saveShowPoints = (v: boolean): void => {
  try {
    localStorage.setItem(SHOW_POINTS_KEY, v ? '1' : '0');
  } catch {
    // ignore (private mode etc.)
  }
};

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

  /**
   * Apply a view returned by any action, and either pause for
   * round-continue OR schedule the next bot-step. Returns the
   * partial state to merge.
   *
   * Round-resolution detection: completed_rounds.length grew vs the
   * previous view. When this happens during PLAYING phase, we pause
   * so the user can see the four cards from the resolved round before
   * the next round starts.
   *
   * Bot scheduling: if we're in a bot match and it's currently a
   * bot's turn during PLAYING phase, schedule the next bot-step
   * after BOT_TURN_DELAY_MS.
   */
  function applyViewAndPace(view: GameView, extraLog?: LogEntry[]) {
    const prev = get();
    const prevCount =
      prev.gameState?.play?.completed_rounds.length ?? 0;
    const newCount = view.state.play?.completed_rounds.length ?? 0;
    const roundJustResolved =
      newCount > prevCount && view.phase === 'playing';

    cancelBotStep();
    set({
      ...applyView(view),
      ...(extraLog ? { log: extraLog } : {}),
      pendingRoundContinue: roundJustResolved,
    });

    if (!roundJustResolved) {
      scheduleBotStepIfNeeded();
    }
  }

  function scheduleBotStepIfNeeded() {
    cancelBotStep();
    const s = get();
    if (!s.isBotMatch) return;
    if (s.pendingRoundContinue) return;
    if (s.phase !== 'playing') return;
    if (!s.matchId || !s.playerId) return;
    if (s.whoseTurn === null || s.whoseTurn === s.mySeat) return;

    botStepTimer = setTimeout(async () => {
      botStepTimer = null;
      const cur = get();
      // Re-validate — state may have changed during the timer.
      if (!cur.isBotMatch) return;
      if (cur.pendingRoundContinue) return;
      if (cur.phase !== 'playing') return;
      if (!cur.matchId || !cur.playerId) return;
      if (cur.whoseTurn === null || cur.whoseTurn === cur.mySeat) return;

      try {
        const view = await api.botStep(cur.matchId, cur.playerId);
        // Log the bot's card play, if visible from the view diff.
        const prevRound = cur.gameState?.play?.current_round ?? [];
        const newRound = view.state.play?.current_round ?? [];
        const newCompleted =
          view.state.play?.completed_rounds.length ?? 0;
        const prevCompleted =
          cur.gameState?.play?.completed_rounds.length ?? 0;
        let extraLog: LogEntry[] | undefined;
        if (newRound.length > prevRound.length) {
          // A bot played a card visible in current_round.
          const newest = newRound[newRound.length - 1];
          const seat = newest.seat;
          const cardStr = newest.card?.str ?? 'face-down';
          extraLog = addLog(
            cur.log,
            `${SEAT_NAMES[seat]} plays ${cardStr}`,
            'play',
            seat,
          );
        } else if (newCompleted > prevCompleted) {
          // A round just resolved on this bot's play.
          const completed =
            view.state.play?.completed_rounds[newCompleted - 1];
          if (completed) {
            extraLog = addLog(
              cur.log,
              `${SEAT_NAMES[completed.winner]} wins Round ${
                completed.round_number
              } (${completed.points_won} pts)`,
              'result',
              completed.winner,
            );
          }
        }
        applyViewAndPace(view, extraLog);
      } catch (e) {
        set({ error: (e as Error).message });
      }
    }, BOT_TURN_DELAY_MS);
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
    showPoints: loadShowPoints(),
    isBotMatch: false,
    pendingRoundContinue: false,

    async enterGame(matchId, mySeat, playerId) {
      logIdCounter = 0;
      set({ matchId, mySeat, playerId, loading: true, log: [], error: null });
      try {
        const view = await api.getState(matchId, playerId);
        const initialLog = addLog([], `You are ${SEAT_NAMES[mySeat]}`, 'info', mySeat);
        applyViewAndPace(view, initialLog);
        // Lobby matches need polling to pick up remote moves. Bot
        // matches don't (they're stateless wrt other clients), so
        // skip polling for them — it's a wasted round trip every
        // POLL_INTERVAL_MS and can race the bot-step scheduling.
        if (!get().isBotMatch) {
          startPolling();
        }
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async enterBotMatch(matchId, mySeat, playerId) {
      set({ isBotMatch: true });
      await get().enterGame(matchId, mySeat, playerId);
    },

    exitGame() {
      stopPolling();
      cancelBotStep();
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
        isBotMatch: false,
        pendingRoundContinue: false,
      });
    },

    continueRound() {
      set({ pendingRoundContinue: false });
      scheduleBotStepIfNeeded();
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
        const newLog = addLog(get().log, msg, 'bid', actor);
        applyViewAndPace(view, newLog);
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
        const newLog = addLog(
          get().log,
          `${actor ? SEAT_NAMES[actor] : 'Trumper'} selects trump (${suitSym})`,
          'trump',
          actor ?? undefined,
        );
        applyViewAndPace(view, newLog);
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
        const newLog = addLog(
          get().log,
          `${actor ? SEAT_NAMES[actor] : 'Trumper'} declares Open Trump`,
          'trump',
          actor ?? undefined,
        );
        applyViewAndPace(view, newLog);
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
        const newLog = addLog(
          get().log,
          `${actor ? SEAT_NAMES[actor] : 'Trumper'} proceeds with Closed Trump`,
          'trump',
          actor ?? undefined,
        );
        applyViewAndPace(view, newLog);
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
        if (view.phase === 'complete' && view.state.result) {
          newLog = addLog(newLog, view.state.result.description, 'result');
        }
        applyViewAndPace(view, newLog);
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

    toggleShowPoints() {
      set(state => {
        const next = !state.showPoints;
        saveShowPoints(next);
        return { showPoints: next };
      });
    },

    clearError() {
      set({ error: null });
    },
  };
});
