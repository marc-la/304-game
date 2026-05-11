// Scenario-aware dealer for the diverse pool. Generalizes the
// engine's south-only `dealForSeed` to support any trumper seat and
// open/closed trump modes.
//
// The dealing process mirrors the rules: shuffle the pack, deal 8
// cards per seat, the trumper picks the trump card from their hand
// (deterministic: longest suit, strongest card in that suit). For
// closed trump, the trump card stays on the table — the trumper's
// in-hand starting size is 7 (they retain 7 + the table card = 8
// total).

import { suitOf } from '@engine/card';
import type { CardId, Suit } from '@engine/card';
import { PACK } from '@engine/card';
import { makeRng } from '@engine/dealing';
import type { Seat } from '@engine/seating';
import { ANTICLOCKWISE } from '@engine/seating';

const fisherYates = <T>(items: ReadonlyArray<T>, rng: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
};

const SUIT_ORDER: readonly Suit[] = ['c', 'd', 'h', 's'];

const POWER: Record<string, number> = {
  J: 0, '9': 1, A: 2, '10': 3, K: 4, Q: 5, '8': 6, '7': 7,
};

const longestSuit = (hand: ReadonlyArray<CardId>): Suit => {
  const counts: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 };
  for (const c of hand) counts[suitOf(c)]++;
  let best: Suit = SUIT_ORDER[0];
  for (const s of SUIT_ORDER) if (counts[s] > counts[best]) best = s;
  return best;
};

const strongestInSuit = (
  hand: ReadonlyArray<CardId>,
  suit: Suit,
): CardId => {
  const inSuit = hand.filter(c => suitOf(c) === suit);
  inSuit.sort((a, b) => {
    const ra = a.length === 3 ? '10' : a[0];
    const rb = b.length === 3 ? '10' : b[0];
    return POWER[ra] - POWER[rb];
  });
  return inSuit[0];
};

export interface Scenario {
  trumperSeat: Seat;
  isOpen: boolean;
}

export interface ScenarioDealResult {
  hands: Record<Seat, CardId[]>;
  trumperSeat: Seat;
  trumpSuit: Suit;
  trumpCard: CardId;
  trumpCardInHand: boolean;     // false for closed trump (card on table)
  isOpen: boolean;
  prioritySeat: Seat;            // = trumperSeat (R1 priority for trumper)
  botSeed: number;
}

// Deal a 304 scenario from a seed. The scenario picks who is trumper
// and whether trump is open or closed; the deal is otherwise random.
export const dealScenario = (
  seed: number,
  scenario: Scenario,
): ScenarioDealResult => {
  const rng = makeRng(seed);
  const shuffled = fisherYates(PACK, rng);

  // Distribute 8 cards per seat. The shuffle order is fixed; the seats
  // get consecutive 8-card blocks. The order in which seats get blocks
  // is anticlockwise from a synthetic starting point — but for our
  // purposes any deterministic mapping is fine.
  const hands: Record<Seat, CardId[]> = {
    north: shuffled.slice(0, 8),
    west: shuffled.slice(8, 16),
    south: shuffled.slice(16, 24),
    east: shuffled.slice(24, 32),
  };

  const trumperHand = hands[scenario.trumperSeat];
  const trumpSuit = longestSuit(trumperHand);
  const trumpCard = strongestInSuit(trumperHand, trumpSuit);

  // Closed trump: the folded trump card sits on the table, not in
  // the trumper's hand. Their in-hand size becomes 7. Open trump:
  // the trump card is in the trumper's hand alongside the rest.
  if (!scenario.isOpen) {
    hands[scenario.trumperSeat] = trumperHand.filter(c => c !== trumpCard);
  }

  const botSeed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

  return {
    hands,
    trumperSeat: scenario.trumperSeat,
    trumpSuit,
    trumpCard,
    trumpCardInHand: scenario.isOpen,
    isOpen: scenario.isOpen,
    prioritySeat: scenario.trumperSeat,
    botSeed,
  };
};

// Cycle through all 8 scenario cells deterministically given a salt.
// Uniform sampling per the user's plan — no weighting, just rotate.
const SCENARIOS: readonly Scenario[] = ANTICLOCKWISE.flatMap(seat =>
  [true, false].map(isOpen => ({ trumperSeat: seat, isOpen })),
);

export const scenarioForSalt = (salt: number): Scenario =>
  SCENARIOS[((salt % SCENARIOS.length) + SCENARIOS.length) % SCENARIOS.length];

export { SCENARIOS };
