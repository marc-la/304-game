// Layer 4 — Single-dummy reachability. Given a deal that passed L2
// (cap-able double-dummy), simulate forward with bots playing the
// non-south seats and a competent south, and find the first state at
// which south becomes caps-obligated under their info-set. Reject the
// deal if obligation either never arises or arises outside the
// configured [minRound, maxRound] window.
//
// We sample multiple bot trajectories so the reported round
// distribution is informative for downstream consumers; the curator
// picks one trajectory whose round lies in the target window.

import { pointsOf, powerOf, suitOf } from '../../frontend/src/304dle/engine/card';
import type { CardId, Suit } from '../../frontend/src/304dle/engine/card';
import { chooseBotPlay } from '../../frontend/src/304dle/engine/bot';
import { checkCapsObligation } from '../../frontend/src/304dle/engine/caps';
import { findWitnessLine } from '../../frontend/src/304dle/engine/caps-csp';
import { makeRng } from '../../frontend/src/304dle/engine/dealing';
import {
  legalPlays,
  roundPoints,
  roundTurnOrder,
  roundWinner,
  seatsHoldingTrump,
} from '../../frontend/src/304dle/engine/play';
import type { Seat, Team } from '../../frontend/src/304dle/engine/seating';
import { partnerSeat, teamOf } from '../../frontend/src/304dle/engine/seating';
import type {
  CompletedRound,
  EngineGameState,
  RoundEntry,
} from '../../frontend/src/304dle/engine/state';
import type { CuratorThresholds, Layer4Result } from './types';

const SEATS_ALL: Seat[] = ['north', 'west', 'south', 'east'];

// Deep snapshot of an EngineGameState — copies hand arrays and the
// completed-rounds list so subsequent simulation mutations don't
// drift the snapshot.
const snapshotState = (state: EngineGameState): EngineGameState => {
  const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
  for (const [seat, cards] of state.hands) handsMap.set(seat, [...cards]);
  return {
    ...state,
    hands: handsMap,
    play: {
      ...state.play,
      completedRounds: state.play.completedRounds.map(r => ({
        ...r,
        cards: r.cards.map(e => ({ ...e })),
      })),
      currentRound: state.play.currentRound.map(e => ({ ...e })),
    },
  };
};

