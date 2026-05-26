// End-to-end verdict tests for the submitCaps store action.
// Adaptive caps (rules.md §C-1 rewrite): submitCaps verifies obligation
// via the CSP solver and emits a verdict.

import { beforeEach, describe, expect, it } from 'vitest';
import type { CardId } from '@engine/card';
import { SEAT_INDEX, type Seat } from '@engine/seating';
import {
  fixtureNotObligated,
  fixtureSimpleSweep,
} from '@engine/__tests__/fixtures';
import { applyPlay, newRuntime, type Runtime } from '../runtime';
import { useStore } from '../store';
import type { ScriptedPuzzle } from '../types';
import type { Fixture } from '@engine/__tests__/fixtures';

const runtimeFromFixture = (fx: Fixture): Runtime => {
  const rt = newRuntime({
    hands: {
      north: [...fx.state.hands[SEAT_INDEX.north]],
      west: [...fx.state.hands[SEAT_INDEX.west]],
      south: [...fx.state.hands[SEAT_INDEX.south]],
      east: [...fx.state.hands[SEAT_INDEX.east]],
    },
    trumpSuit: fx.state.trump.trumpSuit,
    trumpCard: fx.state.trump.trumpCard!,
    trumperSeat: 'south',
    priority: fx.state.play.priority,
    script: [],
    mode: 'open',
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

const stubPuzzle = (rt: Runtime): ScriptedPuzzle => ({
  schemaVersion: 2,
  id: 'fixture-stub',
  seed: 0,
  hands: {
    north: [...rt.hands.north],
    west: [...rt.hands.west],
    south: [...rt.hands.south],
    east: [...rt.hands.east],
  },
  trump: {
    suit: rt.trump.trumpSuit,
    card: rt.trump.trumpCard!,
    trumper: 'south',
    mode: 'open',
    trumpCardInHand: true,
  },
  priority: rt.priority,
  script: [],
  obligation: { round: 7, afterCardIndex: 24 },
  meta: {
    bot: { id: 'fixture', rating: null },
    capsType: 'internal',
    labour: 0,
    witnessSuitSpan: 1,
  },
});

const seedCapsConfirm = (rt: Runtime, puzzle?: ScriptedPuzzle) => {
  useStore.setState({
    state: {
      kind: 'caps-confirm',
      puzzle: puzzle ?? stubPuzzle(rt),
      date: '2026-01-01',
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

  it('finishGame surfaces callRound and obligatedAtRound', () => {
    const rt = runtimeFromFixture(fixtureSimpleSweep);
    applyPlay(rt, 'north', 'Ah' as CardId);

    seedCapsConfirm(rt);
    useStore.getState().submitCaps();
    expect(verdict()).toBe('correct');
    useStore.getState().finishGame();

    const s = useStore.getState().state;
    if (s.kind !== 'result') throw new Error(`expected result, got ${s.kind}`);
    expect(s.callRound).toBe(7);
    expect(s.obligatedAtRound).toBe(7);
    expect(s.verdict).toBe('correct');
  });
});
