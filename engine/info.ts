// Information set construction (§3) and world enumeration (§4) of
// docs/caps_formalism.md. Caps is a property of what V knows, not of
// the actual deal — this module bridges the authoritative state and
// V's epistemic view. No game-tree search; pure finite-CSP solver.

import type { CardId, Suit } from './card';
import { PACK, SUITS, suitOf } from './card';
import type { Seat } from './seating';
import { SEAT_INDEX, SEATS, SEATS_BY_INDEX, teamOf } from './seating';
import type { EngineGameState, RoundEntry } from './state';

export interface HiddenSlot {
  seat: Seat;
  roundNumber: number;
  ledSuit: Suit;
  // True when the slot is from the in-progress round (§T9 has not
  // yet fired). For completed rounds a face-down trump fold would
  // have been revealed at round resolution; for in-progress rounds
  // that reveal is still pending so the slot *can* be the trump
  // suit. See caps_formalism.md §4 W4.
  inProgress: boolean;
  // When set, the slot's card must be of this exact suit. Used by
  // tools that build relaxed information sets where the player saw
  // *which* suit was played but is being asked counterfactually to
  // forget the precise rank. Native closed-trump face-down slots
  // leave this undefined and use the standard ledSuit/trump-forbidden
  // semantics.
  knownSuit?: Suit;
}

export interface InformationSet {
  viewer: Seat;
  ownHand: ReadonlyArray<CardId>;
  trumpSuit: Suit | null;
  knownFoldedTrumpCard: CardId | null;
  foldedTrumpOnTable: boolean;
  trumperSeat: Seat | null;
  handSizes: ReadonlyMap<Seat, number>;
  exhaustedSuits: ReadonlyMap<Seat, ReadonlySet<Suit>>;
  knownPlayed: ReadonlySet<CardId>;
  // Publicly-known cards currently in specific seats' hands. Today
  // this only contains the §T9-lifted folded trump card (in the
  // trumper's hand). See caps_formalism.md §3 clause 4 / §4 W6.
  // The viewer's own-hand entries are NOT duplicated here — `ownHand`
  // already covers those — though setting them would be harmless.
  knownInHand: ReadonlyMap<Seat, ReadonlySet<CardId>>;
  hiddenSlots: ReadonlyArray<HiddenSlot>;
  pccPartnerOut: Seat | null;
  completedRoundWinners: ReadonlyArray<Seat>;
  teamWonAllCompleted: boolean;
  isViewerTrumper: boolean;
}

// (seat, roundNumber) tuple-key, encoded as string for Map.
const slotKey = (seat: Seat, roundNumber: number): string =>
  `${seat}:${roundNumber}`;

export interface World {
  // Indexed by SEAT_INDEX (N=0, W=1, S=2, E=3); PCC-out seat is `[]`.
  // Array (not Map) because enumerateWorlds materialises one World per
  // sample in the B6/B7 hot path — the per-world Map allocation was
  // measurably visible at R1.
  hands: ReadonlyArray<ReadonlyArray<CardId>>;
  trumpSuit: Suit;
  foldedTrumpCard: CardId | null;
  hiddenSlotAssignments: ReadonlyMap<string, CardId>;
}

const entryLedSuit = (entries: ReadonlyArray<RoundEntry>): Suit | null => {
  for (const e of entries) {
    if (!e.faceDown && e.card !== null) return suitOf(e.card);
  }
  return null;
};

const isOffLedSuit = (entry: RoundEntry, ledSuit: Suit): boolean => {
  if (entry.faceDown) return true;
  if (entry.card === null) return true;
  return suitOf(entry.card) !== ledSuit;
};

const viewerKnowsIdentity = (
  entry: RoundEntry,
  viewer: Seat,
  viewerIsTrumper: boolean,
  inCompletedRound: boolean,
): boolean => {
  if (!entry.faceDown) return entry.card !== null;
  if (entry.revealed) return entry.card !== null;
  if (entry.seat === viewer) return entry.card !== null;
  if (viewerIsTrumper && inCompletedRound) return entry.card !== null;
  return false;
};

