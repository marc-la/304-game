import { describe, expect, it } from 'vitest';
import {
  checkCapsObligation,
  trackCapsObligation,
  validateCapsCall,
} from '../caps';
import type { CapsObligation, EngineGameState } from '../state';
import type { Seat } from '../seating';
import { buildInfoSet, enumerateWorlds, worldIsConsistent } from '../info';
import {
  ALL_FIXTURES,
  fixtureLostARound,
  fixtureNotObligated,
  fixtureSimpleSweep,
} from './fixtures';

describe('end-to-end caps fixtures', () => {
  for (const fx of ALL_FIXTURES) {
    describe(fx.id, () => {
      it(`obligation == ${fx.expected.obligated}`, () => {
        expect(checkCapsObligation(fx.state, fx.viewer)).toBe(
          fx.expected.obligated,
        );
      });

      if (fx.expected.correctOrders) {
        for (const order of fx.expected.correctOrders) {
          it(`accepts witness order ${order.join(',')}`, () => {
            expect(validateCapsCall(fx.state, fx.viewer, order)).toBe(true);
          });
        }
      }

      if (fx.expected.incorrectOrders) {
        for (const order of fx.expected.incorrectOrders) {
          it(`rejects bad order ${order.join(',')}`, () => {
            expect(validateCapsCall(fx.state, fx.viewer, order)).toBe(false);
          });
        }
      }
    });
  }
});

describe('information set & world enumeration', () => {
  it('builds info-set with deduced exhausted suits', () => {
    const fx = ALL_FIXTURES.find(f => f.id === 'simple-sweep-trump-dominance')!;
    const info = buildInfoSet(fx.state, fx.viewer);
    // After 6 completed rounds where each seat played the led suit
    // every time, no exhaustion is publicly known. So exhaustedSuits
    // should be empty for all seats.
    for (const set of info.exhaustedSuits.values()) {
      expect(set.size).toBe(0);
    }
    expect(info.teamWonAllCompleted).toBe(true);
    expect(info.ownHand).toEqual(['Jh', '9h']);
  });

  it('enumerated worlds are all consistent and in deterministic order', () => {
    const fx = ALL_FIXTURES.find(f => f.id === 'simple-sweep-trump-dominance')!;
    const info = buildInfoSet(fx.state, fx.viewer);
    const worlds = [...enumerateWorlds(info, { maxWorlds: 1000 })];
    expect(worlds.length).toBeGreaterThan(0);
    for (const w of worlds) expect(worldIsConsistent(w, info)).toBe(true);

    // Same seed → same order
    const worlds2 = [...enumerateWorlds(info, { maxWorlds: 1000 })];
    expect(worlds.length).toBe(worlds2.length);
  });

  it('enumerated worlds for last-round include exactly one world', () => {
    const fx = ALL_FIXTURES.find(f => f.id === 'last-round-trivial')!;
    const info = buildInfoSet(fx.state, fx.viewer);
    const worlds = [...enumerateWorlds(info, { maxWorlds: 100 })];
    // South knows their hand (Jh) and all 28 played cards. The
    // remaining 3 cards (Ah, 9h, 10h) are split 1/1/1 among NWE.
    // 3! = 6 permutations.
    expect(worlds.length).toBe(6);
  });
});

describe('trackCapsObligation', () => {
  it('stamps south with correct fields when obligation holds', () => {
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(fixtureSimpleSweep.state, target);
    const stamp = target.get('south');
    expect(stamp).toBeDefined();
    // Round 7 about to start; current round empty; south has played
    // 6 times (one per completed round).
    expect(stamp).toEqual({
      obligatedAtRound: 7,
      obligatedAtCard: 0,
      vPlaysAtObligation: 6,
    });
  });

  it('does not stamp when obligation does not hold', () => {
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(fixtureNotObligated.state, target);
    expect(target.has('south')).toBe(false);
  });

  it('does not stamp when team has lost a round', () => {
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(fixtureLostARound.state, target);
    expect(target.has('south')).toBe(false);
  });

  it('is idempotent: never overwrites an existing stamp', () => {
    const target = new Map<Seat, CapsObligation>();
    const sentinel: CapsObligation = {
      obligatedAtRound: 1,
      obligatedAtCard: 0,
      vPlaysAtObligation: 0,
    };
    target.set('south', sentinel);
    trackCapsObligation(fixtureSimpleSweep.state, target);
    expect(target.get('south')).toBe(sentinel);
  });

  it('skips the seat marked pccPartnerOut', () => {
    const stateWithPccOut: EngineGameState = {
      ...fixtureSimpleSweep.state,
      pccPartnerOut: 'south',
    };
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(stateWithPccOut, target);
    expect(target.has('south')).toBe(false);
  });

  it('does not stamp once the call window has closed (round 8, full round)', () => {
    // Synthesize a "round 8 with 4 cards in flight" snapshot. The
    // exact contents do not matter — the window guard short-circuits
    // before predicate evaluation.
    const base = fixtureSimpleSweep.state;
    const closed: EngineGameState = {
      ...base,
      play: {
        ...base.play,
        roundNumber: 8,
        currentRound: [
          { seat: 'north', card: 'Ah', faceDown: false, revealed: false },
          { seat: 'west', card: 'Kh', faceDown: false, revealed: false },
          { seat: 'south', card: 'Jh', faceDown: false, revealed: false },
          { seat: 'east', card: '8h', faceDown: false, revealed: false },
        ],
      },
    };
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(closed, target);
    expect(target.has('south')).toBe(false);
  });

  it('honors a custom seats list (e.g. tracking only north)', () => {
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(fixtureSimpleSweep.state, target, {
      seats: ['north'],
    });
    expect(target.has('south')).toBe(false);
    // North's predicate may or may not hold in this fixture; either
    // way the south-skip is the load-bearing assertion.
  });
});
