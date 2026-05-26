// Regression tests for closed-trump-bot fixes (F1, F3, F9, F10).

import { describe, expect, it } from 'vitest';
import type { CardId } from '@engine/card';
import { SEAT_INDEX, type Seat } from '@engine/seating';
import type { EngineGameState, RoundEntry } from '@engine/state';
import {
  ClosedTrumpDealError,
  chooseClosedTrumpPlay,
} from '../closed-trump-bot';

const c = (s: string): CardId => s as CardId;

interface BuildArgs {
  hands: Partial<Record<Seat, CardId[]>>;
  trumperSeat: Seat;
  trumpSuit: 'c' | 'd' | 'h' | 's';
  trumpCard: CardId;
  trumpCardInHand: boolean;
  isOpen: boolean;
  isRevealed: boolean;
  priority: Seat;
  roundNumber: number;
  completedRounds?: number; // shorthand: synthesize this many empty completed rounds
  currentRound?: RoundEntry[];
}

const buildState = (a: BuildArgs): EngineGameState => {
  const hands: ReadonlyArray<CardId>[] = [[], [], [], []];
  for (const seat of ['north', 'west', 'south', 'east'] as Seat[]) {
    hands[SEAT_INDEX[seat]] = a.hands[seat] ?? [];
  }
  const completed = Array.from({ length: a.completedRounds ?? 0 }, (_, i) => ({
    roundNumber: i + 1,
    cards: [] as RoundEntry[],
    winner: 'south' as Seat,
    pointsWon: 0,
    trumpRevealed: false,
  }));
  return {
    hands,
    trump: {
      trumperSeat: a.trumperSeat,
      trumpSuit: a.trumpSuit,
      trumpCard: a.trumpCard,
      trumpCardInHand: a.trumpCardInHand,
      isRevealed: a.isRevealed,
      isOpen: a.isOpen,
    },
    play: {
      roundNumber: a.roundNumber,
      priority: a.priority,
      currentRound: a.currentRound ?? [],
      completedRounds: completed,
      pointsWon: { team_a: 0, team_b: 0 },
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

describe('closed-trump-bot — fixes', () => {
  // F9: R1 closed-trump trumper with priority and only trumps throws
  // ClosedTrumpDealError so callers can discard the deal.
  it('§T-1 R1 priority trumper with only trumps throws ClosedTrumpDealError', () => {
    const state = buildState({
      hands: {
        south: [c('Jc'), c('9c'), c('Ac'), c('10c'), c('Kc'), c('Qc'), c('8c')],
        north: [c('Jh'), c('9h'), c('Ah'), c('10h'), c('Kh'), c('Qh'), c('8h'), c('7h')],
        east:  [c('Js'), c('9s'), c('As'), c('10s'), c('Ks'), c('Qs'), c('8s'), c('7s')],
        west:  [c('Jd'), c('9d'), c('Ad'), c('10d'), c('Kd'), c('Qd'), c('8d'), c('7d')],
      },
      trumperSeat: 'south',
      trumpSuit: 'c',
      trumpCard: c('7c'),
      trumpCardInHand: false,
      isOpen: false,
      isRevealed: false,
      priority: 'south',
      roundNumber: 1,
    });
    expect(() => chooseClosedTrumpPlay({
      seat: 'south',
      hand: state.hands[SEAT_INDEX.south],
      state,
      rng: () => 0.5,
    })).toThrow(ClosedTrumpDealError);
  });

  // F3: post-§T9 reveal (isOpen=true), the bot must play face-up.
  // Set up R5 with isOpen=true after a prior §T9 fire; south is non-
  // trumper, west leads diamonds, south has no diamonds.
  it('§S7 post-reveal: non-trumper plays face-up when unable to follow', () => {
    const state = buildState({
      hands: {
        south: [c('Kc'), c('Qc')],
        north: [c('Jh'), c('9h')],
        east:  [c('Ad'), c('10d')],
        west:  [c('Js'), c('9s')],
      },
      trumperSeat: 'north',
      trumpSuit: 'h',
      trumpCard: c('Ah'),
      trumpCardInHand: true,
      isOpen: true,
      isRevealed: true,
      priority: 'west',
      roundNumber: 5,
      completedRounds: 4,
      currentRound: [
        { seat: 'west', card: c('Js'), faceDown: false, revealed: false },
      ],
    });
    const choice = chooseClosedTrumpPlay({
      seat: 'south',
      hand: state.hands[SEAT_INDEX.south],
      state,
      rng: () => 0.5,
    });
    expect(choice.faceDown).toBe(false);
  });

  // F3 + F10: post-reveal trumper has only in-hand trumps left and
  // cannot follow; play face-up (no face-down §S7/§T-4 violation).
  it('§S7 + §T-4 post-reveal: trumper with only trumps plays face-up', () => {
    const state = buildState({
      hands: {
        south: [c('Jc'), c('9c')],          // south trumper with only trumps
        north: [c('Jh'), c('9h')],
        east:  [c('Ad'), c('10d')],
        west:  [c('Js'), c('9s')],
      },
      trumperSeat: 'south',
      trumpSuit: 'c',
      trumpCard: c('Ac'),
      trumpCardInHand: true,
      isOpen: true,
      isRevealed: true,
      priority: 'west',
      roundNumber: 5,
      completedRounds: 4,
      currentRound: [
        { seat: 'west', card: c('Js'), faceDown: false, revealed: false },
      ],
    });
    const choice = chooseClosedTrumpPlay({
      seat: 'south',
      hand: state.hands[SEAT_INDEX.south],
      state,
      rng: () => 0.5,
    });
    expect(choice.faceDown).toBe(false);
    expect(['Jc', '9c']).toContain(choice.card);
  });
});
