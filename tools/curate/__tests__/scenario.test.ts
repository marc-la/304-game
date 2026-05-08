import { describe, expect, it } from 'vitest';
import { suitOf } from '../../../frontend/src/304dle/engine/card';
import type { Seat } from '../../../frontend/src/304dle/engine/seating';
import { ANTICLOCKWISE } from '../../../frontend/src/304dle/engine/seating';
import { dealScenario, scenarioForSalt, SCENARIOS } from '../scenario-dealing';
import { simulateScenarioOnce } from '../scenario-simulator';

describe('dealScenario', () => {
  it('rotates across all 8 scenario cells deterministically', () => {
    const seen = new Set<string>();
    for (let i = 0; i < SCENARIOS.length; i++) {
      const sc = scenarioForSalt(i);
      seen.add(`${sc.trumperSeat}-${sc.isOpen}`);
    }
    expect(seen.size).toBe(SCENARIOS.length);
  });

  it('open: trumper has 8 cards in hand including trump card', () => {
    const sc = { trumperSeat: 'north' as Seat, isOpen: true };
    const deal = dealScenario(123, sc);
    expect(deal.hands.north.length).toBe(8);
    expect(deal.hands.north).toContain(deal.trumpCard);
    expect(deal.trumpCardInHand).toBe(true);
  });

  it('closed: trumper has 7 cards in hand, trump card on table', () => {
    const sc = { trumperSeat: 'east' as Seat, isOpen: false };
    const deal = dealScenario(456, sc);
    expect(deal.hands.east.length).toBe(7);
    expect(deal.hands.east).not.toContain(deal.trumpCard);
    expect(deal.trumpCardInHand).toBe(false);
  });

  it('the chosen trump suit is the trumper\'s longest suit', () => {
    for (const seat of ANTICLOCKWISE) {
      const deal = dealScenario(789, { trumperSeat: seat, isOpen: true });
      const counts: Record<string, number> = { c: 0, d: 0, h: 0, s: 0 };
      for (const c of deal.hands[seat]) counts[suitOf(c)]++;
      const max = Math.max(...Object.values(counts));
      expect(counts[deal.trumpSuit]).toBe(max);
    }
  });

  it('all 32 cards distributed across hands (or table for closed)', () => {
    for (const isOpen of [true, false]) {
      const deal = dealScenario(42, { trumperSeat: 'south', isOpen });
      const all: string[] = [];
      for (const seat of ANTICLOCKWISE) all.push(...deal.hands[seat]);
      if (!isOpen) all.push(deal.trumpCard);
      expect(new Set(all).size).toBe(32);
    }
  });
});

describe('simulateScenarioOnce', () => {
  it('runs to completion across all 8 scenario cells', () => {
    for (const sc of SCENARIOS) {
      const deal = dealScenario(999, sc);
      const out = simulateScenarioOnce(
        deal.hands, sc, deal.trumpSuit, deal.trumpCard, deal.botSeed,
      );
      // Either south's team lost a round, or we got 8 rounds in.
      expect(out.southPositionR1).toBeGreaterThanOrEqual(1);
      expect(out.southPositionR1).toBeLessThanOrEqual(4);
    }
  });

  it('south position in R1 follows trumper seat', () => {
    // anticlockwise order from trumper: trumper, then turn-rotated.
    // South's position is determined by trumper's seat.
    const expectedPos: Record<Seat, number> = {
      south: 1,  // south leads (south as trumper)
      east: 4,   // east → north → west → south (south is 4th)
      north: 3,  // north → west → south → east (south is 3rd)
      west: 2,   // west → south → east → north (south is 2nd)
    };
    for (const seat of ANTICLOCKWISE) {
      const sc = { trumperSeat: seat, isOpen: true };
      const deal = dealScenario(7, sc);
      const out = simulateScenarioOnce(
        deal.hands, sc, deal.trumpSuit, deal.trumpCard, deal.botSeed,
      );
      expect(out.southPositionR1).toBe(expectedPos[seat]);
    }
  });
});
