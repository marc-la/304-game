// B6 — DDS Monte Carlo. Ginsberg-GIB style:
//   1. Sample N consistent worlds from the bot's information set.
//   2. For each (legalPlay, world) pair, run full double-dummy from
//      this point assuming all four hands are known (the sampled world).
//      Score = +1 if our team wins ≥ 5 of the remaining rounds, else
//      −1 (round-majority proxy for stone outcome).
//   3. Pick the play with the highest mean score across the sample.
//
// Double-dummy here is a recursive maximizing search over the actual
// (sampled) deal. Transposition-cached on (hand-multiset, leader,
// in-progress).

import { pointsOf, suitOf } from '../card';
import type { CardId, Suit } from '../card';
import { buildInfoSet, enumerateWorlds } from '../info';
import { roundTurnOrder, roundWinner } from '../play';
import type { Seat } from '../seating';
import { teamOf, partnerSeat } from '../seating';
import {
  inProgressTuples,
  legalPlaysFor,
  stableSort,
} from './common';
import type { BotChoice, BotContext } from './types';

const SAMPLE_CAP = 8;            // 8 worlds × 8 candidates × DDS
const DDS_BUDGET = 20_000;       // nodes per call

interface DDState {
  hands: Map<Seat, CardId[]>;
  leader: Seat;
  trump: Suit;
  myTeam: ReturnType<typeof teamOf>;
  inProgress: Array<readonly [Seat, CardId]>;
  budget: { remaining: number };
}

const handKey = (hand: ReadonlyArray<CardId>): string =>
  [...hand].sort().join(',');

const stateKey = (s: DDState): string => {
  const parts: string[] = [];
  for (const seat of ['north', 'west', 'south', 'east'] as Seat[]) {
    parts.push(seat[0] + ':' + handKey(s.hands.get(seat) ?? []));
  }
  parts.push('l:' + s.leader);
  parts.push('p:' + s.inProgress.map(([se, c]) => se[0] + c).join('|'));
  return parts.join(';');
};

// Maximize: number of remaining tricks won by `myTeam`. The seat to
// play is determined by leader + length(inProgress). Each seat chooses
// the play that is best for *their* team — this is the standard
// double-dummy assumption (perfect play by all sides on a known deal).
const dds = (
  s: DDState,
  cache: Map<string, number>,
): number => {
  if (s.budget.remaining <= 0) {
    // Budget exhausted: conservative estimate = 0 future tricks for me.
    return 0;
  }
  s.budget.remaining--;

  const order = roundTurnOrder(s.leader, null);
  // If all hands are empty, no more tricks.
  const totalCards = order.reduce(
    (acc, seat) => acc + (s.hands.get(seat)?.length ?? 0),
    0,
  );
  if (totalCards === 0) return 0;

  const seatToPlay = order[s.inProgress.length];
  const hand = s.hands.get(seatToPlay) ?? [];
  if (hand.length === 0) return 0;

  const k = stateKey(s);
  const memo = cache.get(k);
  if (memo !== undefined) return memo;

  // Compute legal plays for seatToPlay in this state.
  const ledSuit = s.inProgress.length > 0 ? suitOf(s.inProgress[0][1]) : null;
  let legal: CardId[];
  if (ledSuit === null) {
    legal = [...hand];
  } else {
    const matches = hand.filter(c => suitOf(c) === ledSuit);
    legal = matches.length > 0 ? matches : [...hand];
  }
  legal.sort(); // determinism

  const playForMyTeam = teamOf(seatToPlay) === s.myTeam;
  let best = playForMyTeam ? -Infinity : Infinity;

  for (const card of legal) {
    const newInProgress: Array<readonly [Seat, CardId]> = [
      ...s.inProgress,
      [seatToPlay, card],
    ];
    let nextLeader = s.leader;
    let value: number;
    if (newInProgress.length === order.length) {
      // Round resolves.
      const winner = roundWinner(newInProgress, s.trump);
      const wonByMe = teamOf(winner) === s.myTeam ? 1 : 0;
      const newHands = new Map<Seat, CardId[]>();
      for (const [se, cs] of s.hands) newHands.set(se, [...cs]);
      const h = newHands.get(seatToPlay)!;
      const idx = h.indexOf(card);
      if (idx >= 0) h.splice(idx, 1);
      nextLeader = winner;
      const sub: DDState = {
        ...s,
        hands: newHands,
        leader: nextLeader,
        inProgress: [],
      };
      value = wonByMe + dds(sub, cache);
    } else {
      const newHands = new Map<Seat, CardId[]>();
      for (const [se, cs] of s.hands) newHands.set(se, [...cs]);
      const h = newHands.get(seatToPlay)!;
      const idx = h.indexOf(card);
      if (idx >= 0) h.splice(idx, 1);
      const sub: DDState = {
        ...s,
        hands: newHands,
        inProgress: newInProgress,
      };
      value = dds(sub, cache);
    }
    if (playForMyTeam) {
      if (value > best) best = value;
    } else {
      if (value < best) best = value;
    }
  }
  if (best === -Infinity || best === Infinity) best = 0;
  cache.set(k, best);
  return best;
};

interface Sample {
  hands: Map<Seat, CardId[]>;
}

const sampleWorlds = (ctx: BotContext, cap: number): Sample[] => {
  const info = buildInfoSet(ctx.state, ctx.seat);
  const out: Sample[] = [];
  for (const w of enumerateWorlds(info, { maxWorlds: cap })) {
    const hands = new Map<Seat, CardId[]>();
    for (const [s, cs] of w.hands) hands.set(s, [...cs]);
    out.push({ hands });
    if (out.length >= cap) break;
  }
  return out;
};

export const chooseDDSMC = (ctx: BotContext): BotChoice => {
  const legal = stableSort(legalPlaysFor(ctx.state, ctx.seat, ctx.hand));
  if (legal.length === 0) throw new Error('B6: no legal plays');
  if (legal.length === 1) return { card: legal[0] };

  const samples = sampleWorlds(ctx, SAMPLE_CAP);
  if (samples.length === 0) return { card: legal[0] };

  const trump = ctx.state.trump.trumpSuit;
  const myTeam = teamOf(ctx.seat);
  const leader = ctx.state.play.priority;
  const inProg = inProgressTuples(ctx.state);

  let bestCard: CardId | null = null;
  let bestScore = -Infinity;

  for (const c of legal) {
    let total = 0;
    for (const sample of samples) {
      const hands = new Map<Seat, CardId[]>();
      for (const [s, cs] of sample.hands) {
        hands.set(s, s === ctx.seat ? [...ctx.hand] : [...cs]);
      }
      // Apply our candidate now: it adds to in-progress; if it
      // completes the round, resolve immediately.
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
      const future = dds(dd, cache);
      total += preWonByMe + future;
    }
    const mean = total / samples.length;
    if (mean > bestScore) {
      bestScore = mean;
      bestCard = c;
    }
  }

  return { card: bestCard ?? legal[0] };
};

// silence unused imports
void pointsOf;
void partnerSeat;
