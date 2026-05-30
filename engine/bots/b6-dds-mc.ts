// B6 — DDS Monte Carlo. Ginsberg-GIB style:
//   1. Sample N consistent worlds from the bot's information set.
//   2. For each (legalPlay, world) pair, run full double-dummy from
//      this point assuming all four hands are known (the sampled world).
//      Score = total card-points won by our team across remaining
//      tricks (304 is decided on points; see dds-core header).
//   3. Pick the play with the highest mean score across the sample.
//
// The heavy lifting (alpha-beta, bitmask hands, transposition table,
// move ordering, killer heuristic) lives in `dds-core.ts`. B6's
// distinguishing trait is that all candidate moves are scored against
// the *same* sampled world set, which lets the TT be shared across
// candidates within a world — its main per-bot speedup over B7.

import { pointsOf, suitOf } from '../card';
import type { CardId, Suit } from '../card';
import { checkCapsObligation } from '../caps';
import { findWitnessLine } from '../caps-csp';
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

const SAMPLE_CAP = 8;
const DDS_BUDGET = 200_000;

const SUIT_TO_IDX: Record<Suit, number> = { c: 0, d: 1, h: 2, s: 3 };
const NEXT_SEAT_IDX = [1, 2, 3, 0]; // anticlockwise N→W→S→E→N

interface Sample {
  // Indexed by SEAT_INDEX; matches World.hands shape directly so the
  // sampler can hand it through without copying.
  hands: ReadonlyArray<ReadonlyArray<CardId>>;
}

const sampleWorlds = (ctx: BotContext, cap: number): Sample[] => {
  const info = buildInfoSet(ctx.state, ctx.seat);
  const out: Sample[] = [];
  for (const w of enumerateWorlds(info, { maxWorlds: cap })) {
    out.push({ hands: w.hands });
    if (out.length >= cap) break;
  }
  return out;
};

// Winner of a complete 4-card trick, given the leader seat. Mirrors
// engine/play.ts:roundWinner using packed card-idx encoding.
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

export const chooseDDSMC = (ctx: BotContext): BotChoice => {
  const legal = stableSort(legalPlaysFor(ctx.state, ctx.seat, ctx.hand));
  if (legal.length === 0) throw new Error('B6: no legal plays');
  if (legal.length === 1) return { card: legal[0] };

  // Caps-aware: when our team is caps-obligated and a witness line
  // exists, play the witness's first card. The DDS itself doesn't
  // model caps, so without this override B6 routinely fluffs caps
  // positions B5 nails by construction. Mirrors B5's override.
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
  if (samples.length === 0) return { card: legal[0] };

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

  // Per-world base hand-bitmasks (with our seat's hand pinned to
  // ctx.hand, overriding what the world sampler put there) + a shared
  // TT cache (re-used across all candidates in the same world).
  const worldStates: Array<{
    handsMask: Uint32Array;
    cache: Map<string, number>;
  }> = samples.map(sample => {
    // Pin our seat's hand to ctx.hand (overrides whatever the sampler
    // assigned). Other seats stay as the world specifies.
    const handsForWorld: ReadonlyArray<CardId>[] = [
      sample.hands[0] ?? [],
      sample.hands[1] ?? [],
      sample.hands[2] ?? [],
      sample.hands[3] ?? [],
    ];
    handsForWorld[SEAT_INDEX[ctx.seat]] = ctx.hand;
    return {
      handsMask: worldHandsToMasks(handsForWorld),
      cache: new Map<string, number>(),
    };
  });

  let bestCard: CardId | null = null;
  let bestScore = -Infinity;

  for (const candidate of legal) {
    const candIdx = cardToIdx(candidate);
    // ledSuit of the trick we're currently completing/continuing.
    const ledSuit: Suit = ledSuitFromInProg ?? suitOf(candidate);
    const ledSuitIdx = SUIT_TO_IDX[ledSuit];

    let total = 0;

    for (const ws of worldStates) {
      const hands = new Uint32Array(4);
      hands[0] = ws.handsMask[0];
      hands[1] = ws.handsMask[1];
      hands[2] = ws.handsMask[2];
      hands[3] = ws.handsMask[3];
      hands[mySeatIdx] = (hands[mySeatIdx] & ~(1 << candIdx)) >>> 0;

      const trickCards = inProgCardsIdx.slice();
      trickCards.push(candIdx);

      // preWon: full card-points of the trick this candidate completes
      // (if it does, and our team wins). Matches the points-valued
      // objective inside DDS so the candidate comparison stays on the
      // same scale as `pointsByMyTeam`.
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
        if (winnerTeam === myTeam) {
          // Sum points of every card in the completed trick. The first
          // three card-idxs came from `inProg` (resolved on-the-table
          // cards) plus our candidate idx. Map back through CARDID_BY_IDX
          // via inProg's tuples + candidate.
          preWon = inProg.reduce((s, [, c]) => s + pointsOf(c), 0)
                 + pointsOf(candidate);
        }
        nextLeaderIdx = winnerIdx;
        nextTrickCards = [];
        nextLedSuit = -1;
      } else {
        nextTrickCards = trickCards;
        nextLedSuit = ledSuitIdx;
      }

      const { pointsByMyTeam } = evalDDS(
        {
          hands,
          trickCards: nextTrickCards,
          leader: nextLeaderIdx,
          ledSuit: nextLedSuit,
        },
        { trumpSuit, myTeam, budget: DDS_BUDGET },
        ws.cache,
      );
      total += preWon + pointsByMyTeam;
    }

    const mean = total / worldStates.length;
    if (mean > bestScore) {
      bestScore = mean;
      bestCard = candidate;
    }
  }

  return { card: bestCard ?? legal[0] };
};
