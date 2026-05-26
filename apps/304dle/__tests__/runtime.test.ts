import { describe, expect, it } from 'vitest';
import { dealForSeed, seedFromDate } from '@engine/dealing';
import {
  applyPlay,
  applyScriptedPlay,
  isGameOver,
  newRuntime,
  resolveRound,
  toEngineState,
  whoseTurn,
} from '../runtime';
import { buildVerdict } from '../scoring';
import { buildShareGrid } from '../share';
import { fixtureSimpleSweep } from '@engine/__tests__/fixtures';
import { SEAT_INDEX, type Seat } from '@engine/seating';
import type { CardId } from '@engine/card';
import type { ScriptedPlay } from '../types';

// Build a minimal script-driver runtime from a deal. The script is
// supplied by the caller; tests that don't exercise the cursor pass
// an empty script and just call applyPlay() directly.
const newRuntimeFromDeal = (
  deal: ReturnType<typeof dealForSeed>,
  script: ScriptedPlay[] = [],
) =>
  newRuntime({
    hands: deal.hands,
    trumpSuit: deal.trumpSuit,
    trumpCard: deal.trumpCard,
    trumperSeat: 'south',
    priority: 'south',
    script,
    mode: 'open',
  });

describe('runtime', () => {
  it('applies a manual play and a round resolves to 4 cards', () => {
    const deal = dealForSeed(seedFromDate('2026-05-01'));
    const rt = newRuntimeFromDeal(deal);
    expect(whoseTurn(rt)).toBe('south');
    applyPlay(rt, 'south', rt.hands.south[0]);
    // Build a "round" by manually playing the other seats; we don't
    // care which card, just that the round resolves.
    for (const seat of ['east', 'north', 'west'] as Seat[]) {
      applyPlay(rt, seat, rt.hands[seat][0]);
    }
    expect(rt.currentRound.length).toBe(4);
    const cr = resolveRound(rt);
    expect(cr.cards.length).toBe(4);
    expect(rt.completedRounds.length).toBe(1);
    expect(rt.roundNumber).toBe(2);
  });

  it('applyScriptedPlay advances the cursor and applies in script order', () => {
    const deal = dealForSeed(seedFromDate('2026-05-01'));
    // Build a legal R1 script: south (trumper, priority, open) MUST
    // lead trump per §T-7; others follow-suit if able.
    const trumpSuit = deal.trumpSuit;
    const southLead = deal.hands.south.find(c => c.endsWith(trumpSuit))
      ?? deal.hands.south[0];
    const followOrAny = (seat: Seat): CardId => {
      const led = southLead.endsWith(trumpSuit) ? trumpSuit : southLead.slice(-1) as typeof trumpSuit;
      const inSuit = deal.hands[seat].find(c => c.endsWith(led));
      return (inSuit ?? deal.hands[seat][0]) as CardId;
    };
    const seats: Seat[] = ['south', 'east', 'north', 'west'];
    const script: ScriptedPlay[] = seats.map(seat => ({
      round: 1,
      seat,
      card: seat === 'south' ? southLead : followOrAny(seat),
      faceDown: false,
    }));
    const rt = newRuntimeFromDeal(deal, script);
    for (let i = 0; i < 4; i++) applyScriptedPlay(rt);
    expect(rt.currentRound.length).toBe(4);
    expect(rt.cursor).toBe(4);
  });

  it('plays a complete game by manual application', () => {
    const deal = dealForSeed(seedFromDate('2026-08-15'));
    const rt = newRuntimeFromDeal(deal);
    while (!isGameOver(rt)) {
      const t = whoseTurn(rt);
      if (t === null) {
        resolveRound(rt);
        continue;
      }
      applyPlay(rt, t, rt.hands[t][0]);
    }
    expect(rt.completedRounds.length).toBe(8);
    expect(rt.pointsWon.team_a + rt.pointsWon.team_b).toBe(304);
  });
});

describe('runtime caps obligation tracking', () => {
  it('exposes rt.capsObligations as the same map the engine writes to', () => {
    const deal = dealForSeed(seedFromDate('2026-05-01'));
    const rt = newRuntimeFromDeal(deal);
    expect(rt.capsObligations.size).toBe(0);
    expect(toEngineState(rt).play.capsObligations).toBe(rt.capsObligations);
  });

  it('stamps south obligation on the next applyPlay once a cappable end-state arises', () => {
    const fx = fixtureSimpleSweep;
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
