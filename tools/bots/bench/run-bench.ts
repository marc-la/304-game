// Bot-speed benchmark harness.
//
// Runs each named bot through fixed seed sequences (the
// bot-speed-handoff.md fixture seeds), playing full 8-round games with
// the bot occupying all four seats. Reports median, p95, p99 per-move
// time, plus per-round timing so we can see opening-vs-endgame cost.
//
// Usage:
//   npx tsx tools/bots/bench/run-bench.ts \
//     --bots b6-dds-mc,b7-bridge-derived \
//     --seeds 3
//
// The fixture seeds are intentionally a measurement standard — don't
// change them. Reduce `--seeds N` to run only the first N if iterating
// quickly.

import { performance } from 'node:perf_hooks';
import { suitOf } from '../../../engine/card';
import type { CardId, Suit } from '../../../engine/card';
import { powerOf } from '../../../engine/card';
import { dealForSeed, makeRng } from '../../../engine/dealing';
import {
  roundTurnOrder,
  roundWinner,
  roundPoints,
} from '../../../engine/play';
import type { Seat, Team } from '../../../engine/seating';
import { SEAT_INDEX, teamOf } from '../../../engine/seating';
import type {
  CompletedRound,
  EngineGameState,
  RoundEntry,
} from '../../../engine/state';
import { botById } from '../../../engine/bots';

// From docs/bot-speed-handoff.md §"Bench fixture seeds".
const FIXTURE_SEEDS = [
  1, 7, 23, 47, 91, 127, 199, 257, 401, 503,
  601, 743, 877, 991, 1009, 1117, 1259, 1381, 1487, 1543,
];

const SEATS: Seat[] = ['north', 'west', 'south', 'east'];

const SUIT_ORDER: readonly Suit[] = ['c', 'd', 'h', 's'];

const longestSuit = (hand: ReadonlyArray<CardId>): Suit => {
  const counts: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 };
  for (const c of hand) counts[suitOf(c)]++;
  let best: Suit = SUIT_ORDER[0];
  for (const s of SUIT_ORDER) if (counts[s] > counts[best]) best = s;
  return best;
};

const strongestInSuit = (hand: ReadonlyArray<CardId>, s: Suit): CardId => {
  const inS = hand.filter(c => suitOf(c) === s);
  return inS.reduce((b, c) => (powerOf(c) < powerOf(b) ? c : b));
};

