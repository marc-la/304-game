import { describe, expect, it } from 'vitest';
import { fixtureSimpleSweep } from '../../../frontend/src/304dle/engine/__tests__/fixtures';
import { computeDeductionLabour } from '../layer3-labour';
import { DEFAULT_THRESHOLDS } from '../types';

describe('Layer 3 — deduction labour (CSP leave-one-out)', () => {
  it('rejects when the input state is not caps-obligated', () => {
    // Construct a state from simple-sweep but with no completed
    // rounds — south can't be obligated at R1 with 8-card hand under
    // any non-degenerate distribution.
    const stateR1 = {
      ...fixtureSimpleSweep.state,
      play: {
        ...fixtureSimpleSweep.state.play,
        roundNumber: 1,
        completedRounds: [],
        currentRound: [],
        pointsWon: { team_a: 0, team_b: 0 },
      },
    };
    const r = computeDeductionLabour({
      state: stateR1,
      thresholds: { ...DEFAULT_THRESHOLDS, minLabour: 0 },
    });
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.reason).toBe('no-witness');
  });

  it('computes labour for the simple-sweep fixture', () => {
    // simple-sweep has south holding only [Jh, 9h] — single-suit, so
    // we relax the suit-span gate for this structural test.
    const r = computeDeductionLabour({
      state: fixtureSimpleSweep.state,
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        minLabour: 0,
        minWitnessSuitSpan: 1,
      },
    });
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.labour).toBeGreaterThanOrEqual(0);
      expect(r.loadBearingCards.length).toBe(r.labour);
      expect(r.witnessSuitSpan).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects single-suit witness when the gate is on', () => {
    const r = computeDeductionLabour({
      state: fixtureSimpleSweep.state,
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        minLabour: 0,
        minWitnessSuitSpan: 2, // simple-sweep has span=1
      },
    });
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.reason).toBe('single-suit-witness');
      expect(r.witnessSuitSpan).toBe(1);
    }
  });

  it('threshold gating rejects low-labour deals', () => {
    // Simple-sweep is robust top-trump; high labour threshold rejects.
    const r = computeDeductionLabour({
      state: fixtureSimpleSweep.state,
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        minLabour: 50, // unreachable
        minWitnessSuitSpan: 1, // disable suit-span gate so labour gate triggers
      },
    });
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.reason).toBe('low-labour');
      expect(r.labour).toBeDefined();
    }
  });
});
