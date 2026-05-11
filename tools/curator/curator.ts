// Curator — orchestrates the L1 → L4 → L3 pipeline.
//
// Pipeline shape (under adaptive-CSP caps semantics):
//   L1  hand-strength heuristic   — broad dud filter, microseconds
//   L4  reachability simulation    — finds first S* where caller is
//                                    caps-obligated under bot trajectory
//   L3  deduction labour           — leave-one-out via checkCapsObligation,
//                                    counts load-bearing facts at S*
//
// L2 (fixed-order DDS at R1) was dropped: under adaptive caps the
// fixed-order question is the wrong one (only catches absolute hands),
// and the necessary condition it provided is subsumed by L4.

import type { CardId } from '@engine/card';
import { dealForSeed } from '@engine/dealing';
import type { Seat } from '@engine/seating';
import { evaluateHand } from './layers/1-heuristic';
import { computeDeductionLabour } from './layers/3-labour';
import { checkReachability } from './layers/4-reachability';
import type {
  CuratedPuzzle,
  CuratorRunResult,
  CuratorThresholds,
  RejectionStats,
} from './types';
import { DEFAULT_THRESHOLDS } from './types';

const mixSeed = (s: number, salt: number): number =>
  (Math.imul(s ^ salt, 0x9e3779b1) ^ (s >>> 16)) >>> 0;

const handHash = (hand: ReadonlyArray<CardId>): string =>
  [...hand].sort().join(',');

export interface CuratorOptions {
  count: number;                    // target accepted puzzles
  maxAttempts: number;              // hard cap on iterations
  masterSeed: number;
  thresholds?: Partial<CuratorThresholds>;
  uniqueSouthHands?: boolean;       // dedup by south-hand hash; default true
  onProgress?: (
    progress: { attempts: number; accepted: number; rejection: RejectionStats },
  ) => void;
  progressEvery?: number;           // report every N attempts; default 100
}

export const curate = (opts: CuratorOptions): CuratorRunResult => {
  const thresholds: CuratorThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(opts.thresholds ?? {}),
  };
  const dedup = opts.uniqueSouthHands ?? true;
  const progressEvery = opts.progressEvery ?? 100;
  const seenHands = new Set<string>();
  const rejection: RejectionStats = { L1: 0, L2: 0, L3: 0, L4: 0, duplicate: 0 };
  const puzzles: CuratedPuzzle[] = [];

  let attempt = 0;
  let seed = opts.masterSeed >>> 0;

  while (puzzles.length < opts.count && attempt < opts.maxAttempts) {
    attempt++;
    seed = mixSeed(seed, attempt);
    const deal = dealForSeed(seed);

    if (dedup) {
      const h = handHash(deal.hands.south);
      if (seenHands.has(h)) {
        rejection.duplicate++;
        continue;
      }
    }

    // L1 — hand-strength heuristic. Broad dud filter on south.
    const l1 = evaluateHand(deal.hands.south, deal.trumpSuit, thresholds);
    if (!l1.pass) { rejection.L1++; continue; }

    // L4 — reachability via simulation. Operative filter for caps:
    // simulates trajectories, finds first S* under adaptive caps,
    // rejects deals whose obligation falls outside the round window.
    const t4 = Date.now();
    const l4 = checkReachability(
      deal.hands,
      deal.trumpSuit,
      deal.trumpCard,
      deal.botSeed,
      thresholds,
    );
    const dt4 = Date.now() - t4;
    if (dt4 > 1000) {
      console.log(`  [slow L4] attempt=${attempt} ${dt4}ms pass=${l4.pass}`);
    }
    if (!l4.pass) { rejection.L4++; continue; }
    if (!l4.obligationState || l4.chosenBotSeed === undefined) {
      rejection.L4++; continue;
    }

    // L3 — deduction labour at S*. Leave-one-out via checkCapsObligation.
    const t3 = Date.now();
    const l3 = computeDeductionLabour({
      state: l4.obligationState,
      thresholds,
    });
    const dt3 = Date.now() - t3;
    if (dt3 > 1000) {
      console.log(`  [slow L3] attempt=${attempt} ${dt3}ms pass=${l3.pass}`);
    }
    if (!l3.pass) { rejection.L3++; continue; }

    if (dedup) {
      seenHands.add(handHash(deal.hands.south));
    }

    const id = `hc-${String(puzzles.length + 1).padStart(4, '0')}`;
    puzzles.push({
      id,
      seed,
      botSeed: l4.chosenBotSeed,
      hands: deal.hands,
      trump: {
        suit: deal.trumpSuit,
        card: deal.trumpCard,
        trumper: 'south',
        trumpCardInHand: true,   // legacy curator is open-trump south-only
      },
      metadata: {
        L1: l1.features,
        // L2 metadata kept on the schema for backward compatibility;
        // populated with the demonstration line from L4 (one canonical
        // adaptive line, not a fixed-order witness).
        L2: {
          tightness: 1,
          witnessOrder: l4.obligationWitness ?? [],
        },
        L3: {
          labour: l3.labour,
          witnessSuitSpan: l3.witnessSuitSpan,
          loadBearingCardCount: l3.loadBearingCards.length,
        },
        L4: {
          optimalCallRound: l4.optimalCallRound,
          trajectoryRoundDistribution: l4.trajectoryRoundDistribution,
        },
      },
    });

    if (opts.onProgress && attempt % progressEvery === 0) {
      opts.onProgress({
        attempts: attempt,
        accepted: puzzles.length,
        rejection: { ...rejection },
      });
    }
  }

  return { puzzles, attempts: attempt, rejection };
};

// Re-export for CLI consumers.
export type { CuratorRunResult, CuratorThresholds };
