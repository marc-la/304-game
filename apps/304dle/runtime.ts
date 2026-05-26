// 304dle runtime — script-driver with closed-trump support.
//
// Plays are pre-computed (curatorial — soul §VI.1.1). The runtime
// advances along a 32-entry script in order; south's turn waits for
// the user to click the highlighted scripted card; bot turns advance
// automatically on the tempo timer. The only player decision is *when*
// to call caps.
//
// Closed-trump support: the runtime tracks live trump state per
// [docs/specs/play_invariants.md §S6]. Face-down plays are applied as-is.
// On round resolution, §T9 fires: if any face-down was trump, all
// trumps in the round are revealed and (if the folded card is still
// on the table) it moves to the trumper's hand.

import type { CardId, Suit } from '@engine/card';
import { suitOf } from '@engine/card';
import {
  legalPlays,
  roundTurnOrder,
  roundWinner,
  roundPoints,
  seatsHoldingTrump,
} from '@engine/play';
import type { Seat, Team } from '@engine/seating';
import { SEAT_INDEX, teamOf } from '@engine/seating';
import type {
  CapsObligation,
  CompletedRound,
  EngineGameState,
  RoundEntry,
} from '@engine/state';
import { trackCapsObligation } from '@engine/caps';
import type { ScriptedPlay } from './types';

export interface TrumpState {
  trumperSeat: Seat;
  trumpSuit: Suit;
  // trumpCard is null once the folded card has been played AND it
  // wasn't picked back up. While on the table OR in the trumper's
  // hand, it's the original face-down trump card identity.
  trumpCard: CardId | null;
  // true: card is in trumper's hand (open trump from the start, or
  //   closed trump after §T9 reveal where the card wasn't played).
  // false: card is face-down on the table.
  trumpCardInHand: boolean;
  // true: trump suit is publicly known to non-trumpers.
  isRevealed: boolean;
  // true: open trump mode (all plays face-up from here on).
  isOpen: boolean;
  // true iff §T9 fired in closed-trump mode and lifted the folded
  // trump card publicly into the trumper's hand. The card identity
  // is public knowledge from this moment on (rules.md: "shown to all
  // players, then picked up and added to the Trumper's hand"). False
  // for open-trump-from-start (the folded card's identity was never
  // publicly shown — the trumper revealed a different trump-suit
  // card per the open-trump reveal mechanic).
  foldedCardLifted: boolean;
}

export interface RuntimeOptions {
  hands: Record<Seat, CardId[]>;
  trumpSuit: Suit;
  trumpCard: CardId;
  trumperSeat: Seat;
  priority: Seat;
  script: ScriptedPlay[];
  // 'open' = trumpCardInHand starts true, isOpen/isRevealed true.
  // 'closed' = trumpCardInHand starts false (card on table),
  //   isOpen/isRevealed false until §T9 fires.
  mode: 'open' | 'closed';
}

export interface Runtime {
  hands: Record<Seat, CardId[]>;
  trump: TrumpState;
  roundNumber: number;
  priority: Seat;
  currentRound: RoundEntry[];
  completedRounds: CompletedRound[];
  pointsWon: Record<Team, number>;
  capsObligations: Map<Seat, CapsObligation>;
  script: ScriptedPlay[];
  cursor: number;        // index into script — next entry to apply
}

const SEATS_ALL: Seat[] = ['north', 'west', 'south', 'east'];

export const newRuntime = (opts: RuntimeOptions): Runtime => {
  const isOpen = opts.mode === 'open';
  return {
    hands: {
      north: [...opts.hands.north],
      west: [...opts.hands.west],
      south: [...opts.hands.south],
      east: [...opts.hands.east],
    },
    trump: {
      trumperSeat: opts.trumperSeat,
      trumpSuit: opts.trumpSuit,
      trumpCard: opts.trumpCard,
      trumpCardInHand: isOpen,
      isRevealed: isOpen,
      isOpen,
      foldedCardLifted: false,
    },
    roundNumber: 1,
    priority: opts.priority,
    currentRound: [],
    completedRounds: [],
    pointsWon: { team_a: 0, team_b: 0 },
    capsObligations: new Map(),
    script: opts.script,
    cursor: 0,
  };
};

export const toEngineState = (rt: Runtime): EngineGameState => {
  const handsArr: ReadonlyArray<CardId>[] = [[], [], [], []];
  for (const seat of SEATS_ALL) handsArr[SEAT_INDEX[seat]] = rt.hands[seat];
  return {
    hands: handsArr,
    trump: {
      trumperSeat: rt.trump.trumperSeat,
      trumpSuit: rt.trump.trumpSuit,
      trumpCard: rt.trump.trumpCard,
      trumpCardInHand: rt.trump.trumpCardInHand,
      isRevealed: rt.trump.isRevealed,
      isOpen: rt.trump.isOpen,
      foldedCardLifted: rt.trump.foldedCardLifted,
    },
    play: {
      roundNumber: rt.roundNumber,
      priority: rt.priority,
      currentRound: rt.currentRound,
      completedRounds: rt.completedRounds,
      pointsWon: rt.pointsWon,
      capsObligations: rt.capsObligations,
    },
    pccPartnerOut: null,
  };
};

