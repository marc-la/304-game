// B0 — Random play. Uniform over legal moves.
// Deterministic given (rng-seed, info-set) because legal moves are
// produced in a stable order.

import { legalPlaysFor, stableSort } from './common';
import type { BotChoice, BotContext } from './types';

export const chooseRandom = (ctx: BotContext): BotChoice => {
  const legal = stableSort(legalPlaysFor(ctx.state, ctx.seat, ctx.hand));
  if (legal.length === 0) throw new Error('B0: no legal plays');
  if (legal.length === 1) return { card: legal[0] };
  const idx = Math.floor(ctx.rng() * legal.length);
  return { card: legal[idx] };
};
