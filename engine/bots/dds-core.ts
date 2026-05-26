// Shared double-dummy solver for 304's open-trump play bots (B6, B7).
//
// Performance pillars over the original per-bot pure minimax:
//   - Cards encoded as 0..31 ((suitIdx<<3)|power) so hands fit in a
//     single 32-bit bitmask and "cards of suit S" is a byte mask.
//   - Hands as Uint32Array(4) indexed by seat-index (N=0, W=1, S=2, E=3).
//   - In-place state mutation with explicit undo on the recursion stack
//     — no per-node Map or array allocation.
//   - Alpha-beta on tricks-won-by-myTeam (the game is zero-sum in
//     trick count, so a scalar suffices).
//   - Move ordering: high-power-first within suit. Combined with a
//     killer-move heuristic indexed by depth, this is what makes
//     alpha-beta actually prune in DDS-style positions.
//   - Bound-typed transposition table (fail-soft alpha-beta): each
//     cached entry stores a packed (lower, upper) pair so a lookup can
//     return on a proven cutoff and otherwise tighten (alpha, beta).
//
// The solver is deterministic in the input state, so two calls with the
// same (world, starting trick, trump, myTeam) return the same value.
// This preserves the bot-zoo invariant of (info-set, rng seed)
// determinism.

import type { CardId, Suit } from '../card';
import type { Seat, Team } from '../seating';

const SUITS_ORDER: readonly Suit[] = ['c', 'd', 'h', 's'];
const RANKS_ORDER: readonly string[] =
  ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];

const SUIT_TO_IDX: Record<Suit, number> = { c: 0, d: 1, h: 2, s: 3 };
const SEAT_TO_IDX: Record<Seat, number> = {
  north: 0, west: 1, south: 2, east: 3,
};

// Anticlockwise: N(0) → W(1) → S(2) → E(3) → N(0)
const NEXT_SEAT = new Uint8Array([1, 2, 3, 0]);
// teamOf(north)=team_a(0), teamOf(west)=team_b(1),
// teamOf(south)=team_a(0), teamOf(east)=team_b(1)
const SEAT_TEAM = new Uint8Array([0, 1, 0, 1]);

const CARD_SUIT = new Uint8Array(32);
const CARD_POWER = new Uint8Array(32);
const CARDID_BY_IDX: CardId[] = new Array<CardId>(32);
const IDX_BY_CARDID = new Map<string, number>();

(() => {
  for (let s = 0; s < 4; s++) {
    for (let p = 0; p < 8; p++) {
      const idx = (s << 3) | p;
      CARD_SUIT[idx] = s;
      CARD_POWER[idx] = p;
      const cid = (RANKS_ORDER[p] + SUITS_ORDER[s]) as CardId;
      CARDID_BY_IDX[idx] = cid;
      IDX_BY_CARDID.set(cid, idx);
    }
  }
})();

export const cardToIdx = (c: CardId): number => {
  const v = IDX_BY_CARDID.get(c);
  if (v === undefined) throw new Error(`dds-core: unknown card ${c}`);
  return v;
};
export const idxToCard = (i: number): CardId => CARDID_BY_IDX[i];
export const seatIdx = (s: Seat): number => SEAT_TO_IDX[s];

export const handMaskFrom = (cards: ReadonlyArray<CardId>): number => {
  let m = 0;
  for (const c of cards) m |= 1 << cardToIdx(c);
  return m >>> 0;
};

// Build the 4-element hand bitmask array from a world's per-seat hands.
// `hands` is indexed by SEAT_INDEX (same as EngineGameState.hands and
// World.hands). 304 has 4 seats (no PCC-out in the open-trump path).
export const worldHandsToMasks = (
  hands: ReadonlyArray<ReadonlyArray<CardId>>,
): Uint32Array => {
  const out = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    const cards = hands[i];
    if (cards !== undefined) out[i] = handMaskFrom(cards);
  }
  return out;
};

// SWAR popcount32
const popcount = (x: number): number => {
  let v = x >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return Math.imul(v, 0x01010101) >>> 24;
};

