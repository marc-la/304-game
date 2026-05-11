// Pool curator — fuzzing-style streaming generator. Cycles through
// scenario cells uniformly (no weighting), evaluates each candidate,
// appends accepted puzzles to a JSONL file as they are found.
//
// Resumable: re-running with a different master seed appends. The
// sidecar meta file tracks running stats; running tail -f on the
// JSONL file lets you watch puzzles arrive live.

import { closeSync, fsyncSync, openSync, writeFileSync, writeSync } from 'node:fs';
import type { CardId } from '@engine/card';
import type { Seat } from '@engine/seating';
import { evaluateHand } from './layers/1-heuristic';
import { computeDeductionLabour } from './layers/3-labour';
import { capsTypeForTrumper, checkScenarioReachability } from './layers/4-scenario';
import { dealScenario, scenarioForSalt } from './scenario-dealing';
import type {
  CuratedPuzzle,
  CuratorThresholds,
  RejectionStats,
  ScenarioCellCounts,
} from './types';
import { DEFAULT_THRESHOLDS } from './types';

const mixSeed = (s: number, salt: number): number =>
  (Math.imul(s ^ salt, 0x9e3779b1) ^ (s >>> 16)) >>> 0;

const handHash = (hand: ReadonlyArray<CardId>): string =>
  [...hand].sort().join(',');

const cellKey = (trumper: Seat, isOpen: boolean): string =>
  `${trumper}-${isOpen ? 'open' : 'closed'}`;

export interface PoolCuratorOptions {
  outPath: string;                 // pool.jsonl
  metaPath: string;                // pool.meta.json
  maxAccepted?: number;            // hard cap; default Infinity
  maxAttempts?: number;            // hard cap; default Infinity
  maxWallSeconds?: number;         // hard cap on wall time; default Infinity
  masterSeed: number;
  thresholds?: Partial<CuratorThresholds>;
  uniqueSouthHands?: boolean;      // dedup south-hand hash; default true
  metaFlushEvery?: number;         // sync meta every N attempts; default 50
  onProgress?: (
    progress: {
      attempts: number;
      accepted: number;
      rejection: RejectionStats;
      cells: ScenarioCellCounts;
    },
  ) => void;
  progressEvery?: number;          // attempts; default 100
}

export interface PoolMeta {
  version: 1;
  criterion: 'hard-caps-pool-v1';
  thresholds: CuratorThresholds;
  generatedAt: string;
  masterSeed: number;
  stats: {
    attempts: number;
    accepted: number;
    rejection: RejectionStats;
    cells: ScenarioCellCounts;
    elapsedSeconds: number;
  };
}

