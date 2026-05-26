// CLI: runs a round-robin tournament and writes a leaderboard.
//
// Usage:
//   npm run bots:tournament -- --games 50 --out tools/bots/elo/results.json
//
// The "rating period" semantics of Glicko-2 mean a single pass through
// the tournament counts as one period. To converge, re-run the tool
// multiple times pointing at the previous --in file.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BOTS } from '../../../../engine/bots';
import { runTournament } from '../tournament';
import type { Rating } from '../glicko2';

const REPO_ROOT = resolve(__dirname, '../../../..');

interface Args {
  games: number;
  periods: number;
  out: string;
  inFile: string | null;
  masterSeed: number;
  bots: string[] | null;
}

const parseArgs = (): Args => {
  const args = process.argv.slice(2);
  let games = 20;
  let periods = 1;
  let out = resolve(REPO_ROOT, 'tools/bots/elo/results.json');
  let inFile: string | null = null;
  let masterSeed = 1;
  let bots: string[] | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--games') games = parseInt(args[++i], 10);
    else if (args[i] === '--periods') periods = parseInt(args[++i], 10);
    else if (args[i] === '--out') out = resolve(args[++i]);
    else if (args[i] === '--in') inFile = resolve(args[++i]);
    else if (args[i] === '--seed') masterSeed = parseInt(args[++i], 10);
    else if (args[i] === '--bots') bots = args[++i].split(',');
  }
  return { games, periods, out, inFile, masterSeed, bots };
};

interface LeaderboardEntry {
  bot: string;
  name: string;
  rating: number;
  rd: number;
  volatility: number;
}

interface LeaderboardFile {
  generatedAt: string;
  games: number;
  periods: number;
  masterSeed: number;
  ratings: LeaderboardEntry[];
  pairings: Array<{
    home: string;
    away: string;
    games: number;
    home_wins: number;
    away_wins: number;
    mean_home_points_diff: number;
    home_as_trumper_games: number;
  }>;
}

// B6 (DDS Monte Carlo) and B7 (bridge-derived) are deliberately
// excluded from the default tournament — their per-move cost at the
// opening makes a 50-game tournament take many hours. Include them
// explicitly with `--bots b0-random,...,b6-dds-mc`. See
// docs/bot-speed-handoff.md for the plan to make them tractable.
const DEFAULT_TOURNAMENT_BOTS = [
  'b0-random',
  'b1-high-low',
  'b2-memo-high-low',
  'b3-heuristic',
  'b4-infoset-1ply',
  'b5-csp-search',
];

const main = () => {
  const args = parseArgs();
  const botIds = args.bots
    ?? DEFAULT_TOURNAMENT_BOTS.filter(id => BOTS.some(b => b.profile.id === id));

  // Seed ratings from --in if present.
  const seed = new Map<string, Rating>();
  if (args.inFile !== null && existsSync(args.inFile)) {
    const prev = JSON.parse(readFileSync(args.inFile, 'utf-8')) as LeaderboardFile;
    for (const r of prev.ratings) {
      seed.set(r.bot, { rating: r.rating, rd: r.rd, volatility: r.volatility });
    }
    console.log(`Seeded from ${args.inFile}`);
  }

  let lastPairings: ReturnType<typeof runTournament>['pairings'] = [];
  let ratings = new Map<string, Rating>();

  for (let p = 0; p < args.periods; p++) {
    console.log(`Period ${p + 1}/${args.periods}…`);
    const tStart = Date.now();
    const res = runTournament({
      bots: botIds,
      gamesPerPairing: args.games,
      masterSeed: args.masterSeed + p * 1000,
      progress: msg => console.log(msg),
    });
    // For multi-period runs, carry ratings forward.
    for (const [b, r] of res.ratings) ratings.set(b, r);
    lastPairings = res.pairings;
    const dt = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`  ...period ${p + 1} done in ${dt}s`);
  }

  if (ratings.size === 0) {
    console.log('No tournament ran.');
    return;
  }

  // Carry --in ratings into output if a bot wasn't played this round.
  for (const [b, r] of seed) {
    if (!ratings.has(b)) ratings.set(b, r);
  }

  const entries: LeaderboardEntry[] = botIds.map(id => {
    const r = ratings.get(id)!;
    const profile = BOTS.find(b => b.profile.id === id)!.profile;
    return {
      bot: id,
      name: profile.name,
      rating: Math.round(r.rating),
      rd: Math.round(r.rd),
      volatility: Number(r.volatility.toFixed(4)),
    };
  });
  entries.sort((a, b) => b.rating - a.rating);

  const file: LeaderboardFile = {
    generatedAt: new Date().toISOString(),
    games: args.games,
    periods: args.periods,
    masterSeed: args.masterSeed,
    ratings: entries,
    pairings: lastPairings,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(file, null, 2));
  console.log(`\nWrote ${args.out}`);
  console.log('\nLeaderboard:');
  for (const e of entries) {
    console.log(`  ${e.rating.toString().padStart(5)} ± ${e.rd.toString().padStart(3)}   ${e.name}`);
  }
};

main();
