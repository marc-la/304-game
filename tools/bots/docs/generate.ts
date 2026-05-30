// Generates one markdown file per bot under docs/bots/, pulling
// rating data from tools/bots/elo/results.json (if present).
//
// Usage: npm run bots:docs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOTS } from '../../../engine/bots';

const REPO_ROOT = resolve(__dirname, '../../..');
const RESULTS_PATH = resolve(REPO_ROOT, 'tools/bots/elo/results.json');
const OUT_DIR = resolve(REPO_ROOT, 'docs/bots');

interface LeaderboardEntry {
  bot: string;
  rating: number;
  rd: number;
  volatility: number;
}
interface PairingEntry {
  home: string;
  away: string;
  games: number;
  home_wins: number;
  away_wins: number;
  mean_home_points_diff: number;
  home_as_trumper_games: number;
}
interface Leaderboard {
  generatedAt: string;
  games: number;
  periods: number;
  ratings: LeaderboardEntry[];
  pairings: PairingEntry[];
}

const loadLeaderboard = (): Leaderboard | null => {
  if (!existsSync(RESULTS_PATH)) return null;
  return JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'));
};

const main = () => {
  const lb = loadLeaderboard();
  mkdirSync(OUT_DIR, { recursive: true });

  for (const { profile } of BOTS) {
    const rating = lb?.ratings.find(r => r.bot === profile.id);
    const pairings = lb?.pairings.filter(
      p => p.home === profile.id || p.away === profile.id,
    ) ?? [];

    const out: string[] = [];
    out.push(`# ${profile.name} (\`${profile.id}\`)`);
    out.push('');
    out.push(profile.description);
    out.push('');
    out.push('## Strengths');
    out.push('');
    for (const s of profile.strengths) out.push(`- ${s}`);
    out.push('');
    out.push('## Limitations');
    out.push('');
    for (const s of profile.limitations) out.push(`- ${s}`);
    out.push('');
    out.push('## Complexity');
    out.push('');
    out.push(`- Time: \`${profile.time}\``);
    out.push(`- Space: \`${profile.space}\``);
    out.push(`- Deterministic: ${profile.deterministic}`);
    out.push('');
    out.push('## Rating');
    out.push('');
    if (rating !== undefined) {
      out.push(`Glicko-2: **${rating.rating}** ± ${rating.rd}  ` +
        `(volatility ${rating.volatility.toFixed(4)})`);
      out.push('');
      out.push(`Measured from a round-robin tournament — ${lb!.games} games ` +
        `per pairing, ${lb!.periods} rating period(s), generated ${lb!.generatedAt}.`);
    } else {
      out.push('_Not yet measured — run `npm run bots:tournament` to populate._');
    }
    out.push('');

    if (pairings.length > 0) {
      out.push('## Head-to-head');
      out.push('');
      out.push('Win/loss is points-threshold (bid = 160). No draws are possible.');
      out.push('');
      out.push('| Opponent | Games | Wins | Losses | Avg points diff |');
      out.push('|---|---|---|---|---|');
      for (const p of pairings) {
        const isHome = p.home === profile.id;
        const opp = isHome ? p.away : p.home;
        const wins = isHome ? p.home_wins : p.away_wins;
        const losses = isHome ? p.away_wins : p.home_wins;
        const diff = isHome ? p.mean_home_points_diff : -p.mean_home_points_diff;
        out.push(
          `| ${opp} | ${p.games} | ${wins} | ${losses} | ` +
          `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} |`,
        );
      }
      out.push('');
    }

    out.push('## Rationale for rating');
    out.push('');
    out.push(rationaleFor(profile.id));
    out.push('');

    const path = resolve(OUT_DIR, `${profile.id}.md`);
    writeFileSync(path, out.join('\n'));
    console.log(`Wrote ${path}`);
  }

  // Index file linking all bots, with summary leaderboard.
  const idx: string[] = [];
  idx.push('# 304 Bot Zoo');
  idx.push('');
  idx.push('Deterministic play-only bots used to generate 304dle puzzles and to ' +
    'benchmark each other via a round-robin Glicko-2 tournament.');
  idx.push('');
  if (lb !== null) {
    idx.push(`## Leaderboard (${lb.generatedAt})`);
    idx.push('');
    idx.push('| # | Bot | Rating | RD |');
    idx.push('|---|---|---|---|');
    lb.ratings.forEach((r, i) => {
      idx.push(`| ${i + 1} | [${r.bot}](${r.bot}.md) | ${r.rating} | ± ${r.rd} |`);
    });
    idx.push('');
  } else {
    idx.push('_Run `npm run bots:tournament` then `npm run bots:docs` to populate._');
    idx.push('');
  }
  idx.push('## Bots');
  idx.push('');
  for (const { profile } of BOTS) {
    idx.push(`- [${profile.name}](${profile.id}.md) — ${profile.description}`);
  }
  idx.push('');
  const indexPath = resolve(OUT_DIR, 'README.md');
  writeFileSync(indexPath, idx.join('\n'));
  console.log(`Wrote ${indexPath}`);
};

const rationaleFor = (id: string): string => {
  switch (id) {
    case 'b0-random':
      return 'Anchor at 1000 by Glicko-2 convention. By construction this is ' +
        'the noise floor — any other bot above 1000 demonstrates measurable ' +
        'play strength.';
    case 'b1-high-low':
      return 'Targets ~1200. Plays legal cards, picks cheapest winner when one ' +
        'exists. No memory or signaling. Beats random consistently because ' +
        'losing cheaply is itself a competence; but no across-trick reasoning.';
    case 'b2-memo-high-low':
      return 'Targets ~1350. Adds card-memory: knows which cards are out, so ' +
        'avoids leading or overspending a star (J/9/A) when that star is ' +
        'already the high-of-suit and will dominate later. Closes the obvious ' +
        'gifts that B1 hands out.';
    case 'b3-heuristic':
      return 'Targets ~1500. The pre-existing engine bot with star-spend ' +
        'thresholds (J ≥ 18, 9 ≥ 10, A ≥ 8 points on table), partner-aware ' +
        'sluff, opportunistic cut-when-rich, longest-non-trump lead. The ' +
        'existing puzzle curator\'s L4 baseline.';
    case 'b4-infoset-1ply':
      return 'Targets ~1700. Builds an info-set, samples ~32 consistent ' +
        'worlds, picks the play with the best expected single-trick value ' +
        'across the sample. The first bot that genuinely reads opponent ' +
        'voids and exhaustions.';
    case 'b5-csp-search':
      return 'Targets ~1900. Two-ply expectimax over a sample of worlds, ' +
        'with a caps-aware override: when caps is obligated, plays the ' +
        'engine\'s witness-line first card. Near-perfect on caps-callable ' +
        'states; depth-limited so deep tactics may slip through.';
    case 'b6-dds-mc':
      return 'Targets ~2050. Ginsberg-GIB style: sample N worlds, full ' +
        'double-dummy each, pick the play with highest mean future-' +
        'points. Reference "expert" play under the open-trump model; ' +
        'the ceiling we can build without bridge-library imports.';
    case 'b6o-dds-mc-hybrid':
      return 'Targets ~B6. Round-keyed hybrid: B5 for R1+R2 where ' +
        'info-set uncertainty makes full DDS low-yield, then B6 for ' +
        'R3+ where the search earns its cost. Strength ceiling is ' +
        'B6\'s; wall-clock is dominated by R3+ moves alone.';
    default:
      return '(No rationale text.)';
  }
};

main();
