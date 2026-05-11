// State schemas for the 304 engine.
//
// Two layers coexist:
//
//   1. The **slim engine view** (`EngineGameState`, `EngineTrumpState`,
//      `EnginePlayState`) used by play-phase pure functions
//      (`bot.ts`, `caps.ts`, `dd.ts`, etc.) and the 304dle puzzle
//      runtime. This represents one viewer's projection during the
//      play phase.
//
//   2. The **full game state** (`GameState`, `BiddingState`,
//      `TrumpState`, `PlayState`) mirroring Python's `game304/state.py`.
//      This is the authoritative state used by the `Game`/`Match`
//      orchestrators (full house-rule game, including bidding and
//      trump selection). When the play-phase pure functions need
//      to be called against this state, project via `toEngineState`
//      (see `game.ts`).

import type { CardId, Suit } from './card';
import type { Seat, Team } from './seating';
import type { BidAction, Phase } from './types';

// ---------------------------------------------------------------------------
// Round / play primitives — shared between both layers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Slim engine view — used by play-phase pure functions
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Full game state — mirrors game304/state.py
// ---------------------------------------------------------------------------

export interface PlayerBidState {
  speechCount: number;
  hasPartnered: boolean;
  partnerUsedBy: Seat | null;
  skipped: boolean;
}

export const newPlayerBidState = (): PlayerBidState => ({
  speechCount: 0,
  hasPartnered: false,
  partnerUsedBy: null,
  skipped: false,
});

export interface Speech {
  seat: Seat;
  action: BidAction;
  value: number | null;
  speechNumber: number;
  onBehalfOf: Seat | null;
}

export interface PendingPartnerResponse {
  originalSeat: Seat;
  partnerSeat: Seat;
}

export interface BiddingState {
  isFourCard: boolean;
  currentBidder: Seat;
  highestBid: number;
  highestBidder: Seat | null;
  consecutivePasses: number;
  speeches: Speech[];
  playerState: Record<Seat, PlayerBidState>;
  isPcc: boolean;
  pendingPartner: PendingPartnerResponse | null;
  fourCardBid: number | null;
  fourCardBidder: Seat | null;
}

export interface TrumpState {
  trumperSeat: Seat | null;
  trumpSuit: Suit | null;
  trumpCard: CardId | null;
  isRevealed: boolean;
  isOpen: boolean;
  trumpCardInHand: boolean;
}

export const newTrumpState = (): TrumpState => ({
  trumperSeat: null,
  trumpSuit: null,
  trumpCard: null,
  isRevealed: false,
  isOpen: false,
  trumpCardInHand: false,
});

export interface CapsCall {
  calledBy: Seat;
  calledAtRound: number;
  playOrder: CardId[];
  isExternal: boolean;
  result: 'correct' | 'late' | 'wrong_early' | null;
}

export interface PlayState {
  roundNumber: number;
  priority: Seat | null;
  currentTurn: Seat | null;
  currentRound: RoundEntry[];
  completedRounds: CompletedRound[];
  pointsWon: Record<Team, number>;
  capsCall: CapsCall | null;
  capsObligations: Map<Seat, CapsObligation>;
}

export const newPlayState = (priority: Seat): PlayState => ({
  roundNumber: 1,
  priority,
  currentTurn: priority,
  currentRound: [],
  completedRounds: [],
  pointsWon: { team_a: 0, team_b: 0 },
  capsCall: null,
  capsObligations: new Map(),
});

export type GameResultReason =
  | 'bid_met'
  | 'bid_failed'
  | 'pcc_won'
  | 'pcc_lost'
  | 'caps_correct'
  | 'caps_late'
  | 'caps_wrong'
  | 'external_caps'
  | 'spoilt_trumps'
  | 'absolute_hand'
  | 'error';

export type StoneDirection = 'give' | 'receive' | 'none';

export interface GameResult {
  reason: GameResultReason;
  stoneExchanged: number;
  stoneDirection: StoneDirection;
  winnerTeam: Team | null;
  description: string;
  trumperPoints?: number;
  oppositionPoints?: number;
  bid?: number;
  capsBy?: Seat;
}

// The Deck instance is held by reference (see ./deck.ts). State holds
// it as `unknown` to avoid a circular module dependency; deck.ts is
// the only place that constructs and operates on it.
export interface DeckRef {
  remaining: number;
  pop(): CardId | undefined;
  popN(n: number): CardId[];
}

export interface GameState {
  gameNumber: number;
  dealer: Seat;
  phase: Phase;
  stone: Record<Team, number>;
  hands: Record<Seat, CardId[]>;
  deck: DeckRef | null;
  trump: TrumpState;
  bidding: BiddingState | null;
  play: PlayState | null;
  result: GameResult | null;
  consecutiveReshuffles: number;
  pccPartnerOut: Seat | null;
}
