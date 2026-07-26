// Refuting-world search — the dual of `findWitnessLine`.
//
// When a caps call is rejected as premature, the honest explanation is
// not "you were wrong" and it is emphatically NOT the actual remaining
// hands: the puzzle is curated so the real layout sweeps, so showing it
// displays a position in which the player's plan works and contradicts
// the verdict.
//
// What answers the question is a *counter-example*: one concrete deal,
// consistent with every card the player had seen, in which they drop a
// trick. That is precisely the world the ∀-quantifier in
// [docs/specs/caps_formalism.md §5] found and the player did not.
//
// Caps is adaptive (∀W ∃σ_W), so a world only refutes if NO ordering of
// the caller's remaining cards sweeps it. With ≤4 cards left that is at
// most 24 orders per world, which is cheap; the search is bounded so
// earlier rounds (where the world count explodes) degrade to "no
// counter-example found" rather than hanging the UI.

import type { CardId } from './card';
import { orderSweepsWorld } from './dd';
import { buildInfoSet, enumerateWorlds } from './info';
import type { World } from './info';
import type { Seat } from './seating';
import { SEAT_INDEX } from './seating';
import type { EngineGameState } from './state';

export interface RefutingWorld {
  // Concrete holdings for every seat in the counter-example.
  hands: Record<Seat, CardId[]>;
  // How many consistent worlds were examined, and how many of those
  // the caller would have swept. Lets the UI say "you were right in
  // 1465 of 1475 layouts — here is one of the other 10", which is a
  // far truer account of a premature call than "wrong".
  worldsChecked: number;
  worldsSwept: number;
}

export interface RefuteOptions {
  // Hard cap on worlds enumerated.
  maxWorlds?: number;
  // Cap on the caller's hand size. Cost is (hand!) orders x worlds x a
  // game-tree search each, so this grows explosively: a 5-card hand at
  // 4000 worlds is ~480k solver calls, which locks the browser tab for
  // minutes. This ran on the main thread the moment a player pressed
  // Call Caps, and an early call at R3 hung the page.
  maxHandSize?: number;
  // Wall-clock budget. The backstop that actually guarantees the UI
  // stays responsive regardless of how the other two are tuned —
  // returning no counter-example is a fine outcome, freezing is not.
  budgetMs?: number;
}

const permutations = (cards: ReadonlyArray<CardId>): CardId[][] => {
  if (cards.length <= 1) return [[...cards]];
  const out: CardId[][] = [];
  for (let i = 0; i < cards.length; i++) {
    const rest = [...cards.slice(0, i), ...cards.slice(i + 1)];
    for (const p of permutations(rest)) out.push([cards[i], ...p]);
  }
  return out;
};

const worldHands = (w: World): Record<Seat, CardId[]> => ({
  north: [...w.hands[SEAT_INDEX.north]],
  west: [...w.hands[SEAT_INDEX.west]],
  south: [...w.hands[SEAT_INDEX.south]],
  east: [...w.hands[SEAT_INDEX.east]],
});

export const findRefutingWorld = (
  state: EngineGameState,
  callerSeat: Seat,
  options: RefuteOptions = {},
): RefutingWorld | null => {
  const maxWorlds = options.maxWorlds ?? 400;
  const maxHandSize = options.maxHandSize ?? 4;
  const budgetMs = options.budgetMs ?? 250;
  const deadline = Date.now() + budgetMs;

  let info;
  try {
    info = buildInfoSet(state, callerSeat);
  } catch {
    return null;
  }
  const own = info.ownHand;
  if (own.length === 0 || own.length > maxHandSize) return null;

  const play = state.play;
  // The caller's own cards are fixed across worlds; only the hidden
  // seats vary. Precompute the orders once.
  const orders = permutations(own);
  // `priority` is the leader of the round in progress (or of the next
  // one when none is in progress), which is what the solver wants.
  const leader = play.priority;
  const entries = play.currentRound
    .filter(e => e.card !== null)
    .map(e => ({ seat: e.seat, card: e.card as CardId }));
  // Rounds left to win, NOT the caller's hand size — those differ
  // whenever the caller has already played into the round in progress.
  const roundsRemaining = 8 - play.completedRounds.length;

  let checked = 0;
  let swept = 0;
  let first: World | null = null;

  for (const w of enumerateWorlds(info, { maxWorlds })) {
    // Check the clock before each world, not after: one world costs up
    // to `orders.length` full solves.
    if (Date.now() > deadline) break;
    checked++;
    const sweeps = orders.some(order => orderSweepsWorld({
      world: w,
      callerSeat,
      callerOrder: order,
      snapshot: { leader, entries },
      pccPartnerOut: state.pccPartnerOut,
      roundsRemaining,
    }));
    if (sweeps) swept++;
    else if (first === null) first = w;
  }

  if (first === null) return null;
  return { hands: worldHands(first), worldsChecked: checked, worldsSwept: swept };
};
