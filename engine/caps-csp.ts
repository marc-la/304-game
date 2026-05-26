// CSP-based adaptive caps solver.
//
// Replaces the world-enumeration approach (which aborted at
// MAX_WORLDS = 5000 — for 5-card hidden states the world count is
// in the millions, so it would silently return "no obligation" for
// genuinely cap-callable positions).
//
// The new approach: don't enumerate worlds. Instead, model opp
// hands as a constraint set (a shared unknown pool, per-seat hand
// sizes, per-seat exhausted-suit sets) and run an adaptive
// minimax search where:
//   - the caller branches existentially on each of their legal plays,
//   - opps branch universally on every consistent legal play
//     (taking a card from the shared pool, decrementing their size,
//     and possibly committing to a new exhaustion).
//
// Soundness: every opp branch corresponds to a legal play in at
// least one consistent world. We over-approximate slightly (any
// pool card matching the opp's suit constraints is a candidate),
// which can introduce false negatives in pathological cases but
// never false positives.
//
// Caps semantics (adaptive): caller's team wins all remaining
// rounds. The caller's plays may depend on what opps reveal —
// per the rules.md §C-1 rewrite, caps does not require a fixed
// pre-committed order, only that a per-world winning strategy
// exists in every consistent world.

import type { CardId, Suit } from './card';
import { suitOf, PACK } from './card';
import type { Seat } from './seating';
import { teamOf, ANTICLOCKWISE } from './seating';
import { roundTurnOrder, roundWinner, legalPlays } from './play';
import type { EngineGameState, RoundEntry } from './state';
import { buildInfoSet } from './info';

interface OppConstraint {
  size: number;
  exhausted: Set<Suit>;
}

interface CSPCtx {
  callerSeat: Seat;
  callerHand: CardId[];
  opps: Map<Seat, OppConstraint>;
  pool: Set<CardId>;
  trumpSuit: Suit;
  inProgress: Array<[Seat, CardId]>;
  leader: Seat;
  roundsRemaining: number;
  pccPartnerOut: Seat | null;
  // Mutable budget tracker to bound search time. When exhausted,
  // the solver returns false (conservative — may miss obligations
  // in pathological wide-open positions, but never falsely
  // confirms one).
  budget: { remaining: number; exhausted: boolean };
}

const DEFAULT_NODE_BUDGET = 50_000;

const initCtx = (state: EngineGameState, callerSeat: Seat): CSPCtx | null => {
  const info = buildInfoSet(state, callerSeat);
  const callerHand = [...info.ownHand];

  const known = new Set<CardId>([...callerHand, ...info.knownPlayed]);
  if (info.knownFoldedTrumpCard !== null) known.add(info.knownFoldedTrumpCard);

  const pool = new Set<CardId>();
  for (const c of PACK) if (!known.has(c)) pool.add(c);

  const opps = new Map<Seat, OppConstraint>();
  let oppTotal = 0;
  for (const seat of ANTICLOCKWISE) {
    if (seat === callerSeat) continue;
    if (state.pccPartnerOut === seat) continue;
    const size = info.handSizes.get(seat) ?? 0;
    opps.set(seat, {
      size,
      exhausted: new Set(info.exhaustedSuits.get(seat) ?? []),
    });
    oppTotal += size;
  }

  // Hidden slots (unrevealed face-down opp minuses in completed and
  // in-progress rounds) and the folded trump card (when face-down on
  // the table and unknown to the viewer) are NOT in any current opp
  // hand but ARE in the pool from the viewer's perspective. Account
  // for them so the consistency check passes:
  //   pool.size === oppTotal + hiddenSlotCount + foldedUnknownCount
  // The CSP search treats these "phantom" pool cards as if any opp
  // could play them, which is a sound over-approximation (more
  // adversarial opp options → conservative obligation answer).
  const hiddenSlotCount = info.hiddenSlots.length;
  const foldedUnknownCount =
    info.foldedTrumpOnTable && info.knownFoldedTrumpCard === null ? 1 : 0;
  if (pool.size !== oppTotal + hiddenSlotCount + foldedUnknownCount) {
    return null;
  }

  // In-progress entries: every entry must be present (turn-order in
  // the search depends on inProgress.length). If any in-progress entry
  // is face-down and not knowable by the caller, abandon — the CSP
  // would otherwise have to use the ground-truth identity (leaking
  // information that doesn't belong in the caller's info-set, possibly
  // producing false-positive obligations). The runtime's trackCaps
  // hook will retry at end-of-round when the round is empty and any
  // §T9 reveals have been applied; the cached stamp covers any earlier
  // moment via the lenient timing policy.
  const inProgress: Array<[Seat, CardId]> = [];
  for (const e of state.play.currentRound) {
    if (e.card === null) continue;
    if (entryKnowableToCaller(e, callerSeat, info.isViewerTrumper)) {
      inProgress.push([e.seat, e.card]);
    } else {
      return null;
    }
  }

  return {
    callerSeat,
    callerHand,
    opps,
    pool,
    trumpSuit: info.trumpSuit ?? state.trump.trumpSuit,
    inProgress,
    leader: state.play.priority,
    roundsRemaining: 8 - state.play.completedRounds.length,
    pccPartnerOut: state.pccPartnerOut,
    budget: { remaining: DEFAULT_NODE_BUDGET, exhausted: false },
  };
};

