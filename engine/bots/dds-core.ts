// Shared double-dummy solver for 304's open-trump play bots (B6, B7).
//
// Performance pillars over the original per-bot pure minimax:
//   - Cards encoded as 0..31 ((suitIdx<<3)|power) so hands fit in a
//     single 32-bit bitmask and "cards of suit S" is a byte mask.
//   - Hands as Uint32Array(4) indexed by seat-index (N=0, W=1, S=2, E=3).
//   - In-place state mutation with explicit undo on the recursion stack
//     — no per-node Map or array allocation.
//   - Alpha-beta on points-won-by-myTeam. 304 is decided on points
//     (trumper team needs ≥160), and per-card values vary widely
//     (J=30, 9=20, A=11, 10=10, K=3, Q=2, 8=0, 7=0). A pure
//     tricks-won objective would treat a J+9+A trick (61 pts) as
//     identical to a K+Q+8+7 trick (5 pts), so the search would
//     gladly trade one for two. Points-scoring fixes that. The game
//     is still zero-sum in *total* points (76·4 = 304), so a scalar
//     suffices and alpha-beta still applies.
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
// Points by power-index, mirroring engine/card.ts POINTS:
//   J=30, 9=20, A=11, 10=10, K=3, Q=2, 8=0, 7=0
const POWER_POINTS = new Uint8Array([30, 20, 11, 10, 3, 2, 0, 0]);
const CARD_POINTS = new Uint8Array(32);
const CARDID_BY_IDX: CardId[] = new Array<CardId>(32);
const IDX_BY_CARDID = new Map<string, number>();

(() => {
  for (let s = 0; s < 4; s++) {
    for (let p = 0; p < 8; p++) {
      const idx = (s << 3) | p;
      CARD_SUIT[idx] = s;
      CARD_POWER[idx] = p;
      CARD_POINTS[idx] = POWER_POINTS[p];
      const cid = (RANKS_ORDER[p] + SUITS_ORDER[s]) as CardId;
      CARDID_BY_IDX[idx] = cid;
      IDX_BY_CARDID.set(cid, idx);
    }
  }
})();

// Sum of point values across all bits set in `mask`. Used to compute
// the initial alpha-beta window (total points still in play).
const maskPoints = (mask: number): number => {
  let m = mask >>> 0;
  let sum = 0;
  while (m !== 0) {
    const bit = m & -m;
    // 31 - clz(bit) → bit index, but JS Math.clz32 covers this.
    const idx = 31 - Math.clz32(bit);
    sum += CARD_POINTS[idx];
    m = (m & (m - 1)) >>> 0;
  }
  return sum;
};

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
  // TT value packs (lower+1, upper+1) into a single int. Each slot is
  // 12 bits, so values fit in [-1, 4094] — plenty for points-valued
  // bounds, which live in [0, 304] (with fail-soft slack still well
  // inside the slot). The +1 sentinel offset lets us tell "no value
  // here" via Map.get() returning undefined.
  cache: Map<string, number>;
  killer: Int8Array;         // killer[depth] = card-idx (-1 = none)
  remaining: number;         // node budget
}

const encodeTT = (lower: number, upper: number): number =>
  ((lower + 1) << 12) | (upper + 1);

