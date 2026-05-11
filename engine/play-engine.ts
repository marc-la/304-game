// Full play-phase state machine for 304. Mirrors game304/play.py.
//
// This module operates on the full GameState (state.ts:GameState) and
// covers closed-trump face-down semantics, which the existing
// engine/play.ts deliberately skipped (304dle is open-trump only).
//
// The Game orchestrator (game.ts) is the only intended caller.

import type { CardId, Suit } from './card';
import { pointsOf, powerOf, suitOf } from './card';
import {
  GameError,
  InvalidPhaseError,
  InvalidPlayError,
  NotYourTurnError,
} from './errors';
import { nextSeat, SEATS, teamOf } from './seating';
import type { Seat } from './seating';
import type {
  CompletedRound,
  GameState,
  RoundEntry,
} from './state';

export const getLedSuit = (
  currentRound: ReadonlyArray<RoundEntry>,
): Suit | null => {
  for (const entry of currentRound) {
    if (!entry.faceDown && entry.card !== null) {
      return suitOf(entry.card);
    }
  }
  return null;
};

// Validate a card play and add it to the current round. Returns true
// if the card was played face-down.
export const validateAndPlay = (
  state: GameState,
  seat: Seat,
  card: CardId,
): boolean => {
  if (state.phase !== 'playing') {
    throw new InvalidPhaseError('Not in play phase.');
  }
  const play = state.play;
  if (play === null) {
    throw new InvalidPhaseError('Play state not initialised.');
  }
  if (seat !== play.currentTurn) {
    throw new NotYourTurnError("It's not your turn.");
  }
  if (state.pccPartnerOut === seat) {
    throw new InvalidPlayError('You are out of play (PCC).');
  }

  const hand = state.hands[seat] ?? [];
  const trump = state.trump;
  const isTrumper = seat === trump.trumperSeat;

  const isTrumpCardPlay =
    isTrumper &&
    !trump.trumpCardInHand &&
    trump.trumpCard !== null &&
    card === trump.trumpCard;

  if (!hand.includes(card) && !isTrumpCardPlay) {
    throw new InvalidPlayError('That card is not in your hand.');
  }

  const trumpIsOpen = trump.isRevealed || trump.isOpen;
  const isLeading = play.currentRound.length === 0;
  const playedSuit = suitOf(card);
  let faceDown = false;

  if (isLeading) {
    validateLead(state, seat, playedSuit, isTrumper, trumpIsOpen);
  } else {
    const ledSuit = getLedSuit(play.currentRound);
    faceDown = validateFollow(
      state,
      card,
      hand,
      ledSuit,
      playedSuit,
      isTrumper,
      trumpIsOpen,
    );
  }

  // Trump card face-up restriction: only legal in round 8 as the trumper's
  // last card.
  if (isTrumpCardPlay && !faceDown) {
    if (play.roundNumber < 8 || hand.length > 0) {
      throw new InvalidPlayError(
        'The trump card can only be played face down (to cut) or in round 8 as your last card.',
      );
    }
  }

  // Remove from hand or clear from table.
  if (isTrumpCardPlay) {
    state.trump.trumpCard = null;
    if (!faceDown) {
      // Folded trump played face-up in round 8 reveals the suit.
      state.trump.isRevealed = true;
    }
  } else {
    state.hands[seat] = hand.filter(c => c !== card);
  }

  play.currentRound.push({
    seat,
    card,
    faceDown,
    revealed: false,
  });

  return faceDown;
};

const validateLead = (
  state: GameState,
  seat: Seat,
  playedSuit: Suit,
  isTrumper: boolean,
  trumpIsOpen: boolean,
): void => {
  const trump = state.trump;
  const play = state.play!;
  const isPcc = state.pccPartnerOut !== null;

  if (
    !trumpIsOpen &&
    isTrumper &&
    play.roundNumber === 1 &&
    playedSuit === trump.trumpSuit
  ) {
    throw new InvalidPlayError(
      'Cannot lead with trump suit on the first round in Closed Trump. Declare Open Trump first.',
    );
  }

  if (
    trumpIsOpen &&
    isTrumper &&
    play.roundNumber === 1 &&
    !isPcc &&
    playedSuit !== trump.trumpSuit
  ) {
    const hand = state.hands[seat] ?? [];
    const hasTrumpInHand = hand.some(c => suitOf(c) === trump.trumpSuit);
    if (hasTrumpInHand) {
      throw new InvalidPlayError(
        'Open Trump: you must lead round 1 with a card of the trump suit.',
      );
    }
  }

  if (
    trumpIsOpen &&
    isTrumper &&
    play.roundNumber > 1 &&
    !isPcc
  ) {
    if (
      checkExhaustedTrumps(state, seat) &&
      playedSuit !== trump.trumpSuit
    ) {
      throw new InvalidPlayError(
        'Exhausted Trumps: you must lead all remaining trump cards before playing another suit.',
      );
    }
  }
};

