// 304dle game runtime — the working state of one game session,
// orchestrating engine calls, bot turns, and event logging.

import type { CardId, Suit } from './engine/card';
import { suitOf } from './engine/card';
import { chooseBotPlay } from './engine/bot';
import { makeRng } from './engine/dealing';
import { roundTurnOrder, roundWinner, roundPoints } from './engine/play';
import type { Seat, Team } from './engine/seating';
import { teamOf } from './engine/seating';
import type {
  CompletedRound,
  EngineGameState,
  RoundEntry,
} from './engine/state';
import { checkCapsObligation } from './engine/caps';

export interface RuntimeOptions {
  hands: Record<Seat, CardId[]>;
  trumpSuit: Suit;
  trumpCard: CardId;
  botSeed: number;
}

export interface Runtime {
  hands: Record<Seat, CardId[]>;
  trumpSuit: Suit;
  trumpCard: CardId;
  roundNumber: number;
  priority: Seat;
  currentRound: RoundEntry[];
  completedRounds: CompletedRound[];
  pointsWon: Record<Team, number>;
  capsObligationStamped: { round: number; cardIdx: number } | null;
  hintsUsed: number;
  worldsToggleUses: number;
  rng: () => number;
}

export const newRuntime = (opts: RuntimeOptions): Runtime => ({
  hands: {
    north: [...opts.hands.north],
    west: [...opts.hands.west],
    south: [...opts.hands.south],
    east: [...opts.hands.east],
  },
  trumpSuit: opts.trumpSuit,
  trumpCard: opts.trumpCard,
  roundNumber: 1,
  priority: 'south',
  currentRound: [],
  completedRounds: [],
  pointsWon: { team_a: 0, team_b: 0 },
  capsObligationStamped: null,
  hintsUsed: 0,
  worldsToggleUses: 0,
  rng: makeRng(opts.botSeed),
});

export const toEngineState = (rt: Runtime): EngineGameState => {
  const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
  for (const seat of ['north', 'west', 'south', 'east'] as Seat[]) {
    handsMap.set(seat, rt.hands[seat]);
  }
  return {
    hands: handsMap,
    trump: {
      trumperSeat: 'south',
      trumpSuit: rt.trumpSuit,
      trumpCard: rt.trumpCard,
      trumpCardInHand: true,
      isRevealed: true,
      isOpen: true,
    },
    play: {
      roundNumber: rt.roundNumber,
      priority: rt.priority,
      currentRound: rt.currentRound,
      completedRounds: rt.completedRounds,
      pointsWon: rt.pointsWon,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

// Order in which seats play this round given the current leader.
export const turnOrder = (rt: Runtime): Seat[] =>
  roundTurnOrder(rt.priority, null);

// Seat whose turn is next, or null if round is full / over.
export const whoseTurn = (rt: Runtime): Seat | null => {
  const order = turnOrder(rt);
  if (rt.currentRound.length >= order.length) return null;
  return order[rt.currentRound.length];
};

// Apply one play. Mutates `rt`. Caller should already have validated
// legality through the engine.
export const applyPlay = (rt: Runtime, seat: Seat, card: CardId): void => {
  const hand = rt.hands[seat];
  const idx = hand.indexOf(card);
  if (idx === -1) throw new Error(`Card ${card} not in ${seat}'s hand`);
  hand.splice(idx, 1);
  rt.currentRound.push({
    seat, card, faceDown: false, revealed: false,
  });
  // Stamp South's obligation if this is the first time it became true.
  if (rt.capsObligationStamped === null) {
    if (checkCapsObligation(toEngineState(rt), 'south')) {
      rt.capsObligationStamped = {
        round: rt.roundNumber,
        cardIdx: rt.currentRound.length,
      };
    }
  }
};

// Resolve the current round, mutating runtime to start the next.
// Returns the resolved round.
export const resolveRound = (rt: Runtime): CompletedRound => {
  const plays: Array<readonly [Seat, CardId]> = rt.currentRound
    .filter(e => e.card !== null)
    .map(e => [e.seat, e.card!]);
  const winner = roundWinner(plays, rt.trumpSuit);
  const points = roundPoints(plays);
  const completed: CompletedRound = {
    roundNumber: rt.roundNumber,
    cards: [...rt.currentRound],
    winner,
    pointsWon: points,
    trumpRevealed: false,
  };
  rt.completedRounds.push(completed);
  rt.pointsWon[teamOf(winner)] += points;
  rt.currentRound = [];
  rt.priority = winner;
  rt.roundNumber++;
  // Re-stamp obligation post-resolution as well.
  if (rt.capsObligationStamped === null && rt.roundNumber <= 8) {
    if (checkCapsObligation(toEngineState(rt), 'south')) {
      rt.capsObligationStamped = { round: rt.roundNumber, cardIdx: 0 };
    }
  }
  return completed;
};

// Choose and play a bot's card.
export const playBotTurn = (rt: Runtime, seat: Seat): CardId => {
  if (seat === 'south') {
    throw new Error('Bot cannot play South');
  }
  const card = chooseBotPlay({
    seat,
    hand: rt.hands[seat],
    state: toEngineState(rt),
    rng: rt.rng,
  });
  applyPlay(rt, seat, card);
  return card;
};

export const isGameOver = (rt: Runtime): boolean => rt.roundNumber > 8;

// Whether the led suit is set for the current in-progress round.
export const ledSuit = (rt: Runtime): Suit | null => {
  for (const e of rt.currentRound) {
    if (!e.faceDown && e.card !== null) return suitOf(e.card);
  }
  return null;
};
