// Bot zoo for 304dle puzzle generation and ELO benchmarking.
//
// All bots implement the same `PlayBot` interface and are deterministic
// in (info-set, seed). They never bid or select trump — that is fixed
// at instantiation (curatorial decisions per soul §VI.1.1). They only
// choose plays during the play phase.
//
// Variety, ordered by expected ELO:
//   B0  random              — anchor (ELO floor)
//   B1  high-low            — cheapest winner / lowest sluff
//   B2  memo-high-low       — B1 + remembers played cards
//   B3  heuristic-current   — existing chooseBotPlay (star thresholds)
//   B4  infoset-1ply        — sampled-world expectation, 1-ply lookahead
//   B5  csp-search          — adaptive CSP-style minimax (depth-limited)
//   B6  dds-monte-carlo     — Ginsberg-style per-world double-dummy EV
//   B7  bridge-derived      — spike from the GIB / single-dummy literature

import { chooseRandom } from './b0-random';
import { chooseHighLow } from './b1-high-low';
import { chooseMemoHighLow } from './b2-memo-high-low';
import { chooseHeuristic } from './b3-heuristic';
import { chooseInfoSet1Ply } from './b4-infoset-1ply';
import { chooseCSPSearch } from './b5-csp-search';
import { chooseDDSMC } from './b6-dds-mc';
import { chooseBridgeDerived } from './b7-bridge-derived';
import type { BotChoice, BotContext, BotProfile, PlayBot } from './types';

export type { BotChoice, BotContext, BotProfile, PlayBot } from './types';

export interface BotEntry {
  profile: BotProfile;
  play: PlayBot;
}

export const BOTS: ReadonlyArray<BotEntry> = [
  {
    profile: {
      id: 'b0-random',
      name: 'Random',
      description:
        'Picks uniformly from legal plays. Anchor for ELO calibration.',
      strengths: ['blazing fast', 'no state', 'true baseline'],
      limitations: [
        'no follow-suit preference beyond legality',
        'no trick awareness',
        'no card memory',
      ],
      deterministic: true,
      time: 'O(L)',
      space: 'O(1)',
    },
    play: chooseRandom,
  },
  {
    profile: {
      id: 'b1-high-low',
      name: 'High-Low',
      description:
        'If a played card can win this trick at the moment of play, plays cheapest winner; else lowest-points sluff.',
      strengths: ['solid trick-taking', 'preserves stars when possible'],
      limitations: [
        'no card memory between rounds',
        'no opponent reading',
        'no signaling',
      ],
      deterministic: true,
      time: 'O(L)',
      space: 'O(1)',
    },
    play: chooseHighLow,
  },
  {
    profile: {
      id: 'b2-memo-high-low',
      name: 'Memo High-Low',
      description:
        'B1 + tracks which cards have already been played. Will commit a star when guaranteed-best, will sluff when out-class is certain.',
      strengths: [
        'closes obvious gifts',
        'won\'t over-spend a J that already dominates',
      ],
      limitations: [
        'no info-set deduction across suits',
        'cannot reason about partner\'s hand',
      ],
      deterministic: true,
      time: 'O(L + H)',
      space: 'O(P)',
    },
    play: chooseMemoHighLow,
  },
  {
    profile: {
      id: 'b3-heuristic',
      name: 'Heuristic',
      description:
        'The existing engine bot. Star-spend thresholds, partner-aware sluff, cut-when-rich, longest-non-trump lead. Used by the existing puzzle curator as the L4 baseline.',
      strengths: [
        'tuned for caps non-triviality',
        'preserves J/9/A under threshold',
        'partner-aware',
      ],
      limitations: ['hand-tuned numbers', 'no deep lookahead'],
      deterministic: true,
      time: 'O(L + H)',
      space: 'O(1)',
    },
    play: chooseHeuristic,
  },
  {
    profile: {
      id: 'b4-infoset-1ply',
      name: 'InfoSet 1-Ply',
      description:
        'Builds an info-set, samples consistent worlds, evaluates each legal play\'s expected round outcome 1 ply ahead, picks the best EV.',
      strengths: [
        'leverages suit-exhaustion',
        'reads opponent voids',
        'beats heuristic on mid-game positions',
      ],
      limitations: [
        'no deep lookahead',
        'sample bias on wide-open positions',
      ],
      deterministic: true,
      time: 'O(W·L)',
      space: 'O(W)',
    },
    play: chooseInfoSet1Ply,
  },
  {
    profile: {
      id: 'b5-csp-search',
      name: 'CSP Search',
      description:
        'Reuses the caps-csp constraint machinery to run depth-limited adaptive minimax: caller branches existentially, opps universally over consistent legal plays.',
      strengths: [
        'finds adaptive lines',
        'near-perfect on caps-callable states',
      ],
      limitations: [
        'slow per move',
        'depth-limited; misses deep tactics',
      ],
      deterministic: true,
      time: 'O(B^d)',
      space: 'O(d)',
    },
    play: chooseCSPSearch,
  },
  {
    profile: {
      id: 'b6-dds-mc',
      name: 'DDS Monte Carlo',
      description:
        'Ginsberg-GIB-style: sample N consistent worlds, double-dummy each, pick the play with highest EV across the sample. Reference "expert" play.',
      strengths: [
        'strongest play overall',
        'handles complex positions',
        'best caps detection',
      ],
      limitations: [
        'expensive per move (~100–500 ms)',
        'Monte-Carlo variance on small N',
      ],
      deterministic: true,
      time: 'O(N·DDS)',
      space: 'O(N)',
    },
    play: chooseDDSMC,
  },
  {
    profile: {
      id: 'b7-bridge-derived',
      name: 'Bridge-Derived',
      description:
        'Spike port of single-dummy expectation-search ideas from bridge (Frank/Basin 1998, Ginsberg 2001 GIB). Sample-then-DDS hybrid with a richer move ordering than B6.',
      strengths: [
        'principled from the bridge literature',
        'best move ordering',
      ],
      limitations: [
        'experimental — limited tuning',
        'similar cost to B6',
      ],
      deterministic: true,
      time: 'O(N·DDS)',
      space: 'O(N)',
    },
    play: chooseBridgeDerived,
  },
];

export const botById = (id: string): BotEntry | undefined =>
  BOTS.find(b => b.profile.id === id);

export const playByBot = (
  botId: string,
  ctx: BotContext,
): BotChoice => {
  const bot = botById(botId);
  if (bot === undefined) throw new Error(`Unknown bot: ${botId}`);
  return bot.play(ctx);
};