export const buildInfoSet = (
  state: EngineGameState,
  viewer: Seat,
): InformationSet => {
  const play = state.play;
  if (state.pccPartnerOut === viewer) {
    throw new Error('PCC-out seat has no information set in play');
  }
  const trump = state.trump;
  const isViewerTrumper = viewer === trump.trumperSeat;
  const foldedOnTable = trump.trumpCard !== null && !trump.trumpCardInHand;
  const trumpSuitKnown =
    isViewerTrumper || trump.isRevealed || trump.isOpen;
  const trumpSuit: Suit | null = trumpSuitKnown ? trump.trumpSuit : null;
  const knownFoldedCard: CardId | null =
    isViewerTrumper && foldedOnTable ? trump.trumpCard : null;

  const ownHand: ReadonlyArray<CardId> = state.hands[SEAT_INDEX[viewer]] ?? [];

  const handSizes = new Map<Seat, number>();
  for (const s of SEATS) {
    if (state.pccPartnerOut === s) continue;
    handSizes.set(s, (state.hands[SEAT_INDEX[s]] ?? []).length);
  }

  // Suit exhaustion (clause 5)
  const exhausted = new Map<Seat, Set<Suit>>();
  for (const s of SEATS) exhausted.set(s, new Set());
  const absorbExhaustion = (entries: ReadonlyArray<RoundEntry>) => {
    const led = entryLedSuit(entries);
    if (led === null) return;
    for (const e of entries) {
      if (isOffLedSuit(e, led)) exhausted.get(e.seat)!.add(led);
    }
  };
  for (const r of play.completedRounds) absorbExhaustion(r.cards);
  if (play.currentRound.length > 0) absorbExhaustion(play.currentRound);

  // Known-played identities + hidden slots from V's perspective
  const knownPlayed = new Set<CardId>();
  const hiddenSlots: HiddenSlot[] = [];
  const absorbRound = (
    roundNumber: number,
    cards: ReadonlyArray<RoundEntry>,
    inCompleted: boolean,
  ) => {
    const led = entryLedSuit(cards);
    for (const entry of cards) {
      if (viewerKnowsIdentity(entry, viewer, isViewerTrumper, inCompleted)) {
        if (entry.card !== null) knownPlayed.add(entry.card);
      } else {
        if (led === null) continue;
        hiddenSlots.push({
          seat: entry.seat,
          roundNumber,
          ledSuit: led,
          inProgress: !inCompleted,
        });
      }
    }
  };
  for (const r of play.completedRounds) {
    absorbRound(r.roundNumber, r.cards, true);
  }
  if (play.currentRound.length > 0) {
    absorbRound(play.roundNumber, play.currentRound, false);
  }

  // Publicly-known cards in specific hands. Currently the only source
  // is the §T9-lifted folded trump card — public to all viewers from
  // the moment of lift (rules.md "shown to all players, then picked
  // up and added to the Trumper's hand").
  const knownInHand = new Map<Seat, Set<CardId>>();
  if (
    trump.foldedCardLifted === true &&
    trump.trumpCardInHand &&
    trump.trumpCard !== null &&
    trump.trumperSeat !== null
  ) {
    const set = new Set<CardId>([trump.trumpCard]);
    knownInHand.set(trump.trumperSeat, set);
  }

  const myTeam = teamOf(viewer);
  const teamWonAll = play.completedRounds.every(
    r => teamOf(r.winner) === myTeam,
  );

  const exhaustedReadonly = new Map<Seat, ReadonlySet<Suit>>();
  for (const [s, set] of exhausted) exhaustedReadonly.set(s, set);
  const knownInHandReadonly = new Map<Seat, ReadonlySet<CardId>>();
  for (const [s, set] of knownInHand) knownInHandReadonly.set(s, set);

  return {
    viewer,
    ownHand,
    trumpSuit,
    knownFoldedTrumpCard: knownFoldedCard,
    foldedTrumpOnTable: foldedOnTable,
    trumperSeat: trump.trumperSeat,
    handSizes,
    exhaustedSuits: exhaustedReadonly,
    knownPlayed,
    knownInHand: knownInHandReadonly,
    hiddenSlots,
    pccPartnerOut: state.pccPartnerOut,
    completedRoundWinners: play.completedRounds.map(r => r.winner),
    teamWonAllCompleted: teamWonAll,
    isViewerTrumper,
  };
};

// World enumeration ---------------------------------------------------

interface Slot {
  key: string;
  size: number;
  forbiddenSuits: ReadonlySet<Suit>;
  // null = any suit (subject to forbidden); set = restricted to these
  allowedSuits: ReadonlySet<Suit> | null;
}

const slotPriority = (s: Slot): number => {
  // Smaller size first, then more-restrictive constraints first.
  const restrictiveness =
    s.allowedSuits !== null ? 1000 : s.forbiddenSuits.size;
  return s.size * 10 - restrictiveness;
};

const slotAccepts = (slot: Slot, c: CardId): boolean => {
  const su = suitOf(c);
  if (slot.allowedSuits !== null && !slot.allowedSuits.has(su)) return false;
  if (slot.forbiddenSuits.has(su)) return false;
  return true;
};

