// Per-world double-dummy solver. Given a fixed world W (concrete card
// locations) and a fixed caller play order O, decide whether O wins
// every remaining round (or, for claim balance, the minimum points the
// caller's team is guaranteed to collect) against any legal opponent
// play. Mirrors game304/dd.py.
//
// The outer single-dummy quantifiers (universal over consistent worlds,
// existential over orders) live in caps.ts. This module is a leaf:
// it knows nothing about information sets.

import type { CardId, Suit } from './card';
import { suitOf } from './card';
import { legalPlays, roundPoints, roundTurnOrder, roundWinner, seatsHoldingTrump } from './play';
import type { Seat, Team } from './seating';
import { SEAT_INDEX, SEATS_BY_INDEX, teamOf } from './seating';
import type { World } from './info';

export interface InProgressEntry {
  seat: Seat;
  card: CardId;
}

export interface PlaySnapshot {
  leader: Seat;
  entries: ReadonlyArray<InProgressEntry>;
}

export interface OrderSweepsArgs {
  world: World;
  callerSeat: Seat;
  callerOrder: ReadonlyArray<CardId>;
  snapshot: PlaySnapshot;
  pccPartnerOut: Seat | null;
  roundsRemaining: number;
}

const worldHandsToMap = (
  hands: ReadonlyArray<ReadonlyArray<CardId>>,
): Map<Seat, CardId[]> => {
  const m = new Map<Seat, CardId[]>();
  for (let i = 0; i < 4; i++) {
    m.set(SEATS_BY_INDEX[i], [...(hands[i] ?? [])]);
  }
  return m;
};

const mapToHandsArr = (
  hands: ReadonlyMap<Seat, ReadonlyArray<CardId>>,
): ReadonlyArray<ReadonlyArray<CardId>> => {
  const arr: ReadonlyArray<CardId>[] = [[], [], [], []];
  for (const [s, cs] of hands) arr[SEAT_INDEX[s]] = cs;
  return arr;
};


// Equivalence-class reduction for a solver's move list.
//
// Two cards of the same suit in the SAME hand are strategically
// identical when no card of that suit still in play sits between them:
// whichever you play, the other takes its place in every subsequent
// position. Collapsing those to one representative is the standard
// double-dummy pruning, and without it these searches are unusable —
// a seven-round position branches roughly (7^3)^7 before pruning.
//
// `inPlay` must be every card not yet played: all four hands plus the
// cards already on the table this trick.
const reduceEquivalent = (
  legal: ReadonlyArray<CardId>,
  hand: ReadonlyArray<CardId>,
  inPlay: ReadonlySet<CardId>,
): CardId[] => {
  if (legal.length <= 1) return [...legal];
  const RANKS = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
  const rank = (c: CardId): number => RANKS.indexOf(c.slice(0, c.length - 1));
  const own = new Set(hand);
  const keep: CardId[] = [];
  const bySuit = new Map<Suit, CardId[]>();
  for (const c of legal) {
    const su = suitOf(c);
    if (!bySuit.has(su)) bySuit.set(su, []);
    bySuit.get(su)!.push(c);
  }
  for (const [su, cards] of bySuit) {
    // All still-in-play cards of this suit, strongest first.
    const global = [...inPlay].filter(c => suitOf(c) === su).sort((a, b) => rank(a) - rank(b));
    const candidate = new Set(cards);
    let prevWasOursAndKept = false;
    for (const c of global) {
      if (!own.has(c)) { prevWasOursAndKept = false; continue; }
      if (!candidate.has(c)) { prevWasOursAndKept = false; continue; }
      // Consecutive in the global ordering and both ours ⇒ equivalent.
      if (!prevWasOursAndKept) keep.push(c);
      prevWasOursAndKept = true;
    }
  }
  return keep.length > 0 ? keep : [...legal];
};

export const orderSweepsWorld = (args: OrderSweepsArgs): boolean => {
  const simHands = worldHandsToMap(args.world.hands);
  const inProgress: Array<[Seat, CardId]> =
    args.snapshot.entries.map(e => [e.seat, e.card]);
  return solveCaps({
    simHands,
    callerSeat: args.callerSeat,
    callerOrder: [...args.callerOrder],
    callerIndex: 0,
    leader: args.snapshot.leader,
    inProgress,
    roundsRemaining: args.roundsRemaining,
    trumpSuit: args.world.trumpSuit,
    myTeam: teamOf(args.callerSeat),
    pccPartnerOut: args.pccPartnerOut,
  });
};

export const orderMinPointsInWorld = (args: OrderSweepsArgs): number => {
  const simHands = worldHandsToMap(args.world.hands);
  const inProgress: Array<[Seat, CardId]> =
    args.snapshot.entries.map(e => [e.seat, e.card]);
  return solveMinPoints({
    simHands,
    callerSeat: args.callerSeat,
    callerOrder: [...args.callerOrder],
    callerIndex: 0,
    leader: args.snapshot.leader,
    inProgress,
    roundsRemaining: args.roundsRemaining,
    trumpSuit: args.world.trumpSuit,
    myTeam: teamOf(args.callerSeat),
    pccPartnerOut: args.pccPartnerOut,
  });
};