const buildState = (
  hands: Record<Seat, CardId[]>,
  trumpSuit: Suit,
  trumpCard: CardId,
  priority: Seat,
  completed: CompletedRound[],
  pointsWon: Record<Team, number>,
  currentRound: ReadonlyArray<RoundEntry>,
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
      currentRound,
      completedRounds: completed,
      pointsWon,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

// Greedy south policy: try to win the round when partner isn't
// already winning; preserve trumps when sluffing. Mirrors the strong
// south policy in the existing generator — represents "competent
// player driving toward caps".
const chooseSouthGreedy = (
  hand: ReadonlyArray<CardId>,
  state: EngineGameState,
): CardId => {
  const cur = state.play.currentRound;
  const ledSuit: Suit | null =
    cur.length > 0 && cur[0].card !== null ? suitOf(cur[0].card) : null;
  const isLead = cur.length === 0;
  const trump = state.trump.trumpSuit;
  const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
  for (const seat of SEATS_ALL) handsMap.set(seat, state.hands.get(seat) ?? []);
  const trumpHolders = seatsHoldingTrump(handsMap, trump);
  const legal = legalPlays({
    hand, ledSuit, trumpSuit: trump, isLead, seatsWithTrumps: trumpHolders, seat: 'south',
  });
  if (legal.length === 1) return legal[0];

  const inProgressTyped: Array<readonly [Seat, CardId]> = cur
    .filter(e => e.card !== null)
    .map(e => [e.seat, e.card!]);

  const wouldWin = (candidate: CardId): boolean => {
    const projected: Array<readonly [Seat, CardId]> = [
      ...inProgressTyped,
      ['south', candidate],
    ];
    return roundWinner(projected, trump) === 'south';
  };

  const partnerWinning = (): boolean => {
    if (inProgressTyped.length === 0) return false;
    return roundWinner(inProgressTyped, trump) === partnerSeat('south');
  };

  if (!isLead && partnerWinning()) {
    const sluffs = legal
      .filter(c => suitOf(c) !== trump)
      .sort((a, b) => pointsOf(a) - pointsOf(b) || powerOf(b) - powerOf(a));
    return sluffs[0] ?? [...legal].sort((a, b) => pointsOf(a) - pointsOf(b))[0];
  }

  if (!isLead) {
    const winners = legal.filter(wouldWin);
    if (winners.length > 0) {
      const nonTrumpWinners = winners.filter(c => suitOf(c) !== trump);
      const pick = nonTrumpWinners.length > 0 ? nonTrumpWinners : winners;
      return [...pick].sort((a, b) => powerOf(b) - powerOf(a))[0];
    }
    const sluffs = legal.filter(c => suitOf(c) !== trump);
    if (sluffs.length > 0) {
      return [...sluffs].sort((a, b) => pointsOf(a) - pointsOf(b) || powerOf(b) - powerOf(a))[0];
    }
    return [...legal].sort((a, b) => pointsOf(a) - pointsOf(b))[0];
  }

  const nonTrumps = legal.filter(c => suitOf(c) !== trump);
  if (nonTrumps.length > 0) {
    return [...nonTrumps].sort((a, b) => powerOf(a) - powerOf(b))[0];
  }
  return [...legal].sort((a, b) => powerOf(a) - powerOf(b))[0];
};

export interface SimulationOutcome {
  optimalCallRound: number | null;       // first round of obligation, null if none
  obligationWitness: CardId[] | null;     // witness order at S*, null if none
  obligationState: EngineGameState | null; // full state at S* (post-round resolution)
  southPoints: number;
  southLostARound: boolean;               // if true, caps was broken before any obligation
}

const simulateOnce = (
  initialHands: Record<Seat, CardId[]>,
  trumpSuit: Suit,
  trumpCard: CardId,
  botSeed: number,
): SimulationOutcome => {
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
  let obligationWitness: CardId[] | null = null;
  let obligationState: EngineGameState | null = null;
  const rng = makeRng(botSeed);

  for (let round = 1; round <= 8; round++) {
    const order = roundTurnOrder(priority, null);
    const plays: Array<readonly [Seat, CardId]> = [];
    for (const seat of order) {
      const stateBefore = buildState(
        hands, trumpSuit, trumpCard, priority, completed, pts,
        plays.map(([s, c]) => ({ seat: s, card: c, faceDown: false, revealed: false })),
      );
      // South uses the same bot as opponents — varied trajectories,
      // no greedy bias toward exhausting non-trumps first. The
      // greedy policy collapses south's hand to single-suit (trump)
      // by S*, which prevents multi-suit witnesses entirely.
      void chooseSouthGreedy;
      const card = chooseBotPlay({ seat, hand: hands[seat], state: stateBefore, rng });
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

    // If south's team lost this round, caps is forever broken on this trajectory.
    if (teamOf(winner) !== 'team_a') {
      return {
        optimalCallRound: null,
        obligationWitness: null,
        obligationState: null,
        southPoints: pts.team_a,
        southLostARound: true,
      };
    }

    // Check obligation post-resolution. Stamp on first occurrence.
    // Adaptive CSP semantics: checkCapsObligation is the fast binary
    // detector; findWitnessLine extracts one canonical demonstration
    // line (used for inspector display, not the strategy itself).
    if (optimalCallRound === null) {
      const post = buildState(hands, trumpSuit, trumpCard, priority, completed, pts, []);
      if (checkCapsObligation(post, 'south')) {
        optimalCallRound = round;
        // Deep-snapshot the state: buildState shares hand-array refs
        // with the live simulation, so without copying the snapshot
        // would drift as remaining rounds mutate the hands.
        obligationState = snapshotState(post);
        // Demonstration line is best-effort. Adaptive caps doesn't
        // require a fixed order; the line is informational only.
        obligationWitness = findWitnessLine(post, 'south') ?? [];
      }
    }
  }

  return {
    optimalCallRound,
    obligationWitness,
    obligationState,
    southPoints: pts.team_a,
    southLostARound: false,
  };
};

export interface ReachabilityOutcome extends Layer4Result {
  // Internal handoffs to L3 — included only on pass.
  chosenBotSeed?: number;
  obligationState?: EngineGameState;
  obligationWitness?: CardId[];
}

const mixSeed = (s: number, salt: number): number =>
  (Math.imul(s ^ salt, 0x9e3779b1) ^ (s >>> 16)) >>> 0;

export const checkReachability = (
  initialHands: Record<Seat, CardId[]>,
  trumpSuit: Suit,
  trumpCard: CardId,
  baseBotSeed: number,
  thresholds: CuratorThresholds,
): ReachabilityOutcome => {
  const trajectoryRounds: number[] = [];
  type Pick = {
    botSeed: number;
    round: number;
    witness: CardId[];
    state: EngineGameState;
  };
  let chosen: Pick | null = null;

  for (let i = 0; i < thresholds.trajectorySamples; i++) {
    const botSeed = i === 0 ? baseBotSeed : mixSeed(baseBotSeed, i);
    const out = simulateOnce(initialHands, trumpSuit, trumpCard, botSeed);
    trajectoryRounds.push(out.optimalCallRound ?? 0);

    if (out.southLostARound || out.optimalCallRound === null) continue;
    const r = out.optimalCallRound;
    if (r < thresholds.minOptimalCallRound || r > thresholds.maxOptimalCallRound) continue;
    if (out.obligationWitness === null || out.obligationState === null) continue;

    const candidate: Pick = {
      botSeed,
      round: r,
      witness: out.obligationWitness,
      state: out.obligationState,
    };
    // Prefer mid-window rounds; ties go to first encountered.
    if (chosen === null) chosen = candidate;
    else {
      const target = (thresholds.minOptimalCallRound + thresholds.maxOptimalCallRound) / 2;
      if (Math.abs(r - target) < Math.abs(chosen.round - target)) chosen = candidate;
    }
  }

  if (chosen === null) {
    const reason: 'never-obligated' | 'too-early' | 'too-late' =
      trajectoryRounds.every(r => r === 0)
        ? 'never-obligated'
        : trajectoryRounds.some(r => r > 0 && r < thresholds.minOptimalCallRound)
          ? 'too-early'
          : 'too-late';
    return { pass: false, reason, trajectoryRoundDistribution: trajectoryRounds };
  }

  return {
    pass: true,
    optimalCallRound: chosen.round,
    obligationWitness: chosen.witness,
    trajectoryRoundDistribution: trajectoryRounds,
    chosenBotSeed: chosen.botSeed,
    obligationState: chosen.state,
  };
};
