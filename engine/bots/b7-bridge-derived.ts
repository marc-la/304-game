// B7 — Bridge-derived (spike). Adapted from the GIB (Ginsberg 2001)
// single-dummy expectation-search idea:
//
//   1. Sample N consistent worlds (info-set sampling).
//   2. For each world, run double-dummy with the bot's *team* as the
//      maximizer (not just the seat). 304 is a partnership game.
//   3. Differentiator vs B6: world *re-sampling* between candidates —
//      each candidate sees a deterministic-but-disjoint slice of the
//      world enumeration rather than the shared set. Trades cache
//      sharing for sample diversity.
//
// The hot inner loop (alpha-beta, bitmask hands, killer + TT) lives in
// `dds-core.ts` and is shared with B6.
//
// Reference: Frank, Basin & Bundy (1992) "Single-dummy bridge
// problem"; Ginsberg (2001) "GIB: Imperfect information in a
// computationally challenging game", JAIR 14.

import { suitOf } from '../card';
import type { CardId, Suit } from '../card';
import { buildInfoSet, enumerateWorlds } from '../info';
import { SEAT_INDEX, teamOf } from '../seating';
import {
  inProgressTuples,
  legalPlaysFor,
  stableSort,
} from './common';
import {
  cardToIdx,
  evalDDS,
  seatIdx,
  worldHandsToMasks,
} from './dds-core';
import type { BotChoice, BotContext } from './types';

const SAMPLES_PER_CANDIDATE = 4;
const DDS_BUDGET = 150_000;

const SUIT_TO_IDX: Record<Suit, number> = { c: 0, d: 1, h: 2, s: 3 };
const NEXT_SEAT_IDX = [1, 2, 3, 0];

interface Sample {
  // Indexed by SEAT_INDEX; matches World.hands shape so the sampler
  // can hand it through without copying.
  hands: ReadonlyArray<ReadonlyArray<CardId>>;
}

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
    out.push({ hands: w.hands });
    if (out.length >= cap) break;
  }
  return out;
};

const resolveTrick = (
  cards: ReadonlyArray<number>,
  leaderIdx: number,
  ledSuitIdx: number,
  trumpSuitIdx: number,
): number => {
  let bestSeat = leaderIdx;
  const c0 = cards[0];
  let bestPow = c0 & 7;
  let bestIsTrump = (c0 >> 3) === trumpSuitIdx;
  let seat = leaderIdx;
  for (let i = 1; i < cards.length; i++) {
    seat = NEXT_SEAT_IDX[seat];
    const c = cards[i];
    const csuit = c >> 3;
    const cpow = c & 7;
    const isTrump = csuit === trumpSuitIdx;
    if (bestIsTrump) {
      if (isTrump && cpow < bestPow) {
        bestSeat = seat;
        bestPow = cpow;
      }
    } else if (isTrump) {
      bestSeat = seat;
      bestPow = cpow;
      bestIsTrump = true;
    } else if (csuit === ledSuitIdx && cpow < bestPow) {
      bestSeat = seat;
      bestPow = cpow;
    }
  }
  return bestSeat;
};

export const chooseBridgeDerived = (ctx: BotContext): BotChoice => {
  const legal = stableSort(legalPlaysFor(ctx.state, ctx.seat, ctx.hand));
  if (legal.length === 0) throw new Error('B7: no legal plays');
  if (legal.length === 1) return { card: legal[0] };

  const trumpSuit = ctx.state.trump.trumpSuit;
  const trumpSuitIdx = SUIT_TO_IDX[trumpSuit];
  const myTeam = teamOf(ctx.seat);
  const leader = ctx.state.play.priority;
  const leaderIdx = seatIdx(leader);
  const mySeatIdx = seatIdx(ctx.seat);

  const inProg = inProgressTuples(ctx.state);
  const inProgCardsIdx = inProg.map(([, c]) => cardToIdx(c));
  const ledSuitFromInProg: Suit | null =
    inProg.length > 0 ? suitOf(inProg[0][1]) : null;

  let bestCard: CardId | null = null;
  let bestScore = -Infinity;

  for (let ci = 0; ci < legal.length; ci++) {
    const candidate = legal[ci];
    const candIdx = cardToIdx(candidate);
    const ledSuit: Suit = ledSuitFromInProg ?? suitOf(candidate);
    const ledSuitIdx = SUIT_TO_IDX[ledSuit];

    // Fresh, disjoint world slice per candidate.
    const samples = sampleFresh(
      ctx,
      SAMPLES_PER_CANDIDATE,
      ci * SAMPLES_PER_CANDIDATE,
    );
    if (samples.length === 0) {
      if (bestCard === null) bestCard = candidate;
      continue;
    }

    let total = 0;
    for (const sample of samples) {
      const handsForWorld: ReadonlyArray<CardId>[] = [
        sample.hands[0] ?? [],
        sample.hands[1] ?? [],
        sample.hands[2] ?? [],
        sample.hands[3] ?? [],
      ];
      handsForWorld[SEAT_INDEX[ctx.seat]] = ctx.hand;
      const hands = worldHandsToMasks(handsForWorld);
      hands[mySeatIdx] = (hands[mySeatIdx] & ~(1 << candIdx)) >>> 0;

      const trickCards = inProgCardsIdx.slice();
      trickCards.push(candIdx);

      let preWon = 0;
      let nextLeaderIdx = leaderIdx;
      let nextLedSuit: number;
      let nextTrickCards: number[];

      if (trickCards.length === 4) {
        const winnerIdx = resolveTrick(
          trickCards, leaderIdx, ledSuitIdx, trumpSuitIdx,
        );
        const winnerTeam =
          winnerIdx === 0 || winnerIdx === 2 ? 'team_a' : 'team_b';
        if (winnerTeam === myTeam) preWon = 1;
        nextLeaderIdx = winnerIdx;
        nextTrickCards = [];
        nextLedSuit = -1;
      } else {
        nextTrickCards = trickCards;
        nextLedSuit = ledSuitIdx;
      }

      // Per-candidate fresh cache (worlds differ across candidates, so
      // sharing wouldn't help).
      const { tricksByMyTeam } = evalDDS(
        {
          hands,
          trickCards: nextTrickCards,
          leader: nextLeaderIdx,
          ledSuit: nextLedSuit,
        },
        { trumpSuit, myTeam, budget: DDS_BUDGET },
      );
      total += preWon + tricksByMyTeam;
    }

    const mean = total / samples.length;
    if (mean > bestScore) {
      bestScore = mean;
      bestCard = candidate;
    }
  }

  return { card: bestCard ?? legal[0] };
};
