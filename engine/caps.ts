// Caps obligation algorithm. The primary entry is now the
// CSP-based adaptive solver in caps-csp.ts (per rules.md §C-1
// adaptive definition). The world-enumeration machinery here is
// retained only because checkClaimBalance still uses it; for caps
// itself we no longer enumerate worlds.

import type { CardId } from './card';
import type { World, InformationSet } from './info';
import { buildInfoSet, enumerateWorlds } from './info';
import type { InProgressEntry, PlaySnapshot } from './dd';
import { orderMinPointsInWorld, orderSweepsWorld } from './dd';
import type { Seat } from './seating';
import { SEATS_BY_INDEX, teamOf } from './seating';
import type { CapsObligation, EngineGameState, EnginePlayState } from './state';
import type { CapsObligationResult } from './caps-csp';
import { checkCapsObligationCSP } from './caps-csp';

export const MAX_WORLDS = 5000;
export const MAX_PERMUTATIONS = 5040; // 7!

// Caps obligation: caller's team wins all remaining rounds, and
// the caller has an adaptive winning strategy in every consistent
// world. Caller's plays may depend on what opps reveal — see
// rules.md §C-1 adaptive definition.
export const checkCapsObligation = (
  state: EngineGameState,
  seat: Seat,
): boolean => {
  // PCC: caps mechanics do not apply (rules.md §C-10; spec §6 / §12).
  if (state.pccPartnerOut !== null) return false;
  // 304dle policy "Trust the player" (handoff §5): on engine budget
  // exhaustion (`exhausted: true`), do NOT auto-stamp obligation —
  // let the player decide; scrutiny resolves on actual play.
  return checkCapsObligationCSP(state, seat).obligated;
};

// Detailed obligation predicate exposing the tri-valued result for
// callers that need to distinguish "proven not obligated" from
// "engine budget exhausted." See CapsObligationResult.
export const checkCapsObligationDetailed = (
  state: EngineGameState,
  seat: Seat,
): CapsObligationResult => {
  if (state.pccPartnerOut !== null) return { obligated: false, exhausted: false };
  return checkCapsObligationCSP(state, seat);
};

export const validateCapsCall = (
  state: EngineGameState,
  seat: Seat,
  playOrder: ReadonlyArray<CardId>,
): boolean => {
  // PCC: caps mechanics do not apply (rules.md §C-10; spec §6 / §12).
  if (state.pccPartnerOut !== null) return false;

  let info: InformationSet;
  try {
    info = buildInfoSet(state, seat);
  } catch {
    return false;
  }
  if (!info.teamWonAllCompleted) return false;

  // play order must equal own hand as a multiset
  const sortedOrder = [...playOrder].sort();
  const sortedHand = [...info.ownHand].sort();
  if (sortedOrder.length !== sortedHand.length) return false;
  for (let i = 0; i < sortedOrder.length; i++) {
    if (sortedOrder[i] !== sortedHand[i]) return false;
  }

  const roundsRemaining = 8 - state.play.completedRounds.length;
  if (roundsRemaining <= 0) return false;

  const { worlds, exhausted } = enumerateOrAbort(info);
  // "Trust the player": engine couldn't enumerate fully → accept the
  // call. Scrutiny resolves on actual play (handoff §5 policy).
  if (exhausted) return true;
  if (worlds.length === 0) return false;

  return orderWinsAllWorlds({
    info,
    seat,
    play: state.play,
    worlds,
    order: [...playOrder],
    roundsRemaining,
    pccPartnerOut: state.pccPartnerOut,
  });
};

