// Round-robin tournament. Each (home, away) pairing plays
// `gamesPerPairing` games with duplicate-bridge symmetry (same deal,
// swap which seats each team occupies). Across games we rotate:
//
//   - trumper-seat through {south, east, north, west} so each team
//     trumps half the time (50/50 split; the slight +EV from holding
//     the bid is balanced)
//   - priority-seat independently through the same cycle (offset by 1)
//     so dealer-rotation is decoupled from who-holds-the-bid, per the
//     real rules
//
// Win/loss uses the fixed-bid (160) criterion from match.ts:
//   - trumping team takes ≥160 → trumping team wins
//   - else → opposing team wins
// Total = 304 ensures mutual exclusivity (no draws are possible).

import { newRating, update } from './glicko2';
import type { MatchOutcome, Rating } from './glicko2';
import { runMatch } from './match';
import type { Seat } from '../../../engine/seating';
import { teamOf } from '../../../engine/seating';

export interface PairingResult {
  home: string;
  away: string;
  games: number;            // total games played (incl. duplicate)
  home_wins: number;
  away_wins: number;
  // mean (home_points - away_points). Diagnostic only.
  mean_home_points_diff: number;
  // For analysis: how many of the games had home as the trumper.
  home_as_trumper_games: number;
  // Wall-clock duration of this pairing in milliseconds. Lets the
  // operator spot which bot combos dominate the run time (B6/B7 R1
  // moves can dwarf the cheap bots — a single B6 pairing is ~50× a
  // B0–B5 pairing).
  duration_ms: number;
}

export interface TournamentOptions {
  bots: ReadonlyArray<string>;
  gamesPerPairing: number;         // games per (home,away) pair, before duplicate
  duplicate?: boolean;             // default true
  masterSeed?: number;             // default 1
  progress?: (msg: string) => void;
}

const mixSeed = (s: number, salt: number): number =>
  (Math.imul(s ^ salt, 0x9e3779b1) ^ (s >>> 16)) >>> 0;

// Compact, human-friendly duration. ≥1h → "1h23m"; ≥1min → "12m34s";
// otherwise "5.4s" or "542ms".
const formatDuration = (ms: number): string => {
  if (ms >= 3_600_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h${m.toString().padStart(2, '0')}m`;
  }
  if (ms >= 60_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m${s.toString().padStart(2, '0')}s`;
  }
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
};

const formatPerGame = (ms: number, games: number): string => {
  if (games === 0) return '—';
  return formatDuration(ms / games);
};

const ROT: Seat[] = ['south', 'east', 'north', 'west'];

export interface TournamentResult {
  pairings: PairingResult[];
  ratings: Map<string, Rating>;
}

