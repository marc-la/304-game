import { describe, expect, it } from 'vitest';
import type { CardId } from '../../../frontend/src/304dle/engine/card';
import { evaluateHand } from '../layer1-heuristic';
import { DEFAULT_THRESHOLDS } from '../types';

const T = DEFAULT_THRESHOLDS;

describe('Layer 1 — hand-strength heuristic', () => {
  it('rejects no-trump hand', () => {
    // South has no clubs, but trump is clubs.
    const hand = ['Js', '9d', '7h', '8h', 'Kh', 'Qd', 'Ah', 'Ks'] as CardId[];
    const r = evaluateHand(hand, 'c', T);
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.reason).toBe('no-trump');
  });

  it('rejects dud hand (low HCP, no top trump)', () => {
    // 3 trumps but all small (Q, 8, 7). Side suits: lots of low pips.
    const hand = ['Qc', '8c', '7c', '8d', '7d', '8h', '7h', '8s'] as CardId[];
    const r = evaluateHand(hand, 'c', T);
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.reason).toBe('dud-hand');
  });

  it('rejects fragile single trump (no top trump in it)', () => {
    // Single low trump, otherwise high HCP elsewhere.
    const hand = ['Qc', 'Jh', '9h', 'Ah', 'Js', '9s', 'Jd', '9d'] as CardId[];
    // Use minTrumpLen=1 here so the 1-trump path is exercised; the
    // production default (minTrumpLen=2) rejects this earlier as 'no-trump'.
    const r = evaluateHand(hand, 'c', { ...T, minTrumpLen: 1 });
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.reason).toBe('fragile-trump');
  });

  it('accepts strong trump hand', () => {
    const hand = ['Jc', '9c', 'Ac', '10c', 'Kh', 'Qd', '8h', '7s'] as CardId[];
    const r = evaluateHand(hand, 'c', T);
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.features.trumpLen).toBe(4);
      expect(r.features.trumpTopCount).toBe(3);
      expect(r.features.hcp).toBeGreaterThan(60);
    }
  });

  it('accepts marginal hand with one top trump and modest HCP', () => {
    // J of trump alone; otherwise mid-strength. Test exercises the
    // single-trump branch (minTrumpLen=1) — production default
    // (minTrumpLen=2) would reject.
    const hand = ['Jc', 'Kh', 'Qh', '8h', 'Ad', '10s', '7s', '8s'] as CardId[];
    const r = evaluateHand(hand, 'c', { ...T, minTrumpLen: 1 });
    expect(r.pass).toBe(true);
  });

  it('records descending suit-length shape', () => {
    const hand = ['Jc', '9c', 'Ac', '10c', 'Kh', 'Qh', 'Ad', '7s'] as CardId[];
    const r = evaluateHand(hand, 'c', T);
    expect(r.features.shape).toEqual([4, 2, 1, 1]);
  });
});
