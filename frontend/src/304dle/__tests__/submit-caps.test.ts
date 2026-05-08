// End-to-end verdict tests for the submitCaps store action.
// The engine layer is unit-tested elsewhere; these tests verify
// the store + runtime + engine wiring produces the right verdict
// across the four reachable branches of the verdict tree.

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

// Build a Runtime whose internal state mirrors a caps test fixture
// (engine-level EngineGameState). The fixture supplies completed
// rounds, current hands, trump, and priority. We project these
// onto the runtime fields directly — there is no public mutator.
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

const seedCapsEntry = (rt: Runtime, chosen: CardId[]) => {
  useStore.setState({
    state: {
      kind: 'caps-entry',
      puzzle: stubPuzzle(rt),
      runtime: rt,
      chosen,
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

describe('submitCaps verdict tree', () => {
  beforeEach(() => {
    // Reset store to a known state before each test.
    useStore.setState({ state: { kind: 'loading' } });
  });

  it("'correct' when called at first-moment with a witness order", () => {
    // fixtureSimpleSweep: round 7 about to start, south holds top
    // two trumps, both [Jh,9h] and [9h,Jh] are witness orders.
    const rt = runtimeFromFixture(fixtureSimpleSweep);
    // Trigger the tracker by playing a single card. The stamp
    // lands at {round:7, card:1, vPlays:6}.
    applyPlay(rt, 'north', 'Ah' as CardId);
    expect(rt.capsObligations.size).toBe(1);

    seedCapsEntry(rt, ['Jh', '9h'] as CardId[]);
    useStore.getState().submitCaps();
    expect(verdict()).toBe('correct');
  });

  it("'late' when caller plays a card after obligation arises before calling", () => {
    const rt = runtimeFromFixture(fixtureSimpleSweep);
    // Stamp at the natural first-moment.
    applyPlay(rt, 'north', 'Ah' as CardId);
    applyPlay(rt, 'west', 'Kh' as CardId);
    // South now plays Jh → vPlaysNow = 7 > vPlaysAtObligation = 6.
    applyPlay(rt, 'south', 'Jh' as CardId);
    expect(rt.capsObligations.get('south' as Seat)?.vPlaysAtObligation)
      .toBe(6);

    // Remaining hand is [9h]; a single-card order trivially
    // sweeps R7's tail and R8.
    seedCapsEntry(rt, ['9h'] as CardId[]);
    useStore.getState().submitCaps();
    expect(verdict()).toBe('late');
  });

  it("'wrong-not-obligated' when obligation never holds", () => {
    // fixtureNotObligated: round 7 start, south holds [Jh, 7h].
    // 7h cannot sweep R8, so obligation is false.
    const rt = runtimeFromFixture(fixtureNotObligated);
    expect(rt.capsObligations.size).toBe(0);
    seedCapsEntry(rt, ['Jh', '7h'] as CardId[]);
    useStore.getState().submitCaps();
    expect(verdict()).toBe('wrong-not-obligated');
  });

  it("'wrong-bad-order' when obligated but the chosen order does not match the hand", () => {
    // fixtureSimpleSweep is obligated; submitting a partial
    // order (missing 9h) makes validateCapsCall fail on the
    // multiset check while obligation is true.
    const rt = runtimeFromFixture(fixtureSimpleSweep);
    applyPlay(rt, 'north', 'Ah' as CardId);
    seedCapsEntry(rt, ['Jh'] as CardId[]);
    useStore.getState().submitCaps();
    expect(verdict()).toBe('wrong-bad-order');
  });

  it('finishGame awards full 100 when caps is called at the first possible moment', () => {
    // Regression for the par/call convention bridge: puzzle
    // generator records optimalCallRound=R (rounds completed at
    // first obligation); runtime emits callRound = roundNumber
    // (the round in which the call happens). Calling at the
    // earliest moment must net zero parPenalty.
    const rt = runtimeFromFixture(fixtureSimpleSweep);
    applyPlay(rt, 'north', 'Ah' as CardId);

    // Stub puzzle with optimalCallRound = 6 (matching generator
    // convention: obligation first detected post-round-6 here).
    useStore.setState({
      state: {
        kind: 'caps-entry',
        puzzle: {
          ...stubPuzzle(rt),
          classification: {
            capsAchievable: true,
            optimalCallRound: 6,
            parScore: 100,
          },
        },
        runtime: rt,
        chosen: ['Jh', '9h'] as CardId[],
      },
    });
    useStore.getState().submitCaps();
    expect(verdict()).toBe('correct');
    useStore.getState().finishGame();

    const s = useStore.getState().state;
    if (s.kind !== 'result') throw new Error(`expected result, got ${s.kind}`);
    expect(s.score).toBe(100);
    expect(s.callRound).toBe(7); // user-facing display: round 7
  });
});