// Hand-rolled combinations generator yielding sorted-input combinations
// in lexicographic order (matches Python itertools.combinations on
// already-sorted input).
function* combinations<T>(
  items: ReadonlyArray<T>,
  k: number,
): Generator<T[]> {
  const n = items.length;
  if (k > n) return;
  if (k === 0) { yield []; return; }
  const idx: number[] = [];
  for (let i = 0; i < k; i++) idx.push(i);
  while (true) {
    yield idx.map(i => items[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function* enumerateForTrump(
  info: InformationSet,
  trumpSuit: Suit,
  unknown: ReadonlyArray<CardId>,
): Generator<World> {
  const slots: Slot[] = [];

  for (const hs of info.hiddenSlots) {
    if (hs.knownSuit !== undefined) {
      slots.push({
        key: `hidden:${hs.seat}:${hs.roundNumber}`,
        size: 1,
        forbiddenSuits: new Set(),
        allowedSuits: new Set([hs.knownSuit]),
      });
    } else {
      // §4 W4: trumpSuit is forbidden only for completed-round
      // face-downs (a trump fold would have been revealed at §T9).
      // For in-progress face-downs the §T9 reveal is still pending,
      // so a trump cut is still possible. See caps_formalism.md §4.
      const forbidden = hs.inProgress
        ? new Set<Suit>([hs.ledSuit])
        : new Set<Suit>([hs.ledSuit, trumpSuit]);
      slots.push({
        key: `hidden:${hs.seat}:${hs.roundNumber}`,
        size: 1,
        forbiddenSuits: forbidden,
        allowedSuits: null,
      });
    }
  }

  let foldedSlotKey: string | null = null;
  if (info.foldedTrumpOnTable && info.knownFoldedTrumpCard === null) {
    foldedSlotKey = `folded:${info.trumperSeat ?? 'unknown'}`;
    slots.push({
      key: foldedSlotKey,
      size: 1,
      forbiddenSuits: new Set(),
      allowedSuits: new Set([trumpSuit]),
    });
  }

  const handSlotsBySeat = new Map<Seat, Slot>();
  for (const [seat, size] of info.handSizes) {
    if (seat === info.viewer) continue;
    // Publicly-known cards in this seat's hand (W6) are forced
    // assignments — they're not enumerated, so we subtract them
    // from the slot size and re-add them in `materialise`.
    const forced = info.knownInHand.get(seat);
    const forcedCount = forced?.size ?? 0;
    const slot: Slot = {
      key: `hand:${seat}`,
      size: size - forcedCount,
      forbiddenSuits: info.exhaustedSuits.get(seat) ?? new Set(),
      allowedSuits: null,
    };
    handSlotsBySeat.set(seat, slot);
    slots.push(slot);
  }

  const totalCapacity = slots.reduce((s, x) => s + x.size, 0);
  if (totalCapacity !== unknown.length) return;

  const slotsSorted = [...slots].sort(
    (a, b) => slotPriority(a) - slotPriority(b),
  );

  const assignments = new Map<string, CardId[]>();

  const materialise = (): World => {
    const hands: ReadonlyArray<CardId>[] = [[], [], [], []];
    hands[SEAT_INDEX[info.viewer]] = [...info.ownHand].sort();
    for (const seat of info.handSizes.keys()) {
      if (seat === info.viewer) continue;
      const cards = assignments.get(`hand:${seat}`) ?? [];
      const forced = info.knownInHand.get(seat);
      const merged = forced
        ? [...cards, ...forced]
        : cards;
      hands[SEAT_INDEX[seat]] = [...merged].sort();
    }
    let folded: CardId | null;
    if (info.foldedTrumpOnTable) {
      if (info.knownFoldedTrumpCard !== null) {
        folded = info.knownFoldedTrumpCard;
      } else {
        folded = assignments.get(foldedSlotKey!)![0];
      }
    } else {
      folded = null;
    }
    const hiddenAssigns = new Map<string, CardId>();
    for (const hs of info.hiddenSlots) {
      const k = `hidden:${hs.seat}:${hs.roundNumber}`;
      hiddenAssigns.set(slotKey(hs.seat, hs.roundNumber), assignments.get(k)![0]);
    }
    return {
      hands,
      trumpSuit,
      foldedTrumpCard: folded,
      hiddenSlotAssignments: hiddenAssigns,
    };
  };

  function* backtrack(
    sIdx: number,
    remaining: ReadonlyArray<CardId>,
  ): Generator<World> {
    if (sIdx >= slotsSorted.length) {
      if (remaining.length === 0) yield materialise();
      return;
    }
    const slot = slotsSorted[sIdx];
    const eligible = remaining.filter(c => slotAccepts(slot, c));
    if (eligible.length < slot.size) return;
    for (const combo of combinations(eligible, slot.size)) {
      const chosenSet = new Set(combo);
      const newRemaining = remaining.filter(c => !chosenSet.has(c));
      assignments.set(slot.key, [...combo]);
      yield* backtrack(sIdx + 1, newRemaining);
      assignments.delete(slot.key);
    }
  }

  yield* backtrack(0, unknown);
}

export interface EnumerateOptions {
  maxWorlds?: number;
}

export function* enumerateWorlds(
  info: InformationSet,
  options: EnumerateOptions = {},
): Generator<World> {
  const ownKnown = new Set<CardId>(info.ownHand);
  if (info.knownFoldedTrumpCard !== null) {
    ownKnown.add(info.knownFoldedTrumpCard);
  }
  for (const c of info.knownPlayed) ownKnown.add(c);
  // §4 W6: publicly-known cards in non-viewer hands are forced
  // assignments — exclude them from the unknown pool.
  for (const [, cards] of info.knownInHand) {
    for (const c of cards) ownKnown.add(c);
  }

  const unknown = PACK.filter(c => !ownKnown.has(c)).sort();

  const trumpCandidates: Suit[] =
    info.trumpSuit !== null ? [info.trumpSuit] : [...SUITS];

  let yielded = 0;
  const cap = options.maxWorlds ?? Infinity;
  for (const trumpSuit of trumpCandidates) {
    for (const w of enumerateForTrump(info, trumpSuit, unknown)) {
      yield w;
      yielded++;
      if (yielded >= cap) return;
    }
  }
}

// Verifier — symmetric with enumerateWorlds. Useful for tests.
export const worldIsConsistent = (
  world: World,
  info: InformationSet,
): boolean => {
  if (info.trumpSuit !== null && world.trumpSuit !== info.trumpSuit) {
    return false;
  }

  const expectedSeats = new Set<Seat>();
  for (const s of SEATS) {
    if (s !== info.pccPartnerOut) expectedSeats.add(s);
  }
  for (let i = 0; i < 4; i++) {
    const seat = SEATS_BY_INDEX[i];
    const present = world.hands[i] !== undefined && world.hands[i].length > 0;
    const expected = expectedSeats.has(seat);
    // Allow either presence (cards remain) or empty arrays — PCC-out
    // also lands here. We verify per-seat hand size below.
    if (!expected && present) return false;
  }

  for (const [seat, expected] of info.handSizes) {
    if ((world.hands[SEAT_INDEX[seat]] ?? []).length !== expected) return false;
  }

  if (info.foldedTrumpOnTable) {
    if (world.foldedTrumpCard === null) return false;
    if (suitOf(world.foldedTrumpCard) !== world.trumpSuit) return false;
    if (
      info.knownFoldedTrumpCard !== null &&
      world.foldedTrumpCard !== info.knownFoldedTrumpCard
    ) return false;
  } else {
    if (world.foldedTrumpCard !== null) return false;
  }

  for (const [seat, suits] of info.exhaustedSuits) {
    const hand = world.hands[SEAT_INDEX[seat]];
    if (!hand) continue;
    for (const c of hand) {
      if (suits.has(suitOf(c))) return false;
    }
  }

  const slotIndex = new Map<string, HiddenSlot>();
  for (const hs of info.hiddenSlots) {
    slotIndex.set(slotKey(hs.seat, hs.roundNumber), hs);
  }
  if (world.hiddenSlotAssignments.size !== slotIndex.size) return false;
  for (const [k, c] of world.hiddenSlotAssignments) {
    const slot = slotIndex.get(k);
    if (!slot) return false;
    if (slot.knownSuit !== undefined) {
      if (suitOf(c) !== slot.knownSuit) return false;
    } else {
      if (suitOf(c) === slot.ledSuit) return false;
      // §4 W4: trumpSuit forbidden only for completed-round slots.
      if (!slot.inProgress && suitOf(c) === world.trumpSuit) return false;
    }
  }

  // §4 W6: publicly-known cards must appear in their seat's hand.
  for (const [seat, cards] of info.knownInHand) {
    const hand = world.hands[SEAT_INDEX[seat]];
    if (!hand) return false;
    for (const c of cards) {
      if (!hand.includes(c)) return false;
    }
  }

  // Viewer's own-hand identity (W5).
  const viewerHand = new Set(world.hands[SEAT_INDEX[info.viewer]] ?? []);
  if (viewerHand.size !== info.ownHand.length) return false;
  for (const c of info.ownHand) if (!viewerHand.has(c)) return false;

  // Card conservation (W1).
  const seen: CardId[] = [];
  for (let i = 0; i < 4; i++) {
    const cards = world.hands[i];
    if (cards !== undefined) seen.push(...cards);
  }
  if (world.foldedTrumpCard !== null) seen.push(world.foldedTrumpCard);
  for (const c of world.hiddenSlotAssignments.values()) seen.push(c);
  for (const c of info.knownPlayed) seen.push(c);
  if (seen.length !== new Set(seen).size) return false;
  if (seen.length !== PACK.length) return false;
  const packSet = new Set(PACK);
  for (const c of seen) if (!packSet.has(c)) return false;

  return true;
};

export { slotKey };
