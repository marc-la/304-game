// Integration test: drive a full game via the runtime, with the bot
// playing all four seats. Assert engine invariants hold throughout.

import { describe, expect, it } from 'vitest';
import { dealForSeed, makeRng, seedFromDate } from '../dealing';
import { chooseBotPlay } from '../bot';
import { roundTurnOrder, roundWinner, roundPoints } from '../play';
import { teamOf } from '../seating';
import type { Seat, Team } from '../seating';
import type { CompletedRound, EngineGameState } from '../state';
import type { CardId } from '../card';
import { checkCapsObligation } from '../caps';

const buildState = (
  hands: Record<Seat, CardId[]>,
  trumpSuit: 'c' | 'd' | 'h' | 's',
  trumpCard: CardId,
  priority: Seat,
  completed: CompletedRound[],
  pointsWon: Record<Team, number>,
): EngineGameState => {
  const hMap = new Map<Seat, CardId[]>();
  for (const s of ['north', 'west', 'south', 'east'] as Seat[]) hMap.set(s, hands[s]);
  return {
    hands: hMap,
    trump: {
      trumperSeat: 'south', trumpSuit, trumpCard,
      trumpCardInHand: true, isRevealed: true, isOpen: true,
    },
    play: {
      roundNumber: completed.length + 1,
      priority,
      currentRound: [],
      completedRounds: completed,
      pointsWon,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

describe('end-to-end game simulation', () => {
  it('plays 8 valid rounds without error for several seeds', () => {
    const dates = ['2026-01-15', '2026-05-01', '2026-08-22', '2026-12-31'];
    for (const date of dates) {
      const deal = dealForSeed(seedFromDate(date));
      const hands: Record<Seat, CardId[]> = {
        north: [...deal.hands.north],
        west: [...deal.hands.west],
        south: [...deal.hands.south],
        east: [...deal.hands.east],
      };
      const completed: CompletedRound[] = [];
      let priority: Seat = 'south';
      const pts: Record<Team, number> = { team_a: 0, team_b: 0 };
      const rng = makeRng(deal.botSeed);

      for (let round = 1; round <= 8; round++) {
        const order = roundTurnOrder(priority, null);
        const plays: Array<readonly [Seat, CardId]> = [];
        for (const seat of order) {
          const state = buildState(hands, deal.trumpSuit, deal.trumpCard, priority, completed, pts);
          state.play.currentRound = plays.map(([s, c]) => ({
            seat: s, card: c, faceDown: false, revealed: false,
          }));
          const card = chooseBotPlay({
            seat, hand: hands[seat], state, rng,
          });
          // bot must produce a card from the seat's hand
          expect(hands[seat].includes(card)).toBe(true);
          const idx = hands[seat].indexOf(card);
          hands[seat].splice(idx, 1);
          plays.push([seat, card]);
        }
        const winner = roundWinner(plays, deal.trumpSuit);
        const points = roundPoints(plays);
        pts[teamOf(winner)] += points;
        completed.push({
          roundNumber: round,
          cards: plays.map(([s, c]) => ({
            seat: s, card: c, faceDown: false, revealed: false,
          })),
          winner,
          pointsWon: points,
          trumpRevealed: false,
        });
        priority = winner;
      }
      // 8 rounds completed, all hands empty
      expect(hands.north.length).toBe(0);
      expect(hands.west.length).toBe(0);
      expect(hands.south.length).toBe(0);
      expect(hands.east.length).toBe(0);
      // points should sum to 304
      expect(pts.team_a + pts.team_b).toBe(304);
    }
  });

  it('checkCapsObligation never throws across many states', () => {
    const dates = ['2026-02-14', '2026-07-04'];
    for (const date of dates) {
      const deal = dealForSeed(seedFromDate(date));
      const hands: Record<Seat, CardId[]> = {
        north: [...deal.hands.north],
        west: [...deal.hands.west],
        south: [...deal.hands.south],
        east: [...deal.hands.east],
      };
      const completed: CompletedRound[] = [];
      let priority: Seat = 'south';
      const pts: Record<Team, number> = { team_a: 0, team_b: 0 };
      const rng = makeRng(deal.botSeed);

      for (let round = 1; round <= 8; round++) {
        const order = roundTurnOrder(priority, null);
        const plays: Array<readonly [Seat, CardId]> = [];
        for (const seat of order) {
          const state = buildState(hands, deal.trumpSuit, deal.trumpCard, priority, completed, pts);
          state.play.currentRound = plays.map(([s, c]) => ({
            seat: s, card: c, faceDown: false, revealed: false,
          }));
          const card = chooseBotPlay({ seat, hand: hands[seat], state, rng });
          const idx = hands[seat].indexOf(card);
          hands[seat].splice(idx, 1);
          plays.push([seat, card]);
        }
        const winner = roundWinner(plays, deal.trumpSuit);
        pts[teamOf(winner)] += roundPoints(plays);
        completed.push({
          roundNumber: round,
          cards: plays.map(([s, c]) => ({
            seat: s, card: c, faceDown: false, revealed: false,
          })),
          winner,
          pointsWon: roundPoints(plays),
          trumpRevealed: false,
        });
        priority = winner;
        // Run the obligation check after each round; should not throw.
        const post = buildState(hands, deal.trumpSuit, deal.trumpCard, priority, completed, pts);
        expect(() => checkCapsObligation(post, 'south')).not.toThrow();
      }
    }
  });
});
