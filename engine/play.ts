// Legal-play and round resolution. Pure functions, no state mutation.
// Mirrors the subset of game304/play.py that dd.py reuses.

import type { CardId, Suit } from './card';
import { powerOf, suitOf } from './card';
import type { Seat } from './seating';
import { nextSeat } from './seating';

export interface LegalPlaysArgs {
  hand: ReadonlyArray<CardId>;
  ledSuit: Suit | null;
  trumpSuit: Suit | null;
  isLead: boolean;
  seatsWithTrumps: ReadonlySet<Seat>;
  seat: Seat;
}

// Cards `seat` can legally play given the current round state.
// Enforces follow-suit and the exhausted-trumps lead rule.
// Closed-trump face-down semantics are intentionally not modelled here:
// caps cards play face-up, and 304dle v1 uses Open Trump throughout.
export const legalPlays = (args: LegalPlaysArgs): CardId[] => {
  const { hand, ledSuit, trumpSuit, isLead, seatsWithTrumps, seat } = args;
  if (!isLead) {
    const suited = hand.filter(c => suitOf(c) === ledSuit);
    return suited.length > 0 ? suited : [...hand];
  }
  // Leading: if this seat is the only seat with any remaining trump
  // and they hold any, they must lead trump.
  if (
    trumpSuit !== null &&
    seatsWithTrumps.size === 1 &&
    seatsWithTrumps.has(seat) &&
    hand.some(c => suitOf(c) === trumpSuit)
  ) {
    return hand.filter(c => suitOf(c) === trumpSuit);
  }
  return [...hand];
};

// Anticlockwise turn order for one round, skipping the PCC-out seat.
export const roundTurnOrder = (
  leader: Seat,
  pccPartnerOut: Seat | null,
): Seat[] => {
  const target = pccPartnerOut !== null ? 3 : 4;
  const order: Seat[] = [leader];
  let cur = leader;
  while (order.length < target) {
    cur = nextSeat(cur);
    if (cur === leader) break;
    if (cur === pccPartnerOut) continue;
    order.push(cur);
  }
  return order;
};

// Winner of a complete round. plays must be in play order; the first
// face-up card sets the led suit (in 304dle the leader always plays
// face-up so plays[0] is always the leader).
export const roundWinner = (
  plays: ReadonlyArray<readonly [Seat, CardId]>,
  trumpSuit: Suit | null,
): Seat => {
  if (plays.length === 0) {
    throw new Error('No plays to resolve');
  }
  const ledSuit = suitOf(plays[0][1]);
  const trumps = trumpSuit
    ? plays.filter(([, c]) => suitOf(c) === trumpSuit)
    : [];
  if (trumps.length > 0) {
    return trumps.reduce((best, cur) =>
      powerOf(cur[1]) < powerOf(best[1]) ? cur : best,
    )[0];
  }
  const led = plays.filter(([, c]) => suitOf(c) === ledSuit);
  if (led.length === 0) return plays[0][0];
  return led.reduce((best, cur) =>
    powerOf(cur[1]) < powerOf(best[1]) ? cur : best,
  )[0];
};

import { pointsOf } from './card';

export const roundPoints = (
  plays: ReadonlyArray<readonly [Seat, CardId]>,
): number => plays.reduce((sum, [, c]) => sum + pointsOf(c), 0);

export const seatsHoldingTrump = (
  hands: ReadonlyMap<Seat, ReadonlyArray<CardId>>,
  trumpSuit: Suit | null,
): Set<Seat> => {
  const out = new Set<Seat>();
  if (trumpSuit === null) return out;
  for (const [seat, hand] of hands.entries()) {
    if (hand.some(c => suitOf(c) === trumpSuit)) out.add(seat);
  }
  return out;
};
