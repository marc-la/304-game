// Trump selection and pre-play declarations. Mirrors game304/trump.py.

import type { CardId } from './card';
import { suitOf } from './card';
import {
  InvalidPhaseError,
  InvalidTrumpSelectionError,
} from './errors';
import { dealOrder } from './seating';
import type { Seat } from './seating';
import type { GameState } from './state';
import { newPlayState } from './state';

export const selectTrump = (
  state: GameState,
  seat: Seat,
  card: CardId,
): void => {
  if (state.phase !== 'trump_selection') {
    throw new InvalidPhaseError('Not in trump selection phase.');
  }
  if (seat !== state.trump.trumperSeat) {
    throw new InvalidTrumpSelectionError(
      'Only the trumper can select the trump card.',
    );
  }
  const hand = state.hands[seat] ?? [];
  if (!hand.includes(card)) {
    throw new InvalidTrumpSelectionError('That card is not in your hand.');
  }

  const isFirstSelection = hand.length === 4;

  // Place trump card face-down (remove from hand).
  state.trump.trumpCard = card;
  state.trump.trumpSuit = suitOf(card);
  state.hands[seat] = hand.filter(c => c !== card);

  if (isFirstSelection) {
    // Deal remaining 4 cards from the deck and proceed to 8-card betting.
    if (state.deck !== null) {
      // Deal in dealing order, batched per seat.
      const order = dealOrder(state.dealer);
      for (const s of order) {
        const cards = state.deck.popN(4);
        if (state.hands[s] === undefined) state.hands[s] = [];
        state.hands[s].push(...cards);
      }
    }
    state.phase = 'betting_8';
  } else {
    // 8-card bid superseded the 4-card bid — go straight to pre-play.
    state.phase = 'pre_play';
  }
};

export const declareOpenTrump = (
  state: GameState,
  seat: Seat,
  revealCard: CardId | null = null,
): void => {
  if (state.phase !== 'pre_play') {
    throw new InvalidPhaseError(
      'Can only declare Open Trump before play begins.',
    );
  }
  if (seat !== state.trump.trumperSeat) {
    throw new InvalidTrumpSelectionError(
      'Only the trumper can declare Open Trump.',
    );
  }
  const trumpCard = state.trump.trumpCard;
  if (trumpCard === null) {
    throw new InvalidTrumpSelectionError(
      'Trump card has already been picked up.',
    );
  }

  // Pick up the trump card.
  if (state.hands[seat] === undefined) state.hands[seat] = [];
  state.hands[seat].push(trumpCard);

  // Validate the reveal card if specified.
  if (revealCard !== null) {
    const hand = state.hands[seat];
    if (!hand.includes(revealCard)) {
      throw new InvalidTrumpSelectionError('That card is not in your hand.');
    }
    if (suitOf(revealCard) !== state.trump.trumpSuit) {
      throw new InvalidTrumpSelectionError(
        'Revealed card must be of the trump suit.',
      );
    }
  }

  state.trump.isRevealed = true;
  state.trump.isOpen = true;
  state.trump.trumpCardInHand = true;
  state.trump.trumpCard = null; // no longer on table

  state.phase = 'playing';
  initPlayState(state);
};

export const proceedClosedTrump = (
  state: GameState,
  seat: Seat,
): void => {
  if (state.phase !== 'pre_play') {
    throw new InvalidPhaseError('Not in pre-play phase.');
  }
  if (seat !== state.trump.trumperSeat) {
    throw new InvalidTrumpSelectionError('Only the trumper can proceed.');
  }
  if (state.bidding !== null && state.bidding.isPcc) {
    throw new InvalidTrumpSelectionError(
      'PCC requires Open Trump. Use declareOpenTrump instead.',
    );
  }
  state.phase = 'playing';
  initPlayState(state);
};

const initPlayState = (state: GameState): void => {
  let priority: Seat;
  if (
    state.pccPartnerOut !== null &&
    state.trump.trumperSeat !== null
  ) {
    // PCC: trumper has priority for round 1.
    priority = state.trump.trumperSeat;
  } else {
    priority = dealOrder(state.dealer)[0];
  }
  state.play = newPlayState(priority);
};
