import { describe, expect, it } from 'vitest';
import type { CardId } from '../../../frontend/src/304dle/engine/card';
import type { Seat } from '../../../frontend/src/304dle/engine/seating';
import { findDoubleDummyWitness } from '../layer2-dds';

const mkHands = (
  north: string[], west: string[], south: string[], east: string[],
): Record<Seat, CardId[]> => ({
  north: north as CardId[],
  west: west as CardId[],
  south: south as CardId[],
  east: east as CardId[],
});

describe('Layer 2 — double-dummy witness search', () => {
  // Each player holds 2 cards per suit (max follow-suit pruning), south
  // has the top-2 of every suit, so any natural lead wins. The tree is
  // small enough to verify without exponential blowup.
  it('finds a witness for an obviously cap-able hand', () => {
    const hands = mkHands(
      ['Ac', '10c', 'Ad', '10d', 'Ah', '10h', 'As', '10s'],
      ['Kc', 'Qc', 'Kd', 'Qd', 'Kh', 'Qh', 'Ks', 'Qs'],
      ['Jc', '9c', 'Jd', '9d', 'Jh', '9h', 'Js', '9s'],
      ['8c', '7c', '8d', '7d', '8h', '7h', '8s', '7s'],
    );
    const r = findDoubleDummyWitness(hands, 'c', { tightnessCap: 1 });
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.witnessOrder.length).toBe(8);
      expect(new Set(r.witnessOrder)).toEqual(new Set(hands.south));
    }
  });

  it('rejects an impossible hand (south has only 7s and 8s)', () => {
    const hands = mkHands(
      ['Jc', '9c', 'Ac', '10c', 'Kc', 'Qc', 'Kd', 'Qd'],
      ['Jd', '9d', 'Ad', '10d', 'Jh', '9h', 'Ah', '10h'],
      ['7c', '8c', '7d', '8d', '7h', '8h', '7s', '8s'],
      ['Js', '9s', 'As', '10s', 'Ks', 'Qs', 'Kh', 'Qh'],
    );
    const r = findDoubleDummyWitness(hands, 'c', { maxPermutations: 100 });
    expect(r.pass).toBe(false);
  });

  it('returns a multi-suit witness order', () => {
    const hands = mkHands(
      ['Ac', '10c', 'Ad', '10d', 'Ah', '10h', 'As', '10s'],
      ['Kc', 'Qc', 'Kd', 'Qd', 'Kh', 'Qh', 'Ks', 'Qs'],
      ['Jc', '9c', 'Jd', '9d', 'Jh', '9h', 'Js', '9s'],
      ['8c', '7c', '8d', '7d', '8h', '7h', '8s', '7s'],
    );
    const r = findDoubleDummyWitness(hands, 'c', { tightnessCap: 1 });
    expect(r.pass).toBe(true);
    if (r.pass) {
      // Witness should span multiple suits (south's hand has 4 suits).
      const suits = new Set(r.witnessOrder.map(c => c[c.length - 1]));
      expect(suits.size).toBeGreaterThanOrEqual(2);
    }
  });
});