const seatToPlay = (leader: number, trickLen: number): number => {
  let s = leader;
  for (let i = 0; i < trickLen; i++) s = NEXT_SEAT[s];
  return s;
};

interface DDSState {
  hands: Uint32Array;       // length 4
  trickCards: Uint8Array;   // length 4
  trickSeats: Uint8Array;   // length 4
  trickLen: number;
  leader: number;           // seat idx 0..3
  ledSuit: number;          // -1 if trick empty, else 0..3
  nodes: number;
}

interface DDSWork {
  trumpSuit: number;
  myTeam: number;            // 0 or 1
  // TT value packs (lower+1, upper+1) into a single int.
  // lower ∈ [-1, 33], upper ∈ [-1, 33]; sentinel "absent" is undefined.
  cache: Map<string, number>;
  killer: Int8Array;         // killer[depth] = card-idx (-1 = none)
  remaining: number;         // node budget
}

const encodeTT = (lower: number, upper: number): number =>
  ((lower + 1) << 8) | (upper + 1);

const decodeLower = (v: number): number => (v >>> 8) - 1;
const decodeUpper = (v: number): number => (v & 0xff) - 1;

// Construct a TT key for the current state. The branching on trickLen
// avoids allocating an unused trailing zero region in the common case.
const makeKey = (s: DDSState): string => {
  const h0 = s.hands[0]; const h1 = s.hands[1];
  const h2 = s.hands[2]; const h3 = s.hands[3];
  // leader(2) | trickLen(3) | (ledSuit+1)(3)  — fits in 8 bits
  const header = (s.leader << 6) | (s.trickLen << 3) | (s.ledSuit + 1);
  switch (s.trickLen) {
    case 0:
      return String.fromCharCode(
        h0 & 0xffff, (h0 >>> 16) & 0xffff,
        h1 & 0xffff, (h1 >>> 16) & 0xffff,
        h2 & 0xffff, (h2 >>> 16) & 0xffff,
        h3 & 0xffff, (h3 >>> 16) & 0xffff,
        header,
      );
    case 1:
      return String.fromCharCode(
        h0 & 0xffff, (h0 >>> 16) & 0xffff,
        h1 & 0xffff, (h1 >>> 16) & 0xffff,
        h2 & 0xffff, (h2 >>> 16) & 0xffff,
        h3 & 0xffff, (h3 >>> 16) & 0xffff,
        header,
        s.trickCards[0],
      );
    case 2:
      return String.fromCharCode(
        h0 & 0xffff, (h0 >>> 16) & 0xffff,
        h1 & 0xffff, (h1 >>> 16) & 0xffff,
        h2 & 0xffff, (h2 >>> 16) & 0xffff,
        h3 & 0xffff, (h3 >>> 16) & 0xffff,
        header,
        s.trickCards[0], s.trickCards[1],
      );
    default: // 3
      return String.fromCharCode(
        h0 & 0xffff, (h0 >>> 16) & 0xffff,
        h1 & 0xffff, (h1 >>> 16) & 0xffff,
        h2 & 0xffff, (h2 >>> 16) & 0xffff,
        h3 & 0xffff, (h3 >>> 16) & 0xffff,
        header,
        s.trickCards[0], s.trickCards[1], s.trickCards[2],
      );
  }
};

// Winner of a fully-played trick (trickLen=4).
const trickWinner = (s: DDSState, trumpSuit: number): number => {
  let bestSeat = s.trickSeats[0];
  const c0 = s.trickCards[0];
  let bestPow = CARD_POWER[c0];
  let bestIsTrump = CARD_SUIT[c0] === trumpSuit;
  const led = s.ledSuit;
  for (let i = 1; i < 4; i++) {
    const c = s.trickCards[i];
    const csuit = CARD_SUIT[c];
    const cpow = CARD_POWER[c];
    const isTrump = csuit === trumpSuit;
    if (bestIsTrump) {
      if (isTrump && cpow < bestPow) {
        bestSeat = s.trickSeats[i];
        bestPow = cpow;
      }
    } else {
      if (isTrump) {
        bestSeat = s.trickSeats[i];
        bestPow = cpow;
        bestIsTrump = true;
      } else if (csuit === led && cpow < bestPow) {
        bestSeat = s.trickSeats[i];
        bestPow = cpow;
      }
    }
  }
  return bestSeat;
};

