import { describe, expect, it } from 'vitest';
import {
  PACK,
  RANKS,
  SUITS,
  beats,
  card,
  handPoints,
  pointsOf,
  powerOf,
  rankOf,
  suitOf,
} from '../card';

describe('card primitives', () => {
  it('encodes / decodes ranks and suits', () => {
    const c = card('J', 'h');
    expect(c).toBe('Jh');
    expect(rankOf(c)).toBe('J');
    expect(suitOf(c)).toBe('h');
  });

  it('handles 10 specially', () => {
    const c = card('10', 'd');
    expect(c).toBe('10d');
    expect(rankOf(c)).toBe('10');
    expect(suitOf(c)).toBe('d');
    expect(c.length).toBe(3);
  });

  it('reports 304 power and points', () => {
    expect(powerOf(card('J', 'c'))).toBe(0);
    expect(powerOf(card('7', 'c'))).toBe(7);
    expect(pointsOf(card('J', 'c'))).toBe(30);
    expect(pointsOf(card('9', 'c'))).toBe(20);
    expect(pointsOf(card('7', 'c'))).toBe(0);
  });

  it('PACK has 32 unique cards across 8 ranks × 4 suits', () => {
    expect(PACK.length).toBe(32);
    expect(new Set(PACK).size).toBe(32);
    expect(PACK.length).toBe(RANKS.length * SUITS.length);
  });

  it('handPoints sums to 304 for the full pack', () => {
    expect(handPoints(PACK)).toBe(304);
  });

  describe('beats()', () => {
    it('trump beats non-trump', () => {
      expect(beats(card('7', 'h'), card('J', 'c'), 'c', 'h')).toBe(true);
    });
    it('higher trump beats lower trump', () => {
      expect(beats(card('J', 'h'), card('9', 'h'), 'c', 'h')).toBe(true);
      expect(beats(card('9', 'h'), card('J', 'h'), 'c', 'h')).toBe(false);
    });
    it('led suit beats off-suit when no trump involved', () => {
      expect(beats(card('7', 'c'), card('J', 'd'), 'c', 'h')).toBe(true);
    });
    it('off-suit non-trump beats nothing', () => {
      expect(beats(card('J', 'd'), card('7', 'c'), 'c', 'h')).toBe(false);
    });
    it('higher led-suit beats lower led-suit', () => {
      expect(beats(card('J', 'c'), card('Q', 'c'), 'c', 'h')).toBe(true);
    });
  });
});
