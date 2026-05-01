// Caps obligation algorithm. Composes info.ts (information sets,
// worlds) and dd.ts (per-world solver) into the §5 single-dummy
// quantifiers: there exists O such that for every world W and every
// legal opponent play, O sweeps every remaining round.
//
// Mirrors game304/caps.py.

import type { CardId } from './card';
import type { World, InformationSet } from './info';
import { buildInfoSet, enumerateWorlds } from './info';
import type { InProgressEntry, PlaySnapshot } from './dd';
import { orderMinPointsInWorld, orderSweepsWorld } from './dd';
import type { Seat } from './seating';
import { teamOf } from './seating';
import type { EngineGameState, EnginePlayState } from './state';

export const MAX_WORLDS = 5000;
export const MAX_PERMUTATIONS = 5040; // 7!

export const checkCapsObligation = (
  state: EngineGameState,
  seat: Seat,
): boolean => {
  if (state.pccPartnerOut === seat) return false;

  let info: InformationSet;
  try {
    info = buildInfoSet(state, seat);
  } catch {
    return false;
  }

  if (!info.teamWonAllCompleted) return false;
  if (info.ownHand.length === 0) return false;

  const roundsRemaining = 8 - state.play.completedRounds.length;
  if (roundsRemaining <= 0) return false;

  const worlds = enumerateOrAbort(info);
  if (worlds === null) return false;

  return hasWitnessOrder({
    info,
    seat,
    play: state.play,
    worlds,
    roundsRemaining,
    pccPartnerOut: state.pccPartnerOut,
  });
};

export const validateCapsCall = (
  state: EngineGameState,
  seat: Seat,
  playOrder: ReadonlyArray<CardId>,
): boolean => {
  if (state.pccPartnerOut === seat) return false;

  let info: InformationSet;
  try {
    info = buildInfoSet(state, seat);
  } catch {
    return false;
  }
  if (!info.teamWonAllCompleted) return false;

  // play order must equal own hand as a multiset
  const sortedOrder = [...playOrder].sort();
  const sortedHand = [...info.ownHand].sort();
  if (sortedOrder.length !== sortedHand.length) return false;
  for (let i = 0; i < sortedOrder.length; i++) {
    if (sortedOrder[i] !== sortedHand[i]) return false;
  }

  const roundsRemaining = 8 - state.play.completedRounds.length;
  if (roundsRemaining <= 0) return false;

  const worlds = enumerateOrAbort(info);
  if (worlds === null) return false;

  return orderWinsAllWorlds({
    info,
    seat,
    play: state.play,
    worlds,
    order: [...playOrder],
    roundsRemaining,
    pccPartnerOut: state.pccPartnerOut,
  });
};

// Like validateCapsCall, but also returns the first failing world for
// UI explanation. null on success, breaking world otherwise.
export const explainCapsFailure = (
  state: EngineGameState,
  seat: Seat,
  playOrder: ReadonlyArray<CardId>,
): { world: World; reason: 'lost-round' | 'illegal-order' } | null => {
  if (state.pccPartnerOut === seat) {
    return { world: anyWorld(state), reason: 'illegal-order' };
  }
  let info: InformationSet;
  try {
    info = buildInfoSet(state, seat);
  } catch {
    return { world: anyWorld(state), reason: 'illegal-order' };
  }
  if (!info.teamWonAllCompleted) {
    return { world: anyWorld(state), reason: 'illegal-order' };
  }

  const sortedOrder = [...playOrder].sort();
  const sortedHand = [...info.ownHand].sort();
  if (
    sortedOrder.length !== sortedHand.length ||
    sortedOrder.some((c, i) => c !== sortedHand[i])
  ) {
    return { world: anyWorld(state), reason: 'illegal-order' };
  }

  const roundsRemaining = 8 - state.play.completedRounds.length;
  const worlds = enumerateOrAbort(info);
  if (worlds === null) return { world: anyWorld(state), reason: 'illegal-order' };

  for (const world of worlds) {
    const snap = resolveSnapshot(state.play, info, world, seat);
    if (snap === null) return { world, reason: 'illegal-order' };
    const ok = orderSweepsWorld({
      world,
      callerSeat: seat,
      callerOrder: [...playOrder],
      snapshot: snap,
      pccPartnerOut: state.pccPartnerOut,
      roundsRemaining,
    });
    if (!ok) return { world, reason: 'lost-round' };
  }
  return null;
};

const anyWorld = (state: EngineGameState): World => {
  // Best-effort: build a dummy world out of the actual hands the
  // runtime is carrying. Used only for the explainer fallback.
  const hands = new Map<Seat, ReadonlyArray<CardId>>();
  for (const [s, cs] of state.hands) {
    if (s !== state.pccPartnerOut) hands.set(s, [...cs]);
  }
  return {
    hands,
    trumpSuit: state.trump.trumpSuit,
    foldedTrumpCard: state.trump.trumpCard,
    hiddenSlotAssignments: new Map(),
  };
};

export const isCapsLate = (
  state: EngineGameState,
  seat: Seat,
  options: { policy?: 'lenient' | 'strict' } = {},
): boolean => {
  const play = state.play;
  const obligation = play.capsObligations.get(seat);
  if (!obligation) return false;

  const policy = options.policy ?? 'lenient';
  if (policy === 'strict') {
    if (obligation.obligatedAtRound < play.roundNumber) return true;
    if (
      obligation.obligatedAtRound === play.roundNumber &&
      obligation.obligatedAtCard < play.currentRound.length
    ) return true;
    return false;
  }

  const vPlayedInCurrent = play.currentRound.some(e => e.seat === seat);
  const vPlaysNow =
    (play.roundNumber - 1) + (vPlayedInCurrent ? 1 : 0);
  return vPlaysNow > obligation.vPlaysAtObligation;
};