// Fill `out` with legal card indices for `seat`, high-power-first within
// each suit. Implements the engine's legal-play contract:
//   - Following a lead: must follow led suit if able; else any card.
//   - Leading: if this seat is the only seat holding any trump and
//     holds at least one, must lead trump.
const legalMoves = (
  s: DDSState,
  seat: number,
  trumpSuit: number,
  out: number[],
): void => {
  out.length = 0;
  const hand = s.hands[seat];
  let movesMask: number;
  if (s.ledSuit < 0) {
    const trumpByte = (0xff << (trumpSuit << 3)) >>> 0;
    const allTrumps =
      ((s.hands[0] | s.hands[1] | s.hands[2] | s.hands[3]) & trumpByte) >>> 0;
    const myTrumps = (hand & trumpByte) >>> 0;
    if (myTrumps !== 0 && allTrumps === myTrumps) {
      movesMask = myTrumps;
    } else {
      movesMask = hand;
    }
  } else {
    const suitByte = (0xff << (s.ledSuit << 3)) >>> 0;
    const suited = (hand & suitByte) >>> 0;
    movesMask = suited !== 0 ? suited : hand;
  }
  // High-power-first within suit = low-bit-first within suit byte
  // (because card index encodes power in the low 3 bits of each byte,
  // and power 0 = strongest).
  for (let suit = 0; suit < 4; suit++) {
    let sm = (movesMask & (0xff << (suit << 3))) >>> 0;
    while (sm !== 0) {
      const lsb = sm & -sm;
      const idx = 31 - Math.clz32(lsb);
      out.push(idx);
      sm ^= lsb;
    }
  }
};

const moveBuf: number[][] = [];
const getMoveBuf = (depth: number): number[] => {
  let buf = moveBuf[depth];
  if (buf === undefined) {
    buf = [];
    moveBuf[depth] = buf;
  }
  return buf;
};

const dds = (
  s: DDSState,
  alpha: number,
  beta: number,
  depth: number,
  w: DDSWork,
): number => {
  if (w.remaining <= 0) return (alpha + beta) >> 1;
  w.remaining--;
  s.nodes++;

  const total = popcount(s.hands[0]) + popcount(s.hands[1])
              + popcount(s.hands[2]) + popcount(s.hands[3]);
  if (total === 0) return 0;

  const seat = seatToPlay(s.leader, s.trickLen);

  const key = makeKey(s);
  const entry = w.cache.get(key);
  let entryLower = -1;
  let entryUpper = 99;
  if (entry !== undefined) {
    entryLower = decodeLower(entry);
    entryUpper = decodeUpper(entry);
    if (entryLower >= beta) return entryLower;
    if (entryUpper <= alpha) return entryUpper;
    if (entryLower === entryUpper) return entryLower;
    if (entryLower > alpha) alpha = entryLower;
    if (entryUpper < beta) beta = entryUpper;
  }

  const origAlpha = alpha;
  const origBeta = beta;

  const moves = getMoveBuf(depth);
  legalMoves(s, seat, w.trumpSuit, moves);

  // Promote killer if it's legal and not already first.
  const k = w.killer[depth];
  if (k >= 0 && moves.length > 1) {
    for (let i = 1; i < moves.length; i++) {
      if (moves[i] === k) {
        moves[i] = moves[0];
        moves[0] = k;
        break;
      }
    }
  }

  const playForMe = SEAT_TEAM[seat] === w.myTeam;
  let best = playForMe ? -1 : 99;

  for (let mi = 0; mi < moves.length; mi++) {
    const card = moves[mi];
    const cardBit = 1 << card;

    // Apply
    const wasLed = s.ledSuit;
    s.hands[seat] = (s.hands[seat] & ~cardBit) >>> 0;
    s.trickCards[s.trickLen] = card;
    s.trickSeats[s.trickLen] = seat;
    s.trickLen++;
    if (wasLed < 0) s.ledSuit = CARD_SUIT[card];

    let value: number;
    if (s.trickLen === 4) {
      const winner = trickWinner(s, w.trumpSuit);
      const won = SEAT_TEAM[winner] === w.myTeam ? 1 : 0;
      const prevLeader = s.leader;
      const prevLed = s.ledSuit;
      s.leader = winner;
      s.trickLen = 0;
      s.ledSuit = -1;
      const future = dds(s, alpha - won, beta - won, depth + 1, w);
      s.leader = prevLeader;
      s.trickLen = 4;
      s.ledSuit = prevLed;
      value = won + future;
    } else {
      value = dds(s, alpha, beta, depth + 1, w);
    }

    // Undo
    s.trickLen--;
    s.hands[seat] = (s.hands[seat] | cardBit) >>> 0;
    s.ledSuit = wasLed;

    if (playForMe) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) {
      w.killer[depth] = card;
      break;
    }
  }

  // Store in TT, merging with any prior bounds.
  let newLower = entryLower;
  let newUpper = entryUpper;
  if (best <= origAlpha) {
    if (best < newUpper) newUpper = best;
  } else if (best >= origBeta) {
    if (best > newLower) newLower = best;
  } else {
    newLower = best;
    newUpper = best;
  }
  w.cache.set(key, encodeTT(newLower, newUpper));
  return best;
};