export const curatePool = (opts: PoolCuratorOptions): PoolMeta => {
  const thresholds: CuratorThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(opts.thresholds ?? {}),
  };
  const dedup = opts.uniqueSouthHands ?? true;
  const progressEvery = opts.progressEvery ?? 100;
  const metaFlushEvery = opts.metaFlushEvery ?? 5;
  const seenHands = new Set<string>();
  const rejection: RejectionStats = { L1: 0, L2: 0, L3: 0, L4: 0, duplicate: 0 };
  const cells: ScenarioCellCounts = {};
  let accepted = 0;
  let attempt = 0;
  let seed = opts.masterSeed >>> 0;
  const tStart = Date.now();
  const maxAccepted = opts.maxAccepted ?? Infinity;
  const maxAttempts = opts.maxAttempts ?? Infinity;
  const maxWallMs = (opts.maxWallSeconds ?? Infinity) * 1000;

  const fd = openSync(opts.outPath, 'a');

  const writeMeta = () => {
    const meta: PoolMeta = {
      version: 1,
      criterion: 'hard-caps-pool-v1',
      thresholds,
      generatedAt: new Date(tStart).toISOString(),
      masterSeed: opts.masterSeed,
      stats: {
        attempts: attempt,
        accepted,
        rejection,
        cells,
        elapsedSeconds: (Date.now() - tStart) / 1000,
      },
    };
    writeFileSync(opts.metaPath, JSON.stringify(meta, null, 2));
    return meta;
  };

  try {
    while (
      accepted < maxAccepted &&
      attempt < maxAttempts &&
      Date.now() - tStart < maxWallMs
    ) {
      attempt++;
      seed = mixSeed(seed, attempt);

      // Cycle scenarios uniformly via the salt — but rotate
      // independently of the seed so that adjacent attempts try
      // different cells (better for early-stage cell coverage).
      const scenario = scenarioForSalt(attempt);
      const deal = dealScenario(seed, scenario);

      if (dedup) {
        const h = handHash(deal.hands.south);
        if (seenHands.has(h)) {
          rejection.duplicate++;
          continue;
        }
      }

      // L1 — south hand strength. Only apply when south is the
      // trumper; otherwise the south-shape gates are mis-calibrated
      // (south doesn't need trump in their hand if north or an opp
      // is bidding). For non-south-trumper, L4's reachability check
      // is the correct filter.
      let l1Features: ReturnType<typeof evaluateHand>['features'];
      if (deal.trumperSeat === 'south') {
        const l1 = evaluateHand(deal.hands.south, deal.trumpSuit, thresholds);
        if (!l1.pass) { rejection.L1++; continue; }
        l1Features = l1.features;
      } else {
        // Compute features for metadata but don't gate.
        const l1 = evaluateHand(deal.hands.south, deal.trumpSuit, {
          ...thresholds, minHcp: 0, minTrumpLen: 0,
        });
        l1Features = l1.features;
      }

      // L4 — scenario-aware reachability.
      const l4 = checkScenarioReachability(
        deal.hands,
        { trumperSeat: deal.trumperSeat, isOpen: deal.isOpen },
        deal.trumpSuit,
        deal.trumpCard,
        deal.botSeed,
        thresholds,
      );
      if (!l4.pass) { rejection.L4++; continue; }
      if (
        !l4.obligationState ||
        l4.chosenBotSeed === undefined ||
        l4.southPositionR1 === undefined
      ) {
        rejection.L4++; continue;
      }

      // L3 — deduction labour at S*.
      const l3 = computeDeductionLabour({
        state: l4.obligationState,
        thresholds,
      });
      if (!l3.pass) { rejection.L3++; continue; }

      // Accept.
      if (dedup) seenHands.add(handHash(deal.hands.south));
      accepted++;
      const key = cellKey(deal.trumperSeat, deal.isOpen);
      cells[key] = (cells[key] ?? 0) + 1;

      const id = `hc-${String(accepted).padStart(5, '0')}`;
      const puzzle: CuratedPuzzle = {
        id,
        seed,
        botSeed: l4.chosenBotSeed,
        hands: deal.hands,
        trump: {
          suit: deal.trumpSuit,
          card: deal.trumpCard,
          trumper: deal.trumperSeat,
          trumpCardInHand: deal.trumpCardInHand,
        },
        scenario: {
          trumperSeat: deal.trumperSeat,
          prioritySeat: deal.prioritySeat,
          isOpen: deal.isOpen,
          capsType: capsTypeForTrumper(deal.trumperSeat),
          southPositionR1: l4.southPositionR1,
        },
        metadata: {
          L1: l1Features,
          L2: { tightness: 1, witnessOrder: l4.obligationWitness ?? [] },
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
      };
      writeSync(fd, JSON.stringify(puzzle) + '\n');
      fsyncSync(fd);

      if (accepted % metaFlushEvery === 0) writeMeta();
      if (opts.onProgress && attempt % progressEvery === 0) {
        opts.onProgress({ attempts: attempt, accepted, rejection, cells });
      }
    }
  } finally {
    closeSync(fd);
  }

  return writeMeta();
};
