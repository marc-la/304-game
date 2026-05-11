// Layer 2 — Double-dummy caps achievability. Given the actual deal
// (all four hands face-up), is there a permutation of south's 8-card
// hand that wins every round against any legal opponent line?
//
// This is a single-world search: we don't enumerate consistent worlds
// (south's view is irrelevant here), we run the per-world solver from
// dd.ts on the literal deal. The outer search is over south's
// permutations; the inner solver handles adversarial opponent play.
//
// Strategy: try a power-sorted "natural" order first (works for the
// overwhelming majority of caps-able hands without an exponential
// tree walk), then fall back to a bounded permutation search.
//
// Distinct from engine/caps.ts:findWitnessOrder, which is single-dummy
// (universal over consistent worlds). Here we just need "is the deal
// theoretically caps-able under perfect info."

import { powerOf, suitOf } from '@engine/card';
import type { CardId, Suit } from '@engine/card';
import { orderSweepsWorld } from '@engine/dd';
import type { World } from '@engine/info';
import type { Seat } from '@engine/seating';
import type { Layer2Result } from '../types';

const dealToWorld = (
  hands: Record<Seat, CardId[]>,
  trumpSuit: Suit,
): World => {
  const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
  for (const seat of ['north', 'west', 'south', 'east'] as Seat[]) {
    handsMap.set(seat, [...hands[seat]].sort());
  }
  return {
    hands: handsMap,
    trumpSuit,
    foldedTrumpCard: null,
    hiddenSlotAssignments: new Map(),
  };
};

const checkOrder = (
  world: World,
  order: ReadonlyArray<CardId>,
  rounds: number,
): boolean => {
  return orderSweepsWorld({
    world,
    callerSeat: 'south',
    callerOrder: order,
    snapshot: { leader: 'south', entries: [] },
    pccPartnerOut: null,
    roundsRemaining: rounds,
  });
};

// Sort south's hand into a "natural" caps order: trump highest-first,
// then side suits by length descending, then by power within each suit.
// Empirically this is a witness for most caps-able deals.
const naturalOrder = (hand: ReadonlyArray<CardId>, trump: Suit): CardId[] => {
  const trumps = hand
    .filter(c => suitOf(c) === trump)
    .sort((a, b) => powerOf(a) - powerOf(b));
  const bySide = new Map<Suit, CardId[]>();
  for (const c of hand) {
    if (suitOf(c) === trump) continue;
    const s = suitOf(c);
    if (!bySide.has(s)) bySide.set(s, []);
    bySide.get(s)!.push(c);
  }
  const sideGroups = [...bySide.values()].map(group =>
    [...group].sort((a, b) => powerOf(a) - powerOf(b)),
  );
  // Longer groups first (running side-suit honors win more rounds).
  sideGroups.sort((a, b) => b.length - a.length);
  return [...trumps, ...sideGroups.flat()];
};

// Lightweight permutation generator (Heap's algorithm). Materialises
// each permutation; OK for ≤8 elements.
function* permutations<T>(items: ReadonlyArray<T>): Generator<T[]> {
  const a = [...items];
  const n = a.length;
  if (n === 0) { yield []; return; }
  const c = new Array<number>(n).fill(0);
  yield [...a];
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const swapIdx = i % 2 === 0 ? 0 : c[i];
      const tmp = a[swapIdx]; a[swapIdx] = a[i]; a[i] = tmp;
      yield [...a];
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

export interface DoubleDummySearchOptions {
  // Hard cap on permutation iterations. Default 5000.
  // For an impossible deal, we iterate up to this many perms before
  // declaring not-cap-able. For a cap-able deal, the heuristic
  // natural-order check almost always succeeds without iterating.
  maxPermutations?: number;
  // Stop iterating permutations once this many distinct first-cards
  // have been confirmed as winning leads. Default: 8 (all of them).
  // Lower (e.g. 1) for early bailout once any witness is found.
  tightnessCap?: number;
}

export const findDoubleDummyWitness = (
  hands: Record<Seat, CardId[]>,
  trumpSuit: Suit,
  options: DoubleDummySearchOptions = {},
): Layer2Result => {
  const world = dealToWorld(hands, trumpSuit);
  const southHand = hands.south;
  const rounds = southHand.length;
  if (rounds !== 8) {
    return { pass: false, reason: 'not-cap-able' };
  }

  const maxPerms = options.maxPermutations ?? 5000;
  const tightnessCap = options.tightnessCap ?? southHand.length;

  // A small set of heuristic candidate orders covering the common
  // shapes of caps witnesses (trump-runner, trump-then-side, mixed).
  // These run before any permutation search; for the overwhelming
  // majority of caps-able deals one of them is a witness.
  const candidates: CardId[][] = [
    naturalOrder(southHand, trumpSuit),
    naturalOrderInverted(southHand, trumpSuit),
    sideFirstOrder(southHand, trumpSuit),
  ];

  let firstWitness: CardId[] | null = null;
  const winningFirstCards = new Set<CardId>();

  for (const order of candidates) {
    if (winningFirstCards.has(order[0])) continue;
    if (checkOrder(world, order, rounds)) {
      if (firstWitness === null) firstWitness = order;
      winningFirstCards.add(order[0]);
      if (winningFirstCards.size >= tightnessCap) break;
    }
  }

  // Bounded permutation search only if asked for it. Default behavior
  // (maxPerms == 0) is "trust the heuristic candidates". The full
  // permutation search is correct but can be very slow on near-
  // cap-able deals; we let the caller opt in.
  if (
    maxPerms > 0 &&
    (firstWitness === null || winningFirstCards.size < tightnessCap)
  ) {
    let count = 0;
    for (const perm of permutations(southHand)) {
      if (++count > maxPerms) break;
      if (winningFirstCards.has(perm[0])) continue;
      if (checkOrder(world, perm, rounds)) {
        if (firstWitness === null) firstWitness = perm;
        winningFirstCards.add(perm[0]);
        if (winningFirstCards.size >= tightnessCap) break;
      }
    }
  }

  if (firstWitness === null) {
    return { pass: false, reason: 'not-cap-able' };
  }
  return {
    pass: true,
    witnessOrder: firstWitness,
    tightness: winningFirstCards.size,
  };
};

// Trump cards LAST instead of first — works for hands where south's
// side-suit honors clear opponents before trumps are needed.
const naturalOrderInverted = (
  hand: ReadonlyArray<CardId>,
  trump: Suit,
): CardId[] => {
  const trumps = hand
    .filter(c => suitOf(c) === trump)
    .sort((a, b) => powerOf(a) - powerOf(b));
  const sides = hand
    .filter(c => suitOf(c) !== trump)
    .sort((a, b) => powerOf(a) - powerOf(b));
  return [...sides, ...trumps];
};

// Side suits first (longest first), trumps last — useful when trump
// is short but side suits are dominant.
const sideFirstOrder = (
  hand: ReadonlyArray<CardId>,
  trump: Suit,
): CardId[] => {
  const trumps = hand
    .filter(c => suitOf(c) === trump)
    .sort((a, b) => powerOf(a) - powerOf(b));
  const bySide = new Map<Suit, CardId[]>();
  for (const c of hand) {
    if (suitOf(c) === trump) continue;
    const s = suitOf(c);
    if (!bySide.has(s)) bySide.set(s, []);
    bySide.get(s)!.push(c);
  }
  const sideGroups = [...bySide.values()].map(group =>
    [...group].sort((a, b) => powerOf(a) - powerOf(b)),
  );
  sideGroups.sort((a, b) => b.length - a.length);
  return [...sideGroups.flat(), ...trumps];
};
