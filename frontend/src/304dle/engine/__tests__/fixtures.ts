// Hand-curated test fixtures for caps engine end-to-end tests.

import type { CardId } from '../card';
import type { EngineGameState } from '../state';

const c = (s: string): CardId => s as CardId;

export interface Fixture {
  id: string;
  description: string;
  state: EngineGameState;
  viewer: 'south';
  expected: {
    obligated: boolean;
    correctOrders?: CardId[][];
    incorrectOrders?: CardId[][];
  };
}

const buildState = (args: {
  trumpSuit: 'c' | 'd' | 'h' | 's';
  trumpCard: CardId;
  hands: Record<'north' | 'west' | 'south' | 'east', CardId[]>;
  completedRounds: Array<{
    roundNumber: number;
    winner: 'north' | 'west' | 'south' | 'east';
    cards: Array<{ seat: 'north' | 'west' | 'south' | 'east'; card: CardId }>;
    pointsWon: number;
  }>;
  priority: 'north' | 'west' | 'south' | 'east';
  pointsWon: { team_a: number; team_b: number };
}): EngineGameState => {
  const hands = new Map<'north' | 'west' | 'south' | 'east', CardId[]>();
  for (const seat of ['north', 'west', 'south', 'east'] as const) {
    hands.set(seat, args.hands[seat]);
  }
  return {
    hands,
    trump: {
      trumperSeat: 'south',
      trumpSuit: args.trumpSuit,
      trumpCard: args.trumpCard,
      trumpCardInHand: true,
      isRevealed: true,
      isOpen: true,
    },
    play: {
      roundNumber: args.completedRounds.length + 1,
      priority: args.priority,
      currentRound: [],
      completedRounds: args.completedRounds.map(r => ({
        roundNumber: r.roundNumber,
        cards: r.cards.map(e => ({
          seat: e.seat,
          card: e.card,
          faceDown: false,
          revealed: false,
        })),
        winner: r.winner,
        pointsWon: r.pointsWon,
        trumpRevealed: false,
      })),
      pointsWon: args.pointsWon,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

// FIXTURE 1: South + North have won all 6 rounds. South holds [Jh, 9h]
// (top two trumps). All 8 hearts remain (2 per seat). North leads R7
// holding [Ah, 10h] — must lead a heart. South follows with Jh, wins.
// South leads R8 with 9h — beats every remaining heart.
// Caps obligated; both [Jh,9h] and [9h,Jh] sweep (since 9h power=1
// beats every other heart but Jh).
export const fixtureSimpleSweep: Fixture = {
  id: 'simple-sweep-trump-dominance',
  description:
    'After 6 rounds team_a wins, S holds top two trumps Jh/9h, all opponent hearts ' +
    'are split among NWE. Caps obligated; either order sweeps.',
  state: buildState({
    trumpSuit: 'h',
    trumpCard: c('Jh'),
    hands: {
      south: [c('Jh'), c('9h')],
      north: [c('Ah'), c('10h')],
      west: [c('Kh'), c('Qh')],
      east: [c('8h'), c('7h')],
    },
    completedRounds: [
      {
        roundNumber: 1,
        cards: [
          { seat: 'north', card: c('Jc') },
          { seat: 'west', card: c('Qc') },
          { seat: 'south', card: c('Kc') },
          { seat: 'east', card: c('8c') },
        ],
        winner: 'north',
        pointsWon: 35,
      },
      {
        roundNumber: 2,
        cards: [
          { seat: 'north', card: c('Js') },
          { seat: 'west', card: c('Qs') },
          { seat: 'south', card: c('Ks') },
          { seat: 'east', card: c('8s') },
        ],
        winner: 'north',
        pointsWon: 35,
      },
      {
        roundNumber: 3,
        cards: [
          { seat: 'north', card: c('Jd') },
          { seat: 'west', card: c('Qd') },
          { seat: 'south', card: c('Kd') },
          { seat: 'east', card: c('8d') },
        ],
        winner: 'north',
        pointsWon: 35,
      },
      {
        roundNumber: 4,
        cards: [
          { seat: 'north', card: c('9c') },
          { seat: 'west', card: c('10c') },
          { seat: 'south', card: c('Ac') },
          { seat: 'east', card: c('7c') },
        ],
        winner: 'north',
        pointsWon: 41,
      },
      {
        roundNumber: 5,
        cards: [
          { seat: 'north', card: c('9s') },
          { seat: 'west', card: c('10s') },
          { seat: 'south', card: c('As') },
          { seat: 'east', card: c('7s') },
        ],
        winner: 'north',
        pointsWon: 41,
      },
      {
        roundNumber: 6,
        cards: [
          { seat: 'north', card: c('9d') },
          { seat: 'west', card: c('10d') },
          { seat: 'south', card: c('Ad') },
          { seat: 'east', card: c('7d') },
        ],
        winner: 'north',
        pointsWon: 41,
      },
    ],
    priority: 'north',
    pointsWon: { team_a: 228, team_b: 0 },
  }),
  viewer: 'south',
  expected: {
    obligated: true,
    correctOrders: [[c('Jh'), c('9h')], [c('9h'), c('Jh')]],
  },
};

// FIXTURE 2: Caps NOT obligated. After 6 rounds team_a wins, South
// holds [Jh, 7h]. Lowest trump 7h cannot sweep R8 vs opponents'
// remaining hearts.
export const fixtureNotObligated: Fixture = {
  id: 'not-obligated-weak-trump',
  description:
    'Team_a won 6, S holds [Jh, 7h]. After Jh wins R7, 7h leads R8 ' +
    'and loses to any remaining higher heart. Caps not obligated.',
  state: buildState({
    trumpSuit: 'h',
    trumpCard: c('Jh'),
    hands: {
      south: [c('Jh'), c('7h')],
      north: [c('Kh'), c('8h')],
      west: [c('9h'), c('Ah')],
      east: [c('10h'), c('Qh')],
    },
    completedRounds: [
      {
        roundNumber: 1,
        cards: [
          { seat: 'south', card: c('Jc') },
          { seat: 'west', card: c('Qc') },
          { seat: 'north', card: c('Kc') },
          { seat: 'east', card: c('10c') },
        ],
        winner: 'south',
        pointsWon: 45,
      },
      {
        roundNumber: 2,
        cards: [
          { seat: 'south', card: c('Js') },
          { seat: 'west', card: c('Qs') },
          { seat: 'north', card: c('Ks') },
          { seat: 'east', card: c('10s') },
        ],
        winner: 'south',
        pointsWon: 45,
      },
      {
        roundNumber: 3,
        cards: [
          { seat: 'south', card: c('Jd') },
          { seat: 'west', card: c('Qd') },
          { seat: 'north', card: c('Kd') },
          { seat: 'east', card: c('10d') },
        ],
        winner: 'south',
        pointsWon: 45,
      },
      {
        roundNumber: 4,
        cards: [
          { seat: 'south', card: c('9c') },
          { seat: 'west', card: c('Ac') },
          { seat: 'north', card: c('8c') },
          { seat: 'east', card: c('7c') },
        ],
        winner: 'south',
        pointsWon: 31,
      },
      {
        roundNumber: 5,
        cards: [
          { seat: 'south', card: c('9s') },
          { seat: 'west', card: c('As') },
          { seat: 'north', card: c('8s') },
          { seat: 'east', card: c('7s') },
        ],
        winner: 'south',
        pointsWon: 31,
      },
      {
        roundNumber: 6,
        cards: [
          { seat: 'south', card: c('9d') },
          { seat: 'west', card: c('Ad') },
          { seat: 'north', card: c('8d') },
          { seat: 'east', card: c('7d') },
        ],
        winner: 'south',
        pointsWon: 31,
      },
    ],
    priority: 'south',
    pointsWon: { team_a: 228, team_b: 0 },
  }),
  viewer: 'south',
  expected: { obligated: false },
};

// FIXTURE 3: Last-round caps. South leads R8 holding [Jh] (top trump).
// All other cards played. Trivially caps. Order = just [Jh].
export const fixtureLastRound: Fixture = {
  id: 'last-round-trivial',
  description:
    'After 7 rounds team_a wins, S holds Jh (top trump). One round remaining ' +
    'with one card per seat. Trivial caps.',
  state: buildState({
    trumpSuit: 'h',
    trumpCard: c('Jh'),
    hands: {
      south: [c('Jh')],
      north: [c('Ah')],
      west: [c('9h')],
      east: [c('10h')],
    },
    completedRounds: [
      // 7 rounds, team_a (south or north) wins each. Each round 4 cards.
      // We'll burn the 28 non-Jh, non-Ah, non-9h, non-10h cards.
      {
        roundNumber: 1,
        cards: [
          { seat: 'south', card: c('Jc') },
          { seat: 'west', card: c('Qc') },
          { seat: 'north', card: c('Kc') },
          { seat: 'east', card: c('8c') },
        ],
        winner: 'south',
        pointsWon: 35,
      },
      {
        roundNumber: 2,
        cards: [
          { seat: 'south', card: c('Js') },
          { seat: 'west', card: c('Qs') },
          { seat: 'north', card: c('Ks') },
          { seat: 'east', card: c('8s') },
        ],
        winner: 'south',
        pointsWon: 35,
      },
      {
        roundNumber: 3,
        cards: [
          { seat: 'south', card: c('Jd') },
          { seat: 'west', card: c('Qd') },
          { seat: 'north', card: c('Kd') },
          { seat: 'east', card: c('8d') },
        ],
        winner: 'south',
        pointsWon: 35,
      },
      {
        roundNumber: 4,
        cards: [
          { seat: 'south', card: c('9c') },
          { seat: 'west', card: c('Ac') },
          { seat: 'north', card: c('10c') },
          { seat: 'east', card: c('7c') },
        ],
        winner: 'south',
        pointsWon: 41,
      },
      {
        roundNumber: 5,
        cards: [
          { seat: 'south', card: c('9s') },
          { seat: 'west', card: c('As') },
          { seat: 'north', card: c('10s') },
          { seat: 'east', card: c('7s') },
        ],
        winner: 'south',
        pointsWon: 41,
      },
      {
        roundNumber: 6,
        cards: [
          { seat: 'south', card: c('9d') },
          { seat: 'west', card: c('Ad') },
          { seat: 'north', card: c('10d') },
          { seat: 'east', card: c('7d') },
        ],
        winner: 'south',
        pointsWon: 41,
      },
      {
        roundNumber: 7,
        cards: [
          { seat: 'south', card: c('Kh') },
          { seat: 'west', card: c('Qh') },
          { seat: 'north', card: c('8h') },
          { seat: 'east', card: c('7h') },
        ],
        winner: 'south',
        pointsWon: 5,
      },
    ],
    priority: 'south',
    pointsWon: { team_a: 233, team_b: 0 },
  }),
  viewer: 'south',
  expected: {
    obligated: true,
    correctOrders: [[c('Jh')]],
  },
};

// FIXTURE 4: Precondition fail — team didn't win every round.
export const fixtureLostARound: Fixture = {
  id: 'lost-a-round',
  description:
    'Team_a lost round 3. Caps precondition fails regardless of remaining hand.',
  state: buildState({
    trumpSuit: 'h',
    trumpCard: c('Jh'),
    hands: {
      south: [c('Jh'), c('9h')],
      north: [c('Ah'), c('10h')],
      west: [c('Kh'), c('Qh')],
      east: [c('8h'), c('7h')],
    },
    completedRounds: [
      {
        roundNumber: 1,
        cards: [
          { seat: 'south', card: c('Jc') },
          { seat: 'west', card: c('Qc') },
          { seat: 'north', card: c('Kc') },
          { seat: 'east', card: c('8c') },
        ],
        winner: 'south',
        pointsWon: 35,
      },
      {
        roundNumber: 2,
        cards: [
          { seat: 'south', card: c('Js') },
          { seat: 'west', card: c('Qs') },
          { seat: 'north', card: c('Ks') },
          { seat: 'east', card: c('8s') },
        ],
        winner: 'south',
        pointsWon: 35,
      },
      // Round 3: east wins (team_b)
      {
        roundNumber: 3,
        cards: [
          { seat: 'south', card: c('Jd') },
          { seat: 'west', card: c('Qd') },
          { seat: 'north', card: c('Kd') },
          { seat: 'east', card: c('10d') },
        ],
        winner: 'east',
        pointsWon: 45,
      },
      // For brevity — only need 3 lost-rounds present to break precondition.
      // Pad to 6 rounds with team_a wins.
      {
        roundNumber: 4,
        cards: [
          { seat: 'south', card: c('9c') },
          { seat: 'west', card: c('Ac') },
          { seat: 'north', card: c('8c') },
          { seat: 'east', card: c('7c') },
        ],
        winner: 'south',
        pointsWon: 31,
      },
      {
        roundNumber: 5,
        cards: [
          { seat: 'south', card: c('9s') },
          { seat: 'west', card: c('As') },
          { seat: 'north', card: c('8s') },
          { seat: 'east', card: c('7s') },
        ],
        winner: 'south',
        pointsWon: 31,
      },
      {
        roundNumber: 6,
        cards: [
          { seat: 'south', card: c('9d') },
          { seat: 'west', card: c('Ad') },
          { seat: 'north', card: c('8d') },
          { seat: 'east', card: c('7d') },
        ],
        winner: 'south',
        pointsWon: 31,
      },
    ],
    priority: 'south',
    pointsWon: { team_a: 163, team_b: 45 },
  }),
  viewer: 'south',
  expected: { obligated: false },
};

export const ALL_FIXTURES: Fixture[] = [
  fixtureSimpleSweep,
  fixtureNotObligated,
  fixtureLastRound,
  fixtureLostARound,
];
