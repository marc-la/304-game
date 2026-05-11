// Deck management: shuffling, cutting, and dealing.
// Mirrors game304/deck.py.
//
// Note on RNG: Python uses Mersenne Twister; this port uses
// xorshift32 (already used by 304dle's dealing.ts). The two RNGs
// produce different sequences from the same numeric seed — so the
// TS Deck is *internally deterministic* given a TS RNG, but does
// NOT bit-match Python's deck for the same numeric seed. Engine
// parity tests inject pre-shuffled card orders from Python fixtures
// and bypass the in-engine shuffle, so this divergence does not
// affect parity verification.

import type { CardId } from './card';
import { PACK } from './card';
import type { Seat } from './seating';
import { dealOrder } from './seating';

// ---------------------------------------------------------------------------
// Random — small wrapper that mirrors the slice of Python's random.Random
// the engine uses (randint inclusive, shuffle).
// ---------------------------------------------------------------------------

export interface Random {
  // Inclusive on both ends, mirroring Python's random.Random.randint.
  randint(low: number, high: number): number;
  // In-place Fisher-Yates shuffle.
  shuffle<T>(arr: T[]): void;
}

// xorshift32 — fast, deterministic, browser-safe.
export const makeRandom = (seed: number): Random => {
  let s = seed | 0;
  if (s === 0) s = 1;
  const next01 = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s = s | 0;
    return (s >>> 0) / 0x100000000;
  };
  return {
    randint(low, high) {
      const span = high - low + 1;
      return low + Math.floor(next01() * span);
    },
    shuffle<T>(arr: T[]) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next01() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Pack
// ---------------------------------------------------------------------------

export const createPack = (): CardId[] => [...PACK];

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

export class Deck {
  private _cards: CardId[];
  private _rng: Random;

  constructor(cards?: ReadonlyArray<CardId>, rng?: Random) {
    this._cards = cards ? [...cards] : createPack();
    this._rng = rng ?? makeRandom(Date.now() | 0);
  }

  get cards(): ReadonlyArray<CardId> {
    return this._cards;
  }

  get remaining(): number {
    return this._cards.length;
  }

  // Single overhand-style partial shuffle. Splits the deck into
  // chunks of 2–6 from the top and prepends each chunk to the
  // result pile (mirroring a real overhand shuffle, preserving
  // some adjacency).
  overhandShuffle(): void {
    const result: CardId[] = [];
    let remaining = this._cards;
    while (remaining.length > 0) {
      const chunkSize = Math.min(
        2 + this._rng.randint(0, 4),
        remaining.length,
      );
      const chunk = remaining.slice(0, chunkSize);
      remaining = remaining.slice(chunkSize);
      // Prepend chunk to result (place on top).
      result.splice(0, 0, ...chunk);
    }
    this._cards = result;
  }

  // 1–4 overhand shuffles.
  minimalShuffle(): void {
    const numPasses = 1 + this._rng.randint(0, 3);
    for (let i = 0; i < numPasses; i++) this.overhandShuffle();
  }

  // Full Fisher-Yates randomisation (used after 3 consecutive reshuffles).
  fullShuffle(): void {
    this._rng.shuffle(this._cards);
  }

  // Cut at a random point (between 1 and len-2 inclusive).
  cut(): void {
    if (this._cards.length < 3) return;
    const cutPoint = 1 + this._rng.randint(0, this._cards.length - 3);
    this._cards = [
      ...this._cards.slice(cutPoint),
      ...this._cards.slice(0, cutPoint),
    ];
  }

  // Pop a single card from the top of the deck.
  pop(): CardId | undefined {
    return this._cards.shift();
  }

  // Pop n cards from the top of the deck.
  popN(n: number): CardId[] {
    if (n > this._cards.length) {
      throw new Error(
        `Not enough cards in deck: requested ${n}, have ${this._cards.length}`,
      );
    }
    return this._cards.splice(0, n);
  }

  // Deal `numCards` to each seat in dealing order (anticlockwise from
  // dealer's right). Each seat receives a contiguous batch before the
  // next seat. Cards are removed from the deck.
  deal(dealer: Seat, numCards: number): Record<Seat, CardId[]> {
    const totalNeeded = numCards * 4;
    if (this._cards.length < totalNeeded) {
      throw new Error(
        `Not enough cards to deal: need ${totalNeeded}, have ${this._cards.length}`,
      );
    }

    const order = dealOrder(dealer);
    const hands: Record<Seat, CardId[]> = {
      north: [],
      west: [],
      south: [],
      east: [],
    };
    for (const seat of order) {
      hands[seat] = this._cards.splice(0, numCards);
    }
    return hands;
  }

  // Inject a specific card order. Used by tests / parity fixtures to
  // bypass shuffling and exercise downstream logic with a known deck.
  setOrder(cards: ReadonlyArray<CardId>): void {
    this._cards = [...cards];
  }
}
