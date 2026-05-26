// B1 — High-low. Cheapest winning card if a winning card exists at
// snapshot, else lowest-points sluff. No memory, no card tracking.

import {
  inProgressTuples,
  legalPlaysFor,
  lowestByPoints,
  partnerWinningSnapshot,
  stableSort,
  wouldWinSnapshot,
} from './common';
import { pointsOf, powerOf } from '../card';
import type { CardId } from '../card';
import type { BotChoice, BotContext } from './types';

const cheapestWinner = (
  cards: ReadonlyArray<CardId>,
  ctx: BotContext,
): CardId | null => {
  // "Cheapest" = lowest points; ties broken by lower power (so we keep
  // higher-rank dominating cards in hand).
  const sorted = [...cards].sort(
    (a, b) => pointsOf(a) - pointsOf(b) || powerOf(b) - powerOf(a),
  );
  for (const c of sorted) {
    if (wouldWinSnapshot(c, ctx.state, ctx.seat)) return c;
  }
  return null;
};

export const chooseHighLow = (ctx: BotContext): BotChoice => {
  const legal = stableSort(legalPlaysFor(ctx.state, ctx.seat, ctx.hand));
  if (legal.length === 0) throw new Error('B1: no legal plays');
  if (legal.length === 1) return { card: legal[0] };

  const inProg = inProgressTuples(ctx.state);

  // Partner already winning → sluff cheapest.
  if (inProg.length > 0 && partnerWinningSnapshot(ctx.state, ctx.seat)) {
    return { card: lowestByPoints(legal) };
  }

  // Leading: lead a low non-J card so opponents have to spend their stars.
  if (inProg.length === 0) {
    const nonStars = legal.filter(c => {
      const r = c.length === 3 ? '10' : c[0];
      return r !== 'J' && r !== '9' && r !== 'A';
    });
    if (nonStars.length > 0) return { card: lowestByPoints(nonStars) };
    return { card: lowestByPoints(legal) };
  }

  const winner = cheapestWinner(legal, ctx);
  if (winner !== null) return { card: winner };
  return { card: lowestByPoints(legal) };
};