const validateFollow = (
  state: GameState,
  card: CardId,
  hand: ReadonlyArray<CardId>,
  ledSuit: Suit | null,
  playedSuit: Suit,
  isTrumper: boolean,
  trumpIsOpen: boolean,
): boolean => {
  if (ledSuit === null) return false;
  const trump = state.trump;

  const hasLedSuit = hand.some(c => suitOf(c) === ledSuit);
  if (hasLedSuit) {
    if (playedSuit !== ledSuit) {
      throw new InvalidPlayError(
        `You must follow suit (${ledSuit}). You have cards of that suit.`,
      );
    }
    return false;
  }

  if (trumpIsOpen) return false; // open trump: any card, face-up.

  const faceDown = true;
  if (!isTrumper) return faceDown;

  // Trumper-specific face-down restrictions.
  const isFoldedTrumpCard = card === trump.trumpCard;
  const isInHandTrump =
    suitOf(card) === trump.trumpSuit && !isFoldedTrumpCard;

  if (isInHandTrump) {
    throw new InvalidPlayError(
      'The trumper cannot fold an in-hand trump-suit card. Cut with the folded trump card or minus a non-trump card.',
    );
  }

  if (ledSuit === trump.trumpSuit) {
    if (isFoldedTrumpCard) {
      throw new InvalidPlayError(
        'The trump card cannot follow the trump suit while it remains the indicator. Minus a non-trump card.',
      );
    }
  }

  return faceDown;
};

export const checkExhaustedTrumps = (
  state: GameState,
  seat: Seat,
): boolean => {
  const trump = state.trump;
  if (!trump.isRevealed && !trump.isOpen) return false;
  if (seat !== trump.trumperSeat) return false;
  const trumpSuit = trump.trumpSuit;
  if (trumpSuit === null) return false;

  for (const s of SEATS) {
    if (s === seat) continue;
    if (state.pccPartnerOut === s) continue;
    const hand = state.hands[s] ?? [];
    if (hand.some(c => suitOf(c) === trumpSuit)) return false;
  }

  const trumperHand = state.hands[seat] ?? [];
  const hasTrump = trumperHand.some(c => suitOf(c) === trumpSuit);
  const hasNonTrump = trumperHand.some(c => suitOf(c) !== trumpSuit);
  return hasTrump && hasNonTrump;
};

interface ResolveResult {
  winner: Seat;
  pointsWon: number;
  trumpFound: boolean;
  revealedCards: CardId[];
}

export const resolveRound = (
  roundCards: ReadonlyArray<RoundEntry>,
  trumpSuit: Suit | null,
): ResolveResult => {
  let ledSuit: Suit | null = null;
  for (const e of roundCards) {
    if (!e.faceDown && e.card !== null) {
      ledSuit = suitOf(e.card);
      break;
    }
  }

  const faceUp = roundCards.filter(e => !e.faceDown);
  const faceDown = roundCards.filter(e => e.faceDown);

  const trumpFolds = faceDown.filter(
    e => e.card !== null && suitOf(e.card) === trumpSuit,
  );
  const faceUpTrumps = faceUp.filter(
    e => e.card !== null && suitOf(e.card) === trumpSuit,
  );
  const trumpFound = trumpFolds.length > 0;
  const revealedCards: CardId[] = trumpFolds
    .map(e => e.card!)
    .filter((c): c is CardId => c !== null);

  let winner: Seat;
  const allTrump = [...trumpFolds, ...faceUpTrumps];
  if (allTrump.length > 0) {
    let best = allTrump[0];
    for (const e of allTrump) {
      if (e.card !== null && best.card !== null) {
        if (powerOf(e.card) < powerOf(best.card)) best = e;
      }
    }
    winner = best.seat;
  } else {
    const ledCards = faceUp.filter(
      e => e.card !== null && suitOf(e.card) === ledSuit,
    );
    if (ledCards.length === 0) {
      // Shouldn't happen in a valid round; fallback to first played.
      winner = roundCards[0].seat;
    } else {
      let best = ledCards[0];
      for (const e of ledCards) {
        if (e.card !== null && best.card !== null) {
          if (powerOf(e.card) < powerOf(best.card)) best = e;
        }
      }
      winner = best.seat;
    }
  }

  const pointsWon = roundCards.reduce(
    (sum, e) => sum + (e.card !== null ? pointsOf(e.card) : 0),
    0,
  );

  return { winner, pointsWon, trumpFound, revealedCards };
};

