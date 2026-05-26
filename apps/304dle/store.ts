// Zustand store driving the 304dle script-driven game session.

import { create } from 'zustand';
import type { CardId } from '@engine/card';
import { checkCapsObligation, isCapsLate } from '@engine/caps';
import { findWitnessLine } from '@engine/caps-csp';
import type { CompletedRound } from '@engine/state';
import type { ScriptedPuzzle } from './types';
import {
  applyScriptedPlay,
  isGameOver,
  newRuntime,
  resolveRound,
  scriptedCardForCurrentTurn,
  toEngineState,
  turnOrder,
  whoseTurn,
} from './runtime';
import type { Runtime } from './runtime';
import type { CapsDifficulty, CapsVerdictKind } from './scoring';
import { gradeDifficulty } from './scoring';
import { countWorlds, measureForDifficulty } from './worlds-counter';

// Each piece of state in the game session lifecycle.
export type AppState =
  | { kind: 'loading' }
  | { kind: 'no-puzzle'; date: string; reason: string }
  | { kind: 'intro'; puzzle: ScriptedPuzzle; date: string }
  | {
      kind: 'playing';
      puzzle: ScriptedPuzzle;
      date: string;
      runtime: Runtime;
    }
  | {
      kind: 'caps-confirm';
      puzzle: ScriptedPuzzle;
      date: string;
      runtime: Runtime;
    }
  | {
      kind: 'caps-reveal';
      puzzle: ScriptedPuzzle;
      date: string;
      runtime: Runtime;
      verdict: CapsVerdictKind;
      witnessLine: CardId[] | null;
      worldsAtCall: number | null;
      difficulty: CapsDifficulty | null;
      obligatedAtRound: number | null;
    }
  | {
      kind: 'result';
      puzzle: ScriptedPuzzle;
      date: string;
      verdict: CapsVerdictKind;
      callRound: number | null;
      obligatedAtRound: number | null;
      worldsAtCall: number | null;
      difficulty: CapsDifficulty | null;
    };

interface Store {
  state: AppState;
  setPuzzle: (puzzle: ScriptedPuzzle | null, date: string) => void;
  startGame: () => void;
  scriptedCardForSouth: () => CardId | null;
  playScripted: () => void;        // advance one scripted play
  resolveCurrentRound: () => CompletedRound | null;
  openCapsConfirm: () => void;
  cancelCapsConfirm: () => void;
  submitCaps: () => void;
  skipCapsToResult: () => void;
  finishGame: () => void;
  replayHand: () => void;
}

const buildRuntimeFromPuzzle = (p: ScriptedPuzzle): Runtime =>
  newRuntime({
    hands: p.hands,
    trumpSuit: p.trump.suit,
    trumpCard: p.trump.card,
    trumperSeat: p.trump.trumper,
    priority: p.priority,
    script: p.script,
    mode: p.trump.mode,
  });

export const useStore = create<Store>((set, get) => ({
  state: { kind: 'loading' },

  setPuzzle: (puzzle, date) => {
    if (puzzle === null) {
      set({ state: { kind: 'no-puzzle', date, reason: 'No puzzle for today' } });
      return;
    }
    set({ state: { kind: 'intro', puzzle, date } });
  },

  startGame: () => {
    const s = get().state;
    if (s.kind !== 'intro') return;
    const runtime = buildRuntimeFromPuzzle(s.puzzle);
    set({ state: { kind: 'playing', puzzle: s.puzzle, date: s.date, runtime } });
  },

  scriptedCardForSouth: () => {
    const s = get().state;
    if (s.kind !== 'playing') return null;
    if (whoseTurn(s.runtime) !== 'south') return null;
    return scriptedCardForCurrentTurn(s.runtime);
  },

  playScripted: () => {
    const s = get().state;
    if (s.kind !== 'playing') return;
    if (s.runtime.cursor >= s.runtime.script.length) return;
    applyScriptedPlay(s.runtime);
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
        date: s.date,
        runtime: s.runtime,
      },
    });
  },

  cancelCapsConfirm: () => {
    const s = get().state;
    if (s.kind !== 'caps-confirm') return;
    set({
      state: {
        kind: 'playing',
        puzzle: s.puzzle,
        date: s.date,
        runtime: s.runtime,
      },
    });
  },

  submitCaps: () => {
    const s = get().state;
    if (s.kind !== 'caps-confirm' && s.kind !== 'playing') return;
    const engine = toEngineState(s.runtime);
    // Authoritative source of "obligated": the cached stamp written by
    // trackCapsObligation at the first event-state at which obligation
    // held (see [docs/caps_formalism.md §8.2]). Falling back to a live
    // CSP re-check covers obligations that the stamp may have missed
    // (e.g. transient mid-round states where the CSP could not run).
    const stamp = s.runtime.capsObligations.get('south');
    const obligated = stamp !== undefined || checkCapsObligation(engine, 'south');
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
    const obligatedAtRound = stamp?.obligatedAtRound ?? null;

    set({
      state: {
        kind: 'caps-reveal',
        puzzle: s.puzzle,
        date: s.date,
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
        date: s.date,
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
      s.kind === 'result' ||
      s.kind === 'caps-reveal' ||
      s.kind === 'caps-confirm' ||
      s.kind === 'playing' ||
      s.kind === 'intro'
        ? s.puzzle
        : null;
    const date =
      s.kind === 'result' ||
      s.kind === 'caps-reveal' ||
      s.kind === 'caps-confirm' ||
      s.kind === 'playing' ||
      s.kind === 'intro'
        ? s.date
        : '';
    if (puzzle === null) return;
    const runtime = buildRuntimeFromPuzzle(puzzle);
    set({ state: { kind: 'playing', puzzle, date, runtime } });
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
        date: s.date,
        verdict: 'missed',
        callRound: null,
        obligatedAtRound: stamp?.obligatedAtRound ?? null,
        worldsAtCall: null,
        difficulty: null,
      },
    });
  },

}));