interface SolveCtx {
  simHands: Map<Seat, CardId[]>;
  callerSeat: Seat;
  callerOrder: CardId[];
  callerIndex: number;
  leader: Seat;
  inProgress: Array<[Seat, CardId]>;
  roundsRemaining: number;
  trumpSuit: Suit;
  myTeam: Team;
  pccPartnerOut: Seat | null;
}

const handRemove = (
  hands: Map<Seat, CardId[]>,
  seat: Seat,
  card: CardId,
): Map<Seat, CardId[]> => {
  const next = new Map<Seat, CardId[]>();
  for (const [s, cs] of hands) {
    if (s === seat) {
      const idx = cs.indexOf(card);
      if (idx === -1) {
        next.set(s, [...cs]);
      } else {
        const copy = [...cs];
        copy.splice(idx, 1);
        next.set(s, copy);
      }
    } else {
      next.set(s, [...cs]);
    }
  }
  return next;
};

const solveCaps = (ctx: SolveCtx): boolean => {
  if (ctx.roundsRemaining <= 0) return true;

  const turnOrder = roundTurnOrder(ctx.leader, ctx.pccPartnerOut);
  const nextIdx = ctx.inProgress.length;

  if (nextIdx >= turnOrder.length) {
    const winner = roundWinner(ctx.inProgress, ctx.trumpSuit);
    if (teamOf(winner) !== ctx.myTeam) return false;
    if (ctx.roundsRemaining === 1) return true;
    return solveCaps({
      ...ctx,
      leader: winner,
      inProgress: [],
      roundsRemaining: ctx.roundsRemaining - 1,
    });
  }

  const nextSeatToPlay = turnOrder[nextIdx];
  const ledSuit: Suit | null =
    ctx.inProgress.length > 0 ? suitOf(ctx.inProgress[0][1]) : null;
  const isLead = ctx.inProgress.length === 0;
  const trumpHolders = seatsHoldingTrump(mapToHandsArr(ctx.simHands), ctx.trumpSuit);

  if (nextSeatToPlay === ctx.callerSeat) {
    if (ctx.callerIndex >= ctx.callerOrder.length) return false;
    const card = ctx.callerOrder[ctx.callerIndex];
    const hand = ctx.simHands.get(ctx.callerSeat) ?? [];
    if (!hand.includes(card)) return false;
    const legal = legalPlays({
      hand,
      ledSuit,
      trumpSuit: ctx.trumpSuit,
      isLead,
      seatsWithTrumps: trumpHolders,
      seat: ctx.callerSeat,
    });
    if (!legal.includes(card)) return false;
    return solveCaps({
      ...ctx,
      simHands: handRemove(ctx.simHands, ctx.callerSeat, card),
      callerIndex: ctx.callerIndex + 1,
      inProgress: [...ctx.inProgress, [ctx.callerSeat, card]],
    });
  }

  const otherHand = ctx.simHands.get(nextSeatToPlay) ?? [];
  if (otherHand.length === 0) return false;
  const legal = legalPlays({
    hand: otherHand,
    ledSuit,
    trumpSuit: ctx.trumpSuit,
    isLead,
    seatsWithTrumps: trumpHolders,
    seat: nextSeatToPlay,
  });
  if (legal.length === 0) return false;

  const inPlay = new Set<CardId>();
  for (const [, cs] of ctx.simHands) for (const c of cs) inPlay.add(c);
  for (const [, c] of ctx.inProgress) inPlay.add(c);
  for (const chosen of reduceEquivalent(legal, otherHand, inPlay)) {
    const ok = solveCaps({
      ...ctx,
      simHands: handRemove(ctx.simHands, nextSeatToPlay, chosen),
      inProgress: [...ctx.inProgress, [nextSeatToPlay, chosen]],
    });
    if (!ok) return false;
  }
  return true;
};