const decodeLower = (v: number): number => (v >>> 12) - 1;
const decodeUpper = (v: number): number => (v & 0xfff) - 1;

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
// each suit, with suit-equivalence collapsing. Implements the engine's
// legal-play contract:
//   - Following a lead: must follow led suit if able; else any card.
//   - Leading: if this seat is the only seat holding any trump and
//     holds at least one, must lead trump.
//
// Suit-equivalence (the bridge-DDS branching-factor win): two cards of
// the same suit held by `seat` are interchangeable if every card of
// that suit with power strictly between them is also held by `seat`
// (i.e. no opponent holds a card that could split them in trick value).
// We emit one representative per class — the strongest, so move
// ordering stays high-power-first within suit. Per-class collapse is
// computed against `allMask` (all unplayed cards) and so changes node
// to node; the TT keys include hand bitmasks, so caches remain correct.
const legalMoves = (
  s: DDSState,
  seat: number,
  trumpSuit: number,
  out: number[],
): void => {
  out.length = 0;
  const hand = s.hands[seat];
  const allMask = (s.hands[0] | s.hands[1] | s.hands[2] | s.hands[3]) >>> 0;
  let movesMask: number;
  if (s.ledSuit < 0) {
    const trumpByte = (0xff << (trumpSuit << 3)) >>> 0;
    const allTrumps = (allMask & trumpByte) >>> 0;
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
  // Scan powers low-to-high (strongest first) per suit. Within a suit:
  //   - On an opponent's card, close the current equivalence group.
  //   - On a MY card, open a new group if none is open (and emit it).
  //     Otherwise skip — this card is equivalent to the open group's
  //     representative.
  // The opponent-mask is computed from suitByte against `allMask` so
  // that cards of mine that are NOT legal-to-play (e.g. when forced to
  // follow a different suit) still count as group-internal for the
  // collapsed suit — but since `movesMask` zeros out other suits, the
  // scan only emits within the legal suit anyway.
  for (let suit = 0; suit < 4; suit++) {
    const shift = suit << 3;
    const suitByte = (0xff << shift) >>> 0;
    const myInSuit = (movesMask & suitByte) >>> 0;
    if (myInSuit === 0) continue;
    const allInSuit = (allMask & suitByte) >>> 0;
    // "Other" = unplayed cards of this suit held by anyone else. Use
    // `hand` (not `movesMask`) so the must-lead-trump restriction
    // collapses correctly: my trumps are all-equivalent iff no other
    // seat holds any trump, which is precisely the lone-holder case.
    const otherInSuit = (allInSuit & ~(hand & suitByte)) >>> 0;
    let inGroup = false;
    for (let p = 0; p < 8; p++) {
      const bit = (1 << (shift + p)) >>> 0;
      if (otherInSuit & bit) inGroup = false;
      if (myInSuit & bit) {
        if (!inGroup) {
          out.push(shift + p);
          inGroup = true;
        }
      }
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
  // Budget-exhaustion fallback: return `alpha` as a sound lower-bound
  // proxy. The previous midpoint estimate was reasonable on a [0, 8]
  // tricks window but became wildly noisy on the new [0, 304] points
  // window. Returning alpha is pessimistic but at least consistent
  // with the cutoff math (any caller that has alpha tightened by
  // exhaustion will simply not improve).
  if (w.remaining <= 0) return alpha;
  w.remaining--;
  s.nodes++;

  const total = popcount(s.hands[0]) + popcount(s.hands[1])
              + popcount(s.hands[2]) + popcount(s.hands[3]);
  if (total === 0) return 0;

  const seat = seatToPlay(s.leader, s.trickLen);

  const key = makeKey(s);
  const entry = w.cache.get(key);
  let entryLower = -1;
  // Upper "absent" sentinel must be larger than any reachable points
  // total. 305 is one more than the max (304) so a fresh entry never
  // accidentally clamps the window.
  let entryUpper = 305;
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
  // Sentinels must straddle the points range [0, 304]. -1 / 305 keeps
  // the first move's `best` comparison correct in both maximizing and
  // minimizing branches.
  let best = playForMe ? -1 : 305;

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

    // Principal Variation Search: after move ordering, the first child
    // is almost always the best. Search it with the full (alpha, beta)
    // window, then probe each subsequent child with a null window. The
    // null-window probe answers "does this beat alpha?" (max) or "does
    // this beat beta?" (min) ~2× cheaper than a full search. If the
    // probe says yes, re-search with the full window to extract the
    // true value. The bound-typed TT stores sound bounds regardless of
    // window width, so deeper entries written during the null probe
    // remain valid for the re-search.
    let value: number;
    if (s.trickLen === 4) {
      const winner = trickWinner(s, w.trumpSuit);
      // Sum the four card-points of this trick; credit to the winner.
      // 304 is decided on points, not trick count — see header.
      const trickPts = CARD_POINTS[s.trickCards[0]]
                     + CARD_POINTS[s.trickCards[1]]
                     + CARD_POINTS[s.trickCards[2]]
                     + CARD_POINTS[s.trickCards[3]];
      const won = SEAT_TEAM[winner] === w.myTeam ? trickPts : 0;
      const prevLeader = s.leader;
      const prevLed = s.ledSuit;
      s.leader = winner;
      s.trickLen = 0;
      s.ledSuit = -1;
      const innerA = alpha - won;
      const innerB = beta - won;
      let future: number;
      if (mi === 0) {
        future = dds(s, innerA, innerB, depth + 1, w);
      } else if (playForMe) {
        future = dds(s, innerA, innerA + 1, depth + 1, w);
        if (future > innerA && future < innerB) {
          future = dds(s, innerA, innerB, depth + 1, w);
        }
      } else {
        future = dds(s, innerB - 1, innerB, depth + 1, w);
        if (future < innerB && future > innerA) {
          future = dds(s, innerA, innerB, depth + 1, w);
        }
      }
      s.leader = prevLeader;
      s.trickLen = 4;
      s.ledSuit = prevLed;
      value = won + future;
    } else {
      if (mi === 0) {
        value = dds(s, alpha, beta, depth + 1, w);
      } else if (playForMe) {
        value = dds(s, alpha, alpha + 1, depth + 1, w);
        if (value > alpha && value < beta) {
          value = dds(s, alpha, beta, depth + 1, w);
        }
      } else {
        value = dds(s, beta - 1, beta, depth + 1, w);
        if (value < beta && value > alpha) {
          value = dds(s, alpha, beta, depth + 1, w);
        }
      }
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
  pointsByMyTeam: number;
  nodesVisited: number;
}

// Evaluate the input state and return points-won-by-myTeam under
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

  // Initial alpha-beta window covers every point still in play: cards
  // remaining in any hand plus cards already on the table (which will
  // be credited when this trick resolves). This is the *tight* upper
  // bound — no honest play can score more than this — so the initial
  // search runs with the narrowest sound window.
  let pointsLeft = maskPoints(s.hands[0]) + maskPoints(s.hands[1])
                 + maskPoints(s.hands[2]) + maskPoints(s.hands[3]);
  for (let i = 0; i < s.trickLen; i++) {
    pointsLeft += CARD_POINTS[s.trickCards[i]];
  }

  const w: DDSWork = {
    trumpSuit: SUIT_TO_IDX[config.trumpSuit],
    myTeam: config.myTeam === 'team_a' ? 0 : 1,
    cache: cache ?? new Map<string, number>(),
    killer: killer ?? new Int8Array(33).fill(-1),
    remaining: config.budget,
  };

  const value = dds(s, 0, pointsLeft, 0, w);
  return { pointsByMyTeam: value, nodesVisited: s.nodes };
};
