// B2 — Memo High-Low. Like B1 but tracks which cards in the suit are
// already played. Two upgrades over B1:
//   1. If a candidate is the unambiguous high-of-suit AND will be left
//      to lead a future trick, the bot saves a cheaper alternative for
//      this trick.
//   2. If sluffing in a suit where a star is still out, prefer to
//      sluff lowest-power so partner/opp can't read which star you hold.

import { pointsOf, powerOf, rankOf, suitOf, PACK } from '../card';
import type { CardId, Rank, Suit } from '../card';
import { teamOf } from '../seating';
import {
  inProgressTuples,
  legalPlaysFor,
  lowestByPoints,
  partnerWinningSnapshot,
  stableSort,
  wouldWinSnapshot,
} from './common';
import type { BotChoice, BotContext } from './types';

const STAR_RANKS = new Set<Rank>(['J', '9', 'A']);

const playedCards = (ctx: BotContext): Set<CardId> => {
  const out = new Set<CardId>();
  for (const r of ctx.state.play.completedRounds) {
    for (const e of r.cards) {
      if (e.card !== null && !e.faceDown) out.add(e.card);
      else if (e.card !== null && e.revealed) out.add(e.card);
    }
  }
  for (const e of ctx.state.play.currentRound) {
    if (e.card !== null && !e.faceDown) out.add(e.card);
  }
  return out;
};

// All cards of suit `s` that are not yet known to be out of play AND
// not in our own hand AND not the folded trump card known to us.
const remainingInSuit = (
  ctx: BotContext,
  s: Suit,
): CardId[] => {
  const played = playedCards(ctx);
  const own = new Set<CardId>(ctx.hand);
  const out: CardId[] = [];
  for (const c of PACK) {
    if (suitOf(c) !== s) continue;
    if (played.has(c)) continue;
    if (own.has(c)) continue;
    out.push(c);
  }
  return out;
};

// Strictly stronger than every other unseen card of its suit?
const isUnambiguousHigh = (
  candidate: CardId,
  ctx: BotContext,
): boolean => {
  const others = remainingInSuit(ctx, suitOf(candidate));
  return others.every(c => powerOf(candidate) < powerOf(c));
};

export const chooseMemoHighLow = (ctx: BotContext): BotChoice => {
  const legal = stableSort(legalPlaysFor(ctx.state, ctx.seat, ctx.hand));
  if (legal.length === 0) throw new Error('B2: no legal plays');
  if (legal.length === 1) return { card: legal[0] };

  const inProg = inProgressTuples(ctx.state);
  void teamOf; // silence unused if narrowed later

  // Partner already winning → sluff lowest-points; among ties, prefer
  // a non-star.
  if (inProg.length > 0 && partnerWinningSnapshot(ctx.state, ctx.seat)) {
    const ranked = [...legal].sort((a, b) => {
      const aStar = STAR_RANKS.has(rankOf(a)) ? 1 : 0;
      const bStar = STAR_RANKS.has(rankOf(b)) ? 1 : 0;
      return (
        pointsOf(a) - pointsOf(b) ||
        aStar - bStar ||
        powerOf(b) - powerOf(a)
      );
    });
    return { card: ranked[0] };
  }

  // Leading: lead low non-star; if we hold an unambiguous high in a
  // suit, save it for a later round (avoid leading it).
  if (inProg.length === 0) {
    const nonStarsNonHigh = legal.filter(
      c => !STAR_RANKS.has(rankOf(c)) && !isUnambiguousHigh(c, ctx),
    );
    if (nonStarsNonHigh.length > 0) {
      return { card: lowestByPoints(nonStarsNonHigh) };
    }
    return { card: lowestByPoints(legal) };
  }

  // Try to win cheaply. Prefer non-stars; among winners, take the
  // cheapest.
  const winners = legal.filter(c => wouldWinSnapshot(c, ctx.state, ctx.seat));
  if (winners.length > 0) {
    const nonStarWinners = winners.filter(c => !STAR_RANKS.has(rankOf(c)));
    const pool = nonStarWinners.length > 0 ? nonStarWinners : winners;
    return { card: lowestByPoints(pool) };
  }
  return { card: lowestByPoints(legal) };
};
