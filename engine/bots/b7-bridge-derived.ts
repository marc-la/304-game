// B7 — Bridge-derived (spike). Adapted from the GIB (Ginsberg 2001)
// single-dummy expectation-search idea:
//
//   1. Sample N consistent worlds (info-set sampling).
//   2. For each world, run double-dummy with the bot's *team* as the
//      maximizer (not just the seat), since 304 is a partnership game
//      and B6's per-seat alpha-beta already gets this right.
//   3. Differentiator vs B6: world *re-sampling* between candidates
//      (each candidate gets fresh worlds rather than the shared set)
//      and a move ordering that explores high-power cards first to
//      improve transposition cache hits.
//
// Time-boxed spike — kept compact. Reference: Frank, Basin & Bundy
// (1992) "Single-dummy bridge problem"; Ginsberg (2001) "GIB: Imperfect
// information in a computationally challenging game", JAIR 14.

import { powerOf, suitOf } from '../card';
import type { CardId, Suit } from '../card';
import { buildInfoSet, enumerateWorlds } from '../info';
import { roundTurnOrder, roundWinner } from '../play';
import type { Seat } from '../seating';
import { teamOf } from '../seating';
import {
  inProgressTuples,
  legalPlaysFor,
  stableSort,
} from './common';
import type { BotChoice, BotContext } from './types';

const SAMPLES_PER_CANDIDATE = 4;
const DDS_BUDGET = 12_000;

interface Sample {
  hands: Map<Seat, CardId[]>;
}

interface DDState {
  hands: Map<Seat, CardId[]>;
  leader: Seat;
  trump: Suit;
  myTeam: ReturnType<typeof teamOf>;
  inProgress: Array<readonly [Seat, CardId]>;
  budget: { remaining: number };
}

const handKey = (h: ReadonlyArray<CardId>): string => [...h].sort().join(',');

const stateKey = (s: DDState): string => {
  const seats: Seat[] = ['north', 'west', 'south', 'east'];
  return (
    seats.map(se => se[0] + ':' + handKey(s.hands.get(se) ?? [])).join(';') +
    '|l:' + s.leader +
    '|p:' + s.inProgress.map(([se, c]) => se[0] + c).join('+')
  );
};

const legalAt = (
  hand: ReadonlyArray<CardId>,
  inProgress: ReadonlyArray<readonly [Seat, CardId]>,
): CardId[] => {
  if (inProgress.length === 0) {
    // Bridge-derived ordering: lead lowest first to test the "give
    // up" branch quickly, opens the alpha-beta cut early.
    return [...hand].sort((a, b) => powerOf(b) - powerOf(a));
  }
  const ledSuit = suitOf(inProgress[0][1]);
  const matches = hand.filter(c => suitOf(c) === ledSuit);
  const pool = matches.length > 0 ? matches : [...hand];
  // Highest power first: better alpha-beta because likely-winning
  // moves prune more cheaply.
  return pool.sort((a, b) => powerOf(a) - powerOf(b));
};