const buildState = (
  hands: Record<Seat, CardId[]>,
  trumpSuit: Suit,
  trumpCard: CardId,
  trumperSeat: Seat,
  priority: Seat,
  completed: CompletedRound[],
  current: RoundEntry[],
  pts: Record<Team, number>,
): EngineGameState => {
  const handsArr: CardId[][] = [[], [], [], []];
  for (const s of SEATS) handsArr[SEAT_INDEX[s]] = hands[s];
  return {
    hands: handsArr,
    trump: {
      trumperSeat,
      trumpSuit,
      trumpCard,
      trumpCardInHand: true,
      isRevealed: true,
      isOpen: true,
    },
    play: {
      roundNumber: completed.length + 1,
      priority,
      currentRound: current,
      completedRounds: completed,
      pointsWon: pts,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

interface SeedResult {
  perMove: number[];
  perRound: number[];   // length 8
  cards: CardId[];      // moves in play order (for determinism check)
  totalMs: number;
}

const runOnce = (botId: string, seed: number): SeedResult => {
  const deal = dealForSeed(seed);
  const trumpSuit = longestSuit(deal.hands.south);
  const trumpCard = strongestInSuit(deal.hands.south, trumpSuit);
  const trumperSeat: Seat = 'south';
  let priority: Seat = 'south';

  const hands: Record<Seat, CardId[]> = {
    north: [...deal.hands.north],
    west: [...deal.hands.west],
    south: [...deal.hands.south],
    east: [...deal.hands.east],
  };
  const completed: CompletedRound[] = [];
  const pts: Record<Team, number> = { team_a: 0, team_b: 0 };
  const bot = botById(botId);
  if (!bot) throw new Error(`Unknown bot: ${botId}`);
  const rng = makeRng(deal.botSeed);

  const perMove: number[] = [];
  const perRound: number[] = new Array(8).fill(0);
  const cards: CardId[] = [];
  const t0 = performance.now();

  for (let round = 1; round <= 8; round++) {
    const order = roundTurnOrder(priority, null);
    const current: RoundEntry[] = [];
    let roundMs = 0;
    for (const seat of order) {
      const state = buildState(
        hands, trumpSuit, trumpCard, trumperSeat,
        priority, completed, current, pts,
      );
      const tm0 = performance.now();
      const { card } = bot.play({
        seat, hand: hands[seat], state, rng,
      });
      const dt = performance.now() - tm0;
      perMove.push(dt);
      roundMs += dt;
      cards.push(card);
      const idx = hands[seat].indexOf(card);
      if (idx < 0) {
        throw new Error(
          `Bot ${botId} returned ${card} not in ${seat} hand`,
        );
      }
      hands[seat].splice(idx, 1);
      current.push({ seat, card, faceDown: false, revealed: false });
    }
    perRound[round - 1] = roundMs;
    const plays: Array<readonly [Seat, CardId]> = current.map(
      e => [e.seat, e.card!],
    );
    const winner = roundWinner(plays, trumpSuit);
    pts[teamOf(winner)] += roundPoints(plays);
    completed.push({
      roundNumber: round,
      cards: current,
      winner,
      pointsWon: roundPoints(plays),
      trumpRevealed: false,
    });
    priority = winner;
  }

  return {
    perMove,
    perRound,
    cards,
    totalMs: performance.now() - t0,
  };
};

const median = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

const percentile = (arr: number[], p: number): number => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.max(0, Math.ceil((p / 100) * s.length) - 1);
  return s[i];
};

const mean = (arr: number[]): number =>
  arr.length === 0 ? 0 : arr.reduce((s, x) => s + x, 0) / arr.length;

interface Args {
  bots: string[];
  seeds: number;
  determinismCheck: boolean;
}

const parseArgs = (): Args => {
  const a = process.argv.slice(2);
  const out: Args = {
    bots: ['b6-dds-mc', 'b7-bridge-derived'],
    seeds: 3,
    determinismCheck: false,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--bots') out.bots = a[++i].split(',');
    else if (a[i] === '--seeds') out.seeds = parseInt(a[++i], 10);
    else if (a[i] === '--determinism') out.determinismCheck = true;
  }
  return out;
};

const main = (): void => {
  const args = parseArgs();
  const seeds = FIXTURE_SEEDS.slice(0, args.seeds);
  console.log(`Bots:  ${args.bots.join(', ')}`);
  console.log(`Seeds (${seeds.length}): ${seeds.join(', ')}`);
  console.log();

  for (const botId of args.bots) {
    console.log(`=== ${botId} ===`);
    const allMoves: number[] = [];
    const perRoundAcc: number[] = new Array(8).fill(0);
    let totalMs = 0;
    const cardsBySeed = new Map<number, CardId[]>();

    for (const seed of seeds) {
      const r = runOnce(botId, seed);
      allMoves.push(...r.perMove);
      for (let i = 0; i < 8; i++) perRoundAcc[i] += r.perRound[i];
      totalMs += r.totalMs;
      cardsBySeed.set(seed, r.cards);
      console.log(
        `  seed ${String(seed).padStart(4)}  ` +
        `total ${r.totalMs.toFixed(0).padStart(6)} ms  ` +
        `median ${median(r.perMove).toFixed(1).padStart(7)} ms  ` +
        `p95 ${percentile(r.perMove, 95).toFixed(1).padStart(7)} ms`,
      );
    }

    console.log(
      `  ALL  ${seeds.length} seeds  ` +
      `${allMoves.length} moves  ` +
      `total ${totalMs.toFixed(0)} ms`,
    );
    console.log(
      `  per-move:  median ${median(allMoves).toFixed(1)} ms  ` +
      `p95 ${percentile(allMoves, 95).toFixed(1)} ms  ` +
      `p99 ${percentile(allMoves, 99).toFixed(1)} ms  ` +
      `mean ${mean(allMoves).toFixed(1)} ms`,
    );
    console.log('  per-round mean across seeds (ms total / ms per move):');
    for (let i = 0; i < 8; i++) {
      const roundTotal = perRoundAcc[i] / seeds.length;
      console.log(
        `    round ${i + 1}: ${roundTotal.toFixed(1).padStart(7)}  ` +
        `(${(roundTotal / 4).toFixed(1).padStart(6)} per move)`,
      );
    }

    if (args.determinismCheck) {
      console.log('  determinism check — replaying each seed:');
      for (const seed of seeds) {
        const r2 = runOnce(botId, seed);
        const orig = cardsBySeed.get(seed)!;
        const same = orig.length === r2.cards.length &&
          orig.every((c, i) => c === r2.cards[i]);
        console.log(`    seed ${seed}: ${same ? 'OK' : 'DIVERGED'}`);
        if (!same) {
          console.log(`      orig: ${orig.join(',')}`);
          console.log(`      new:  ${r2.cards.join(',')}`);
        }
      }
    }

    console.log();
  }
};

main();