// Like validateCapsCall, but also returns the first failing world for
// UI explanation. null on success, breaking world otherwise.
export const explainCapsFailure = (
  state: EngineGameState,
  seat: Seat,
  playOrder: ReadonlyArray<CardId>,
): { world: World; reason: 'lost-round' | 'illegal-order' } | null => {
  // PCC: caps mechanics do not apply (rules.md §C-10; spec §6 / §12).
  if (state.pccPartnerOut !== null) {
    return { world: anyWorld(state), reason: 'illegal-order' };
  }
  let info: InformationSet;
  try {
    info = buildInfoSet(state, seat);
  } catch {
    return { world: anyWorld(state), reason: 'illegal-order' };
  }
  if (!info.teamWonAllCompleted) {
    return { world: anyWorld(state), reason: 'illegal-order' };
  }

  const sortedOrder = [...playOrder].sort();
  const sortedHand = [...info.ownHand].sort();
  if (
    sortedOrder.length !== sortedHand.length ||
    sortedOrder.some((c, i) => c !== sortedHand[i])
  ) {
    return { world: anyWorld(state), reason: 'illegal-order' };
  }

  const roundsRemaining = 8 - state.play.completedRounds.length;
  const { worlds, exhausted } = enumerateOrAbort(info);
  // "Trust the player": engine couldn't enumerate fully → no failure
  // to explain (the call goes through; scrutiny resolves on play).
  if (exhausted) return null;
  if (worlds.length === 0) {
    return { world: anyWorld(state), reason: 'illegal-order' };
  }

  for (const world of worlds) {
    const snap = resolveSnapshot(state.play, info, world, seat);
    if (snap === null) return { world, reason: 'illegal-order' };
    const ok = orderSweepsWorld({
      world,
      callerSeat: seat,
      callerOrder: [...playOrder],
      snapshot: snap,
      pccPartnerOut: state.pccPartnerOut,
      roundsRemaining,
    });
    if (!ok) return { world, reason: 'lost-round' };
  }
  return null;
};

const anyWorld = (state: EngineGameState): World => {
  // Best-effort: build a dummy world out of the actual hands the
  // runtime is carrying. Used only for the explainer fallback.
  const hands: ReadonlyArray<CardId>[] = [[], [], [], []];
  for (let i = 0; i < 4; i++) {
    const seat = SEATS_BY_INDEX[i];
    if (seat === state.pccPartnerOut) continue;
    hands[i] = [...(state.hands[i] ?? [])];
  }
  return {
    hands,
    trumpSuit: state.trump.trumpSuit,
    foldedTrumpCard: state.trump.trumpCard,
    hiddenSlotAssignments: new Map(),
  };
};

export interface TrackCapsObligationOptions {
  // Seats to consider stamping. Default: ['south'] (304dle's only
  // human seat). Python's track_caps_obligation walks every seat;
  // 304dle restricts to south to keep per-play cost flat.
  seats?: ReadonlyArray<Seat>;
  // Override the expected round size (cards per round). Defaults to
  // 3 if pccPartnerOut is set, else 4.
  expectedRoundSize?: number;
}

// Stamp first-obligation moments into `target`, mirroring
// game304/caps.py:track_caps_obligation. Idempotent: a seat's
// stamp is written exactly once; subsequent calls are no-ops for
// already-stamped seats. Best-effort: any exception from the
// per-seat predicate is swallowed so the play loop never crashes.
export const trackCapsObligation = (
  state: EngineGameState,
  target: Map<Seat, CapsObligation>,
  opts: TrackCapsObligationOptions = {},
): void => {
  // PCC: caps mechanics do not apply (rules.md §C-10; spec §6 / §12).
  if (state.pccPartnerOut !== null) return;
  const play = state.play;
  const expectedRoundSize = opts.expectedRoundSize ?? 4;
  // §rules: caps cannot be called after the final card of round 8.
  // Obligations arising precisely at that final state are not
  // stamped; earlier stamps remain.
  const callWindowClosed =
    play.roundNumber === 8 && play.currentRound.length >= expectedRoundSize;
  if (callWindowClosed) return;

  const seats = opts.seats ?? (['south'] as const);
  for (const seat of seats) {
    if (target.has(seat)) continue;
    let obligated = false;
    try {
      obligated = checkCapsObligation(state, seat);
    } catch {
      continue;
    }
    if (!obligated) continue;
    const playedInCurrent = play.currentRound.some(e => e.seat === seat);
    target.set(seat, {
      obligatedAtRound: play.roundNumber,
      obligatedAtCard: play.currentRound.length,
      vPlaysAtObligation:
        (play.roundNumber - 1) + (playedInCurrent ? 1 : 0),
    });
  }
};