const dds = (
  s: DDState,
  cache: Map<string, number>,
): number => {
  if (s.budget.remaining <= 0) return 0;
  s.budget.remaining--;

  const order = roundTurnOrder(s.leader, null);
  const total = order.reduce(
    (acc, se) => acc + (s.hands.get(se)?.length ?? 0),
    0,
  );
  if (total === 0) return 0;
  const seat = order[s.inProgress.length];
  const hand = s.hands.get(seat) ?? [];
  if (hand.length === 0) return 0;

  const k = stateKey(s);
  const memo = cache.get(k);
  if (memo !== undefined) return memo;

  const playForMe = teamOf(seat) === s.myTeam;
  let best = playForMe ? -Infinity : Infinity;

  for (const card of legalAt(hand, s.inProgress)) {
    const newInProg: Array<readonly [Seat, CardId]> = [
      ...s.inProgress,
      [seat, card],
    ];
    const newHands = new Map<Seat, CardId[]>();
    for (const [se, cs] of s.hands) newHands.set(se, [...cs]);
    const h = newHands.get(seat)!;
    const idx = h.indexOf(card);
    if (idx >= 0) h.splice(idx, 1);

    let value: number;
    if (newInProg.length === order.length) {
      const winner = roundWinner(newInProg, s.trump);
      const wonByMe = teamOf(winner) === s.myTeam ? 1 : 0;
      value = wonByMe + dds(
        { ...s, hands: newHands, leader: winner, inProgress: [] },
        cache,
      );
    } else {
      value = dds(
        { ...s, hands: newHands, inProgress: newInProg },
        cache,
      );
    }
    if (playForMe) {
      if (value > best) best = value;
    } else {
      if (value < best) best = value;
    }
  }
  if (best === -Infinity || best === Infinity) best = 0;
  cache.set(k, best);
  return best;
};

const sampleFresh = (
  ctx: BotContext,
  cap: number,
  offset: number,
): Sample[] => {
  const info = buildInfoSet(ctx.state, ctx.seat);
  const out: Sample[] = [];
  let i = 0;
  for (const w of enumerateWorlds(info, { maxWorlds: cap + offset })) {
    if (i++ < offset) continue;
    const hands = new Map<Seat, CardId[]>();
    for (const [s, cs] of w.hands) hands.set(s, [...cs]);
    out.push({ hands });
    if (out.length >= cap) break;
  }
  return out;
};

export const chooseBridgeDerived = (ctx: BotContext): BotChoice => {
  const legal = stableSort(legalPlaysFor(ctx.state, ctx.seat, ctx.hand));
  if (legal.length === 0) throw new Error('B7: no legal plays');
  if (legal.length === 1) return { card: legal[0] };

  const trump = ctx.state.trump.trumpSuit;
  const myTeam = teamOf(ctx.seat);
  const leader = ctx.state.play.priority;
  const inProg = inProgressTuples(ctx.state);

  let bestCard: CardId | null = null;
  let bestScore = -Infinity;

  for (let ci = 0; ci < legal.length; ci++) {
    const c = legal[ci];
    // Fresh sample per candidate (the GIB-style differentiator).
    const samples = sampleFresh(
      ctx,
      SAMPLES_PER_CANDIDATE,
      ci * SAMPLES_PER_CANDIDATE,
    );
    if (samples.length === 0) {
      // Cannot sample; fall back to a cheap score (0).
      if (bestCard === null) bestCard = c;
      continue;
    }

    let total = 0;
    for (const sample of samples) {
      const hands = new Map<Seat, CardId[]>();
      for (const [s, cs] of sample.hands) {
        hands.set(s, s === ctx.seat ? [...ctx.hand] : [...cs]);
      }
      let newInProg: Array<readonly [Seat, CardId]> = [
        ...inProg,
        [ctx.seat, c],
      ];
      const myHand = hands.get(ctx.seat)!;
      const idx = myHand.indexOf(c);
      if (idx >= 0) myHand.splice(idx, 1);

      let nextLeader = leader;
      let preWonByMe = 0;
      const order = roundTurnOrder(leader, null);
      if (newInProg.length === order.length) {
        const winner = roundWinner(newInProg, trump);
        if (teamOf(winner) === myTeam) preWonByMe = 1;
        nextLeader = winner;
        newInProg = [];
      }

      const dd: DDState = {
        hands,
        leader: nextLeader,
        trump,
        myTeam,
        inProgress: newInProg,
        budget: { remaining: DDS_BUDGET },
      };
      const cache = new Map<string, number>();
      total += preWonByMe + dds(dd, cache);
    }
    const mean = total / samples.length;
    if (mean > bestScore) {
      bestScore = mean;
      bestCard = c;
    }
  }

  return { card: bestCard ?? legal[0] };
};
