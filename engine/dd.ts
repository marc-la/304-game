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
import { teamOf } from './seating';
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

export const orderSweepsWorld = (args: OrderSweepsArgs): boolean => {
  const simHands = new Map<Seat, CardId[]>();
  for (const [seat, cards] of args.world.hands) simHands.set(seat, [...cards]);
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
  const simHands = new Map<Seat, CardId[]>();
  for (const [seat, cards] of args.world.hands) simHands.set(seat, [...cards]);
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
  const trumpHolders = seatsHoldingTrump(ctx.simHands, ctx.trumpSuit);

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

  for (const chosen of legal) {
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
  const trumpHolders = seatsHoldingTrump(ctx.simHands, ctx.trumpSuit);

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
