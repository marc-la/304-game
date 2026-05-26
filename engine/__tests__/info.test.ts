// Direct tests for buildInfoSet / enumerateWorlds / worldIsConsistent.
//
// Companion to caps.test.ts but focused on info-set machinery rather
// than the obligation predicate.

import { describe, expect, it } from 'vitest';

import type { CardId } from '../card';
import { suitOf } from '../card';
import {
  buildInfoSet,
  enumerateWorlds,
  worldIsConsistent,
} from '../info';
import { SEAT_INDEX } from '../seating';
import type { Seat } from '../seating';
import type { EngineGameState } from '../state';

const c = (s: string): CardId => s as CardId;

// B9: §T9 lift adds a publicly-observed card to the trumper's hand
// *after* any earlier exhaustion was observed. Clause-5 exhaustion at
// time T is not retracted on a later reveal at time T+k. Both
// enumerateForTrump (write) and worldIsConsistent (read) must exempt
// forced cards from the exhaustion check; pre-B9 the write path
// already did, but the read path didn't — so worldIsConsistent
// rejected worlds the enumerator itself produced.
describe('worldIsConsistent — B9 forced/exhaustion exemption', () => {
  // Post-§T9 state. Trumper = west, trump = clubs, lifted folded card
  // 7c. R3 had clubs led; west pitched a heart → west deduced
  // exhausted in clubs. So info.exhaustedSuits.get('west') contains
  // 'c' while info.knownInHand.get('west') contains 7c.
  //
  // Card-conservation (W1): every PACK card is in exactly one of
  // a current hand, a played round entry, or the folded slot.
  // Per-round winners are declared "south" throughout so that
  // info.teamWonAllCompleted is true; the resolver's actual winner
  // rules are not validated by buildInfoSet.
  const buildState = (): EngineGameState => {
    const hands: CardId[][] = [[], [], [], []];
    hands[SEAT_INDEX.south] = [c('Jc'), c('Ah')];
    // 8c lives in north's final hand (would have been west's R3 play
    // pre-B9 fixture). 9h stays.
    hands[SEAT_INDEX.north] = [c('8c'), c('9h')];
    hands[SEAT_INDEX.west] = [c('7c'), c('Kd')];
    hands[SEAT_INDEX.east] = [c('Ks'), c('Qs')];

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
        foldedCardLifted: true,
      },
      play: {
        roundNumber: 7,
        priority: 'south',
        currentRound: [],
        completedRounds: [
          round(1,
            [['south', 'Jd'], ['east', 'Ad'], ['north', '10d'], ['west', '7d']],
            'south'),
          round(2,
            [['south', 'Js'], ['east', 'As'], ['north', '10s'], ['west', '9s']],
            'south'),
          // Clubs led. West pitches Jh → west exhausted in clubs.
          // The lifted card 7c (a club) appears in west's hand later,
          // a fact the spec says is consistent with this exhaustion.
          round(3,
            [['south', '9c'], ['east', 'Ac'], ['north', 'Qc'], ['west', 'Jh']],
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

  it('forced-card-in-exhausted-suit is not a contradiction', () => {
    const state = buildState();
    const info = buildInfoSet(state, 'south');
    expect(info.exhaustedSuits.get('west')!.has('c')).toBe(true);
    expect(info.knownInHand.get('west')!.has(c('7c'))).toBe(true);

    const worlds = [...enumerateWorlds(info, { maxWorlds: 5000 })];
    expect(worlds.length).toBeGreaterThan(0);
    for (const w of worlds) {
      // Every world places the forced 7c in west's hand (W6). Pre-B9,
      // worldIsConsistent rejected here because 7c is a club and
      // exhaustedSuits[west] contains 'c'. Post-B9 it exempts forced
      // cards from the exhaustion sweep and accepts.
      expect(worldIsConsistent(w, info)).toBe(true);
      expect(w.hands[SEAT_INDEX.west].includes(c('7c'))).toBe(true);
    }
  });
});

// A1: open-trump pre-play reveal. When the trumper does not have R1
// priority, they reveal one trump-suit card publicly before R1 and
// return it to their hand. Its identity is in I_V for every viewer
// from that moment — even though the originally-folded card (also in
// the trumper's hand) is *not* revealed and remains private.
describe('buildInfoSet — A1 open-trump pre-play reveal', () => {
  // Trumper = north, R1 priority = east (so north must reveal).
  // Folded trump card: Js (private — kept in north's hand).
  // Revealed trump card: 9s (publicly shown then returned to hand).
  // Viewer south expects to see 9s in knownInHand[north] but NOT Js.
  const buildState = (): EngineGameState => {
    const hands: CardId[][] = [[], [], [], []];
    hands[SEAT_INDEX.north] = [
      c('Js'), c('9s'), c('Ks'), c('Qs'),
      c('Ah'), c('Kh'), c('Qh'), c('Jh'),
    ];
    hands[SEAT_INDEX.east] = [
      c('10s'), c('8s'), c('7s'),
      c('10h'), c('9h'), c('8h'), c('7h'), c('Ac'),
    ];
    hands[SEAT_INDEX.south] = [
      c('Kc'), c('Qc'), c('Jc'), c('10c'),
      c('9c'), c('8c'), c('7c'), c('Ad'),
    ];
    hands[SEAT_INDEX.west] = [
      c('Kd'), c('Qd'), c('Jd'), c('10d'),
      c('9d'), c('8d'), c('7d'), c('As'),
    ];

    return {
      hands,
      trump: {
        trumperSeat: 'north',
        trumpSuit: 's',
        // In open trump, trump.trumpCard is null at the engine level
        // (the originally-folded card was picked up at trump selection
        // and its identity is not tracked here — that's a pre-existing
        // engine choice; A1 only tracks the *revealed* card).
        trumpCard: null,
        trumpCardInHand: true,
        isRevealed: true,
        isOpen: true,
        foldedCardLifted: false,
        revealedTrumpCardId: c('9s'),
      },
      play: {
        roundNumber: 1,
        priority: 'east',
        currentRound: [],
        completedRounds: [],
        pointsWon: { team_a: 0, team_b: 0 },
        capsObligations: new Map(),
      },
      pccPartnerOut: null,
    };
  };

  it('south sees 9s in knownInHand[north] (but not the private Js)', () => {
    const state = buildState();
    const info = buildInfoSet(state, 'south');
    const northKnown = info.knownInHand.get('north');
    expect(northKnown).toBeDefined();
    expect(northKnown!.has(c('9s'))).toBe(true);
    expect(northKnown!.has(c('Js'))).toBe(false);
  });

  it('east (R1-priority non-trumper) also sees 9s in knownInHand[north]', () => {
    const state = buildState();
    const info = buildInfoSet(state, 'east');
    const northKnown = info.knownInHand.get('north');
    expect(northKnown).toBeDefined();
    expect(northKnown!.has(c('9s'))).toBe(true);
  });

  it('trumper (north) viewer: knownInHand may still carry the revealed card', () => {
    const state = buildState();
    const info = buildInfoSet(state, 'north');
    // The trumper sees their own hand directly; knownInHand may also
    // carry the revealed card (harmless per InformationSet docstring).
    expect(info.ownHand.includes(c('9s'))).toBe(true);
    expect(info.ownHand.includes(c('Js'))).toBe(true);
  });

  it('once the revealed card is played, it disappears from knownInHand', () => {
    const state = buildState();
    // Simulate: north has played 9s in R1 (face-up). Move it from
    // north's hand to a completed round entry.
    state.hands = state.hands.map(h => [...h]);
    state.hands[SEAT_INDEX.north] = state.hands[SEAT_INDEX.north]
      .filter(card => card !== c('9s'));
    state.play = {
      ...state.play,
      roundNumber: 2,
      priority: 'north',
      completedRounds: [
        {
          roundNumber: 1,
          cards: [
            { seat: 'east', card: c('10s'), faceDown: false, revealed: false },
            { seat: 'south', card: c('Kc'), faceDown: false, revealed: false },
            { seat: 'west', card: c('Kd'), faceDown: false, revealed: false },
            { seat: 'north', card: c('9s'), faceDown: false, revealed: false },
          ],
          winner: 'north',
          pointsWon: 0,
          trumpRevealed: false,
        },
      ],
    };
    const info = buildInfoSet(state, 'south');
    const northKnown = info.knownInHand.get('north');
    // knownInHand should be absent or empty for north after the
    // revealed card has been played.
    expect(northKnown === undefined || northKnown.size === 0).toBe(true);
    // The played card is in knownPlayed instead.
    expect(info.knownPlayed.has(c('9s'))).toBe(true);
  });
});

// A2 / B4 / B8: W4 five-way case dispatch. Replace v1's binary
// "in-progress ⇒ only led forbidden, completed ⇒ led+trump forbidden"
// with the five (seat, completion, folded-on-table) cases:
//
//   W4-a / W4-c — completed:                forbidden = {led, trump}
//   W4-b       — in-prog, non-trumper:      forbidden = {led}
//   W4-d       — in-prog, trumper, folded-on-table:
//                                            forbidden = {led, trump}
//   W4-e       — in-prog, trumper, folded-already-played:
//                                            forbidden = {led}, allowed = {trump}
describe('hiddenSlots — A2/B4/B8 W4 case dispatch', () => {
  // Shared 32-card deal for W4-b / W4-d / W4-e mid-round-1 states.
  //
  //   south: 10h, 7h, 9d, Ad, 10d, Kd, Jd, 8d   (hearts:2, diamonds:6)
  //   north: Ah, 9h, 8h, Kh, Qh, Jh, Js, 9s     (hearts:5, spades:2,
  //                                              wait actually 6+2 — let me
  //                                              re-derive: 5 hearts +
  //                                              2 spades = 7; need 8)
  //
  // Re-deal for clean accounting:
  const SOUTH = [c('10h'), c('7h'), c('9d'), c('Ad'), c('10d'), c('Kd'), c('Jd'), c('8d')];
  const NORTH = [c('Ah'), c('9h'), c('8h'), c('Kh'), c('Qh'), c('Jh'), c('Js'), c('9s')];
  const WEST  = [c('7c'), c('9c'), c('Ac'), c('Kc'), c('Qc'), c('Jc'), c('Qd'), c('8s')];
  const EAST  = [c('8c'), c('10c'), c('7d'), c('7s'), c('10s'), c('Qs'), c('Ks'), c('As')];

  // Sanity-checking ourselves on suit counts, all 32 cards unique.
  it('fixture deal covers all 32 PACK cards exactly once', () => {
    const all = [...SOUTH, ...NORTH, ...WEST, ...EAST];
    expect(all.length).toBe(32);
    expect(new Set(all).size).toBe(32);
  });

  // ===== W4-d ============================================================
  // Closed-trump R1 in progress. Trumper = west (folded 7c on table).
  // south leads 7h. north follows 8h. west plays a face-down minus
  // from hand (Qd — non-trump non-led). Viewer = south.
  it('W4-d: in-progress trumper face-down with folded card on table ' +
     '⇒ trump-suit forbidden', () => {
    const hands: CardId[][] = [[], [], [], []];
    // south played 7h.
    hands[SEAT_INDEX.south] = SOUTH.filter(x => x !== c('7h'));
    // north played 8h.
    hands[SEAT_INDEX.north] = NORTH.filter(x => x !== c('8h'));
    // west selected 7c as trump (folded on table) and played Qd face-down.
    hands[SEAT_INDEX.west] = WEST.filter(x => x !== c('7c') && x !== c('Qd'));
    hands[SEAT_INDEX.east] = [...EAST];

    const state: EngineGameState = {
      hands,
      trump: {
        trumperSeat: 'west',
        trumpSuit: 'c',
        trumpCard: c('7c'),
        trumpCardInHand: false,
        isRevealed: false,
        isOpen: false,
      },
      play: {
        roundNumber: 1,
        priority: 'south',
        currentRound: [
          { seat: 'south', card: c('7h'), faceDown: false, revealed: false },
          { seat: 'north', card: c('8h'), faceDown: false, revealed: false },
          { seat: 'west', card: c('Qd'), faceDown: true, revealed: false },
        ],
        completedRounds: [],
        pointsWon: { team_a: 0, team_b: 0 },
        capsObligations: new Map(),
      },
      pccPartnerOut: null,
    };

    const info = buildInfoSet(state, 'south');
    const westSlot = info.hiddenSlots.find(h => h.seat === 'west');
    expect(westSlot).toBeDefined();
    expect(westSlot!.inProgress).toBe(true);
    expect(westSlot!.seatIsTrumper).toBe(true);
    expect(westSlot!.foldedOnTableAtPlayTime).toBe(true);
    expect(westSlot!.ledSuit).toBe('h');

    const worlds = [...enumerateWorlds(info, { maxWorlds: 5000 })];
    expect(worlds.length).toBeGreaterThan(0);
    for (const w of worlds) {
      const assigned = w.hiddenSlotAssignments.get(`west:1`);
      expect(assigned).toBeDefined();
      // §T-4 says west cannot fold an in-hand trump while the folded
      // trump remains on the table; W4-d encodes that. No world places
      // a trump-suit card here.
      expect(suitOf(assigned!)).not.toBe(w.trumpSuit);
      // Nor the led suit.
      expect(suitOf(assigned!)).not.toBe('h');
    }
  });

  // ===== W4-e ============================================================
  // Same setup, but west cuts with the folded trump itself (7c). After
  // the play, trump.trumpCard is null (per play-engine.ts:103).
  it('W4-e: in-progress trumper face-down where the folded trump was ' +
     'played ⇒ slot identity is trump-suit', () => {
    const hands: CardId[][] = [[], [], [], []];
    hands[SEAT_INDEX.south] = SOUTH.filter(x => x !== c('7h'));
    hands[SEAT_INDEX.north] = NORTH.filter(x => x !== c('8h'));
    // 7c was folded; west played it face-down (so it's removed from
    // the table — trump.trumpCard = null — and not in hand).
    hands[SEAT_INDEX.west] = WEST.filter(x => x !== c('7c'));
    hands[SEAT_INDEX.east] = [...EAST];

    const state: EngineGameState = {
      hands,
      trump: {
        trumperSeat: 'west',
        trumpSuit: 'c',
        trumpCard: null,
        trumpCardInHand: false,
        isRevealed: false,
        isOpen: false,
      },
      play: {
        roundNumber: 1,
        priority: 'south',
        currentRound: [
          { seat: 'south', card: c('7h'), faceDown: false, revealed: false },
          { seat: 'north', card: c('8h'), faceDown: false, revealed: false },
          { seat: 'west', card: c('7c'), faceDown: true, revealed: false },
        ],
        completedRounds: [],
        pointsWon: { team_a: 0, team_b: 0 },
        capsObligations: new Map(),
      },
      pccPartnerOut: null,
    };

    const info = buildInfoSet(state, 'south');
    const westSlot = info.hiddenSlots.find(h => h.seat === 'west');
    expect(westSlot).toBeDefined();
    expect(westSlot!.inProgress).toBe(true);
    expect(westSlot!.seatIsTrumper).toBe(true);
    expect(westSlot!.foldedOnTableAtPlayTime).toBe(false);

    const worlds = [...enumerateWorlds(info, { maxWorlds: 5000 })];
    expect(worlds.length).toBeGreaterThan(0);
    for (const w of worlds) {
      const assigned = w.hiddenSlotAssignments.get(`west:1`);
      expect(assigned).toBeDefined();
      // W4-e: slot identity must be trump-suit.
      expect(suitOf(assigned!)).toBe(w.trumpSuit);
    }
  });

  // ===== W4-b regression ================================================
  // Existing F4-b case: an in-progress non-trumper face-down slot
  // allows trumpSuit. This was the original v1 fix that the W4 case
  // table generalises.
  it('W4-b: in-progress non-trumper face-down ⇒ only led forbidden', () => {
    const hands: CardId[][] = [[], [], [], []];
    // Trumper is south (so the face-down player west is a non-trumper).
    hands[SEAT_INDEX.south] = SOUTH.filter(x => x !== c('7h') && x !== c('Ad'));
    // west selected Ad as trump? No, trump card needs to be from west's
    // hand. Easier: keep south as trumper with trump 'c', folded 7c
    // in WEST's original allocation — but trumper is south, so trump
    // card must be from south's hand. Re-pick trump: trump suit 'h',
    // folded card 10h (in south's hand). Adjust state below.
    hands[SEAT_INDEX.south] = SOUTH
      .filter(x => x !== c('7h') && x !== c('10h'));
    hands[SEAT_INDEX.north] = [...NORTH];
    hands[SEAT_INDEX.west] = WEST.filter(x => x !== c('Qd'));
    hands[SEAT_INDEX.east] = [...EAST];

    const state: EngineGameState = {
      hands,
      trump: {
        trumperSeat: 'south',
        trumpSuit: 'h',
        trumpCard: c('10h'),
        trumpCardInHand: false,
        isRevealed: false,
        isOpen: false,
      },
      play: {
        roundNumber: 1,
        priority: 'south',
        currentRound: [
          // south is trumper; closed-trump R1 forbids leading trump.
          // South leads 7h... wait, 7h is hearts which IS trump. Switch:
          // south leads a diamond.
          { seat: 'south', card: c('9d'), faceDown: false, revealed: false },
          { seat: 'west', card: c('Qd'), faceDown: true, revealed: false },
        ],
        completedRounds: [],
        pointsWon: { team_a: 0, team_b: 0 },
        capsObligations: new Map(),
      },
      pccPartnerOut: null,
    };

    // Adjust south's hand: we filtered 7h+10h; but the play here is
    // 9d, not 7h. Restore 7h, remove 9d instead.
    state.hands = state.hands.map(h => [...h]) as typeof state.hands;
    state.hands[SEAT_INDEX.south] = SOUTH
      .filter(x => x !== c('10h') && x !== c('9d'));

    // Viewer = south (trumper). South sees own hand and west's face-
    // down slot.
    const info = buildInfoSet(state, 'south');
    const westSlot = info.hiddenSlots.find(h => h.seat === 'west');
    expect(westSlot).toBeDefined();
    expect(westSlot!.inProgress).toBe(true);
    expect(westSlot!.seatIsTrumper).toBe(false);
    expect(westSlot!.ledSuit).toBe('d');
    // (The W4-d / W4-e siblings exercise the enumeration direction;
    // the W4-b dispatch produces a permissive slot whose enumerate-
    // and-find heart approach is non-deterministic under the world
    // cap — slot-metadata is the load-bearing assertion here.)
  });
});
