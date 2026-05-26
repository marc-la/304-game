// B3 — Heuristic. Reuses the existing engine bot (chooseBotPlay).
// Kept as a thin re-export so the zoo lookup is uniform and the
// existing engine module is not touched.

import { chooseBotPlay } from '../bot';
import type { BotChoice, BotContext } from './types';

export const chooseHeuristic = (ctx: BotContext): BotChoice => {
  const card = chooseBotPlay({
    seat: ctx.seat,
    hand: ctx.hand,
    state: ctx.state,
    rng: ctx.rng,
  });
  return { card };
};
