// Daily seed → deal pipeline. Pure deterministic functions.

import type { CardId, Suit } from './card';
import { PACK, suitOf } from './card';
import type { Seat } from './seating';

// xorshift32 — small, fast, deterministic across browsers.
export const makeRng = (seed: number): (() => number) => {
  let s = seed | 0;
  if (s === 0) s = 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s = s | 0;
    // Convert to [0, 1)
    return ((s >>> 0) / 0x100000000);
  };
};

// FNV-1a 32-bit hash; deterministic seeding from a date string.
export const seedFromDate = (date: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const fisherYates = <T>(items: ReadonlyArray<T>, rng: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
};

export interface DealResult {
  hands: Record<Seat, CardId[]>;
  trumper: Seat;
  trumpSuit: Suit;
  trumpCard: CardId;
  isOpen: true;
  botSeed: number;
}

// Generate a deal where South is always the trumper. Trump card =
// South's highest-power card in their longest suit (deterministic).
// Open trump (no closed-trump fold).
export const dealForSeed = (seed: number): DealResult => {
  const rng = makeRng(seed);
  const shuffled = fisherYates(PACK, rng);

  const hands: Record<Seat, CardId[]> = {
    north: shuffled.slice(0, 8),
    west: shuffled.slice(8, 16),
    south: shuffled.slice(16, 24),
    east: shuffled.slice(24, 32),
  };

  // Pick trump suit = south's longest suit (deterministic tie-break by suit order).
  const counts: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 };
  for (const card of hands.south) counts[suitOf(card)]++;
  const SUIT_ORDER: Suit[] = ['c', 'd', 'h', 's'];
  let trumpSuit: Suit = SUIT_ORDER[0];
  for (const su of SUIT_ORDER) {
    if (counts[su] > counts[trumpSuit]) trumpSuit = su;
  }

  // Trump card = south's strongest card in trump suit.
  const trumpsInHand = hands.south.filter(c => suitOf(c) === trumpSuit);
  trumpsInHand.sort((a, b) => {
    const POWER: Record<string, number> = {
      J: 0, '9': 1, A: 2, '10': 3, K: 4, Q: 5, '8': 6, '7': 7,
    };
    const ra = a.length === 3 ? '10' : a[0];
    const rb = b.length === 3 ? '10' : b[0];
    return POWER[ra] - POWER[rb];
  });
  const trumpCard = trumpsInHand[0];

  // Bot seed: derived from main seed but distinct so we can vary
  // either independently in classifier reroll loops.
  const botSeed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

  return {
    hands,
    trumper: 'south',
    trumpSuit,
    trumpCard,
    isOpen: true,
    botSeed,
  };
};
