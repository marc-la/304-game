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

// B6 (DDS Monte Carlo) and B7 (bridge-derived) are now included by
// default following the tier-2 optimizations in dds-core.ts
// (alpha-beta, bitmask hands, killer + bound TT, move ordering) that
// make them tractable for tournament-scale runs. Exclude them
// explicitly with `--bots b0-random,b1-high-low,...` if you need a
// fast iteration loop. See docs/bot-speed-handoff.md +
// docs/bot-speed-tier2-changes.md for context.
const DEFAULT_TOURNAMENT_BOTS = [
  'b0-random',
  'b1-high-low',
  'b2-memo-high-low',
  'b3-heuristic',
  'b4-infoset-1ply',
  'b5-csp-search',
  'b6-dds-mc',
  'b7-bridge-derived',
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

  // --- Startup banner (printed once) ---------------------------------------
  const RULE = '═'.repeat(70);
  const SUB  = '─'.repeat(70);
  const totalPerPairing = args.games * 2;
  const totalPairings = botIds.length * (botIds.length - 1);
  const totalGames = totalPairings * totalPerPairing * args.periods;
  console.log(RULE);
  console.log(' 304 Bot Tournament');
  console.log(RULE);
  console.log(' Bid             : 160 (trumping team wins iff points ≥ 160; opp ≥ 145)');
  console.log(' Trumper         : rotates {south, east, north, west} per game');
  console.log('                   each team trumps exactly 50% of games per pairing');
  console.log(' Priority        : rotates independently of trumper (offset by 1)');
  console.log(' Duplicate       : same seed + same trumper/priority, swap home/away seats');
  console.log(' Draws           : impossible (304 total ⇒ thresholds are mutually exclusive)');
  console.log(' Open trump only : closed-trump bots are exiled to the curator pipeline');
  console.log(SUB);
  console.log(` Bots (${botIds.length})        : ${botIds.join(', ')}`);
  console.log(` Games / pairing : ${args.games} × 2 duplicate = ${totalPerPairing}`);
  console.log(` Pairings        : ${totalPairings}`);
  console.log(` Periods         : ${args.periods}`);
  console.log(` Total games     : ${totalGames.toLocaleString()}`);
  console.log(` Master seed     : ${args.masterSeed}`);
  if (args.inFile !== null) {
    console.log(` Seeded from     : ${args.inFile}`);
  }
  console.log(RULE);
  console.log('');

  let lastPairings: ReturnType<typeof runTournament>['pairings'] = [];
  let ratings = new Map<string, Rating>();

  for (let p = 0; p < args.periods; p++) {
    console.log(`Period ${p + 1}/${args.periods}`);
    console.log(SUB);
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
    console.log(SUB);
    console.log(` period ${p + 1} done in ${dt}s`);
    console.log('');
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

  const RULE2 = '═'.repeat(70);
  const nameW = Math.max(...entries.map(e => e.name.length));
  console.log(RULE2);
  console.log(' Final Leaderboard');
  console.log(RULE2);
  entries.forEach((e, i) => {
    const rank = String(i + 1).padStart(2);
    const rating = String(e.rating).padStart(5);
    const rd = String(e.rd).padStart(3);
    console.log(
      `  ${rank}.  ${rating} ± ${rd}   ${e.name.padEnd(nameW)}   (${e.bot})`,
    );
  });
  console.log(RULE2);
  console.log(` Wrote ${args.out}`);
};

main();
