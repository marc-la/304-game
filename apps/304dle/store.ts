// Zustand store driving the 304dle game session.
//
// Adaptive caps + dynamic-par + worlds-at-call difficulty.
// Static puzzle.classification.optimalCallRound is no longer
// part of the verdict — runtime's capsObligations stamp is the
// dynamic par.

import { create } from 'zustand';
import type { CardId } from '@engine/card';
import { checkCapsObligation, isCapsLate } from '@engine/caps';
import { findWitnessLine } from '@engine/caps-csp';
import { legalPlays } from '@engine/play';
import type { Seat } from '@engine/seating';
import type { CompletedRound } from '@engine/state';
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
import type { CapsDifficulty, CapsVerdictKind } from './scoring';
import { gradeDifficulty } from './scoring';
import { seatsHoldingTrump } from '@engine/play';
import { countWorlds, measureForDifficulty } from './worlds-counter';

export type AppState =
  | { kind: 'loading' }
  | { kind: 'no-puzzle'; date: string; reason: string }
  | { kind: 'intro'; puzzle: DailyPuzzle }
  | {
      kind: 'playing';
      puzzle: DailyPuzzle;
      runtime: Runtime;
    }
  | {
      kind: 'caps-confirm';
      puzzle: DailyPuzzle;
      runtime: Runtime;
    }
  | {
      kind: 'caps-reveal';
      puzzle: DailyPuzzle;
      runtime: Runtime;
      verdict: CapsVerdictKind;
      witnessLine: CardId[] | null;
      worldsAtCall: number | null;
      difficulty: CapsDifficulty | null;
      obligatedAtRound: number | null;
    }
  | {
      kind: 'result';
      puzzle: DailyPuzzle;
      verdict: CapsVerdictKind;
      callRound: number | null;
      obligatedAtRound: number | null;
      worldsAtCall: number | null;
      difficulty: CapsDifficulty | null;
    };

interface Store {
  state: AppState;
  setPuzzle: (puzzle: DailyPuzzle | null, date: string) => void;
  startGame: () => void;
  legalPlaysForSouth: () => CardId[];
  playCard: (card: CardId) => void;
  advanceBots: () => void;
  resolveCurrentRound: () => CompletedRound | null;
  openCapsConfirm: () => void;
  cancelCapsConfirm: () => void;
  submitCaps: () => void;
  skipCapsToResult: () => void;
  finishGame: () => void;
  replayHand: () => void;
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

  openCapsConfirm: () => {
    const s = get().state;
    if (s.kind !== 'playing') return;
    set({
      state: {
        kind: 'caps-confirm',
        puzzle: s.puzzle,
        runtime: s.runtime,
      },
    });
  },

  cancelCapsConfirm: () => {
    const s = get().state;
    if (s.kind !== 'caps-confirm') return;
    set({ state: { kind: 'playing', puzzle: s.puzzle, runtime: s.runtime } });
  },

  submitCaps: () => {
    const s = get().state;
    if (s.kind !== 'caps-confirm' && s.kind !== 'playing') return;
    const engine = toEngineState(s.runtime);
    const obligated = checkCapsObligation(engine, 'south');
    const late = isCapsLate(engine, 'south');

    let verdict: CapsVerdictKind;
    let witnessLine: CardId[] | null = null;
    if (obligated && !late) {
      verdict = 'correct';
      witnessLine = findWitnessLine(engine, 'south');
    } else if (late) {
      verdict = 'late';
      witnessLine = findWitnessLine(engine, 'south');
    } else {
      verdict = 'wrong-not-obligated';
    }

    const worldsCount = countWorlds(s.runtime, 'south');
    const worldsAtCall = measureForDifficulty(worldsCount);
    const difficulty = gradeDifficulty(worldsAtCall);
    const stamp = s.runtime.capsObligations.get('south');
    const obligatedAtRound = stamp?.obligatedAtRound ?? null;

    set({
      state: {
        kind: 'caps-reveal',
        puzzle: s.puzzle,
        runtime: s.runtime,
        verdict,
        witnessLine,
        worldsAtCall,
        difficulty,
        obligatedAtRound,
      },
    });
  },

  finishGame: () => {
    const s = get().state;
    if (s.kind !== 'caps-reveal') return;
    set({
      state: {
        kind: 'result',
        puzzle: s.puzzle,
        verdict: s.verdict,
        callRound: s.runtime.roundNumber,
        obligatedAtRound: s.obligatedAtRound,
        worldsAtCall: s.worldsAtCall,
        difficulty: s.difficulty,
      },
    });
  },

  replayHand: () => {
    const s = get().state;
    const puzzle =
      s.kind === 'result' || s.kind === 'caps-reveal' || s.kind === 'caps-confirm' || s.kind === 'playing' || s.kind === 'intro'
        ? s.puzzle
        : null;
    if (puzzle === null) return;
    const runtime = newRuntime({
      hands: puzzle.hands,
      trumpSuit: puzzle.trump.suit,
      trumpCard: puzzle.trump.card,
      botSeed: puzzle.botSeed,
    });
    set({ state: { kind: 'playing', puzzle, runtime } });
  },

  skipCapsToResult: () => {
    const s = get().state;
    if (s.kind !== 'playing') return;
    if (!isGameOver(s.runtime)) return;
    const stamp = s.runtime.capsObligations.get('south');
    set({
      state: {
        kind: 'result',
        puzzle: s.puzzle,
        verdict: 'missed',
        callRound: null,
        obligatedAtRound: stamp?.obligatedAtRound ?? null,
        worldsAtCall: null,
        difficulty: null,
      },
    });
  },
}));
