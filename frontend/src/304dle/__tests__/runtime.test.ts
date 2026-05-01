import { describe, expect, it } from 'vitest';
import { dealForSeed, seedFromDate } from '../engine/dealing';
import {
  applyPlay,
  isGameOver,
  newRuntime,
  playBotTurn,
  resolveRound,
  turnOrder,
  whoseTurn,
} from '../runtime';
import { computeScore } from '../scoring';
import { buildShareGrid } from '../share';

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

describe('computeScore', () => {
  it('100 for correct call at par with no aids', () => {
    expect(computeScore({
      verdict: 'correct', callRound: 5, parRound: 5, hintsUsed: 0, worldsToggleUses: 0,
    }).total).toBe(100);
  });
  it('penalises late call vs par', () => {
    expect(computeScore({
      verdict: 'correct', callRound: 7, parRound: 5, hintsUsed: 0, worldsToggleUses: 0,
    }).total).toBe(100 - 16);
  });
  it('40 for late', () => {
    expect(computeScore({
      verdict: 'late', callRound: 7, parRound: 4, hintsUsed: 0, worldsToggleUses: 0,
    }).total).toBe(40);
  });
  it('0 for early/missed', () => {
    expect(computeScore({
      verdict: 'wrong-not-obligated', callRound: 3, parRound: 6, hintsUsed: 0, worldsToggleUses: 0,
    }).total).toBe(0);
  });
});

describe('share grid', () => {
  it('produces a non-empty multi-line grid', () => {
    const grid = buildShareGrid({
      date: '2026-05-01',
      difficulty: 'wednesday',
      verdict: 'correct',
      score: 100,
      callRound: 5,
      orderLength: 4,
      worldsAtCall: null,
    });
    expect(grid).toContain('304dle');
    expect(grid).toContain('100');
    expect(grid.split('\n').length).toBeGreaterThan(2);
  });
});
