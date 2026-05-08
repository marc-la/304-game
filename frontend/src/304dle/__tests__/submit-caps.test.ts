// End-to-end verdict tests for the submitCaps store action.
// Adaptive caps (rules.md §C-1 rewrite): no order is committed by
// the player. submitCaps verifies obligation via the CSP solver
// and emits a verdict.

import { beforeEach, describe, expect, it } from 'vitest';
import type { CardId } from '../engine/card';
import type { Seat } from '../engine/seating';
import {
  fixtureNotObligated,
  fixtureSimpleSweep,
} from '../engine/__tests__/fixtures';
import { applyPlay, newRuntime, type Runtime } from '../runtime';
import { useStore } from '../store';
import type { DailyPuzzle } from '../types';
import type { Fixture } from '../engine/__tests__/fixtures';

const runtimeFromFixture = (fx: Fixture): Runtime => {
  const rt = newRuntime({
    hands: {
      north: [...fx.state.hands.get('north')!],
      west: [...fx.state.hands.get('west')!],
      south: [...fx.state.hands.get('south')!],
      east: [...fx.state.hands.get('east')!],
    },
    trumpSuit: fx.state.trump.trumpSuit,
    trumpCard: fx.state.trump.trumpCard!,
    botSeed: 0,
  });
  rt.roundNumber = fx.state.play.roundNumber;
  rt.priority = fx.state.play.priority;
  rt.completedRounds = fx.state.play.completedRounds.map(r => ({
    ...r,
    cards: [...r.cards],
  }));
  rt.pointsWon = { ...fx.state.play.pointsWon };
  return rt;
};

const stubPuzzle = (rt: Runtime): DailyPuzzle => ({
  date: '2026-01-01',
  seed: 0,
  hands: {
    north: [...rt.hands.north],
    west: [...rt.hands.west],
    south: [...rt.hands.south],
    east: [...rt.hands.east],
  },
  trump: { suit: rt.trumpSuit, card: rt.trumpCard, trumper: 'south' },
  botSeed: 0,
  difficulty: 'wednesday',
  classification: {
    capsAchievable: true,
    optimalCallRound: 7,
    parScore: 100,
  },
});

const seedCapsConfirm = (rt: Runtime, puzzle?: DailyPuzzle) => {
  useStore.setState({
    state: {
      kind: 'caps-confirm',
      puzzle: puzzle ?? stubPuzzle(rt),
      runtime: rt,
    },
  });
};

const verdict = () => {
  const s = useStore.getState().state;
  if (s.kind !== 'caps-reveal') {
    throw new Error(`expected caps-reveal, got ${s.kind}`);
  }
  return s.verdict;
};

describe('submitCaps verdict tree (adaptive)', () => {
  beforeEach(() => {
    useStore.setState({ state: { kind: 'loading' } });
  });

  it("'correct' when caller is obligated and on time", () => {
    const rt = runtimeFromFixture(fixtureSimpleSweep);
    applyPlay(rt, 'north', 'Ah' as CardId);
    expect(rt.capsObligations.size).toBe(1);

    seedCapsConfirm(rt);
    useStore.getState().submitCaps();
    expect(verdict()).toBe('correct');
  });

  it("'late' when caller plays a card after obligation arises before calling", () => {
    const rt = runtimeFromFixture(fixtureSimpleSweep);
    applyPlay(rt, 'north', 'Ah' as CardId);
    applyPlay(rt, 'west', 'Kh' as CardId);
    applyPlay(rt, 'south', 'Jh' as CardId);
    expect(rt.capsObligations.get('south' as Seat)?.vPlaysAtObligation)
      .toBe(6);

    seedCapsConfirm(rt);
    useStore.getState().submitCaps();
    expect(verdict()).toBe('late');
  });

  it("'wrong-not-obligated' when obligation never holds", () => {
    const rt = runtimeFromFixture(fixtureNotObligated);
    expect(rt.capsObligations.size).toBe(0);
    seedCapsConfirm(rt);
    useStore.getState().submitCaps();
    expect(verdict()).toBe('wrong-not-obligated');
  });

  it("'late' wins precedence when stamp predates current state", () => {
    const rt = runtimeFromFixture(fixtureSimpleSweep);
    rt.capsObligations.set('south' as Seat, {
      obligatedAtRound: 7,
      obligatedAtCard: 0,
      vPlaysAtObligation: 6,
    });
    applyPlay(rt, 'north', 'Ah' as CardId);
    applyPlay(rt, 'west', 'Kh' as CardId);
    applyPlay(rt, 'south', '9h' as CardId);
    seedCapsConfirm(rt);
    useStore.getState().submitCaps();
    expect(verdict()).toBe('late');
  });

  it('finishGame surfaces callRound and displayPar (par+1) when obligation just arose', () => {
    const rt = runtimeFromFixture(fixtureSimpleSweep);
    applyPlay(rt, 'north', 'Ah' as CardId);

    seedCapsConfirm(rt, {
      ...stubPuzzle(rt),
      classification: {
        capsAchievable: true,
        optimalCallRound: 6,
        parScore: 100,
      },
    });
    useStore.getState().submitCaps();
    expect(verdict()).toBe('correct');
    useStore.getState().finishGame();

    const s = useStore.getState().state;
    if (s.kind !== 'result') throw new Error(`expected result, got ${s.kind}`);
    expect(s.callRound).toBe(7);
    expect(s.parRound).toBe(7);
    expect(s.verdict).toBe('correct');
  });
});