export const turnOrder = (rt: Runtime): Seat[] =>
  roundTurnOrder(rt.priority, null);

export const whoseTurn = (rt: Runtime): Seat | null => {
  const order = turnOrder(rt);
  if (rt.currentRound.length >= order.length) return null;
  return order[rt.currentRound.length];
};

export const scriptedCardForCurrentTurn = (rt: Runtime): CardId | null => {
  if (rt.cursor >= rt.script.length) return null;
  return rt.script[rt.cursor].card;
};

// Low-level primitive: removes `card` from `seat`'s hand (or the
// folded-trump-card slot if it's the trumper playing their face-down
// trump), pushes onto current round, runs the obligation tracker.
// Doesn't touch the script cursor.
export const applyPlay = (
  rt: Runtime,
  seat: Seat,
  card: CardId,
  faceDown = false,
): void => {
  // Special case: trumper plays the folded trump card as a face-down
  // cut. The card is on the table, not in the hand. Remove from the
  // trump slot, not from hands.
  if (
    seat === rt.trump.trumperSeat &&
    !rt.trump.trumpCardInHand &&
    rt.trump.trumpCard === card
  ) {
    rt.trump.trumpCard = null;
  } else {
    const hand = rt.hands[seat];
    const idx = hand.indexOf(card);
    if (idx === -1) {
      throw new Error(`Card ${card} not in ${seat}'s hand`);
    }
    hand.splice(idx, 1);
    // §S6/§S10: once the trumper plays the (formerly folded) trump
    // card from hand, the trump-card slot is no longer "in hand". Clear
    // it so the state remains a faithful descriptor of where the card
    // lives.
    if (
      seat === rt.trump.trumperSeat &&
      rt.trump.trumpCardInHand &&
      rt.trump.trumpCard === card
    ) {
      rt.trump.trumpCard = null;
      rt.trump.trumpCardInHand = false;
    }
  }
  rt.currentRound.push({
    seat,
    card,
    faceDown,
    revealed: false,
  });
  trackCapsObligation(toEngineState(rt), rt.capsObligations);
};

export const applyScriptedPlay = (rt: Runtime): void => {
  if (rt.cursor >= rt.script.length) {
    throw new Error('Script exhausted');
  }
  const entry = rt.script[rt.cursor];
  validatePlayLegality(rt, entry.seat, entry.card, entry.faceDown);
  applyPlay(rt, entry.seat, entry.card, entry.faceDown);
  rt.cursor++;
};

// Gatekeeper for scripted plays. Throws if `card`+`faceDown` would
// violate any of §S7, §T-2, §T-3, §T-4, §T-5, §T-6, §T-7, §T-8, or
// the basic follow-suit rule. Called from applyScriptedPlay so the
// 304dle runtime never silently replays an illegal puzzle script.
//
// applyPlay itself remains a low-level primitive (used by tests for
// arbitrary plays); this function is the contract for production
// scripted plays.
const validatePlayLegality = (
  rt: Runtime,
  seat: Seat,
  card: CardId,
  faceDown: boolean,
): void => {
  const trump = rt.trump;
  const isTrumper = seat === trump.trumperSeat;
  const isLead = rt.currentRound.length === 0;
  const led = ledSuit(rt);
  const hand = rt.hands[seat];

  // Trumper plays the folded trump card from the table?
  const isPlayingFoldedTrump =
    isTrumper && !trump.trumpCardInHand && trump.trumpCard === card;

  if (isPlayingFoldedTrump) {
    // §T-2: folded trump is playable face-down as a cut (not leading,
    // can't follow led suit, led suit ≠ trump) OR face-up only as the
    // trumper's R8 last card.
    if (faceDown) {
      if (isLead) {
        throw new Error('§T-3: trumper cannot lead with face-down play');
      }
      if (led !== null && hand.some(c => suitOf(c) === led)) {
        throw new Error(
          `§T-2: trumper cannot cut while able to follow led suit ${led}`,
        );
      }
      if (led === trump.trumpSuit) {
        throw new Error('§T-2: folded trump cannot cut a trump-led round');
      }
      if (trump.isOpen || trump.isRevealed) {
        throw new Error('§S7: cannot play face-down after trump reveal');
      }
      return;
    }
    if (rt.roundNumber !== 8 || hand.length !== 0) {
      throw new Error(
        `§T-2: folded trump card face-up only on R8 as trumper's last card ` +
        `(round=${rt.roundNumber}, hand size=${hand.length})`,
      );
    }
    return;
  }

  // From here, the play is sourced from `hand`.
  if (!hand.includes(card)) {
    throw new Error(`Card ${card} not in ${seat}'s hand`);
  }

  // Compute the engine's view of legal face-up plays.
  const seatsHands: ReadonlyArray<CardId>[] = [[], [], [], []];
  for (const s of SEATS_ALL) seatsHands[SEAT_INDEX[s]] = rt.hands[s];
  const seatsWithTrumps = seatsHoldingTrump(seatsHands, trump.trumpSuit);
  const legal = legalPlays({
    hand,
    ledSuit: led,
    trumpSuit: trump.trumpSuit,
    isLead,
    seatsWithTrumps,
    seat,
    roundNumber: rt.roundNumber,
    trumperSeat: trump.trumperSeat,
    isOpen: trump.isOpen,
    isPcc: false,
  });

  if (faceDown) {
    // §S7: face-down only pre-reveal.
    if (trump.isOpen || trump.isRevealed) {
      throw new Error('§S7: cannot play face-down after trump reveal');
    }
    // §T-3: face-down requires not-leading and unable to follow led suit.
    if (isLead) {
      throw new Error('§T-3: cannot lead face-down');
    }
    if (led !== null && hand.some(c => suitOf(c) === led)) {
      throw new Error(
        `§T-3: cannot play face-down while able to follow ${led}`,
      );
    }
    // §T-4: trumper cannot fold an in-hand trump card.
    if (isTrumper && suitOf(card) === trump.trumpSuit) {
      throw new Error('§T-4: trumper cannot fold an in-hand trump card');
    }
    return;
  }

  // Face-up. Must be in the engine's legal-plays set. Empty `legal`
  // means no face-up play is legal (e.g. §T-1 with only-trumps); the
  // caller should never have produced a face-up play in this state.
  if (legal.length === 0) {
    throw new Error(
      `No legal face-up play exists for ${seat} (e.g. §T-1 closed-trump ` +
      `R1 trumper with only trumps); puzzle deal is irrecoverable`,
    );
  }
  if (!legal.includes(card)) {
    throw new Error(
      `Illegal play ${card} by ${seat}: not in legal set [${legal.join(',')}]`,
    );
  }
};

