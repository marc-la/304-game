// Daily puzzle pre-generator. Walks N days, generates a deal per
// day, simulates the game with the bot playing all four seats, runs
// the caps classifier, and writes the puzzles to JSON.
//
// Usage: tsx tools/generate-puzzles.ts --year 2026 --out frontend/public/puzzles/2026.json
//
// Re-running with the same args is deterministic.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { pointsOf, powerOf, suitOf } from '../frontend/src/304dle/engine/card';
import type { CardId, Suit } from '../frontend/src/304dle/engine/card';
import { dealForSeed, makeRng, seedFromDate } from '../frontend/src/304dle/engine/dealing';
import { chooseBotPlay } from '../frontend/src/304dle/engine/bot';
import {
  legalPlays,
  roundTurnOrder,
  roundWinner,
  roundPoints,
  seatsHoldingTrump,
} from '../frontend/src/304dle/engine/play';
import type { Seat, Team } from '../frontend/src/304dle/engine/seating';
import { teamOf, partnerSeat } from '../frontend/src/304dle/engine/seating';
import type { CompletedRound, EngineGameState } from '../frontend/src/304dle/engine/state';
import { checkCapsObligation } from '../frontend/src/304dle/engine/caps';

interface DailyPuzzle {
  date: string;
  seed: number;
  hands: Record<Seat, CardId[]>;
  trump: { suit: Suit; card: CardId; trumper: 'south' };
  botSeed: number;
  difficulty: 'monday' | 'wednesday' | 'friday' | 'sunday';
  classification: {
    capsAchievable: boolean;
    optimalCallRound: number | null;
    parScore: number;
  };
}

interface PuzzleFile {
  version: 1;
  year: number;
  generatedAt: string;
  puzzles: DailyPuzzle[];
}

const SEATS_ALL: Seat[] = ['north', 'west', 'south', 'east'];