export const resolveCurrentRound = (state: GameState): CompletedRound => {
  const play = state.play!;
  const trump = state.trump;
  const roundCards = play.currentRound;
  const hasFaceDown = roundCards.some(e => e.faceDown);
  let trumpRevealedThisRound = false;

  let winner: Seat, pointsWon: number, trumpFound: boolean;

  if (hasFaceDown && !trump.isRevealed && !trump.isOpen) {
    ({ winner, pointsWon, trumpFound } = resolveRound(
      roundCards,
      trump.trumpSuit,
    ));
    if (trumpFound) {
      trump.isRevealed = true;
      trumpRevealedThisRound = true;

      if (trump.trumpCard !== null) {
        // Trump card not yet played — gets picked up to trumper's hand.
        const trumpCardPlayed = roundCards.some(
          e => e.card === trump.trumpCard,
        );
        if (!trumpCardPlayed && trump.trumperSeat !== null) {
          if (state.hands[trump.trumperSeat] === undefined) {
            state.hands[trump.trumperSeat] = [];
          }
          state.hands[trump.trumperSeat].push(trump.trumpCard);
          trump.trumpCardInHand = true;
          trump.trumpCard = null;
        }
      }

      // Mark face-down trump cards as revealed.
      for (const entry of roundCards) {
        if (
          entry.faceDown &&
          entry.card !== null &&
          suitOf(entry.card) === trump.trumpSuit
        ) {
          entry.revealed = true;
        }
      }
    }
  } else {
    ({ winner, pointsWon } = resolveRound(roundCards, trump.trumpSuit));
  }

  const completed: CompletedRound = {
    roundNumber: play.roundNumber,
    cards: [...roundCards],
    winner,
    pointsWon,
    trumpRevealed: trumpRevealedThisRound,
  };
  play.completedRounds.push(completed);
  play.pointsWon[teamOf(winner)] += pointsWon;
  return completed;
};

// Returns true if all 8 rounds are complete (game should end).
export const advanceAfterRound = (
  state: GameState,
  completed: CompletedRound,
): boolean => {
  const play = state.play!;
  play.currentRound = [];
  if (play.roundNumber >= 8) return true;

  play.roundNumber += 1;
  play.priority = completed.winner;
  play.currentTurn = completed.winner;
  if (state.pccPartnerOut === play.currentTurn) {
    play.currentTurn = nextSeat(play.currentTurn);
  }
  return false;
};

export const advanceTurn = (state: GameState, seat: Seat): void => {
  const play = state.play!;
  let nextTurn = nextSeat(seat);
  if (state.pccPartnerOut === nextTurn) nextTurn = nextSeat(nextTurn);
  play.currentTurn = nextTurn;
};

export const isRoundComplete = (state: GameState): boolean => {
  const play = state.play!;
  const expected = state.pccPartnerOut !== null ? 3 : 4;
  return play.currentRound.length >= expected;
};

export const checkSpoiltTrumps = (state: GameState): boolean => {
  const trump = state.trump;
  if (trump.trumperSeat === null || trump.trumpSuit === null) return false;
  const trumperTeam = teamOf(trump.trumperSeat);
  const trumpSuit = trump.trumpSuit;

  const oppositionSeats = SEATS.filter(
    s => teamOf(s) !== trumperTeam && s !== state.pccPartnerOut,
  );

  let oppTrumpCount = 0;
  for (const s of oppositionSeats) {
    const hand = state.hands[s] ?? [];
    oppTrumpCount += hand.filter(c => suitOf(c) === trumpSuit).length;
  }

  const play = state.play;
  if (play !== null) {
    for (const r of play.completedRounds) {
      for (const e of r.cards) {
        if (
          oppositionSeats.includes(e.seat) &&
          e.card !== null &&
          suitOf(e.card) === trumpSuit
        ) {
          oppTrumpCount += 1;
        }
      }
    }
    for (const e of play.currentRound) {
      if (
        oppositionSeats.includes(e.seat) &&
        e.card !== null &&
        suitOf(e.card) === trumpSuit
      ) {
        oppTrumpCount += 1;
      }
    }
  }

  return oppTrumpCount === 0;
};