const entryKnowableToCaller = (
  e: RoundEntry,
  viewer: Seat,
  viewerIsTrumper: boolean,
): boolean => {
  if (!e.faceDown) return e.card !== null;
  if (e.revealed) return e.card !== null;
  if (e.seat === viewer) return e.card !== null;
  // Mid-round, even the trumper has not yet observed face-downs
  // (clause 6 fires at round resolution). Suppress.
  void viewerIsTrumper;
  return false;
};

// Public entry point — does south's team have an adaptive winning
// strategy that sweeps all remaining rounds in every consistent
// world?
export const checkCapsObligationCSP = (
  state: EngineGameState,
  callerSeat: Seat,
): boolean => {
  if (state.pccPartnerOut === callerSeat) return false;

  let info;
  try {
    info = buildInfoSet(state, callerSeat);
  } catch {
    return false;
  }
  if (!info.teamWonAllCompleted) return false;
  if (info.ownHand.length === 0) return false;
  if (state.play.completedRounds.length >= 8) return false;

  const ctx = initCtx(state, callerSeat);
  if (ctx === null) return false;

  return adaptiveSweep(ctx);
};

// Find one canonical witness line — the sequence of cards the
// caller plays assuming opps play their first listed candidate at
// each universal branch. Used for UI display only; the actual
// strategy is adaptive, so this is one demonstration among many.
export const findWitnessLine = (
  state: EngineGameState,
  callerSeat: Seat,
): CardId[] | null => {
  if (!checkCapsObligationCSP(state, callerSeat)) return null;
  const ctx = initCtx(state, callerSeat);
  if (ctx === null) return null;
  const line: CardId[] = [];
  collectWitness(ctx, line);
  return line;
};

const collectWitness = (ctx: CSPCtx, line: CardId[]): boolean => {
  if (ctx.roundsRemaining <= 0) return true;
  if (!isFeasible(ctx)) return true;
  if (trumpDominanceShortCircuit(ctx)) {
    // Caller plays remaining trumps in any order — collect them.
    for (const c of [...ctx.callerHand].sort()) line.push(c);
    return true;
  }
  const turnOrder = roundTurnOrder(ctx.leader, ctx.pccPartnerOut);
  const idx = ctx.inProgress.length;

  if (idx >= turnOrder.length) {
    const winner = roundWinner(ctx.inProgress, ctx.trumpSuit);
    if (teamOf(winner) !== teamOf(ctx.callerSeat)) return false;
    return collectWitness(
      { ...ctx, leader: winner, inProgress: [], roundsRemaining: ctx.roundsRemaining - 1 },
      line,
    );
  }

  const seat = turnOrder[idx];
  const ledSuit = ctx.inProgress.length > 0 ? suitOf(ctx.inProgress[0][1]) : null;
  const isLead = ctx.inProgress.length === 0;

  if (seat === ctx.callerSeat) {
    const trumpHolders = computeTrumpHolders(ctx);
    const legal = legalPlays({
      hand: ctx.callerHand,
      ledSuit, trumpSuit: ctx.trumpSuit, isLead,
      seatsWithTrumps: trumpHolders, seat,
    });
    for (const c of legal) {
      const next = applyCallerPlay(ctx, c);
      const trial: CardId[] = [];
      if (collectWitness(next, trial) && adaptiveSweep(next)) {
        line.push(c);
        line.push(...trial);
        return true;
      }
    }
    return false;
  }

  // Opp turn: assume they play the first candidate (canonical).
  const candidates = computeOppCandidates(ctx, seat, ledSuit, isLead);
  if (candidates.length === 0) return true;
  const [first] = candidates;
  const next = applyOppPlay(ctx, seat, first.card, first.exhaustNewSuit);
  return collectWitness(next, line);
};

