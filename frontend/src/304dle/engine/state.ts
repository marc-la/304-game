// Slim engine-facing state shape. The 304dle game runtime maintains a
// rich working state; this is what the engine reads. The bridge
// adapter (304dle/runtime.ts) converts between them.

import type { CardId, Suit } from './card';
import type { Seat, Team } from './seating';

export interface RoundEntry {
  seat: Seat;
  // null when face-down and the viewer cannot see it. Engine callers
  // always pass viewer-redacted state, so the engine never gets
  // hidden information leaking through this field.
  card: CardId | null;
  faceDown: boolean;
  revealed: boolean;
}

export interface CompletedRound {
  roundNumber: number;
  cards: ReadonlyArray<RoundEntry>;
  winner: Seat;
  pointsWon: number;
  trumpRevealed: boolean;
}

export interface CapsObligation {
  obligatedAtRound: number;
  obligatedAtCard: number;
  vPlaysAtObligation: number;
}

export interface EngineTrumpState {
  trumperSeat: Seat;
  trumpSuit: Suit;
  trumpCard: CardId | null;
  trumpCardInHand: boolean;
  isRevealed: boolean;
  isOpen: boolean;
}

export interface EnginePlayState {
  roundNumber: number;
  priority: Seat;
  currentRound: ReadonlyArray<RoundEntry>;
  completedRounds: ReadonlyArray<CompletedRound>;
  pointsWon: Record<Team, number>;
  capsObligations: ReadonlyMap<Seat, CapsObligation>;
}

export interface EngineGameState {
  // Hands stored per seat. The engine only ever reads the viewer's
  // own hand (build_info_set never peeks at others); 304dle stores
  // the full set so the bot can use its own seat's hand.
  hands: ReadonlyMap<Seat, ReadonlyArray<CardId>>;
  trump: EngineTrumpState;
  play: EnginePlayState;
  pccPartnerOut: Seat | null;
}