export const getValidPlays = (
  state: GameState,
  seat: Seat,
): CardId[] => {
  if (state.phase !== 'playing') return [];
  const play = state.play;
  if (play === null || seat !== play.currentTurn) return [];
  if (state.pccPartnerOut === seat) return [];

  const hand = [...(state.hands[seat] ?? [])];
  const trump = state.trump;
  const isTrumper = seat === trump.trumperSeat;
  if (
    isTrumper &&
    !trump.trumpCardInHand &&
    trump.trumpCard !== null
  ) {
    hand.push(trump.trumpCard);
  }

  const valid: CardId[] = [];
  for (const card of hand) {
    try {
      validatePlayOnly(state, seat, card);
      valid.push(card);
    } catch (err) {
      if (err instanceof InvalidPlayError || err instanceof GameError) continue;
      throw err;
    }
  }
  return valid;
};

const validatePlayOnly = (
  state: GameState,
  seat: Seat,
  card: CardId,
): void => {
  const play = state.play!;
  const trump = state.trump;
  const isTrumper = seat === trump.trumperSeat;
  const trumpIsOpen = trump.isRevealed || trump.isOpen;
  const isLeading = play.currentRound.length === 0;
  const hand = state.hands[seat] ?? [];
  const isPcc = state.pccPartnerOut !== null;

  const isTrumpCardPlay =
    isTrumper &&
    !trump.trumpCardInHand &&
    trump.trumpCard !== null &&
    card === trump.trumpCard;

  const playedSuit = suitOf(card);
  let faceDown = false;

  if (isLeading) {
    if (
      !trumpIsOpen &&
      isTrumper &&
      play.roundNumber === 1 &&
      playedSuit === trump.trumpSuit
    ) {
      throw new InvalidPlayError('Cannot lead with trump on round 1.');
    }
    if (
      trumpIsOpen &&
      isTrumper &&
      play.roundNumber === 1 &&
      !isPcc &&
      playedSuit !== trump.trumpSuit
    ) {
      if (hand.some(c => suitOf(c) === trump.trumpSuit)) {
        throw new InvalidPlayError(
          'Open Trump: must lead round 1 with the trump suit.',
        );
      }
    }
    if (
      trumpIsOpen &&
      isTrumper &&
      play.roundNumber > 1 &&
      !isPcc
    ) {
      if (
        checkExhaustedTrumps(state, seat) &&
        playedSuit !== trump.trumpSuit
      ) {
        throw new InvalidPlayError('Exhausted Trumps.');
      }
    }
  } else {
    const ledSuit = getLedSuit(play.currentRound);
    if (ledSuit !== null) {
      const hasLedSuit = hand.some(c => suitOf(c) === ledSuit);
      if (hasLedSuit && playedSuit !== ledSuit) {
        throw new InvalidPlayError('Must follow suit.');
      }
      if (!hasLedSuit && !trumpIsOpen) {
        faceDown = true;
        if (isTrumper) {
          const isFoldedTrump = card === trump.trumpCard;
          const isInHandTrump =
            suitOf(card) === trump.trumpSuit && !isFoldedTrump;
          if (isInHandTrump) {
            throw new InvalidPlayError(
              'Trumper cannot fold an in-hand trump card.',
            );
          }
          if (ledSuit === trump.trumpSuit && isFoldedTrump) {
            throw new InvalidPlayError(
              'Trump card cannot follow trump suit face-up while it is the indicator.',
            );
          }
        }
      }
    }
  }

  if (isTrumpCardPlay && !faceDown) {
    if (play.roundNumber < 8 || hand.length > 0) {
      throw new InvalidPlayError(
        'Trump card may only be played face-up as the last card in round 8.',
      );
    }
  }
};