const solveMinPoints = (ctx: SolveCtx): number => {
  if (ctx.roundsRemaining <= 0) return 0;

  const turnOrder = roundTurnOrder(ctx.leader, ctx.pccPartnerOut);
  const nextIdx = ctx.inProgress.length;

  if (nextIdx >= turnOrder.length) {
    const winner = roundWinner(ctx.inProgress, ctx.trumpSuit);
    const gained =
      teamOf(winner) === ctx.myTeam ? roundPoints(ctx.inProgress) : 0;
    if (ctx.roundsRemaining === 1) return gained;
    return gained + solveMinPoints({
      ...ctx,
      leader: winner,
      inProgress: [],
      roundsRemaining: ctx.roundsRemaining - 1,
    });
  }

  const nextSeatToPlay = turnOrder[nextIdx];
  const ledSuit: Suit | null =
    ctx.inProgress.length > 0 ? suitOf(ctx.inProgress[0][1]) : null;
  const isLead = ctx.inProgress.length === 0;
  const trumpHolders = seatsHoldingTrump(mapToHandsArr(ctx.simHands), ctx.trumpSuit);

  if (nextSeatToPlay === ctx.callerSeat) {
    if (ctx.callerIndex >= ctx.callerOrder.length) return 0;
    const card = ctx.callerOrder[ctx.callerIndex];
    const hand = ctx.simHands.get(ctx.callerSeat) ?? [];
    if (!hand.includes(card)) return 0;
    const legal = legalPlays({
      hand,
      ledSuit,
      trumpSuit: ctx.trumpSuit,
      isLead,
      seatsWithTrumps: trumpHolders,
      seat: ctx.callerSeat,
    });
    if (!legal.includes(card)) return 0;
    return solveMinPoints({
      ...ctx,
      simHands: handRemove(ctx.simHands, ctx.callerSeat, card),
      callerIndex: ctx.callerIndex + 1,
      inProgress: [...ctx.inProgress, [ctx.callerSeat, card]],
    });
  }

  const otherHand = ctx.simHands.get(nextSeatToPlay) ?? [];
  if (otherHand.length === 0) return 0;
  const legal = legalPlays({
    hand: otherHand,
    ledSuit,
    trumpSuit: ctx.trumpSuit,
    isLead,
    seatsWithTrumps: trumpHolders,
    seat: nextSeatToPlay,
  });
  if (legal.length === 0) return 0;

  let best: number | null = null;
  for (const chosen of legal) {
    const v = solveMinPoints({
      ...ctx,
      simHands: handRemove(ctx.simHands, nextSeatToPlay, chosen),
      inProgress: [...ctx.inProgress, [nextSeatToPlay, chosen]],
    });
    if (best === null || v < best) best = v;
  }
  return best ?? 0;
};

// Adaptive per-world sweep — the honest reading of `∃σ_W` from
// [docs/specs/caps_formalism.md §5], as opposed to `orderSweepsWorld`'s
// fixed-order `∃O`. Within a fully-known world the caller chooses each
// card knowing what has been played, and every other seat — partner
// included, per §5's "V still cannot rely on partner choice" — plays
// adversarially.
//
// Used to verify the CSP's obligation predicate independently: if the
// CSP says obligated but some consistent world fails this, the CSP is
// unsound. See tools/puzzles/audit-obligation.ts.
export interface WorldSweepArgs {
  hands: ReadonlyMap<Seat, ReadonlyArray<CardId>>;
  callerSeat: Seat;
  leader: Seat;
  inProgress: ReadonlyArray<readonly [Seat, CardId]>;
  roundsRemaining: number;
  trumpSuit: Suit;
  pccPartnerOut?: Seat | null;
}

export const worldSweepsAdaptive = (args: WorldSweepArgs): boolean => {
  const pccOut = args.pccPartnerOut ?? null;
  const rec = (
    hands: Map<Seat, CardId[]>,
    leader: Seat,
    inProgress: Array<readonly [Seat, CardId]>,
    roundsRemaining: number,
  ): boolean => {
    if (roundsRemaining <= 0) return true;
    const order = roundTurnOrder(leader, pccOut);
    if (inProgress.length >= order.length) {
      const winner = roundWinner(inProgress, args.trumpSuit);
      if (teamOf(winner) !== teamOf(args.callerSeat)) return false;
      if (roundsRemaining === 1) return true;
      return rec(hands, winner, [], roundsRemaining - 1);
    }
    const seat = order[inProgress.length];
    const hand = hands.get(seat) ?? [];
    if (hand.length === 0) return false;
    const arr: ReadonlyArray<CardId>[] = [[], [], [], []];
    for (let i = 0; i < 4; i++) arr[i] = hands.get(SEATS_BY_INDEX[i]) ?? [];
    const legal = legalPlays({
      hand,
      ledSuit: inProgress.length > 0 ? suitOf(inProgress[0][1]) : null,
      trumpSuit: args.trumpSuit,
      isLead: inProgress.length === 0,
      seatsWithTrumps: seatsHoldingTrump(arr, args.trumpSuit),
      seat,
    });
    if (legal.length === 0) return false;
    const isCaller = seat === args.callerSeat;
    const inPlay = new Set<CardId>();
    for (const [, cs] of hands) for (const c of cs) inPlay.add(c);
    for (const [, c] of inProgress) inPlay.add(c);
    for (const c of reduceEquivalent(legal, hand, inPlay)) {
      const next = new Map(hands);
      next.set(seat, hand.filter(x => x !== c));
      const ok = rec(next, leader, [...inProgress, [seat, c] as const], roundsRemaining);
      if (isCaller) { if (ok) return true; }
      else if (!ok) return false;
    }
    return !isCaller;
  };
  const start = new Map<Seat, CardId[]>();
  for (const [s, cs] of args.hands) start.set(s, [...cs]);
  return rec(start, args.leader, [...args.inProgress], args.roundsRemaining);
};