// §T9 round resolution. Determines winner, sums points, advances
// priority. For closed-trump: if any face-down play was trump,
// reveal all trumps in the round, and (if the folded card was not
// played this round) pick it up into the trumper's hand. Trump mode
// becomes open from this point.
export const resolveRound = (rt: Runtime): CompletedRound => {
  // Build (seat, card) plays from ground-truth identities (face-down
  // cards still have their actual card stored in the entry).
  const plays: Array<readonly [Seat, CardId]> = rt.currentRound
    .filter(e => e.card !== null)
    .map(e => [e.seat, e.card!]);
  const winner = roundWinner(plays, rt.trump.trumpSuit);
  const points = roundPoints(plays);

  // §T9: closed-trump reveal logic.
  let trumpRevealedInRound = false;
  if (!rt.trump.isOpen) {
    const faceDownTrumpPlayed = rt.currentRound.some(
      e => e.faceDown && e.card !== null && suitOf(e.card) === rt.trump.trumpSuit,
    );
    if (faceDownTrumpPlayed) {
      for (const e of rt.currentRound) {
        if (e.faceDown && e.card !== null && suitOf(e.card) === rt.trump.trumpSuit) {
          e.revealed = true;
        }
      }
      // If the folded trump card was NOT played this round, it goes
      // to the trumper's hand and trumpCardInHand becomes true. The
      // card's identity is *publicly revealed* in the process (rules:
      // "shown to all players, then picked up and added to the
      // Trumper's hand") — mark `foldedCardLifted` so buildInfoSet
      // can propagate the public knownInHand to non-trumpers.
      if (rt.trump.trumpCard !== null && !rt.trump.trumpCardInHand) {
        rt.hands[rt.trump.trumperSeat].push(rt.trump.trumpCard);
        rt.trump.trumpCardInHand = true;
        rt.trump.foldedCardLifted = true;
      }
      rt.trump.isRevealed = true;
      rt.trump.isOpen = true;
      trumpRevealedInRound = true;
    }
  }

  const completed: CompletedRound = {
    roundNumber: rt.roundNumber,
    cards: [...rt.currentRound],
    winner,
    pointsWon: points,
    trumpRevealed: trumpRevealedInRound,
  };
  rt.completedRounds.push(completed);
  rt.pointsWon[teamOf(winner)] += points;
  rt.currentRound = [];
  rt.priority = winner;
  rt.roundNumber++;
  if (rt.roundNumber <= 8) {
    // Re-run the obligation tracker. For the trumper, this is the
    // moment they "see" any face-down identities in the just-resolved
    // round (info-set §3 clause 6). The obligation predicate may flip
    // True now even though it was False at the moment of play.
    trackCapsObligation(toEngineState(rt), rt.capsObligations);
  }
  return completed;
};

export const isGameOver = (rt: Runtime): boolean => rt.roundNumber > 8;

export const ledSuit = (rt: Runtime): Suit | null => {
  for (const e of rt.currentRound) {
    if (!e.faceDown && e.card !== null) return suitOf(e.card);
  }
  return null;
};