export const isCapsLate = (
  state: EngineGameState,
  seat: Seat,
  options: { policy?: 'lenient' | 'strict' } = {},
): boolean => {
  const play = state.play;
  const obligation = play.capsObligations.get(seat);
  if (!obligation) return false;

  const policy = options.policy ?? 'lenient';
  if (policy === 'strict') {
    if (obligation.obligatedAtRound < play.roundNumber) return true;
    if (
      obligation.obligatedAtRound === play.roundNumber &&
      obligation.obligatedAtCard < play.currentRound.length
    ) return true;
    return false;
  }

  const vPlayedInCurrent = play.currentRound.some(e => e.seat === seat);
  const vPlaysNow =
    (play.roundNumber - 1) + (vPlayedInCurrent ? 1 : 0);
  return vPlaysNow > obligation.vPlaysAtObligation;
};

// Claim balance ----------------------------------------------------------

export const checkClaimBalance = (
  state: EngineGameState,
  seat: Seat,
  threshold: number,
): boolean => {
  // PCC: claim balance is moot when caps cannot be called
  // (rules.md §C-10). Match the caps API surface.
  if (state.pccPartnerOut !== null) return false;
  let info: InformationSet;
  try {
    info = buildInfoSet(state, seat);
  } catch {
    return false;
  }
  if (info.ownHand.length === 0) return false;

  const myTeam = teamOf(seat);
  const pointsSoFar = state.play.pointsWon[myTeam] ?? 0;
  if (pointsSoFar >= threshold) return true;
  const roundsRemaining = 8 - state.play.completedRounds.length;
  if (roundsRemaining <= 0) return false;

  const { worlds, exhausted } = enumerateOrAbort(info);
  // Claim balance is a positive ASK from the caller's defensive side;
  // unlike a caps call we have no asymmetric "trust" rationale, so
  // stay conservative on exhaustion (caller didn't prove threshold).
  if (exhausted) return false;
  if (worlds.length === 0) return false;
  const gap = threshold - pointsSoFar;

  return hasBalanceWitness({
    info, seat, play: state.play, worlds, roundsRemaining,
    pccPartnerOut: state.pccPartnerOut, gap,
  });
};

// Internals --------------------------------------------------------------

// Tri-valued enumeration. `exhausted: true` means we exceeded
// MAX_WORLDS and bailed (the worlds set is empty; the truth value
// is unknown). `exhausted: false` with empty worlds means the info-
// set has no consistent extension (a real contradiction). Otherwise
// `worlds` is the full enumeration. See handoff §5 (B5/B6).
interface EnumResult {
  worlds: World[];
  exhausted: boolean;
}

const enumerateOrAbort = (info: InformationSet): EnumResult => {
  const worlds: World[] = [];
  for (const w of enumerateWorlds(info, { maxWorlds: MAX_WORLDS + 1 })) {
    worlds.push(w);
    if (worlds.length > MAX_WORLDS) return { worlds: [], exhausted: true };
  }
  return { worlds, exhausted: false };
};

const resolveSnapshot = (
  play: EnginePlayState,
  _info: InformationSet,
  world: World,
  viewer: Seat,
): PlaySnapshot | null => {
  const leader = play.priority;
  const entries: InProgressEntry[] = [];
  for (const e of play.currentRound) {
    if (e.faceDown && !e.revealed && e.seat !== viewer) {
      const k = `${e.seat}:${play.roundNumber}`;
      const card = world.hiddenSlotAssignments.get(k);
      if (!card) return null;
      entries.push({ seat: e.seat, card });
    } else {
      if (e.card === null) return null;
      entries.push({ seat: e.seat, card: e.card });
    }
  }
  return { leader, entries };
};

interface WitnessSearchArgs {
  info: InformationSet;
  seat: Seat;
  play: EnginePlayState;
  worlds: World[];
  roundsRemaining: number;
  pccPartnerOut: Seat | null;
}

interface OrderCheckArgs extends WitnessSearchArgs {
  order: CardId[];
}

const factorial = (n: number): number => {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};

