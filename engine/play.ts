// Legal-play and round resolution. Pure functions, no state mutation.
// Mirrors the subset of game304/play.py that dd.py reuses.

import type { CardId, Suit } from './card';
import { powerOf, suitOf } from './card';
import type { Seat } from './seating';
import { nextSeat, SEATS_BY_INDEX } from './seating';

export interface LegalPlaysArgs {
  hand: ReadonlyArray<CardId>;
  ledSuit: Suit | null;
  trumpSuit: Suit | null;
  isLead: boolean;
  seatsWithTrumps: ReadonlySet<Seat>;
  seat: Seat;
  // Optional R1-trumper-lead context. When all four are supplied the
  // function enforces §T-6 (closed R1: trumper with priority cannot
  // lead trump) and §T-7 (open R1: trumper with priority must lead
  // trump if they hold any, non-PCC). Older callers that omit them
  // get the previous follow-suit + exhausted-trumps behaviour only.
  roundNumber?: number;
  trumperSeat?: Seat | null;
  isOpen?: boolean;
  isPcc?: boolean;
}

// Cards `seat` can legally play given the current round state.
// Enforces follow-suit, exhausted-trumps lead, and (when the optional
// context fields are supplied) the round-1 trumper lead constraints
// §T-1 / §T-6 (closed) and §T-7 (open).
// Face-down vs face-up choice is decided at the runtime layer
// (apps/304dle/runtime.ts) and validated against §S7 there.
export const legalPlays = (args: LegalPlaysArgs): CardId[] => {
  const {
    hand, ledSuit, trumpSuit, isLead, seatsWithTrumps, seat,
    roundNumber, trumperSeat, isOpen, isPcc,
  } = args;
  if (!isLead) {
    const suited = hand.filter(c => suitOf(c) === ledSuit);
    return suited.length > 0 ? suited : [...hand];
  }
  // Leading: if this seat is the only seat with any remaining trump
  // and they hold any, they must lead trump (§T-8).
  if (
    trumpSuit !== null &&
    seatsWithTrumps.size === 1 &&
    seatsWithTrumps.has(seat) &&
    hand.some(c => suitOf(c) === trumpSuit)
  ) {
    return hand.filter(c => suitOf(c) === trumpSuit);
  }
  // R1 trumper-with-priority lead constraints, if context supplied:
  //   §T-6 closed: cannot lead trump.
  //   §T-7 open non-PCC: must lead trump if any held.
  const isTrumperOnR1Lead =
    roundNumber === 1 &&
    trumperSeat !== undefined && trumperSeat !== null &&
    seat === trumperSeat &&
    trumpSuit !== null;
  if (isTrumperOnR1Lead) {
    if (isOpen === false) {
      const nonTrump = hand.filter(c => suitOf(c) !== trumpSuit);
      // If the trumper has only trumps, no legal closed R1 lead exists.
      // Returning an empty set surfaces the contradiction to callers
      // (it's the same condition that triggers ClosedTrumpDealError in
      // the closed-trump bot).
      if (nonTrump.length > 0) return nonTrump;
      return [];
    }
    if (isOpen === true && isPcc !== true) {
      const inTrump = hand.filter(c => suitOf(c) === trumpSuit);
      if (inTrump.length > 0) return inTrump;
      // No trumps held — open trumper may lead any card.
    }
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
  hands: ReadonlyArray<ReadonlyArray<CardId>>,
  trumpSuit: Suit | null,
): Set<Seat> => {
  const out = new Set<Seat>();
  if (trumpSuit === null) return out;
  for (let i = 0; i < 4; i++) {
    const hand = hands[i];
    if (hand === undefined) continue;
    if (hand.some(c => suitOf(c) === trumpSuit)) out.add(SEATS_BY_INDEX[i]);
  }
  return out;
};
