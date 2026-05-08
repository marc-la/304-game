// Shared types for the hard-caps curator pipeline.
//
// The pipeline runs four independent layers; each layer's result is a
// discriminated union of pass/fail. The `metadata` records on accepted
// puzzles aggregate per-layer signals so downstream consumers (the
// scoring/bucketing chat) can use them without re-running anything.

import type { CardId, Suit } from '../../frontend/src/304dle/engine/card';
import type { Seat } from '../../frontend/src/304dle/engine/seating';

export interface HandFeatures {
  hcp: number;                // sum of pointsOf over south's hand
  trumpLen: number;           // count of trump-suit cards in south's hand
  trumpTopCount: number;      // count of trump cards in {J, 9, A}
  shape: [number, number, number, number]; // descending suit lengths
  topHonors: number;          // # of side-suit AK / J9 pair holdings
}

export type Layer1Result =
  | { pass: true; features: HandFeatures }
  | { pass: false; reason: 'no-trump' | 'dud-hand' | 'fragile-trump'; features: HandFeatures };

export interface Layer2Pass {
  pass: true;
  witnessOrder: CardId[];      // a winning order found double-dummy
  tightness: number;           // distinct first-cards that lead to a winning order
}
export interface Layer2Fail {
  pass: false;
  reason: 'not-cap-able';
}
export type Layer2Result = Layer2Pass | Layer2Fail;

export interface Layer3Pass {
  pass: true;
  labour: number;              // count of load-bearing public facts at S*
  loadBearingCards: CardId[];  // played cards south needed to recall
  loadBearingExhaustions: Array<{ seat: Seat; suit: Suit }>;
  witnessSuitSpan: number;     // distinct suits in the S* witness order
}
export interface Layer3Fail {
  pass: false;
  reason: 'low-labour' | 'no-witness' | 'single-suit-witness';
  labour?: number;
  witnessSuitSpan?: number;
}
export type Layer3Result = Layer3Pass | Layer3Fail;

export interface Layer4Pass {
  pass: true;
  optimalCallRound: number;    // round of first obligation under chosen trajectory
  obligationWitness: CardId[]; // single-dummy witness at S*
  trajectoryRoundDistribution: number[]; // call round per sampled trajectory (or 0 if none)
}
export interface Layer4Fail {
  pass: false;
  reason: 'never-obligated' | 'too-early' | 'too-late';
  trajectoryRoundDistribution: number[];
}
export type Layer4Result = Layer4Pass | Layer4Fail;

export interface HardCapsMetadata {
  L1: HandFeatures;
  L2: { tightness: number; witnessOrder: CardId[] };
  L3: { labour: number; witnessSuitSpan: number; loadBearingCardCount: number };
  L4: { optimalCallRound: number; trajectoryRoundDistribution: number[] };
}

export interface ScenarioMetadata {
  trumperSeat: Seat;
  prioritySeat: Seat;            // = trumperSeat (R1 priority for trumper)
  isOpen: boolean;
  capsType: 'internal' | 'external'; // internal = south's team is trumping
  southPositionR1: number;       // 1..4, south's slot in R1 turn order
}

export interface CuratedPuzzle {
  id: string;                  // sequential within the curated file
  seed: number;                // master seed for this puzzle (deal seed)
  botSeed: number;             // selected bot trajectory seed
  hands: Record<Seat, CardId[]>;
  // `trumper` field allowed any seat in pool puzzles; legacy curated
  // files always have 'south'.
  trump: { suit: Suit; card: CardId; trumper: Seat; trumpCardInHand: boolean };
  scenario?: ScenarioMetadata;   // present on pool puzzles
  metadata: HardCapsMetadata;
}

export interface CuratorThresholds {
  // L1
  minHcp: number;
  minTrumpLen: number;
  // L3
  minLabour: number;
  // Multi-suit gate: south's remaining hand at S* must span at least
  // this many suits. Rejects trump-runner witnesses (south's hand
  // is all trump) where the deduction collapses to a single suit.
  // Per soul §VI.4: hard caps means tracking across multiple suits.
  minWitnessSuitSpan: number;
  // L4
  minOptimalCallRound: number;     // inclusive
  maxOptimalCallRound: number;     // inclusive
  trajectorySamples: number;       // # bot seeds to try in L4
}

export const DEFAULT_THRESHOLDS: CuratorThresholds = {
  // Broad dud filter — these are not hand-shape gates. They reject
  // hands where caps is implausible (no trump, very weak HCP) without
  // imposing specific shape requirements.
  minHcp: 35,
  minTrumpLen: 2,
  // Hard-caps difficulty floor; deduction labour is the cardinal
  // signal per the design.
  minLabour: 4,
  // Reject trump-runner witnesses (south has only trump left at S*).
  // Multi-suit witnesses are what soul §VI.4 calls "hard caps".
  minWitnessSuitSpan: 2,
  // Round window: caps callable in [3, 7] per rules §C-1/§C-2 timing.
  minOptimalCallRound: 3,
  maxOptimalCallRound: 7,
  trajectorySamples: 8,
};

export interface RejectionStats {
  L1: number;
  L2: number;
  L3: number;
  L4: number;
  duplicate: number;
}

// Per-scenario-cell counts of accepted puzzles. Populated by the
// pool curator as accepts stream in. The cell key is "<seat>-<mode>"
// e.g. "south-open", "north-closed".
export type ScenarioCellCounts = Record<string, number>;

export interface CuratorRunResult {
  puzzles: CuratedPuzzle[];
  attempts: number;
  rejection: RejectionStats;
}
