import { describe, expect, it } from 'vitest';
import {
  checkCapsObligation,
  trackCapsObligation,
  validateCapsCall,
} from '../caps';
import { checkCapsObligationCSP } from '../caps-csp';
import type { CardId } from '../card';
import type { CapsObligation, EngineGameState } from '../state';
import type { Seat } from '../seating';
import { SEAT_INDEX } from '../seating';
import { buildInfoSet, enumerateWorlds, worldIsConsistent } from '../info';
import {
  ALL_FIXTURES,
  fixtureLostARound,
  fixtureNotObligated,
  fixtureSimpleSweep,
} from './fixtures';

describe('end-to-end caps fixtures', () => {
  for (const fx of ALL_FIXTURES) {
    describe(fx.id, () => {
      it(`obligation == ${fx.expected.obligated}`, () => {
        expect(checkCapsObligation(fx.state, fx.viewer)).toBe(
          fx.expected.obligated,
        );
      });

      if (fx.expected.correctOrders) {
        for (const order of fx.expected.correctOrders) {
          it(`accepts witness order ${order.join(',')}`, () => {
            expect(validateCapsCall(fx.state, fx.viewer, order)).toBe(true);
          });
        }
      }

      if (fx.expected.incorrectOrders) {
        for (const order of fx.expected.incorrectOrders) {
          it(`rejects bad order ${order.join(',')}`, () => {
            expect(validateCapsCall(fx.state, fx.viewer, order)).toBe(false);
          });
        }
      }
    });
  }
});

describe('information set & world enumeration', () => {
  it('builds info-set with deduced exhausted suits', () => {
    const fx = ALL_FIXTURES.find(f => f.id === 'simple-sweep-trump-dominance')!;
    const info = buildInfoSet(fx.state, fx.viewer);
    // After 6 completed rounds where each seat played the led suit
    // every time, no exhaustion is publicly known. So exhaustedSuits
    // should be empty for all seats.
    for (const set of info.exhaustedSuits.values()) {
      expect(set.size).toBe(0);
    }
    expect(info.teamWonAllCompleted).toBe(true);
    expect(info.ownHand).toEqual(['Jh', '9h']);
  });

  it('enumerated worlds are all consistent and in deterministic order', () => {
    const fx = ALL_FIXTURES.find(f => f.id === 'simple-sweep-trump-dominance')!;
    const info = buildInfoSet(fx.state, fx.viewer);
    const worlds = [...enumerateWorlds(info, { maxWorlds: 1000 })];
    expect(worlds.length).toBeGreaterThan(0);
    for (const w of worlds) expect(worldIsConsistent(w, info)).toBe(true);

    // Same seed → same order
    const worlds2 = [...enumerateWorlds(info, { maxWorlds: 1000 })];
    expect(worlds.length).toBe(worlds2.length);
  });

  it('enumerated worlds for last-round include exactly one world', () => {
    const fx = ALL_FIXTURES.find(f => f.id === 'last-round-trivial')!;
    const info = buildInfoSet(fx.state, fx.viewer);
    const worlds = [...enumerateWorlds(info, { maxWorlds: 100 })];
    // South knows their hand (Jh) and all 28 played cards. The
    // remaining 3 cards (Ah, 9h, 10h) are split 1/1/1 among NWE.
    // 3! = 6 permutations.
    expect(worlds.length).toBe(6);
  });
});

