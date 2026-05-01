// Zustand store driving the 304dle game session.

import { create } from 'zustand';
import type { CardId } from './engine/card';
import {
  checkCapsObligation,
  explainCapsFailure,
  isCapsLate,
  validateCapsCall,
} from './engine/caps';
import { legalPlays } from './engine/play';
import type { Seat } from './engine/seating';
import type { CompletedRound } from './engine/state';
import type { DailyPuzzle } from './types';
import {
  applyPlay,
  isGameOver,
  newRuntime,
  playBotTurn,
  resolveRound,
  toEngineState,
  turnOrder,
  whoseTurn,
  ledSuit as runtimeLedSuit,
} from './runtime';
import type { Runtime } from './runtime';
import { computeScore } from './scoring';
import type { CapsVerdictKind } from './scoring';
import { seatsHoldingTrump } from './engine/play';

export type AppState =
  | { kind: 'loading' }
  | { kind: 'no-puzzle'; date: string; reason: string }
  | { kind: 'intro'; puzzle: DailyPuzzle }
  | {
      kind: 'playing';
      puzzle: DailyPuzzle;
      runtime: Runtime;
      // Bot turns auto-tick via scheduleBotTurn.
    }
  | {
      kind: 'caps-entry';
      puzzle: DailyPuzzle;
      runtime: Runtime;
      chosen: CardId[];
    }
  | {
      kind: 'caps-reveal';
      puzzle: DailyPuzzle;
      runtime: Runtime;
      verdict: CapsVerdictKind;
      order: CardId[];
      breakingWorldHint: string | null;
    }
  | {
      kind: 'result';
      puzzle: DailyPuzzle;
      score: number;
      verdict: CapsVerdictKind;
      callRound: number | null;
      orderLength: number | null;
      hintsUsed: number;
      worldsToggleUses: number;
    };

interface Store {
  state: AppState;
  setPuzzle: (puzzle: DailyPuzzle | null, date: string) => void;
  startGame: () => void;
  legalPlaysForSouth: () => CardId[];
  playCard: (card: CardId) => void;
  advanceBots: () => void;
  resolveCurrentRound: () => CompletedRound | null;
  openCapsEntry: () => void;
  cancelCapsEntry: () => void;
  toggleCardInOrder: (card: CardId) => void;
  submitCaps: () => void;
  skipCapsToResult: () => void;
  finishGame: () => void;
  recordHint: () => void;
  recordWorldsToggle: () => void;
}

