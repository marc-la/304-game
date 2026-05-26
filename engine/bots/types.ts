// Shared types for the bot zoo.

import type { CardId } from '../card';
import type { Seat } from '../seating';
import type { EngineGameState } from '../state';

export interface BotContext {
  seat: Seat;
  hand: ReadonlyArray<CardId>;
  state: EngineGameState;
  rng: () => number;
}

// Face-down is intentionally not exposed: all bots assume Open Trump
// (304dle's mode). The closed-trump bot in tools/curator is the
// scenario-aware variant and stays where it is.
export interface BotChoice {
  card: CardId;
}

export type PlayBot = (ctx: BotContext) => BotChoice;

export interface BotProfile {
  id: string;
  name: string;
  description: string;
  strengths: string[];
  limitations: string[];
  deterministic: true;
  time: string;
  space: string;
}
