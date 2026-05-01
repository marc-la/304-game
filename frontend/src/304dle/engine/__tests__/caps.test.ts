import { describe, expect, it } from 'vitest';
import { checkCapsObligation, validateCapsCall } from '../caps';
import { buildInfoSet, enumerateWorlds, worldIsConsistent } from '../info';
import { ALL_FIXTURES } from './fixtures';

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
