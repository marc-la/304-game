// Shared helpers across bots.

import type { CardId, Suit } from '../card';
import { pointsOf, powerOf, suitOf } from '../card';
import { legalPlays, roundWinner, seatsHoldingTrump } from '../play';
import type { Seat } from '../seating';
import { partnerSeat } from '../seating';
import type { EngineGameState } from '../state';

export const ledSuitOf = (state: EngineGameState): Suit | null => {
  const cur = state.play.currentRound;
  if (cur.length > 0 && cur[0].card !== null) return suitOf(cur[0].card);
  return null;
};

export const isLeadNow = (state: EngineGameState): boolean =>
  state.play.currentRound.length === 0;

export const legalPlaysFor = (
  state: EngineGameState,
  seat: Seat,
  hand: ReadonlyArray<CardId>,
): CardId[] => {
  const trump = state.trump.trumpSuit;
  const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
  for (const s of ['north', 'west', 'south', 'east'] as Seat[]) {
    handsMap.set(s, state.hands.get(s) ?? []);
  }
  const trumpHolders = seatsHoldingTrump(handsMap, trump);
  return legalPlays({
    hand,
    ledSuit: ledSuitOf(state),
    trumpSuit: trump,
    isLead: isLeadNow(state),
    seatsWithTrumps: trumpHolders,
    seat,
  });
};

export const inProgressTuples = (
  state: EngineGameState,
): Array<readonly [Seat, CardId]> =>
  state.play.currentRound
    .filter(e => e.card !== null)
    .map(e => [e.seat, e.card!]);

// Would this candidate, if played now, win the in-progress round
// (given only the cards on the table so far)?
export const wouldWinSnapshot = (
  candidate: CardId,
  state: EngineGameState,
  seat: Seat,
): boolean => {
  const tuples = inProgressTuples(state);
  if (tuples.length === 0) return true; // leading
  const projected: Array<readonly [Seat, CardId]> = [
    ...tuples,
    [seat, candidate],
  ];
  return roundWinner(projected, state.trump.trumpSuit) === seat;
};

export const partnerWinningSnapshot = (
  state: EngineGameState,
  seat: Seat,
): boolean => {
  const tuples = inProgressTuples(state);
  if (tuples.length === 0) return false;
  return roundWinner(tuples, state.trump.trumpSuit) === partnerSeat(seat);
};

export const lowestByPoints = (cards: ReadonlyArray<CardId>): CardId =>
  [...cards].sort(
    (a, b) => pointsOf(a) - pointsOf(b) || powerOf(b) - powerOf(a),
  )[0];

export const highestByPower = (cards: ReadonlyArray<CardId>): CardId =>
  [...cards].sort((a, b) => powerOf(a) - powerOf(b))[0];

export const lowestByPower = (cards: ReadonlyArray<CardId>): CardId =>
  [...cards].sort((a, b) => powerOf(b) - powerOf(a))[0];

// Sort cards in a deterministic, total order. Used wherever bots
// need stable iteration so RNG indices are reproducible.
export const stableSort = (cards: ReadonlyArray<CardId>): CardId[] =>
  [...cards].sort();
