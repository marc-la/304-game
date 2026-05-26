// 304dle runtime — script-driver with closed-trump support.
//
// Plays are pre-computed (curatorial — soul §VI.1.1). The runtime
// advances along a 32-entry script in order; south's turn waits for
// the user to click the highlighted scripted card; bot turns advance
// automatically on the tempo timer. The only player decision is *when*
// to call caps.
//
// Closed-trump support: the runtime tracks live trump state per
// [docs/play_invariants.md §S6]. Face-down plays are applied as-is.
// On round resolution, §T9 fires: if any face-down was trump, all
// trumps in the round are revealed and (if the folded card is still
// on the table) it moves to the trumper's hand.

import type { CardId, Suit } from '@engine/card';
import { suitOf } from '@engine/card';
import { roundTurnOrder, roundWinner, roundPoints } from '@engine/play';
import type { Seat, Team } from '@engine/seating';
import { teamOf } from '@engine/seating';
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
  const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
  for (const seat of SEATS_ALL) handsMap.set(seat, rt.hands[seat]);
  return {
    hands: handsMap,
    trump: {
      trumperSeat: rt.trump.trumperSeat,
      trumpSuit: rt.trump.trumpSuit,
      trumpCard: rt.trump.trumpCard,
      trumpCardInHand: rt.trump.trumpCardInHand,
      isRevealed: rt.trump.isRevealed,
      isOpen: rt.trump.isOpen,
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
  applyPlay(rt, entry.seat, entry.card, entry.faceDown);
  rt.cursor++;
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
      // to the trumper's hand and trumpCardInHand becomes true.
      if (rt.trump.trumpCard !== null && !rt.trump.trumpCardInHand) {
        rt.hands[rt.trump.trumperSeat].push(rt.trump.trumpCard);
        rt.trump.trumpCardInHand = true;
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
