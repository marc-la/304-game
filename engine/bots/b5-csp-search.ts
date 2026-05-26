// B5 — CSP-search. Two-ply expectimax over a small sample of
// consistent worlds with a caps-aware override: if the bot is the
// trumper's team and caps is currently obligated for this seat, the
// bot plays the first card of a witness line found by the engine's
// CSP solver — i.e. it always knows the caps line when one exists.
//
// Non-caps positions: deterministic 2-ply lookahead (this round +
// the next round, both projected via greedyFollow), averaged across
// sampled worlds.

import { pointsOf, suitOf } from '../card';
import type { CardId, Suit } from '../card';
import { checkCapsObligation } from '../caps';
import { findWitnessLine } from '../caps-csp';
import { buildInfoSet, enumerateWorlds } from '../info';
import { roundTurnOrder, roundWinner } from '../play';
import type { Seat } from '../seating';
import { SEATS_BY_INDEX, teamOf } from '../seating';
import {
  inProgressTuples,
  legalPlaysFor,
  stableSort,
} from './common';
import type { BotChoice, BotContext } from './types';

const SAMPLE_CAP = 16;

interface Sample {
  hands: Map<Seat, CardId[]>;
}

const sampleWorlds = (ctx: BotContext, cap: number): Sample[] => {
  const info = buildInfoSet(ctx.state, ctx.seat);
  const out: Sample[] = [];
  for (const w of enumerateWorlds(info, { maxWorlds: cap })) {
    // B5 mutates per-seat hands during the 2-ply projection, so we
    // copy into a Map<Seat, CardId[]> keyed by seat (matches projectTrick).
    const hands = new Map<Seat, CardId[]>();
    for (let i = 0; i < 4; i++) {
      const cs = w.hands[i];
      if (cs !== undefined) hands.set(SEATS_BY_INDEX[i], [...cs]);
    }
    out.push({ hands });
    if (out.length >= cap) break;
  }
  return out;
};

const followChoice = (
  hand: ReadonlyArray<CardId>,
  ledSuit: Suit,
  trump: Suit,
  partnerWins: boolean,
): CardId => {
  const matches = hand.filter(c => suitOf(c) === ledSuit);
  if (matches.length > 0) {
    if (partnerWins) {
      return [...matches].sort((a, b) => pointsOf(a) - pointsOf(b))[0];
    }
    return [...matches].sort((a, b) => pointsOf(b) - pointsOf(a))[0];
  }
  const nonTrump = hand.filter(c => suitOf(c) !== trump);
  if (nonTrump.length > 0) {
    return [...nonTrump].sort((a, b) => pointsOf(a) - pointsOf(b))[0];
  }
  return [...hand].sort((a, b) => pointsOf(a) - pointsOf(b))[0];
};

const leadChoice = (
  hand: ReadonlyArray<CardId>,
  trump: Suit,
): CardId => {
  const nonTrump = hand.filter(c => suitOf(c) !== trump);
  if (nonTrump.length > 0) {
    return [...nonTrump].sort((a, b) => pointsOf(b) - pointsOf(a))[0];
  }
  return [...hand].sort((a, b) => pointsOf(a) - pointsOf(b))[0];
};

// Project a single trick to completion using greedyFollow for all
// remaining seats. Returns (winnerSeat, points, handsAfter).
const projectTrick = (
  startInProg: Array<readonly [Seat, CardId]>,
  myCandidate: { seat: Seat; card: CardId } | null,
  hands: Map<Seat, CardId[]>,
  leader: Seat,
  trump: Suit,
): { winner: Seat; points: number; handsAfter: Map<Seat, CardId[]> } => {
  const order = roundTurnOrder(leader, null);
  const round: Array<readonly [Seat, CardId]> = [...startInProg];
  if (myCandidate !== null) round.push([myCandidate.seat, myCandidate.card]);
  const played = new Set(round.map(([s]) => s));

  const handsAfter = new Map<Seat, CardId[]>();
  for (const [s, cs] of hands) handsAfter.set(s, [...cs]);
  if (myCandidate !== null) {
    const h = handsAfter.get(myCandidate.seat)!;
    const idx = h.indexOf(myCandidate.card);
    if (idx >= 0) h.splice(idx, 1);
  }

  for (const seat of order) {
    if (played.has(seat)) continue;
    const hand = handsAfter.get(seat) ?? [];
    let card: CardId;
    if (round.length === 0) {
      card = leadChoice(hand, trump);
    } else {
      const ledSuit = suitOf(round[0][1]);
      const winnerNow = roundWinner(round, trump);
      const partnerWins =
        teamOf(winnerNow) === teamOf(seat) && winnerNow !== seat;
      card = followChoice(hand, ledSuit, trump, partnerWins);
    }
    round.push([seat, card]);
    const idx = hand.indexOf(card);
    if (idx >= 0) hand.splice(idx, 1);
  }

  const winner = roundWinner(round, trump);
  const points = round.reduce((s, [, c]) => s + pointsOf(c), 0);
  return { winner, points, handsAfter };
};

const evaluate2Ply = (
  ctx: BotContext,
  candidate: CardId,
  sample: Sample,
): number => {
  const trump = ctx.state.trump.trumpSuit;
  const myTeam = teamOf(ctx.seat);

  // Ensure the sample's view of own hand reflects ctx.hand (W5 should
  // do this but we defend).
  const hands = new Map<Seat, CardId[]>();
  for (const [s, cs] of sample.hands) {
    hands.set(s, s === ctx.seat ? [...ctx.hand] : [...cs]);
  }

  const inProg = inProgressTuples(ctx.state);
  const t1 = projectTrick(
    inProg,
    { seat: ctx.seat, card: candidate },
    hands,
    ctx.state.play.priority,
    trump,
  );

  let score = teamOf(t1.winner) === myTeam ? +t1.points : -t1.points;

  // 2nd ply: if we (or partner) won, we lead with leadChoice; project
  // one more trick.
  if (t1.handsAfter.get(ctx.seat)!.length > 0) {
    const t2 = projectTrick(
      [],
      null,
      t1.handsAfter,
      t1.winner,
      trump,
    );
    score += teamOf(t2.winner) === myTeam ? +t2.points : -t2.points;
  }

  return score;
};

export const chooseCSPSearch = (ctx: BotContext): BotChoice => {
  const legal = stableSort(legalPlaysFor(ctx.state, ctx.seat, ctx.hand));
  if (legal.length === 0) throw new Error('B5: no legal plays');
  if (legal.length === 1) return { card: legal[0] };

  // Caps-aware: if we are caps-obligated now, play the witness's first
  // card (when one fits a legal play).
  try {
    if (checkCapsObligation(ctx.state, ctx.seat)) {
      const witness = findWitnessLine(ctx.state, ctx.seat);
      if (witness !== null && witness.length > 0) {
        const first = witness[0];
        if (legal.includes(first)) return { card: first };
      }
    }
  } catch {
    // Predicate failed (e.g. world enumeration aborted); fall through.
  }

  const samples = sampleWorlds(ctx, SAMPLE_CAP);
  if (samples.length === 0) {
    return { card: legal[0] };
  }

  let bestCard: CardId | null = null;
  let bestEV = -Infinity;
  for (const c of legal) {
    let ev = 0;
    for (const s of samples) ev += evaluate2Ply(ctx, c, s);
    ev /= samples.length;
    if (ev > bestEV) {
      bestEV = ev;
      bestCard = c;
    }
  }
  return { card: bestCard ?? legal[0] };
};