export const useStore = create<Store>((set, get) => ({
  state: { kind: 'loading' },

  setPuzzle: (puzzle, date) => {
    if (puzzle === null) {
      set({ state: { kind: 'no-puzzle', date, reason: 'No puzzle for today' } });
      return;
    }
    set({ state: { kind: 'intro', puzzle } });
  },

  startGame: () => {
    const s = get().state;
    if (s.kind !== 'intro') return;
    const runtime = newRuntime({
      hands: s.puzzle.hands,
      trumpSuit: s.puzzle.trump.suit,
      trumpCard: s.puzzle.trump.card,
      botSeed: s.puzzle.botSeed,
    });
    set({ state: { kind: 'playing', puzzle: s.puzzle, runtime } });
  },

  legalPlaysForSouth: () => {
    const s = get().state;
    if (s.kind !== 'playing') return [];
    const { runtime } = s;
    const t = whoseTurn(runtime);
    if (t !== 'south') return [];
    const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
    handsMap.set('north', runtime.hands.north);
    handsMap.set('west', runtime.hands.west);
    handsMap.set('south', runtime.hands.south);
    handsMap.set('east', runtime.hands.east);
    const trumpHolders = seatsHoldingTrump(handsMap, runtime.trumpSuit);
    return legalPlays({
      hand: runtime.hands.south,
      ledSuit: runtimeLedSuit(runtime),
      trumpSuit: runtime.trumpSuit,
      isLead: runtime.currentRound.length === 0,
      seatsWithTrumps: trumpHolders,
      seat: 'south',
    });
  },

  playCard: (card) => {
    const s = get().state;
    if (s.kind !== 'playing') return;
    if (whoseTurn(s.runtime) !== 'south') return;
    if (!get().legalPlaysForSouth().includes(card)) return;
    applyPlay(s.runtime, 'south', card);
    set({ state: { ...s } });
  },

  advanceBots: () => {
    const s = get().state;
    if (s.kind !== 'playing') return;
    const turn = whoseTurn(s.runtime);
    if (turn === null || turn === 'south') return;
    playBotTurn(s.runtime, turn);
    set({ state: { ...s } });
  },

  resolveCurrentRound: () => {
    const s = get().state;
    if (s.kind !== 'playing') return null;
    if (s.runtime.currentRound.length !== turnOrder(s.runtime).length) return null;
    const cr = resolveRound(s.runtime);
    set({ state: { ...s } });
    return cr;
  },

  openCapsEntry: () => {
    const s = get().state;
    if (s.kind !== 'playing') return;
    set({
      state: {
        kind: 'caps-entry',
        puzzle: s.puzzle,
        runtime: s.runtime,
        chosen: [],
      },
    });
  },

  cancelCapsEntry: () => {
    const s = get().state;
    if (s.kind !== 'caps-entry') return;
    set({ state: { kind: 'playing', puzzle: s.puzzle, runtime: s.runtime } });
  },

  toggleCardInOrder: (card) => {
    const s = get().state;
    if (s.kind !== 'caps-entry') return;
    const next = s.chosen.includes(card)
      ? s.chosen.filter(c => c !== card)
      : [...s.chosen, card];
    set({ state: { ...s, chosen: next } });
  },

  submitCaps: () => {
    const s = get().state;
    if (s.kind !== 'caps-entry') return;
    const engine = toEngineState(s.runtime);
    const valid = validateCapsCall(engine, 'south', s.chosen);
    const obligated = checkCapsObligation(engine, 'south');
    const late = isCapsLate(engine, 'south');
    let verdict: CapsVerdictKind;
    if (valid && !late) verdict = 'correct';
    else if (valid && late) verdict = 'late';
    else if (!obligated) verdict = 'wrong-not-obligated';
    else verdict = 'wrong-bad-order';

    let breaking: string | null = null;
    if (verdict !== 'correct' && verdict !== 'late') {
      const explained = explainCapsFailure(engine, 'south', s.chosen);
      if (explained) {
        breaking = `Order broke in a world consistent with what you know.`;
      }
    }
    set({
      state: {
        kind: 'caps-reveal',
        puzzle: s.puzzle,
        runtime: s.runtime,
        verdict,
        order: [...s.chosen],
        breakingWorldHint: breaking,
      },
    });
  },

  finishGame: () => {
    const s = get().state;
    if (s.kind !== 'caps-reveal') return;
    const par = s.puzzle.classification.optimalCallRound;
    const callRound = s.runtime.roundNumber;
    const breakdown = computeScore({
      verdict: s.verdict,
      callRound,
      parRound: par,
      hintsUsed: s.runtime.hintsUsed,
      worldsToggleUses: s.runtime.worldsToggleUses,
    });
    set({
      state: {
        kind: 'result',
        puzzle: s.puzzle,
        score: breakdown.total,
        verdict: s.verdict,
        callRound,
        orderLength: s.order.length,
        hintsUsed: s.runtime.hintsUsed,
        worldsToggleUses: s.runtime.worldsToggleUses,
      },
    });
  },

  skipCapsToResult: () => {
    const s = get().state;
    if (s.kind !== 'playing') return;
    if (!isGameOver(s.runtime)) return;
    const par = s.puzzle.classification.optimalCallRound;
    // No call was made. If south was ever obligated, this is a missed call.
    const verdict: CapsVerdictKind = par !== null ? 'missed' : 'missed';
    const breakdown = computeScore({
      verdict,
      callRound: null,
      parRound: par,
      hintsUsed: s.runtime.hintsUsed,
      worldsToggleUses: s.runtime.worldsToggleUses,
    });
    set({
      state: {
        kind: 'result',
        puzzle: s.puzzle,
        score: breakdown.total,
        verdict,
        callRound: null,
        orderLength: null,
        hintsUsed: s.runtime.hintsUsed,
        worldsToggleUses: s.runtime.worldsToggleUses,
      },
    });
  },

  recordHint: () => {
    const s = get().state;
    if (s.kind !== 'playing') return;
    s.runtime.hintsUsed++;
    set({ state: { ...s } });
  },

  recordWorldsToggle: () => {
    const s = get().state;
    if (s.kind !== 'playing') return;
    s.runtime.worldsToggleUses++;
    set({ state: { ...s } });
  },
}));