const adaptiveSweep = (ctx: CSPCtx): boolean => {
  if (ctx.budget.exhausted) return false;
  if (--ctx.budget.remaining <= 0) {
    ctx.budget.exhausted = true;
    return false;
  }
  if (ctx.roundsRemaining <= 0) return true;
  if (!isFeasible(ctx)) return true;
  if (trumpDominanceShortCircuit(ctx)) return true;
  const turnOrder = roundTurnOrder(ctx.leader, ctx.pccPartnerOut);
  const idx = ctx.inProgress.length;

  if (idx >= turnOrder.length) {
    const winner = roundWinner(ctx.inProgress, ctx.trumpSuit);
    if (teamOf(winner) !== teamOf(ctx.callerSeat)) return false;
    return adaptiveSweep({
      ...ctx, leader: winner, inProgress: [], roundsRemaining: ctx.roundsRemaining - 1,
    });
  }

  const seat = turnOrder[idx];
  const ledSuit = ctx.inProgress.length > 0 ? suitOf(ctx.inProgress[0][1]) : null;
  const isLead = ctx.inProgress.length === 0;

  if (seat === ctx.callerSeat) {
    const trumpHolders = computeTrumpHolders(ctx);
    const legal = legalPlays({
      hand: ctx.callerHand,
      ledSuit, trumpSuit: ctx.trumpSuit, isLead,
      seatsWithTrumps: trumpHolders, seat,
    });
    for (const c of legal) {
      if (adaptiveSweep(applyCallerPlay(ctx, c))) return true;
    }
    return false;
  }

  return universalOppMove(ctx, seat, ledSuit, isLead);
};

interface OppCandidate {
  card: CardId;
  exhaustNewSuit: Suit | null; // mark this suit exhausted on opp after the play
}

const universalOppMove = (
  ctx: CSPCtx,
  seat: Seat,
  ledSuit: Suit | null,
  isLead: boolean,
): boolean => {
  const opp = ctx.opps.get(seat);
  if (!opp || opp.size === 0) return true;

  const candidates = computeOppCandidates(ctx, seat, ledSuit, isLead);
  if (candidates.length === 0) return true; // infeasible branch

  for (const cand of candidates) {
    const next = applyOppPlay(ctx, seat, cand.card, cand.exhaustNewSuit);
    if (!adaptiveSweep(next)) return false;
  }
  return true;
};

const computeOppCandidates = (
  ctx: CSPCtx,
  seat: Seat,
  ledSuit: Suit | null,
  isLead: boolean,
): OppCandidate[] => {
  const opp = ctx.opps.get(seat);
  if (!opp) return [];
  const oppCards = [...ctx.pool].filter(c => !opp.exhausted.has(suitOf(c)));
  if (oppCards.length === 0) return [];

  if (ledSuit === null) {
    // Opp leads. Apply must-lead-trump rule if opp is the
    // unique potential trump holder.
    let pool = oppCards;
    if (isLead && oppIsSoleTrumpHolder(ctx, seat)) {
      pool = pool.filter(c => suitOf(c) === ctx.trumpSuit);
      if (pool.length === 0) pool = oppCards; // fallback (shouldn't happen)
    }
    return pool.map(card => ({ card, exhaustNewSuit: null }));
  }

  const inSuit = oppCards.filter(c => suitOf(c) === ledSuit);
  const offSuit = oppCards.filter(c => suitOf(c) !== ledSuit);

  const out: OppCandidate[] = [];
  // Case A: opp follows. Possible iff led-suit cards exist and opp
  // not exhausted in led-suit.
  if (inSuit.length > 0 && !opp.exhausted.has(ledSuit)) {
    for (const c of inSuit) out.push({ card: c, exhaustNewSuit: null });
  }
  // Case B: opp claims void on led-suit. Possible iff other opps
  // can absorb every led-suit card in the pool.
  if (canBeVoidIn(ctx, seat, ledSuit, inSuit.length)) {
    for (const c of offSuit) out.push({ card: c, exhaustNewSuit: ledSuit });
  }
  return out;
};

const canBeVoidIn = (
  ctx: CSPCtx,
  seat: Seat,
  suit: Suit,
  suitInPoolCount: number,
): boolean => {
  if (suitInPoolCount === 0) return true;
  let otherCapacity = 0;
  for (const [s, o] of ctx.opps) {
    if (s === seat) continue;
    if (o.exhausted.has(suit)) continue;
    otherCapacity += o.size;
  }
  return otherCapacity >= suitInPoolCount;
};

