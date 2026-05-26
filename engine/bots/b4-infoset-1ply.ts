// B4 — InfoSet 1-Ply. Builds the bot's information set, samples a
// small number of consistent worlds, evaluates each legal play's
// expected round-points yield (1 ply: this trick only), picks the play
// with the best EV from the bot's team's perspective.
//
// Why 1 ply: the round being resolved is the only quantity that
// changes monotonically and can be evaluated cheaply on a sampled
// world (we just simulate the remaining seats' best legal plays
// using a simple greedy). Deeper search lives in B5/B6.

import { pointsOf, suitOf } from '../card';
import type { CardId, Suit } from '../card';
import { buildInfoSet, enumerateWorlds } from '../info';
import { roundTurnOrder, roundWinner } from '../play';
import type { Seat } from '../seating';
import { SEATS_BY_INDEX, teamOf } from '../seating';
import {
  inProgressTuples,
  legalPlaysFor,
  partnerWinningSnapshot,
  stableSort,
} from './common';
import type { BotChoice, BotContext } from './types';

const SAMPLE_CAP = 32;

interface Sample {
  // World-projected hands for the seats we don't see. Includes the
  // bot's own seat for uniformity.
  hands: Map<Seat, CardId[]>;
}

const sampleWorlds = (
  ctx: BotContext,
  cap: number,
): Sample[] => {
  const info = buildInfoSet(ctx.state, ctx.seat);
  const out: Sample[] = [];
  for (const w of enumerateWorlds(info, { maxWorlds: cap })) {
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

// Imagined-opponent / partner policy when projecting one ply. We want
// the highest-power matching card when trying to win, lowest-points
// when partner already wins.
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

const evaluatePlay = (
  ctx: BotContext,
  candidate: CardId,
  sample: Sample,
): number => {
  // EV = +points if my team wins the trick, −points if not.
  const trump = ctx.state.trump.trumpSuit;
  const inProg = inProgressTuples(ctx.state);
  const order = roundTurnOrder(ctx.state.play.priority, null);
  const myTeam = teamOf(ctx.seat);

  // Build the synthetic round: existing in-progress + our candidate +
  // remaining seats playing greedyFollow on this sampled world.
  const synthetic: Array<readonly [Seat, CardId]> = [...inProg];
  synthetic.push([ctx.seat, candidate]);

  // Determine who still needs to play (anyone in `order` whose seat
  // hasn't appeared yet).
  const played = new Set(synthetic.map(([s]) => s));
  for (const seat of order) {
    if (played.has(seat)) continue;
    const hand = [...(sample.hands.get(seat) ?? [])];
    // For the bot's own seat we use ctx.hand minus the candidate.
    // (Sampling may have set ctx.seat's hand to ctx.hand already
    // by virtue of W5 — but we defensively reset here.)
    const handForSim = seat === ctx.seat
      ? ctx.hand.filter(c => c !== candidate)
      : hand;
    const ledSuit = suitOf(synthetic[0][1]);
    const winner = roundWinner(synthetic, trump);
    const partnerWins =
      teamOf(winner) === teamOf(seat) && winner !== seat;
    const card = followChoice(handForSim, ledSuit, trump, partnerWins);
    synthetic.push([seat, card]);
  }

  const winner = roundWinner(synthetic, trump);
  const points = synthetic.reduce((s, [, c]) => s + pointsOf(c), 0);
  return teamOf(winner) === myTeam ? +points : -points;
};

export const chooseInfoSet1Ply = (ctx: BotContext): BotChoice => {
  const legal = stableSort(legalPlaysFor(ctx.state, ctx.seat, ctx.hand));
  if (legal.length === 0) throw new Error('B4: no legal plays');
  if (legal.length === 1) return { card: legal[0] };

  const samples = sampleWorlds(ctx, SAMPLE_CAP);

  // No samples — fall back to a simple rule.
  if (samples.length === 0) {
    if (partnerWinningSnapshot(ctx.state, ctx.seat)) {
      return { card: [...legal].sort((a, b) => pointsOf(a) - pointsOf(b))[0] };
    }
    return { card: legal[0] };
  }

  let bestCard: CardId | null = null;
  let bestEV = -Infinity;
  for (const c of legal) {
    let ev = 0;
    for (const s of samples) ev += evaluatePlay(ctx, c, s);
    ev /= samples.length;
    if (ev > bestEV) {
      bestEV = ev;
      bestCard = c;
    }
  }
  return { card: bestCard ?? legal[0] };
};
