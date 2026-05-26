// Closure-property tests for the information set (A8).
//
// docs/specs/caps_formalism.md §3.5 states five closure properties
// (I-C1..I-C5) as invariants over event-driven state transitions.
// These tests construct representative states and assert the
// properties hold across canonical transitions:
//
//   I-C2 (observation discipline) — a non-revealing face-up play
//        does not change knownInHand.
//   I-C3 (monotone components) — knownPlayed.size and hiddenSlots
//        evolve monotonically (knownPlayed only grows; hiddenSlots
//        shrinks only at §T9 reveal).
//   I-C5 (world-set monotonicity) — observation events do not grow
//        the world set (modulo the freshly-played card factor).
//
// I-C1 (persistence) and I-C4 (knownInHand evolution) are covered
// by the §T9 / open-trump-reveal tests in info.test.ts.

import { describe, expect, it } from 'vitest';

import type { CardId } from '../card';
import { buildInfoSet, enumerateWorlds } from '../info';
import { SEAT_INDEX } from '../seating';
import type { Seat } from '../seating';
import type { EngineGameState, RoundEntry } from '../state';

const c = (s: string): CardId => s as CardId;

// Open-trump, all-face-up starting state. Useful as a base for the
// closure-property transitions below — incrementally play face-up
// cards and observe info-set invariants.
const buildOpenTrumpState = (): EngineGameState => {
  const hands: CardId[][] = [[], [], [], []];
  hands[SEAT_INDEX.south] = [
    c('Jh'), c('9h'), c('Ah'), c('10h'),
    c('Kh'), c('Qh'), c('8h'), c('7h'),
  ];
  hands[SEAT_INDEX.north] = [
    c('Jd'), c('9d'), c('Ad'), c('10d'),
    c('Kd'), c('Qd'), c('8d'), c('7d'),
  ];
  hands[SEAT_INDEX.west] = [
    c('Jc'), c('9c'), c('Ac'), c('10c'),
    c('Kc'), c('Qc'), c('8c'), c('7c'),
  ];
  hands[SEAT_INDEX.east] = [
    c('Js'), c('9s'), c('As'), c('10s'),
    c('Ks'), c('Qs'), c('8s'), c('7s'),
  ];
  return {
    hands,
    trump: {
      trumperSeat: 'south',
      trumpSuit: 'h',
      trumpCard: c('Jh'),
      trumpCardInHand: true,
      isRevealed: true,
      isOpen: true,
    },
    play: {
      roundNumber: 1,
      priority: 'south',
      currentRound: [],
      completedRounds: [],
      pointsWon: { team_a: 0, team_b: 0 },
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

// Apply a face-up play to a state (mutates a clone). For tests only;
// not a full play engine — skips validation. Hand is decremented;
// current round gets the entry; if the round is now 4-long, resolves
// it (winner = first card's seat for simplicity — closure tests don't
// depend on actual round-resolution rules).
const playFaceUp = (
  state: EngineGameState,
  seat: Seat,
  card: CardId,
): EngineGameState => {
  const hands = state.hands.map(h => [...h]);
  const idx = hands[SEAT_INDEX[seat]].indexOf(card);
  if (idx < 0) throw new Error(`${card} not in ${seat}'s hand`);
  hands[SEAT_INDEX[seat]].splice(idx, 1);
  const entry: RoundEntry = { seat, card, faceDown: false, revealed: false };
  const newCurrent = [...state.play.currentRound, entry];
  if (newCurrent.length < 4) {
    return {
      ...state,
      hands,
      play: { ...state.play, currentRound: newCurrent },
    };
  }
  // Round full → resolve. Winner is the first seat for test simplicity.
  return {
    ...state,
    hands,
    play: {
      ...state.play,
      roundNumber: state.play.roundNumber + 1,
      priority: newCurrent[0].seat,
      currentRound: [],
      completedRounds: [
        ...state.play.completedRounds,
        {
          roundNumber: state.play.roundNumber,
          cards: newCurrent,
          winner: newCurrent[0].seat,
          pointsWon: 0,
          trumpRevealed: false,
        },
      ],
    },
  };
};

describe('I-C2: observation discipline — non-revealing face-up plays', () => {
  it('does not change knownInHand', () => {
    // Seed with revealedTrumpCardId so knownInHand is non-empty.
    let state: EngineGameState = {
      ...buildOpenTrumpState(),
      trump: {
        trumperSeat: 'south',
        trumpSuit: 'h',
        trumpCard: c('Jh'),
        trumpCardInHand: true,
        isRevealed: true,
        isOpen: true,
        revealedTrumpCardId: c('9h'),
      },
    };
    const before = buildInfoSet(state, 'east');
    const beforeKnown = new Set(before.knownInHand.get('south') ?? []);
    expect(beforeKnown.has(c('9h'))).toBe(true);

    // Apply face-up plays that are NOT the revealed card.
    state = playFaceUp(state, 'south', c('Ah'));
    state = playFaceUp(state, 'west', c('Ac'));
    const after = buildInfoSet(state, 'east');
    const afterKnown = new Set(after.knownInHand.get('south') ?? []);
    expect(afterKnown).toEqual(beforeKnown);
    expect(afterKnown.has(c('9h'))).toBe(true);
  });
});

describe('I-C3: monotone components', () => {
  it('knownPlayed.size is non-decreasing across face-up plays', () => {
    let state = buildOpenTrumpState();
    let prevSize = buildInfoSet(state, 'east').knownPlayed.size;

    const plays: Array<[Seat, CardId]> = [
      ['south', c('Ah')], ['west', c('Ac')], ['north', c('Ad')], ['east', c('As')],
      ['south', c('Kh')], ['west', c('Kc')], ['north', c('Kd')], ['east', c('Ks')],
      ['south', c('Qh')], ['west', c('Qc')], ['north', c('Qd')], ['east', c('Qs')],
    ];
    for (const [seat, card] of plays) {
      state = playFaceUp(state, seat, card);
      const size = buildInfoSet(state, 'east').knownPlayed.size;
      expect(size).toBeGreaterThanOrEqual(prevSize);
      prevSize = size;
    }
  });

  it('hiddenSlots is non-decreasing across face-down plays (no §T9)', () => {
    // Closed-trump R1 with multiple face-downs not triggering §T9.
    // (Trump is hearts; we play diamonds/spades face-down which won't
    // reveal trump.) Each face-down adds a hidden slot for the viewer.
    let state: EngineGameState = {
      ...buildOpenTrumpState(),
      trump: {
        trumperSeat: 'south',
        trumpSuit: 'h',
        trumpCard: c('Jh'),
        trumpCardInHand: false,
        isRevealed: false,
        isOpen: false,
      },
    };
    // South cannot lead trump on R1 closed; lead a diamond.
    // But south's hand only has hearts. Switch leader to north.
    state = { ...state, play: { ...state.play, priority: 'north' } };
    // North leads 10d; west pitches a club (face-down minus); south
    // pitches a heart (no can do — south has only hearts and trump is
    // hearts, so south CAN follow trump-led, but trump-led isn't valid
    // — north led 10d). South pitches a heart face-down (non-led
    // suit). Note: the test doesn't validate play legality.
    state = playFaceUp(state, 'north', c('10d'));
    let info = buildInfoSet(state, 'east');
    const slots0 = info.hiddenSlots.length;
    expect(slots0).toBe(0);

    const fdEntry = (seat: Seat, card: CardId): RoundEntry => ({
      seat, card, faceDown: true, revealed: false,
    });
    // Append a face-down play directly to mimic the state machine.
    const handsAfterWest = state.hands.map(h => [...h]);
    handsAfterWest[SEAT_INDEX.west] = handsAfterWest[SEAT_INDEX.west]
      .filter(x => x !== c('Jc'));
    state = {
      ...state,
      hands: handsAfterWest,
      play: {
        ...state.play,
        currentRound: [...state.play.currentRound, fdEntry('west', c('Jc'))],
      },
    };
    info = buildInfoSet(state, 'east');
    const slots1 = info.hiddenSlots.length;
    expect(slots1).toBeGreaterThanOrEqual(slots0);

    // Another face-down.
    const handsAfterSouth = state.hands.map(h => [...h]);
    handsAfterSouth[SEAT_INDEX.south] = handsAfterSouth[SEAT_INDEX.south]
      .filter(x => x !== c('Qh'));
    state = {
      ...state,
      hands: handsAfterSouth,
      play: {
        ...state.play,
        currentRound: [...state.play.currentRound, fdEntry('south', c('Qh'))],
      },
    };
    info = buildInfoSet(state, 'east');
    expect(info.hiddenSlots.length).toBeGreaterThanOrEqual(slots1);
  });
});

describe('I-C5: world-set monotonicity', () => {
  it('enumerateWorlds count is non-increasing after a face-up reveal ' +
     '(modulo the played-card factor)', () => {
    let state = buildOpenTrumpState();
    const before = buildInfoSet(state, 'east');
    const worldsBefore = [...enumerateWorlds(before, { maxWorlds: 100_000 })].length;
    const handsBeforeSouth = state.hands[SEAT_INDEX.south].length;

    state = playFaceUp(state, 'south', c('Ah'));

    const after = buildInfoSet(state, 'east');
    const worldsAfter = [...enumerateWorlds(after, { maxWorlds: 100_000 })].length;
    const handsAfterSouth = state.hands[SEAT_INDEX.south].length;

    // After south plays Ah face-up: south's hand shrinks by 1, the
    // unknown pool shrinks by 1 (Ah now in knownPlayed). Both effects
    // SHRINK the world space — south's hand is no longer freely
    // permuted, and the pool is one card smaller. So worldsAfter must
    // be ≤ worldsBefore.
    expect(worldsAfter).toBeLessThanOrEqual(worldsBefore);
    expect(handsAfterSouth).toBe(handsBeforeSouth - 1);
  });
});
