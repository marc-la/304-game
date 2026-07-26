// Zustand store driving the 304dle script-driven game session.

import { create } from 'zustand';
import type { CardId } from '@engine/card';
import { checkCapsObligation, isCapsLate } from '@engine/caps';
import { findWitnessLine } from '@engine/caps-csp';
import { findRefutingWorld } from '@engine/refute';
import type { RefutingWorld } from '@engine/refute';
import type { Seat } from '@engine/seating';
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
      handsAtCall: Record<Seat, CardId[]>;
      refutingWorld: RefutingWorld | null;
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
      // Everyone's remaining cards at the moment of the call. The
      // post-mortem: this is where you see what you failed to rule
      // out. Not persisted, so it is absent after a reload.
      handsAtCall: Record<Seat, CardId[]> | null;
      // Only for a premature call: one layout, consistent with what
      // the player had seen, in which they drop a trick. See
      // engine/refute.ts for why the ACTUAL hands are the wrong
      // evidence to show here.
      refutingWorld: RefutingWorld | null;
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

// Freeze everyone's remaining cards. Taken by value — the runtime's
// hand arrays are mutated in place by applyPlay.
const snapshotHands = (rt: Runtime): Record<Seat, CardId[]> => ({
  north: [...rt.hands.north],
  west: [...rt.hands.west],
  south: [...rt.hands.south],
  east: [...rt.hands.east],
});

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

    // Grace-period model: if the round is full but not yet resolved
    // (the player is reviewing the just-completed round), §T9 reveals
    // and clause-6 trumper visibility have not yet fired in the engine.
    // Resolve first so the obligation predicate sees the state the
    // player is visually reasoning about.
    if (s.runtime.currentRound.length === turnOrder(s.runtime).length) {
      resolveRound(s.runtime);
    }

    const engine = toEngineState(s.runtime);
    // Authoritative source of "obligated": the cached stamp written by
    // trackCapsObligation at the first event-state at which obligation
    // held (see [docs/specs/caps_formalism.md §8.2]). Falling back to a live
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

    // A premature call needs a counter-example, not the real layout:
    // the puzzle is curated to sweep, so the true hands would show a
    // position where the player's plan works and contradict the
    // verdict. Bounded — returns null rather than stalling the UI.
    const refutingWorld = verdict === 'wrong-not-obligated'
      ? findRefutingWorld(engine, 'south')
      : null;
    const handsAtCall = snapshotHands(s.runtime);
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
        handsAtCall,
        refutingWorld,
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
        handsAtCall: s.handsAtCall,
        refutingWorld: s.refutingWorld,
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
        // The hand ran out — there are no remaining cards to show.
        handsAtCall: null,
        refutingWorld: null,
      },
    });
  },

}));
