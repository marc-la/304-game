import { describe, expect, it } from 'vitest';
import { dealForSeed, seedFromDate } from '../engine/dealing';
import {
  applyPlay,
  isGameOver,
  newRuntime,
  playBotTurn,
  resolveRound,
  toEngineState,
  turnOrder,
  whoseTurn,
} from '../runtime';
import { buildVerdict } from '../scoring';
import { buildShareGrid } from '../share';
import { fixtureSimpleSweep } from '../engine/__tests__/fixtures';
import type { Seat } from '../engine/seating';
import type { CardId } from '../engine/card';

describe('runtime', () => {
  it('plays a round when South + bots all move', () => {
    const deal = dealForSeed(seedFromDate('2026-05-01'));
    const rt = newRuntime({
      hands: deal.hands,
      trumpSuit: deal.trumpSuit,
      trumpCard: deal.trumpCard,
      botSeed: deal.botSeed,
    });
    expect(whoseTurn(rt)).toBe('south');
    const south0 = rt.hands.south[0];
    applyPlay(rt, 'south', south0);
    expect(whoseTurn(rt)).not.toBe('south');
    while (whoseTurn(rt) !== null) {
      const t = whoseTurn(rt)!;
      playBotTurn(rt, t);
    }
    expect(rt.currentRound.length).toBe(turnOrder(rt).length);
    const cr = resolveRound(rt);
    expect(cr.cards.length).toBe(4);
    expect(rt.completedRounds.length).toBe(1);
    expect(rt.roundNumber).toBe(2);
  });

  it('plays a complete game without error', () => {
    const deal = dealForSeed(seedFromDate('2026-08-15'));
    const rt = newRuntime({
      hands: deal.hands,
      trumpSuit: deal.trumpSuit,
      trumpCard: deal.trumpCard,
      botSeed: deal.botSeed,
    });
    while (!isGameOver(rt)) {
      const t = whoseTurn(rt);
      if (t === null) {
        resolveRound(rt);
        continue;
      }
      if (t === 'south') {
        // play any legal card (lowest first)
        applyPlay(rt, 'south', rt.hands.south[0]);
      } else {
        playBotTurn(rt, t);
      }
    }
    expect(rt.completedRounds.length).toBe(8);
    expect(rt.pointsWon.team_a + rt.pointsWon.team_b).toBe(304);
  });
});

describe('runtime caps obligation tracking', () => {
  it('exposes rt.capsObligations as the same map the engine writes to', () => {
    const deal = dealForSeed(seedFromDate('2026-05-01'));
    const rt = newRuntime({
      hands: deal.hands,
      trumpSuit: deal.trumpSuit,
      trumpCard: deal.trumpCard,
      botSeed: deal.botSeed,
    });
    expect(rt.capsObligations.size).toBe(0);
    // Reference identity matters: the engine mutates this same map.
    expect(toEngineState(rt).play.capsObligations).toBe(rt.capsObligations);
  });

  it('stamps south obligation on the next applyPlay once a cappable end-state arises', () => {
    // Mirror fixtureSimpleSweep (round 7 about to begin, south
    // holds [Jh, 9h] = top two trumps, all 6 prior rounds won by
    // team_a). After north opens round 7, the tracker should
    // detect obligation and stamp it.
    const fx = fixtureSimpleSweep;
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

    expect(rt.capsObligations.size).toBe(0);

    applyPlay(rt, 'north', 'Ah' as CardId);

    const stamp = rt.capsObligations.get('south' as Seat);
    expect(stamp).toBeDefined();
    expect(stamp).toEqual({
      obligatedAtRound: 7,
      obligatedAtCard: 1,
      vPlaysAtObligation: 6,
    });
  });

  it('does not stamp south when team_a has lost a round (precondition fails)', () => {
    const deal = dealForSeed(seedFromDate('2026-05-01'));
    const rt = newRuntime({
      hands: deal.hands,
      trumpSuit: deal.trumpSuit,
      trumpCard: deal.trumpCard,
      botSeed: deal.botSeed,
    });
    // Play one full round; whoever wins, by R2 it will not be the
    // case that team_a has won every round (probabilistically — and
    // even if they did, this test only asserts the absence of a
    // mid-game stamp on round 1, which the predicate cannot satisfy
    // because south still has 7 trumpless cards left).
    applyPlay(rt, 'south', rt.hands.south[0]);
    while (whoseTurn(rt) !== null) {
      const t = whoseTurn(rt)!;
      playBotTurn(rt, t);
    }
    resolveRound(rt);
    expect(rt.capsObligations.has('south' as Seat)).toBe(false);
  });
});

describe('buildVerdict', () => {
  it('correct at dynamic par + master worlds → no parDelta, extends streak', () => {
    const v = buildVerdict({
      verdict: 'correct', callRound: 5, obligatedAtRound: 5, worldsAtCall: 2000,
    });
    expect(v.parDelta).toBe(0);
    expect(v.difficulty).toBe('master');
    expect(v.extendsStreak).toBe(true);
  });
  it('correct but trivial worlds → no streak extension', () => {
    const v = buildVerdict({
      verdict: 'correct', callRound: 7, obligatedAtRound: 5, worldsAtCall: 3,
    });
    expect(v.parDelta).toBe(2);
    expect(v.difficulty).toBe('trivial');
    expect(v.extendsStreak).toBe(false);
  });
  it('late verdict does not extend streak', () => {
    const v = buildVerdict({
      verdict: 'late', callRound: 7, obligatedAtRound: 4, worldsAtCall: 50,
    });
    expect(v.extendsStreak).toBe(false);
  });
  it('wrong-not-obligated does not extend streak', () => {
    const v = buildVerdict({
      verdict: 'wrong-not-obligated', callRound: 3, obligatedAtRound: null, worldsAtCall: 5000,
    });
    expect(v.extendsStreak).toBe(false);
  });
  it('missed (no callRound, no worlds) yields null parDelta and null difficulty', () => {
    const v = buildVerdict({
      verdict: 'missed', callRound: null, obligatedAtRound: 6, worldsAtCall: null,
    });
    expect(v.parDelta).toBeNull();
    expect(v.difficulty).toBeNull();
    expect(v.extendsStreak).toBe(false);
  });
});

describe('share grid', () => {
  it('includes verdict + difficulty + dynamic par; no /100', () => {
    const grid = buildShareGrid({
      date: '2026-05-01',
      verdict: 'correct',
      callRound: 5,
      obligatedAtRound: 5,
      difficulty: 'master',
      worldsAtCall: 2000,
    });
    expect(grid).toContain('304dle');
    expect(grid).toContain('Caps');
    expect(grid).toContain('Master');
    expect(grid).not.toContain('/100');
    expect(grid.split('\n').length).toBeGreaterThan(2);
  });
});
