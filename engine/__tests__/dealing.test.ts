import { describe, expect, it } from 'vitest';
import { dealForSeed, makeRng, seedFromDate } from '../dealing';
import { PACK, suitOf } from '../card';

describe('makeRng', () => {
  it('is deterministic for the same seed', () => {
    const a = makeRng(42); const b = makeRng(42);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });
  it('differs across seeds', () => {
    const a = makeRng(1); const b = makeRng(2);
    let same = true;
    for (let i = 0; i < 20; i++) if (a() !== b()) { same = false; break; }
    expect(same).toBe(false);
  });
});

describe('seedFromDate', () => {
  it('hashes consistently', () => {
    expect(seedFromDate('2026-05-01')).toBe(seedFromDate('2026-05-01'));
  });
  it('differs for different dates', () => {
    expect(seedFromDate('2026-05-01')).not.toBe(seedFromDate('2026-05-02'));
  });
});

describe('dealForSeed', () => {
  it('deals 8 cards to each seat covering the full pack with no duplicates', () => {
    const d = dealForSeed(seedFromDate('2026-05-01'));
    expect(d.hands.north.length).toBe(8);
    expect(d.hands.south.length).toBe(8);
    expect(d.hands.east.length).toBe(8);
    expect(d.hands.west.length).toBe(8);
    const all = [
      ...d.hands.north, ...d.hands.south, ...d.hands.east, ...d.hands.west,
    ];
    expect(new Set(all).size).toBe(32);
    const packSet = new Set(PACK);
    for (const c of all) expect(packSet.has(c)).toBe(true);
  });

  it('south is always trumper and trump card belongs to south', () => {
    for (const date of ['2026-01-01', '2026-06-15', '2026-12-31']) {
      const d = dealForSeed(seedFromDate(date));
      expect(d.trumper).toBe('south');
      expect(d.hands.south.includes(d.trumpCard)).toBe(true);
      expect(suitOf(d.trumpCard)).toBe(d.trumpSuit);
    }
  });

  it('is deterministic for the same date', () => {
    const a = dealForSeed(seedFromDate('2026-05-01'));
    const b = dealForSeed(seedFromDate('2026-05-01'));
    expect(a.hands.north).toEqual(b.hands.north);
    expect(a.trumpCard).toBe(b.trumpCard);
  });
});