export const runTournament = (opts: TournamentOptions): TournamentResult => {
  const dup = opts.duplicate ?? true;
  const masterSeed = opts.masterSeed ?? 1;
  const bots = opts.bots;
  const ratings = new Map<string, Rating>();
  for (const b of bots) ratings.set(b, newRating());

  // Pad bot ids to the longest name for column-aligned output.
  const nameWidth = bots.reduce((w, b) => Math.max(w, b.length), 0);
  const padName = (s: string): string => s.padEnd(nameWidth);
  const padInt = (n: number, w: number): string => String(n).padStart(w);
  const padDiff = (d: number): string => {
    const s = d >= 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
    return s.padStart(7);
  };

  const pairings: PairingResult[] = [];
  const outcomesByBot = new Map<string, MatchOutcome[]>();
  for (const b of bots) outcomesByBot.set(b, []);

  for (let hi = 0; hi < bots.length; hi++) {
    for (let aj = 0; aj < bots.length; aj++) {
      if (hi === aj) continue;
      const home = bots[hi];
      const away = bots[aj];
      const pr: PairingResult = {
        home, away,
        games: 0,
        home_wins: 0,
        away_wins: 0,
        mean_home_points_diff: 0,
        home_as_trumper_games: 0,
        duration_ms: 0,
      };
      let cumulativeDiff = 0;
      const pairingStart = Date.now();

      for (let g = 0; g < opts.gamesPerPairing; g++) {
        const seed = mixSeed(masterSeed, hi * 10_000 + aj * 100 + g);
        // Rotate trumper and priority through the seat cycle. Trumper
        // and priority offsets are independent — the offset is what
        // makes them realistic (in real 304 dealer rotates → priority
        // rotates, while trumper is decided by the bid).
        const trumperSeat = ROT[g % 4];
        const prioritySeat = ROT[(g + 1) % 4];

        // Configuration 1: home on team_a (N/S), away on team_b (E/W).
        const cfg1: Record<Seat, string> = {
          north: home, south: home, west: away, east: away,
        };
        const r1 = runMatch(seed, cfg1, { trumperSeat, prioritySeat });
        const trumpingIsHome1 = teamOf(trumperSeat) === 'team_a';
        const homeWon1 = trumpingIsHome1 ? r1.trumperWon : !r1.trumperWon;
        if (homeWon1) pr.home_wins++; else pr.away_wins++;
        if (trumpingIsHome1) pr.home_as_trumper_games++;
        const homePoints1 = trumpingIsHome1 ? r1.trumpingTeamPoints : r1.opposingTeamPoints;
        const awayPoints1 = trumpingIsHome1 ? r1.opposingTeamPoints : r1.trumpingTeamPoints;
        cumulativeDiff += homePoints1 - awayPoints1;
        pr.games++;

        if (dup) {
          // Duplicate: same deal + same trumper/priority position, but
          // home/away seat assignment flips. This is the deal-luck
          // canceller: a strong team_a hand on this seed will likely
          // win both games, but the bot in team_a's seat differs.
          const cfg2: Record<Seat, string> = {
            north: away, south: away, west: home, east: home,
          };
          const r2 = runMatch(seed, cfg2, { trumperSeat, prioritySeat });
          const trumpingIsHome2 = teamOf(trumperSeat) === 'team_b';
          const homeWon2 = trumpingIsHome2 ? r2.trumperWon : !r2.trumperWon;
          if (homeWon2) pr.home_wins++; else pr.away_wins++;
          if (trumpingIsHome2) pr.home_as_trumper_games++;
          const homePoints2 = trumpingIsHome2 ? r2.trumpingTeamPoints : r2.opposingTeamPoints;
          const awayPoints2 = trumpingIsHome2 ? r2.opposingTeamPoints : r2.trumpingTeamPoints;
          cumulativeDiff += homePoints2 - awayPoints2;
          pr.games++;
        }
      }
      pr.mean_home_points_diff = cumulativeDiff / pr.games;
      pr.duration_ms = Date.now() - pairingStart;

      pairings.push(pr);

      const homeRating = ratings.get(home)!;
      const awayRating = ratings.get(away)!;
      const homeOutcomes = outcomesByBot.get(home)!;
      const awayOutcomes = outcomesByBot.get(away)!;
      for (let i = 0; i < pr.home_wins; i++) {
        homeOutcomes.push({ opponent: awayRating, score: 1 });
        awayOutcomes.push({ opponent: homeRating, score: 0 });
      }
      for (let i = 0; i < pr.away_wins; i++) {
        homeOutcomes.push({ opponent: awayRating, score: 0 });
        awayOutcomes.push({ opponent: homeRating, score: 1 });
      }

      // home-trumper is exactly 50% of games by construction (rotation
      // guarantees it); we no longer surface it per pairing.
      opts.progress?.(
        `   ${padName(home)}  vs  ${padName(away)}   ` +
        `${padInt(pr.home_wins, 3)}W / ${padInt(pr.away_wins, 3)}L   ` +
        `diff: ${padDiff(pr.mean_home_points_diff)}   ` +
        `time: ${formatDuration(pr.duration_ms).padStart(8)} ` +
        `(${formatPerGame(pr.duration_ms, pr.games)}/game)`,
      );
    }
  }

  // Apply one Glicko-2 update per bot using all outcomes from this
  // rating period. Snapshot to avoid intra-period drift.
  const snapshot = new Map<string, Rating>();
  for (const [b, r] of ratings) snapshot.set(b, { ...r });
  for (const b of bots) {
    const updated = update(snapshot.get(b)!, outcomesByBot.get(b) ?? []);
    ratings.set(b, updated);
  }

  return { pairings, ratings };
};