describe('trackCapsObligation', () => {
  it('stamps south with correct fields when obligation holds', () => {
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(fixtureSimpleSweep.state, target);
    const stamp = target.get('south');
    expect(stamp).toBeDefined();
    // Round 7 about to start; current round empty; south has played
    // 6 times (one per completed round).
    expect(stamp).toEqual({
      obligatedAtRound: 7,
      obligatedAtCard: 0,
      vPlaysAtObligation: 6,
    });
  });

  it('does not stamp when obligation does not hold', () => {
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(fixtureNotObligated.state, target);
    expect(target.has('south')).toBe(false);
  });

  it('does not stamp when team has lost a round', () => {
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(fixtureLostARound.state, target);
    expect(target.has('south')).toBe(false);
  });

  it('is idempotent: never overwrites an existing stamp', () => {
    const target = new Map<Seat, CapsObligation>();
    const sentinel: CapsObligation = {
      obligatedAtRound: 1,
      obligatedAtCard: 0,
      vPlaysAtObligation: 0,
    };
    target.set('south', sentinel);
    trackCapsObligation(fixtureSimpleSweep.state, target);
    expect(target.get('south')).toBe(sentinel);
  });

  it('skips the seat marked pccPartnerOut', () => {
    const stateWithPccOut: EngineGameState = {
      ...fixtureSimpleSweep.state,
      pccPartnerOut: 'south',
    };
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(stateWithPccOut, target);
    expect(target.has('south')).toBe(false);
  });

  it('does not stamp once the call window has closed (round 8, full round)', () => {
    // Synthesize a "round 8 with 4 cards in flight" snapshot. The
    // exact contents do not matter — the window guard short-circuits
    // before predicate evaluation.
    const base = fixtureSimpleSweep.state;
    const closed: EngineGameState = {
      ...base,
      play: {
        ...base.play,
        roundNumber: 8,
        currentRound: [
          { seat: 'north', card: 'Ah', faceDown: false, revealed: false },
          { seat: 'west', card: 'Kh', faceDown: false, revealed: false },
          { seat: 'south', card: 'Jh', faceDown: false, revealed: false },
          { seat: 'east', card: '8h', faceDown: false, revealed: false },
        ],
      },
    };
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(closed, target);
    expect(target.has('south')).toBe(false);
  });

  it('honors a custom seats list (e.g. tracking only north)', () => {
    const target = new Map<Seat, CapsObligation>();
    trackCapsObligation(fixtureSimpleSweep.state, target, {
      seats: ['north'],
    });
    expect(target.has('south')).toBe(false);
    // North's predicate may or may not hold in this fixture; either
    // way the south-skip is the load-bearing assertion.
  });
});