// Trump-dominance short-circuit: caller's hand is entirely trump
// and the unknown pool contains no trump. Therefore no opp can
// hold trump; caller will lead trump every round and win. Holds
// regardless of in-progress mid-trick state because (a) if caller
// has already played in this round their card is trump and pool
// has no trump → no opp can beat it; (b) if caller hasn't played,
// caller is sole trump holder and leads (or follows by playing
// trump, since they only have trump) — wins.
const trumpDominanceShortCircuit = (ctx: CSPCtx): boolean => {
  for (const c of ctx.callerHand) {
    if (suitOf(c) !== ctx.trumpSuit) return false;
  }
  if (ctx.callerHand.length === 0) return false;
  for (const c of ctx.pool) {
    if (suitOf(c) === ctx.trumpSuit) return false;
  }
  // Caller still needs at least one card per remaining round
  // (caller plays once per round). If hand is too short, can't sweep.
  // Roughly: callerHand.length should be >= roundsRemaining minus
  // (1 if caller already played in current in-progress round else 0).
  const callerPlayedInCurrent = ctx.inProgress.some(
    ([s]) => s === ctx.callerSeat,
  );
  const callerPlaysRemaining = callerPlayedInCurrent
    ? ctx.roundsRemaining - 1
    : ctx.roundsRemaining;
  return ctx.callerHand.length >= callerPlaysRemaining;
};

// Feasibility: for every suit, the pool's count of that suit must
// fit within the combined size of opps not exhausted in it. If any
// suit fails Hall's condition, no consistent world remains and the
// universal is vacuously true.
const isFeasible = (ctx: CSPCtx): boolean => {
  const counts: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 };
  for (const c of ctx.pool) counts[suitOf(c)]++;
  for (const suit of ['c', 'd', 'h', 's'] as Suit[]) {
    if (counts[suit] === 0) continue;
    let cap = 0;
    for (const o of ctx.opps.values()) {
      if (!o.exhausted.has(suit)) cap += o.size;
    }
    if (cap < counts[suit]) return false;
  }
  return true;
};

const oppIsSoleTrumpHolder = (ctx: CSPCtx, seat: Seat): boolean => {
  if (ctx.callerHand.some(c => suitOf(c) === ctx.trumpSuit)) return false;
  const trumpInPool = [...ctx.pool].some(c => suitOf(c) === ctx.trumpSuit);
  if (!trumpInPool) return false;
  for (const [s, o] of ctx.opps) {
    if (s === seat) continue;
    if (o.size > 0 && !o.exhausted.has(ctx.trumpSuit)) return false;
  }
  return true;
};

const computeTrumpHolders = (ctx: CSPCtx): Set<Seat> => {
  const out = new Set<Seat>();
  if (ctx.callerHand.some(c => suitOf(c) === ctx.trumpSuit)) {
    out.add(ctx.callerSeat);
  }
  const trumpInPool = [...ctx.pool].some(c => suitOf(c) === ctx.trumpSuit);
  if (trumpInPool) {
    for (const [s, o] of ctx.opps) {
      if (o.size > 0 && !o.exhausted.has(ctx.trumpSuit)) out.add(s);
    }
  }
  return out;
};

const applyCallerPlay = (ctx: CSPCtx, c: CardId): CSPCtx => ({
  ...ctx,
  callerHand: ctx.callerHand.filter(x => x !== c),
  inProgress: [...ctx.inProgress, [ctx.callerSeat, c]],
});

const applyOppPlay = (
  ctx: CSPCtx,
  seat: Seat,
  c: CardId,
  exhaustNewSuit: Suit | null,
): CSPCtx => {
  const newPool = new Set(ctx.pool);
  newPool.delete(c);
  const newOpps = new Map<Seat, OppConstraint>();
  for (const [s, o] of ctx.opps) {
    if (s === seat) {
      const newExhausted = new Set(o.exhausted);
      if (exhaustNewSuit !== null) newExhausted.add(exhaustNewSuit);
      newOpps.set(s, { size: o.size - 1, exhausted: newExhausted });
    } else {
      newOpps.set(s, o);
    }
  }
  return {
    ...ctx,
    pool: newPool,
    opps: newOpps,
    inProgress: [...ctx.inProgress, [seat, c]],
  };
};