function* permutations<T>(items: ReadonlyArray<T>): Generator<T[]> {
  const a = [...items];
  const n = a.length;
  if (n === 0) { yield []; return; }
  const c = new Array(n).fill(0);
  yield [...a];
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const swapIdx = i % 2 === 0 ? 0 : c[i];
      const tmp = a[swapIdx]; a[swapIdx] = a[i]; a[i] = tmp;
      yield [...a];
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

const firstWitnessOrder = (args: WitnessSearchArgs): CardId[] | null => {
  const cards = [...args.info.ownHand];
  if (factorial(cards.length) > MAX_PERMUTATIONS) return null;
  for (const ordering of permutations(cards)) {
    if (orderWinsAllWorlds({ ...args, order: ordering })) return ordering;
  }
  return null;
};

// Returns south's first witness order at this state, or null if none
// exists / none can be searched within the permutation cap. Mirrors
// checkCapsObligation but exposes the actual order. Useful for tooling
// (puzzle curators) that need to inspect the witness, not just know it
// exists.
export const findWitnessOrder = (
  state: EngineGameState,
  seat: Seat,
): CardId[] | null => {
  // PCC: caps mechanics do not apply (rules.md §C-10; spec §6 / §12).
  if (state.pccPartnerOut !== null) return null;

  let info: InformationSet;
  try {
    info = buildInfoSet(state, seat);
  } catch {
    return null;
  }

  if (!info.teamWonAllCompleted) return null;
  if (info.ownHand.length === 0) return null;

  const roundsRemaining = 8 - state.play.completedRounds.length;
  if (roundsRemaining <= 0) return null;

  const { worlds, exhausted } = enumerateOrAbort(info);
  // findWitnessOrder is for tooling that wants a proven witness; if
  // we couldn't enumerate fully or no consistent world exists, there
  // is no proven witness to return.
  if (exhausted) return null;
  if (worlds.length === 0) return null;

  return firstWitnessOrder({
    info,
    seat,
    play: state.play,
    worlds,
    roundsRemaining,
    pccPartnerOut: state.pccPartnerOut,
  });
};

// Whether `order` wins across every world consistent with `info`.
// Lower-level than validateCapsCall: takes a pre-built information
// set rather than re-deriving from EngineGameState. Used by the
// curator to test orders against synthesized (relaxed) information
// sets without round-tripping through the state shape.
export const orderSurvivesInfo = (args: {
  info: InformationSet;
  play: EnginePlayState;
  seat: Seat;
  pccPartnerOut: Seat | null;
  order: ReadonlyArray<CardId>;
}): boolean => {
  const roundsRemaining = 8 - args.play.completedRounds.length;
  if (roundsRemaining <= 0) return false;

  const { worlds, exhausted } = enumerateOrAbort(args.info);
  // orderSurvivesInfo is for curator tooling that needs a proven
  // "this order sweeps every world." Exhaustion or empty → not proven.
  if (exhausted) return false;
  if (worlds.length === 0) return false;

  return orderWinsAllWorlds({
    info: args.info,
    seat: args.seat,
    play: args.play,
    worlds,
    order: [...args.order],
    roundsRemaining,
    pccPartnerOut: args.pccPartnerOut,
  });
};

const orderWinsAllWorlds = (args: OrderCheckArgs): boolean => {
  for (const world of args.worlds) {
    const snap = resolveSnapshot(args.play, args.info, world, args.seat);
    if (snap === null) return false;
    const ok = orderSweepsWorld({
      world,
      callerSeat: args.seat,
      callerOrder: args.order,
      snapshot: snap,
      pccPartnerOut: args.pccPartnerOut,
      roundsRemaining: args.roundsRemaining,
    });
    if (!ok) return false;
  }
  return true;
};

interface BalanceArgs extends WitnessSearchArgs {
  gap: number;
}

const hasBalanceWitness = (args: BalanceArgs): boolean => {
  const cards = [...args.info.ownHand];
  if (factorial(cards.length) > MAX_PERMUTATIONS) return false;
  for (const ordering of permutations(cards)) {
    let ok = true;
    for (const world of args.worlds) {
      const snap = resolveSnapshot(args.play, args.info, world, args.seat);
      if (snap === null) { ok = false; break; }
      const minPts = orderMinPointsInWorld({
        world,
        callerSeat: args.seat,
        callerOrder: ordering,
        snapshot: snap,
        pccPartnerOut: args.pccPartnerOut,
        roundsRemaining: args.roundsRemaining,
      });
      if (minPts < args.gap) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
};