export const deduceExhaustedSuits = (
  state: EngineGameState,
): Map<Seat, Set<import('./card').Suit>> => {
  const out = new Map<Seat, Set<import('./card').Suit>>();
  for (const s of (['north', 'west', 'south', 'east'] as Seat[])) {
    out.set(s, new Set());
  }
  for (const r of state.play.completedRounds) {
    if (r.cards.length === 0) continue;
    let ledSuit: import('./card').Suit | null = null;
    for (const e of r.cards) {
      if (!e.faceDown && e.card !== null) {
        ledSuit = e.card[e.card.length - 1] as import('./card').Suit;
        break;
      }
    }
    if (ledSuit === null) continue;
    for (const e of r.cards) {
      if (e.faceDown) {
        out.get(e.seat)!.add(ledSuit);
        continue;
      }
      if (e.card === null) continue;
      const su = e.card[e.card.length - 1] as import('./card').Suit;
      if (su !== ledSuit) out.get(e.seat)!.add(ledSuit);
    }
  }
  return out;
};

// Claim balance ----------------------------------------------------------

export const checkClaimBalance = (
  state: EngineGameState,
  seat: Seat,
  threshold: number,
): boolean => {
  if (state.pccPartnerOut === seat) return false;
  let info: InformationSet;
  try {
    info = buildInfoSet(state, seat);
  } catch {
    return false;
  }
  if (info.ownHand.length === 0) return false;

  const myTeam = teamOf(seat);
  const pointsSoFar = state.play.pointsWon[myTeam] ?? 0;
  if (pointsSoFar >= threshold) return true;
  const roundsRemaining = 8 - state.play.completedRounds.length;
  if (roundsRemaining <= 0) return false;

  const worlds = enumerateOrAbort(info);
  if (worlds === null) return false;
  const gap = threshold - pointsSoFar;

  return hasBalanceWitness({
    info, seat, play: state.play, worlds, roundsRemaining,
    pccPartnerOut: state.pccPartnerOut, gap,
  });
};

// Internals --------------------------------------------------------------

const enumerateOrAbort = (info: InformationSet): World[] | null => {
  const worlds: World[] = [];
  for (const w of enumerateWorlds(info, { maxWorlds: MAX_WORLDS + 1 })) {
    worlds.push(w);
    if (worlds.length > MAX_WORLDS) return null;
  }
  if (worlds.length === 0) return null;
  return worlds;
};

const resolveSnapshot = (
  play: EnginePlayState,
  _info: InformationSet,
  world: World,
  viewer: Seat,
): PlaySnapshot | null => {
  const leader = play.priority;
  const entries: InProgressEntry[] = [];
  for (const e of play.currentRound) {
    if (e.faceDown && !e.revealed && e.seat !== viewer) {
      const k = `${e.seat}:${play.roundNumber}`;
      const card = world.hiddenSlotAssignments.get(k);
      if (!card) return null;
      entries.push({ seat: e.seat, card });
    } else {
      if (e.card === null) return null;
      entries.push({ seat: e.seat, card: e.card });
    }
  }
  return { leader, entries };
};

interface WitnessSearchArgs {
  info: InformationSet;
  seat: Seat;
  play: EnginePlayState;
  worlds: World[];
  roundsRemaining: number;
  pccPartnerOut: Seat | null;
}

interface OrderCheckArgs extends WitnessSearchArgs {
  order: CardId[];
}

const factorial = (n: number): number => {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};

function* permutations<T>(items: ReadonlyArray<T>): Generator<T[]> {
  const a = [...items];
  const n = a.length;
  if (n === 0) { yield []; return; }
  const c = new Array(n).fill(0);
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

const hasWitnessOrder = (args: WitnessSearchArgs): boolean => {
  const cards = [...args.info.ownHand];
  if (factorial(cards.length) > MAX_PERMUTATIONS) return false;
  for (const ordering of permutations(cards)) {
    if (orderWinsAllWorlds({ ...args, order: ordering })) return true;
  }
  return false;
};

const orderWinsAllWorlds = (args: OrderCheckArgs): boolean => {
  for (const world of args.worlds) {
    const snap = resolveSnapshot(args.play, args.info, world, args.seat);
    if (snap === null) return false;
    const ok = orderSweepsWorld({
      world,
      callerSeat: args.seat,
      callerOrder: args.order,
      snapshot: snap,
      pccPartnerOut: args.pccPartnerOut,
      roundsRemaining: args.roundsRemaining,
    });
    if (!ok) return false;
  }
  return true;
};

interface BalanceArgs extends WitnessSearchArgs {
  gap: number;
}

const hasBalanceWitness = (args: BalanceArgs): boolean => {
  const cards = [...args.info.ownHand];
  if (factorial(cards.length) > MAX_PERMUTATIONS) return false;
  for (const ordering of permutations(cards)) {
    let ok = true;
    for (const world of args.worlds) {
      const snap = resolveSnapshot(args.play, args.info, world, args.seat);
      if (snap === null) { ok = false; break; }
      const minPts = orderMinPointsInWorld({
        world,
        callerSeat: args.seat,
        callerOrder: ordering,
        snapshot: snap,
        pccPartnerOut: args.pccPartnerOut,
        roundsRemaining: args.roundsRemaining,
      });
      if (minPts < args.gap) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
};