const buildState = (
  hands: Record<Seat, CardId[]>,
  trumpSuit: Suit,
  trumpCard: CardId,
  priority: Seat,
  completed: CompletedRound[],
  pointsWon: Record<Team, number>,
): EngineGameState => {
  const handsMap = new Map<Seat, CardId[]>();
  for (const s of SEATS_ALL) handsMap.set(s, hands[s]);
  return {
    hands: handsMap,
    trump: {
      trumperSeat: 'south',
      trumpSuit,
      trumpCard,
      trumpCardInHand: true,
      isRevealed: true,
      isOpen: true,
    },
    play: {
      roundNumber: completed.length + 1,
      priority,
      currentRound: [],
      completedRounds: completed,
      pointsWon,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

interface SimResult {
  capsAchievable: boolean;
  optimalCallRound: number | null;
  southPoints: number;
}

// Stronger south policy used by the classifier. South tries to win
// every trick where partner isn't already winning, preserving
// trumps. This represents "competent caller" — what a good human
// player would do.
const chooseSouthGreedy = (args: {
  hand: ReadonlyArray<CardId>;
  state: EngineGameState;
  rng: () => number;
}): CardId => {
  const { hand, state } = args;
  const cur = state.play.currentRound;
  const ledSuit: Suit | null =
    cur.length > 0 && cur[0].card !== null ? suitOf(cur[0].card) : null;
  const isLead = cur.length === 0;
  const trump = state.trump.trumpSuit;
  const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
  for (const seat of ['north', 'west', 'south', 'east'] as Seat[]) {
    handsMap.set(seat, state.hands.get(seat) ?? []);
  }
  const trumpHolders = seatsHoldingTrump(handsMap, trump);
  const legal = legalPlays({
    hand, ledSuit, trumpSuit: trump, isLead, seatsWithTrumps: trumpHolders, seat: 'south',
  });
  if (legal.length === 1) return legal[0];

  const inProgressTyped: Array<readonly [Seat, CardId]> = cur
    .filter(e => e.card !== null)
    .map(e => [e.seat, e.card!]);

  const wouldWin = (candidate: CardId): boolean => {
    const projected: Array<readonly [Seat, CardId]> = [...inProgressTyped, ['south', candidate]];
    return roundWinner(projected, trump) === 'south';
  };

  const partnerWinning = (): boolean => {
    if (inProgressTyped.length === 0) return false;
    return roundWinner(inProgressTyped, trump) === partnerSeat('south');
  };

  // If partner is already winning, sluff lowest-pointed non-trump if possible.
  if (!isLead && partnerWinning()) {
    const sluffs = [...legal]
      .filter(c => trump === null || suitOf(c) !== trump)
      .sort((a, b) => pointsOf(a) - pointsOf(b) || powerOf(b) - powerOf(a));
    if (sluffs.length > 0) return sluffs[0];
    return [...legal].sort((a, b) => pointsOf(a) - pointsOf(b))[0];
  }

  // If I can win, pick the cheapest winning card (preserve high cards/trumps when possible).
  if (!isLead) {
    const winners = legal.filter(wouldWin);
    if (winners.length > 0) {
      // prefer non-trump winners; among trumps, prefer lowest power that wins
      const nonTrumpWinners = winners.filter(c => trump === null || suitOf(c) !== trump);
      const pick = nonTrumpWinners.length > 0 ? nonTrumpWinners : winners;
      return [...pick].sort((a, b) => powerOf(b) - powerOf(a))[0];
    }
    // can't win → sluff lowest-pointed non-trump if possible
    const sluffs = legal.filter(c => trump === null || suitOf(c) !== trump);
    if (sluffs.length > 0) {
      return [...sluffs].sort((a, b) => pointsOf(a) - pointsOf(b) || powerOf(b) - powerOf(a))[0];
    }
    return [...legal].sort((a, b) => pointsOf(a) - pointsOf(b))[0];
  }

  // Leading: lead high non-trump from longest suit (try to flush opponent suits).
  // Avoid leading trumps unless we have to.
  const nonTrumps = legal.filter(c => trump === null || suitOf(c) !== trump);
  if (nonTrumps.length > 0) {
    // Lead highest-power non-trump (most likely to win the trick).
    return [...nonTrumps].sort((a, b) => powerOf(a) - powerOf(b))[0];
  }
  // All trumps — lead highest trump.
  return [...legal].sort((a, b) => powerOf(a) - powerOf(b))[0];
};

// Simulate a full game with the bot playing all four seats. After
// each round resolution, check if South was caps-obligated. The
// earliest such round is the "optimal call round" — par.
const simulate = (
  initialHands: Record<Seat, CardId[]>,
  trumpSuit: Suit,
  trumpCard: CardId,
  botSeed: number,
): SimResult => {
  const hands: Record<Seat, CardId[]> = {
    north: [...initialHands.north],
    west: [...initialHands.west],
    south: [...initialHands.south],
    east: [...initialHands.east],
  };
  const completed: CompletedRound[] = [];
  let priority: Seat = 'south';
  const pts: Record<Team, number> = { team_a: 0, team_b: 0 };
  let optimalCallRound: number | null = null;
  const rng = makeRng(botSeed);

  for (let round = 1; round <= 8; round++) {
    const order = roundTurnOrder(priority, null);
    const plays: Array<readonly [Seat, CardId]> = [];
    for (const seat of order) {
      const state = buildState(hands, trumpSuit, trumpCard, priority, completed, pts);
      state.play.currentRound = plays.map(([s, c]) => ({
        seat: s, card: c, faceDown: false, revealed: false,
      }));
      const card = seat === 'south'
        ? chooseSouthGreedy({ hand: hands[seat], state, rng })
        : chooseBotPlay({ seat, hand: hands[seat], state, rng });
      const idx = hands[seat].indexOf(card);
      hands[seat].splice(idx, 1);
      plays.push([seat, card]);
    }
    const winner = roundWinner(plays, trumpSuit);
    const points = roundPoints(plays);
    pts[teamOf(winner)] += points;
    completed.push({
      roundNumber: round,
      cards: plays.map(([s, c]) => ({
        seat: s, card: c, faceDown: false, revealed: false,
      })),
      winner,
      pointsWon: points,
      trumpRevealed: false,
    });
    priority = winner;

    // Check obligation for South after this round resolution.
    if (optimalCallRound === null) {
      const post = buildState(hands, trumpSuit, trumpCard, priority, completed, pts);
      if (checkCapsObligation(post, 'south')) {
        optimalCallRound = round;
      }
    }
  }

  return {
    capsAchievable: optimalCallRound !== null,
    optimalCallRound,
    southPoints: pts.team_a,
  };
};

const REROLL_LIMIT = 200;
const mixSeed = (s: number, salt: number): number =>
  (Math.imul(s ^ salt, 0x9e3779b1) ^ (s >>> 16)) >>> 0;

const generateForDate = (date: string): DailyPuzzle => {
  let seed = seedFromDate(date);
  for (let attempt = 0; attempt < REROLL_LIMIT; attempt++) {
    const deal = dealForSeed(seed);
    const sim = simulate(deal.hands, deal.trumpSuit, deal.trumpCard, deal.botSeed);
    if (sim.capsAchievable && sim.optimalCallRound !== null && sim.optimalCallRound <= 7) {
      const round = sim.optimalCallRound;
      const difficulty: DailyPuzzle['difficulty'] =
        round <= 4 ? 'monday' :
        round === 5 ? 'wednesday' :
        round === 6 ? 'friday' : 'sunday';
      // Par score: full 100 unless they call later than optimal.
      const parScore = 100;
      return {
        date,
        seed,
        hands: deal.hands,
        trump: { suit: deal.trumpSuit, card: deal.trumpCard, trumper: 'south' },
        botSeed: deal.botSeed,
        difficulty,
        classification: {
          capsAchievable: true,
          optimalCallRound: round,
          parScore,
        },
      };
    }
    seed = mixSeed(seed, attempt + 1);
  }
  // Fallback: ship the deal anyway, marked unachievable.
  const deal = dealForSeed(seed);
  return {
    date,
    seed,
    hands: deal.hands,
    trump: { suit: deal.trumpSuit, card: deal.trumpCard, trumper: 'south' },
    botSeed: deal.botSeed,
    difficulty: 'sunday',
    classification: {
      capsAchievable: false,
      optimalCallRound: null,
      parScore: 30,
    },
  };
};

const datesInYear = (year: number): string[] => {
  const dates: string[] = [];
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  for (let d = start; d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
};

// Always resolve relative to the repo root, not cwd.
const REPO_ROOT = resolve(__dirname, '..');

const parseArgs = (): { year: number; out: string } => {
  const args = process.argv.slice(2);
  let year = new Date().getUTCFullYear();
  let out = resolve(REPO_ROOT, `frontend/public/puzzles/${year}.json`);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--year' && i + 1 < args.length) {
      year = parseInt(args[++i], 10);
      out = resolve(REPO_ROOT, `frontend/public/puzzles/${year}.json`);
    } else if (args[i] === '--out' && i + 1 < args.length) {
      out = resolve(args[++i]);
    }
  }
  return { year, out };
};

const main = () => {
  const { year, out } = parseArgs();
  const dates = datesInYear(year);
  console.log(`Generating ${dates.length} puzzles for ${year}...`);

  const puzzles: DailyPuzzle[] = [];
  let achievable = 0;
  const tStart = Date.now();

  for (const date of dates) {
    const p = generateForDate(date);
    puzzles.push(p);
    if (p.classification.capsAchievable) achievable++;
    if (puzzles.length % 30 === 0) {
      const dt = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(`  ... ${puzzles.length}/${dates.length} (${achievable} achievable, ${dt}s)`);
    }
  }

  const file: PuzzleFile = {
    version: 1,
    year,
    generatedAt: new Date().toISOString(),
    puzzles,
  };

  const outPath = out;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(file));
  const dt = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`\nWrote ${outPath}`);
  console.log(`  ${achievable}/${puzzles.length} achievable (${(100 * achievable / puzzles.length).toFixed(1)}%)`);
  console.log(`  ${dt}s total`);
};

main();
