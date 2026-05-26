// Tests for the full-state play engine (play-engine.ts).
//
// Focus: §T9 closed-trump reveal plumbing. The lift now preserves
// `trump.trumpCard` and sets `trump.foldedCardLifted = true` so
// `buildInfoSet` can populate W6 `knownInHand` from the full-game
// engine path (matching what the 304dle runtime already did).

import { describe, expect, it } from 'vitest';

import type { CardId } from '../card';
import { buildInfoSet } from '../info';
import { toEngineState } from '../game';
import { resolveCurrentRound } from '../play-engine';
import type { Seat } from '../seating';
import type { GameState, RoundEntry } from '../state';
import { newPlayState } from '../state';

const c = (s: string): CardId => s as CardId;

// Build a minimal closed-trump GameState mid-round-1, with the
// current round already containing four plays where a non-trumper
// has cut face-down with a trump. resolveCurrentRound is expected
// to fire §T9 (lift the folded trump into the trumper's hand) and
// flag the lift via trump.foldedCardLifted.
const buildPreLiftState = (): GameState => {
  // Trumper = west, trump suit = clubs, folded trump card = Jc.
  // Hands shown are what each seat holds at the moment the round
  // is about to resolve (i.e. after each seat has played one card).
  // Round 1: south leads 7h. North follows 8h. West cuts face-down
  // with 9c (clubs / trump). East minuses 7s face-down (non-trump).
  const handsAfter: Record<Seat, CardId[]> = {
    south: ['10c', '9d', 'Ad', '10d', 'Kd', 'Jd', '8d'].map(c),
    north: ['9h', 'Ah', '10h', 'Kh', 'Qh', '7h', 'Js'].map(c),
    west: ['Ac', 'Kc', 'Qd', '8c', '7c', 'Jh'].map(c),
    east: ['9s', 'As', '10s', 'Ks', 'Qs', '8s', 'Qc'].map(c),
  };
  const currentRound: RoundEntry[] = [
    { seat: 'south', card: c('7h'), faceDown: false, revealed: false },
    { seat: 'north', card: c('8h'), faceDown: false, revealed: false },
    { seat: 'west', card: c('9c'), faceDown: true, revealed: false },
    { seat: 'east', card: c('7s'), faceDown: true, revealed: false },
  ];

  const play = newPlayState('south');
  play.currentRound = currentRound;
  play.roundNumber = 1;
  play.currentTurn = null;

  return {
    gameNumber: 1,
    dealer: 'south',
    phase: 'playing',
    stone: { team_a: 0, team_b: 0 },
    hands: handsAfter,
    deck: null,
    trump: {
      trumperSeat: 'west',
      trumpSuit: 'c',
      trumpCard: c('Jc'),
      isRevealed: false,
      isOpen: false,
      trumpCardInHand: false,
      foldedCardLifted: false,
    },
    bidding: null,
    play,
    result: null,
    consecutiveReshuffles: 0,
    pccPartnerOut: null,
  };
};

describe('play-engine §T9 lift (B3)', () => {
  it('lift preserves trump.trumpCard and sets foldedCardLifted', () => {
    const state = buildPreLiftState();
    resolveCurrentRound(state);

    expect(state.trump.isRevealed).toBe(true);
    expect(state.trump.trumpCardInHand).toBe(true);
    expect(state.trump.foldedCardLifted).toBe(true);
    // Identity preserved (the W6 prerequisite).
    expect(state.trump.trumpCard).toBe(c('Jc'));
    // Lifted card now physically in trumper's hand.
    expect(state.hands.west.includes(c('Jc'))).toBe(true);
  });

  it('buildInfoSet on a non-trumper viewer sees the lifted card in knownInHand', () => {
    const state = buildPreLiftState();
    resolveCurrentRound(state);

    // After resolution, the round is in completedRounds; build the
    // engine view and the info-set for south (non-trumper).
    const engine = toEngineState(state);
    const info = buildInfoSet(engine, 'south');

    const westKnown = info.knownInHand.get('west');
    expect(westKnown).toBeDefined();
    expect(westKnown!.has(c('Jc'))).toBe(true);
  });
});