export interface DDSConfig {
  trumpSuit: Suit;
  myTeam: Team;
  budget: number;            // hard cap on dds() node visits
}

export interface DDSInput {
  hands: Uint32Array;        // 4 hand bitmasks (NOT mutated by evalDDS)
  trickCards: number[];      // already-played cards this trick (card idxs)
  leader: number;            // seat-index of trick leader
  ledSuit: number;           // -1 if trick is empty
}

export interface DDSResult {
  tricksByMyTeam: number;
  nodesVisited: number;
}

// Evaluate the input state and return tricks-won-by-myTeam under
// double-dummy assumption. `cache` is reused across calls when supplied;
// callers can clear() to start fresh.
export const evalDDS = (
  input: DDSInput,
  config: DDSConfig,
  cache?: Map<string, number>,
  killer?: Int8Array,
): DDSResult => {
  // Copy hands so the input bitmask array isn't mutated.
  const handsCopy = new Uint32Array(4);
  handsCopy[0] = input.hands[0];
  handsCopy[1] = input.hands[1];
  handsCopy[2] = input.hands[2];
  handsCopy[3] = input.hands[3];

  const s: DDSState = {
    hands: handsCopy,
    trickCards: new Uint8Array(4),
    trickSeats: new Uint8Array(4),
    trickLen: input.trickCards.length,
    leader: input.leader,
    ledSuit: input.ledSuit,
    nodes: 0,
  };
  let walker = input.leader;
  for (let i = 0; i < input.trickCards.length; i++) {
    s.trickCards[i] = input.trickCards[i];
    s.trickSeats[i] = walker;
    walker = NEXT_SEAT[walker];
  }

  const cardsLeft = popcount(s.hands[0]) + popcount(s.hands[1])
                  + popcount(s.hands[2]) + popcount(s.hands[3]);
  const tricksLeft = (cardsLeft + s.trickLen) >> 2;

  const w: DDSWork = {
    trumpSuit: SUIT_TO_IDX[config.trumpSuit],
    myTeam: config.myTeam === 'team_a' ? 0 : 1,
    cache: cache ?? new Map<string, number>(),
    killer: killer ?? new Int8Array(33).fill(-1),
    remaining: config.budget,
  };

  const value = dds(s, 0, tricksLeft, 0, w);
  return { tricksByMyTeam: value, nodesVisited: s.nodes };
};
