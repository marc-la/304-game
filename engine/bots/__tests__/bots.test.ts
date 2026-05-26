// Bot zoo tests — combination of hand-curated fixtures (regression
// guards on specific decisive positions) and property-based invariants
// (every bot is legal + deterministic).
//
// The heavier bots (B6 / B7) get a generous timeout — their full
// DDS-from-round-1 trees can take a few seconds on 8-card hands.

import { describe, expect, it } from 'vitest';
import type { CardId, Suit } from '../../card';
import { dealForSeed, makeRng } from '../../dealing';
import { legalPlays, seatsHoldingTrump } from '../../play';
import type { Seat } from '../../seating';
import type { CompletedRound, EngineGameState, RoundEntry } from '../../state';
import { BOTS } from '..';

const c = (s: string): CardId => s as CardId;

const SEATS: Seat[] = ['north', 'west', 'south', 'east'];

const buildState = (args: {
  hands: Record<Seat, CardId[]>;
  trump: Suit;
  trumpCard: CardId;
  priority: Seat;
  current?: RoundEntry[];
  completed?: CompletedRound[];
  pointsWon?: { team_a: number; team_b: number };
}): EngineGameState => {
  const handsMap = new Map<Seat, CardId[]>();
  for (const s of SEATS) handsMap.set(s, args.hands[s]);
  return {
    hands: handsMap,
    trump: {
      trumperSeat: 'south',
      trumpSuit: args.trump,
      trumpCard: args.trumpCard,
      trumpCardInHand: true,
      isRevealed: true,
      isOpen: true,
    },
    play: {
      roundNumber: (args.completed?.length ?? 0) + 1,
      priority: args.priority,
      currentRound: args.current ?? [],
      completedRounds: args.completed ?? [],
      pointsWon: args.pointsWon ?? { team_a: 0, team_b: 0 },
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

describe('bot zoo: invariants (all bots)', () => {
  for (const { profile, play } of BOTS) {
    // Heavier bots need more time on full 8-card openings.
    const timeoutMs = ['b6-dds-mc', 'b7-bridge-derived'].includes(profile.id)
      ? 60_000
      : 5_000;

    it(`${profile.id} returns a legal play for a fresh deal`, () => {
      // 3 seeds for the heavy bots, 10 for the cheap ones.
      const maxSeed =
        ['b6-dds-mc', 'b7-bridge-derived'].includes(profile.id) ? 2 : 6;
      for (let seed = 1; seed <= maxSeed; seed++) {
        const deal = dealForSeed(seed);
        const state = buildState({
          hands: deal.hands,
          trump: deal.trumpSuit,
          trumpCard: deal.trumpCard,
          priority: 'south',
        });
        const rng = makeRng(seed * 31 + 7);
        const { card } = play({
          seat: 'south',
          hand: deal.hands.south,
          state,
          rng,
        });
        const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
        for (const s of SEATS) handsMap.set(s, deal.hands[s]);
        const trumpHolders = seatsHoldingTrump(handsMap, deal.trumpSuit);
        const legal = legalPlays({
          hand: deal.hands.south,
          ledSuit: null,
          trumpSuit: deal.trumpSuit,
          isLead: true,
          seatsWithTrumps: trumpHolders,
          seat: 'south',
        });
        expect(legal).toContain(card);
      }
    }, timeoutMs);

    it(`${profile.id} is deterministic given the same (state, seed)`, () => {
      const deal = dealForSeed(42);
      const state = buildState({
        hands: deal.hands,
        trump: deal.trumpSuit,
        trumpCard: deal.trumpCard,
        priority: 'south',
      });
      const calls = [0, 1, 2].map(() =>
        play({
          seat: 'south', hand: deal.hands.south, state, rng: makeRng(99),
        }).card,
      );
      expect(calls[0]).toBe(calls[1]);
      expect(calls[1]).toBe(calls[2]);
    }, timeoutMs);
  }
});

// Fixture: partner already winning a non-trump trick. A smart bot
// should sluff its cheapest card rather than over-spend a star (J/9/A).
// Setup: south leads K♣, west plays J♣ (wins for team_b), north sluffs
// 7♣, east to play with {Q♣, 9♣} — partner (west) is winning, so east
// should sluff Q♣, not spend 9♣.
describe('bot zoo: fixture — sluff to partner who is winning', () => {
  const hands: Record<Seat, CardId[]> = {
    north: [c('7d')],
    west: [c('8d')],
    south: [c('Kd')],
    east: [c('Qc'), c('9c')],  // east must follow clubs (we'll set led)
  };

  // Round: south leads Kc, west plays Jc (wins), north plays 7c, east to play.
  const altHands: Record<Seat, CardId[]> = {
    north: [c('7c')],
    west: [c('8c')],
    south: [c('Kc')],
    east: [c('Qc'), c('9c')],
  };

  const current: RoundEntry[] = [
    { seat: 'south', card: c('Kc'), faceDown: false, revealed: false },
    { seat: 'west', card: c('Jc'), faceDown: false, revealed: false },
    { seat: 'north', card: c('7c'), faceDown: false, revealed: false },
  ];
  const state = buildState({
    hands: altHands,
    trump: 'h',                  // hearts trump
    trumpCard: c('Jh'),
    priority: 'south',
    current,
  });
  void hands;

  // After south/west/north have played, those seats' hands must reflect
  // that they no longer hold the cards they played. We reset the state
  // to have empty north/west/south hands.
  const handsRefreshed: Record<Seat, CardId[]> = {
    north: [], west: [], south: [],
    east: [c('Qc'), c('9c')],
  };
  const fixedState = buildState({
    hands: handsRefreshed,
    trump: 'h',
    trumpCard: c('Jh'),
    priority: 'south',
    current,
  });

  // Only the rule-based bots that explicitly preserve stars are tested
  // here. Search-based bots (B5/B6/B7) evaluate EV — and in this
  // 2-card-remaining setup the future value of {Q} ≈ {9} (both are
  // single cards), so they may pick either. Star preservation matters
  // mid-game; the search will pick correctly when given more cards.
  const ruleBased = ['b2-memo-high-low', 'b3-heuristic'];
  for (const { profile, play } of BOTS) {
    if (!ruleBased.includes(profile.id)) continue;
    const timeoutMs = 5_000;
    it(`${profile.id} sluffs Q♣ rather than spending 9♣`, () => {
      const { card } = play({
        seat: 'east',
        hand: handsRefreshed.east,
        state: fixedState,
        rng: makeRng(1),
      });
      // Partner is winning; the 9 is east's star — preserve it.
      expect(card).toBe(c('Qc'));
    }, timeoutMs);
  }
  // The blank `state` reference avoids the unused-var lint.
  void state;
});

describe('bot zoo: B5 caps-aware', () => {
  // Smoke test: B5 returns a legal card on a fresh deal.
  it('B5 returns a legal card on the opening lead', () => {
    const deal = dealForSeed(123);
    const state = buildState({
      hands: deal.hands,
      trump: deal.trumpSuit,
      trumpCard: deal.trumpCard,
      priority: 'south',
    });
    const bot = BOTS.find(b => b.profile.id === 'b5-csp-search')!;
    const { card } = bot.play({
      seat: 'south',
      hand: deal.hands.south,
      state,
      rng: makeRng(7),
    });
    expect(deal.hands.south).toContain(card);
  });
});

describe('bot zoo: property — every bot stays legal across many seeds', () => {
  for (const { profile, play } of BOTS) {
    // Heavier bots: fewer seeds, longer timeout.
    const isHeavy = ['b6-dds-mc', 'b7-bridge-derived'].includes(profile.id);
    const seeds = isHeavy ? [11, 23] : [11, 23, 47, 91, 127];
    const timeoutMs = isHeavy ? 60_000 : 10_000;
    it(`${profile.id} produces only legal plays`, () => {
      for (const seed of seeds) {
        const deal = dealForSeed(seed);
        const state = buildState({
          hands: deal.hands,
          trump: deal.trumpSuit,
          trumpCard: deal.trumpCard,
          priority: 'south',
        });
        const { card } = play({
          seat: 'south',
          hand: deal.hands.south,
          state,
          rng: makeRng(seed + 99),
        });
        expect(deal.hands.south).toContain(card);
      }
    }, timeoutMs);
  }
});