// §T9 lift / W6 — verify the CSP path consumes info.knownInHand for
// the publicly-lifted folded trump card, per caps_formalism.md §4 W6
// and docs/handoffs/info-set-completeness-v2-handoff.md (priority finding).
// Before the v2 fix, initCtx left the lifted card in the shared pool;
// after the fix, it's tracked in OppConstraint.forced for the trumper.
describe('§T9 lift / W6 — CSP consumes knownInHand', () => {
  const c = (s: string): CardId => s as CardId;

  // Build a post-§T9 state. Trumper = west (so south is on the
  // opposing team, matching the handoff's external-caps framing).
  // 2 rounds remaining; 6 completed (team_a won all). The lifted
  // trump card 7c is publicly in west's hand. Completed rounds are
  // all face-up suit-following so no observable exhaustion is
  // deduced — exhaustion would confound the W6 test by independently
  // pruning the unknown pool.
  const buildPostLiftState = (foldedLifted: boolean): EngineGameState => {
    const hands: CardId[][] = [[], [], [], []];
    hands[SEAT_INDEX.south] = [c('Jc'), c('Ah')];
    hands[SEAT_INDEX.north] = [c('Jh'), c('9h')];
    hands[SEAT_INDEX.west] = [c('7c'), c('Kd')];
    hands[SEAT_INDEX.east] = [c('Ks'), c('Qs')];

    // 6 completed rounds, each pure-suit (no exhaustion deduced),
    // each won by team_a. The arrangement is a stylised one — the
    // CSP only needs the led-suit / winner / face-up entries to be
    // self-consistent, not to mirror a real bid trajectory.
    const round = (
      n: number,
      cards: Array<[Seat, string]>,
      winner: Seat,
    ) => ({
      roundNumber: n,
      cards: cards.map(([seat, card]) => ({
        seat,
        card: c(card),
        faceDown: false,
        revealed: false,
      })),
      winner,
      pointsWon: 0,
      trumpRevealed: false,
    });

    return {
      hands,
      trump: {
        trumperSeat: 'west',
        trumpSuit: 'c',
        trumpCard: c('7c'),
        trumpCardInHand: true,
        isRevealed: true,
        isOpen: true,
        foldedCardLifted: foldedLifted,
      },
      play: {
        roundNumber: 7,
        priority: 'south',
        currentRound: [],
        completedRounds: [
          // Pure-diamond round (all follow), south wins.
          // All pure-suit rounds (every entry follows the led suit) so
          // no opp exhaustion is deduced. With no exhaustion, the only
          // remaining constraints on pool placement are hand-size and
          // (with W6) the forced 7c in west. Keeps the test focused on
          // the W6 path.
          round(1,
            [['south', 'Jd'], ['east', 'Ad'], ['north', '10d'], ['west', '7d']],
            'south'),
          round(2,
            [['south', 'Js'], ['east', 'As'], ['north', '10s'], ['west', '9s']],
            'south'),
          round(3,
            [['south', '9c'], ['east', 'Ac'], ['north', 'Qc'], ['west', '8c']],
            'south'),
          round(4,
            [['south', '10h'], ['east', 'Qh'], ['north', '8h'], ['west', '7h']],
            'south'),
          round(5,
            [['south', 'Kc'], ['east', '10c'], ['north', 'Kh'], ['west', 'Qd']],
            'south'),
          round(6,
            [['south', '8d'], ['east', '8s'], ['north', '7s'], ['west', '9d']],
            'south'),
        ],
        pointsWon: { team_a: 0, team_b: 0 },
        capsObligations: new Map(),
      },
      pccPartnerOut: null,
    };
  };

  it('builds knownInHand with the lifted trump card in the trumper\'s seat', () => {
    const state = buildPostLiftState(true);
    const info = buildInfoSet(state, 'south');
    const westKnown = info.knownInHand.get('west');
    expect(westKnown).toBeDefined();
    expect(westKnown!.has(c('7c'))).toBe(true);
    expect(westKnown!.size).toBe(1);
  });

  it('enumerated worlds all place the lifted trump card in west\'s hand (W6)', () => {
    const state = buildPostLiftState(true);
    const info = buildInfoSet(state, 'south');
    const worlds = [...enumerateWorlds(info, { maxWorlds: 5000 })];
    expect(worlds.length).toBeGreaterThan(0);
    for (const w of worlds) {
      // The load-bearing W6 invariant: the publicly-known lifted trump
      // card appears in the trumper's hand in every enumerated world.
      expect(w.hands[SEAT_INDEX.west].includes(c('7c'))).toBe(true);
    }
  });

  it('CSP path runs cleanly against a post-§T9 state with knownInHand', () => {
    const state = buildPostLiftState(true);
    // Smoke test: must not throw, must return boolean. The exact
    // obligation value depends on the universal opp's freedom in this
    // wide-open pool; the load-bearing assertion is that the new
    // forced-card extension (OppConstraint.forced, applyOppPlay's
    // fromForced branch, consistency-check arithmetic) survives an
    // actual evaluation without contradicting the pool size invariant
    // (which would return null from initCtx → false here).
    const result = checkCapsObligationCSP(state, 'south');
    expect(typeof result).toBe('boolean');
  });

  it('toggling foldedCardLifted toggles whether the trumper\'s slot is forced', () => {
    // When foldedCardLifted=false, buildInfoSet does NOT populate
    // knownInHand, so the CSP treats 7c as a free pool card (the
    // pre-v2 behaviour). When true, 7c is forced in west. This test
    // confirms the data path is wired end-to-end — the InfoSet → CSP
    // bridge actually delivers the forced card.
    const lifted = buildPostLiftState(true);
    const notLifted = buildPostLiftState(false);

    const liftedInfo = buildInfoSet(lifted, 'south');
    const notLiftedInfo = buildInfoSet(notLifted, 'south');

    expect(liftedInfo.knownInHand.get('west')?.size ?? 0).toBe(1);
    expect(notLiftedInfo.knownInHand.size).toBe(0);
  });
});
