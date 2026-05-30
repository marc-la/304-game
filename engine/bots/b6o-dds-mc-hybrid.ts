// B6o — DDS Monte Carlo hybrid. Delegates the high-uncertainty early
// rounds to B5 (csp-search) and the more decisive late rounds to B6
// (dds-mc, points-objective refactored). Motivation: R1+R2 dominate
// B6's per-game compute (~85 %) but their information-set uncertainty
// makes the high-fidelity DDS investment low-yield — a well-tuned
// shallow search at those rounds is comparable in strength at a
// fraction of the cost.
//
// Dispatch is round-number-keyed and total: there is no mid-game
// switch-back. Both delegates are individually deterministic in
// (info-set, rng seed), and the round number is a deterministic
// property of the engine state, so the hybrid inherits determinism.
//
// Tune by editing EARLY_ROUNDS. The default (≤ 2) matches the cutover
// chosen in the bot-hybrid handoff. If the refactored B6 is strong
// enough at R2 to justify its cost, drop it to 1. If B5 is comparable
// up through R3, raise it to 3.

import { chooseCSPSearch } from './b5-csp-search';
import { chooseDDSMC } from './b6-dds-mc';
import type { BotChoice, BotContext } from './types';

const EARLY_ROUNDS = 2;

export const chooseDDSMCHybrid = (ctx: BotContext): BotChoice =>
  ctx.state.play.roundNumber <= EARLY_ROUNDS
    ? chooseCSPSearch(ctx)
    : chooseDDSMC(ctx);
