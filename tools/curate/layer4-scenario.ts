// Layer 4 (scenario variant) — reachability for the diverse pool.
// Generalizes the south-only layer4-reachability with:
//   - Variable trumper seat (any Seat).
//   - Open or closed trump simulation.
//   - Returns south's position in R1 + the engine state at S*.
//
// The detection predicate is unchanged (engine `checkCapsObligation`,
// CSP-adaptive). The simulator changes shape per scenario.

import type { CardId } from '../../frontend/src/304dle/engine/card';
import type { EngineGameState } from '../../frontend/src/304dle/engine/state';
import type { Seat } from '../../frontend/src/304dle/engine/seating';
import { teamOf } from '../../frontend/src/304dle/engine/seating';
import type { Scenario } from './scenario-dealing';
import { simulateScenarioOnce } from './scenario-simulator';
import type { CuratorThresholds, Layer4Result } from './types';

const mixSeed = (s: number, salt: number): number =>
  (Math.imul(s ^ salt, 0x9e3779b1) ^ (s >>> 16)) >>> 0;

export interface ScenarioReachabilityOutcome extends Layer4Result {
  chosenBotSeed?: number;
  obligationState?: EngineGameState;
  obligationWitness?: CardId[];
  southPositionR1?: number;
}

export const checkScenarioReachability = (
  initialHands: Record<Seat, CardId[]>,
  scenario: Scenario,
  trumpSuit: import('../../frontend/src/304dle/engine/card').Suit,
  trumpCard: CardId,
  baseBotSeed: number,
  thresholds: CuratorThresholds,
): ScenarioReachabilityOutcome => {
  const trajectoryRounds: number[] = [];
  type Pick = {
    botSeed: number;
    round: number;
    state: EngineGameState;
    witness: CardId[];
    southPositionR1: number;
  };
  let chosen: Pick | null = null;

  for (let i = 0; i < thresholds.trajectorySamples; i++) {
    const botSeed = i === 0 ? baseBotSeed : mixSeed(baseBotSeed, i);
    const out = simulateScenarioOnce(
      initialHands, scenario, trumpSuit, trumpCard, botSeed,
    );
    trajectoryRounds.push(out.optimalCallRound ?? 0);

    if (out.southLostARound || out.optimalCallRound === null) continue;
    const r = out.optimalCallRound;
    if (r < thresholds.minOptimalCallRound || r > thresholds.maxOptimalCallRound) continue;
    if (out.obligationState === null) continue;

    const candidate: Pick = {
      botSeed,
      round: r,
      state: out.obligationState,
      witness: out.obligationWitness ?? [],
      southPositionR1: out.southPositionR1,
    };
    if (chosen === null) {
      chosen = candidate;
    } else {
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
    southPositionR1: chosen.southPositionR1,
  };
};

export const capsTypeForTrumper = (trumperSeat: Seat): 'internal' | 'external' =>
  teamOf(trumperSeat) === teamOf('south') ? 'internal' : 'external';
