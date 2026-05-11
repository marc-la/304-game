// Bidding state machine for 304. Mirrors game304/bidding.py.
//
// Pure functions that mutate the supplied GameState. The Game
// orchestrator (game.ts) calls placeBid and consumes the transition
// signal to advance phase.

import { handPoints } from './card';
import {
  INCREMENT_200_PLUS,
  INCREMENT_BELOW_200,
  MAX_CONSECUTIVE_RESHUFFLES,
  MIN_BID_4_CARD,
  MIN_BID_8_CARD,
  PCC_BID_VALUE,
  REDEAL_POINT_THRESHOLD,
  RESHUFFLE_POINT_THRESHOLD,
  THRESHOLD_4_CARD,
  THRESHOLD_8_CARD,
} from './constants';
import {
  InvalidBidError,
  InvalidPhaseError,
  NotYourTurnError,
} from './errors';
import {
  dealOrder,
  nextSeat,
  partnerSeat,
  SEATS,
} from './seating';
import type { Seat } from './seating';
import type {
  BiddingState,
  GameState,
  PendingPartnerResponse,
  PlayerBidState,
} from './state';
import { newPlayerBidState } from './state';
import type { BidAction } from './types';

export type BiddingTransition =
  | 'pass_on'
  | 'trump_selection'
  | 'pre_play'
  | 'new_8_card_trump'
  | 'pcc'
  | null;

export const getIncrement = (currentBid: number): number =>
  currentBid >= 200 ? INCREMENT_200_PLUS : INCREMENT_BELOW_200;

const isValidBidStep = (value: number): boolean => {
  if (value < MIN_BID_4_CARD) return false;
  if (value > 250) return false;
  if (value < THRESHOLD_4_CARD) return value % INCREMENT_BELOW_200 === 0;
  return value % INCREMENT_200_PLUS === 0;
};

export const validateBidValue = (
  bidding: BiddingState,
  value: number,
  playerState: PlayerBidState,
  callerSeat: Seat,
): void => {
  if (value > 250) {
    throw new InvalidBidError(
      'Bids above 250 are illegal — only PCC may exceed 250.',
    );
  }
  if (!isValidBidStep(value)) {
    throw new InvalidBidError(
      `${value} is not a legal bid. Legal bids are 160-190 (step 10) and 200-250 (step 5).`,
    );
  }

  const isFour = bidding.isFourCard;
  const minFirst = isFour ? MIN_BID_4_CARD : MIN_BID_8_CARD;
  const threshold = isFour ? THRESHOLD_4_CARD : THRESHOLD_8_CARD;
  const isFirstSpeech = playerState.speechCount === 0;
  const partner = partnerSeat(callerSeat);
  const partnerIsHighest = bidding.highestBidder === partner;

  let minBid: number;
  if (bidding.highestBid === 0) {
    minBid = minFirst;
  } else if (isFirstSpeech) {
    minBid = Math.max(
      minFirst,
      bidding.highestBid + getIncrement(bidding.highestBid),
    );
  } else {
    minBid = Math.max(
      threshold,
      bidding.highestBid + getIncrement(bidding.highestBid),
    );
  }

  if (partnerIsHighest && value < threshold) {
    throw new InvalidBidError(
      `Cannot undercut your partner. Minimum bid is ${threshold}.`,
    );
  }

  if (value < minBid) {
    throw new InvalidBidError(`Bid must be at least ${minBid}.`);
  }

  if (bidding.highestBid > 0 && value <= bidding.highestBid) {
    throw new InvalidBidError(
      `Bid must exceed the current highest bid of ${bidding.highestBid}.`,
    );
  }
};

// Advance the current_bidder to the next seat, consuming any 'skipped'
// flag that was set when the partnered player's turn was used by their
// partner.
export const advanceBidder = (bidding: BiddingState): void => {
  let next = nextSeat(bidding.currentBidder);
  let attempts = 0;
  while (attempts < 4) {
    const ps = bidding.playerState[next];
    if (ps.skipped) {
      ps.skipped = false; // consume the skip
      next = nextSeat(next);
      attempts++;
    } else {
      break;
    }
  }
  bidding.currentBidder = next;
};

export const initBiddingState = (
  firstBidder: Seat,
  isFourCard: boolean,
  fourCardBid: number | null = null,
  fourCardBidder: Seat | null = null,
): BiddingState => {
  const playerState: Record<Seat, PlayerBidState> = {
    north: newPlayerBidState(),
    west: newPlayerBidState(),
    south: newPlayerBidState(),
    east: newPlayerBidState(),
  };
  const bidding: BiddingState = {
    isFourCard,
    currentBidder: firstBidder,
    highestBid: 0,
    highestBidder: null,
    consecutivePasses: 0,
    speeches: [],
    playerState,
    isPcc: false,
    pendingPartner: null,
    fourCardBid: null,
    fourCardBidder: null,
  };
  if (!isFourCard) {
    bidding.fourCardBid = fourCardBid;
    bidding.fourCardBidder = fourCardBidder;
    bidding.highestBid = fourCardBid ?? 0;
    bidding.highestBidder = fourCardBidder;
  }
  return bidding;
};

export const placeBid = (
  state: GameState,
  seat: Seat,
  action: BidAction,
  value = 0,
): BiddingTransition => {
  if (state.phase !== 'betting_4' && state.phase !== 'betting_8') {
    throw new InvalidPhaseError('Not in a betting phase.');
  }
  const bidding = state.bidding;
  if (bidding === null) {
    throw new InvalidPhaseError('Bidding state not initialised.');
  }
  if (seat !== bidding.currentBidder) {
    throw new NotYourTurnError("It's not your turn to bid.");
  }

  const playerState = bidding.playerState[seat];
  const partner = partnerSeat(seat);
  const partnerState = bidding.playerState[partner];

  // Pending partner response: only bet/pass allowed.
  if (
    bidding.pendingPartner !== null &&
    seat === bidding.pendingPartner.partnerSeat
  ) {
    return handlePartnerResponse(state, bidding, seat, action, value, partnerState);
  }

  if (action === 'partner') {
    return handlePartner(state, bidding, seat, playerState, partner, partnerState);
  }
  if (action === 'bet') {
    return handleBet(state, bidding, seat, value, playerState);
  }
  if (action === 'pass') {
    return handlePass(state, bidding, seat, playerState);
  }
  if (action === 'pcc') {
    return handlePcc(state, bidding, seat, playerState);
  }
  throw new InvalidBidError(`Invalid bid action: ${action}`);
};

const handlePartner = (
  state: GameState,
  bidding: BiddingState,
  seat: Seat,
  playerState: PlayerBidState,
  partner: Seat,
  partnerState: PlayerBidState,
): BiddingTransition => {
  if (!bidding.isFourCard) {
    throw new InvalidBidError('Partnering is not allowed on 8-card betting.');
  }
  if (playerState.speechCount !== 0) {
    throw new InvalidBidError(
      'Partnering is only allowed on your first speech.',
    );
  }
  const order = dealOrder(state.dealer);
  const prioritySeat = order[0];
  const acrossFromDealer = order[1];
  if (seat !== prioritySeat && seat !== acrossFromDealer) {
    throw new InvalidBidError(
      "Only the player to dealer's right or the player across from dealer may partner.",
    );
  }
  if (partnerState.skipped || partnerState.partnerUsedBy !== null) {
    throw new InvalidBidError(
      'Your partner has already been used via partnering.',
    );
  }

  playerState.speechCount += 1;
  playerState.hasPartnered = true;
  partnerState.partnerUsedBy = seat;
  partnerState.speechCount += 1;

  bidding.speeches.push({
    seat,
    action: 'partner',
    value: null,
    speechNumber: playerState.speechCount,
    onBehalfOf: null,
  });

  bidding.currentBidder = partner;
  bidding.pendingPartner = { originalSeat: seat, partnerSeat: partner };
  return null;
};

const handlePartnerResponse = (
  state: GameState,
  bidding: BiddingState,
  seat: Seat,
  action: BidAction,
  value: number,
  partnerState: PlayerBidState,
): BiddingTransition => {
  const pending = bidding.pendingPartner as PendingPartnerResponse;
  const originalSeat = pending.originalSeat;

  if (action === 'bet') {
    validateBidValue(bidding, value, partnerState, seat);
    bidding.highestBid = value;
    bidding.highestBidder = seat;
    bidding.consecutivePasses = 0;
    bidding.speeches.push({
      seat,
      action: 'bet_for_partner',
      value,
      speechNumber: partnerState.speechCount,
      onBehalfOf: originalSeat,
    });
  } else if (action === 'pass') {
    bidding.consecutivePasses += 1;
    bidding.speeches.push({
      seat,
      action: 'pass_for_partner',
      value: null,
      speechNumber: partnerState.speechCount,
      onBehalfOf: originalSeat,
    });
  } else {
    throw new InvalidBidError(
      'When responding to a partner request, you can only bet or pass.',
    );
  }

  // Responding partner's own normal turn is now skipped.
  bidding.playerState[seat].skipped = true;
  bidding.pendingPartner = null;

  // Resume from the original player's position so advance lands on the
  // next player in normal order.
  bidding.currentBidder = originalSeat;
  advanceBidder(bidding);
  return checkBiddingEnd(state, bidding);
};

const handleBet = (
  state: GameState,
  bidding: BiddingState,
  seat: Seat,
  value: number,
  playerState: PlayerBidState,
): BiddingTransition => {
  validateBidValue(bidding, value, playerState, seat);
  playerState.speechCount += 1;
  bidding.highestBid = value;
  bidding.highestBidder = seat;
  bidding.consecutivePasses = 0;
  bidding.speeches.push({
    seat,
    action: 'bet',
    value,
    speechNumber: playerState.speechCount,
    onBehalfOf: null,
  });
  advanceBidder(bidding);
  return checkBiddingEnd(state, bidding);
};

const handlePass = (
  state: GameState,
  bidding: BiddingState,
  seat: Seat,
  playerState: PlayerBidState,
): BiddingTransition => {
  playerState.speechCount += 1;
  bidding.consecutivePasses += 1;
  bidding.speeches.push({
    seat,
    action: 'pass',
    value: null,
    speechNumber: playerState.speechCount,
    onBehalfOf: null,
  });
  advanceBidder(bidding);
  return checkBiddingEnd(state, bidding);
};

const handlePcc = (
  state: GameState,
  bidding: BiddingState,
  seat: Seat,
  playerState: PlayerBidState,
): BiddingTransition => {
  if (playerState.speechCount === 0) {
    throw new InvalidBidError(
      'PCC is only available on a subsequent speech (above 250).',
    );
  }
  playerState.speechCount += 1;
  bidding.highestBid = PCC_BID_VALUE;
  bidding.highestBidder = seat;
  bidding.consecutivePasses = 0;
  bidding.isPcc = true;
  bidding.speeches.push({
    seat,
    action: 'pcc',
    value: null,
    speechNumber: playerState.speechCount,
    onBehalfOf: null,
  });
  advanceBidder(bidding);
  return checkBiddingEnd(state, bidding);
};

const checkBiddingEnd = (
  _state: GameState,
  bidding: BiddingState,
): BiddingTransition => {
  if (bidding.consecutivePasses < 3) return null;
  const allSpoken = SEATS.every(s => bidding.playerState[s].speechCount > 0);
  if (!allSpoken) return null;

  if (bidding.isFourCard) {
    if (bidding.highestBidder === null) return 'pass_on';
    if (bidding.isPcc) return 'pcc';
    return 'trump_selection';
  }
  // 8-card
  if (
    bidding.highestBid > 0 &&
    bidding.highestBid !== bidding.fourCardBid
  ) {
    if (bidding.isPcc) return 'pcc';
    return 'new_8_card_trump';
  }
  return 'pre_play';
};

// ---------------------------------------------------------------------------
// Reshuffle / pass-on eligibility
// ---------------------------------------------------------------------------

export const checkReshuffleEligibility = (
  state: GameState,
  seat: Seat,
): void => {
  if (state.phase !== 'betting_4') {
    throw new InvalidPhaseError('Can only reshuffle during 4-card betting.');
  }
  const order = dealOrder(state.dealer);
  const prioritySeat = order[0];
  const isPriority = seat === prioritySeat;
  const isPartnerViaPartner =
    state.bidding !== null &&
    state.bidding.playerState[seat].partnerUsedBy === prioritySeat;
  if (!isPriority && !isPartnerViaPartner) {
    throw new InvalidBidError(
      "Only the player with priority (or their partner via 'partner') can reshuffle.",
    );
  }
  const hand = state.hands[seat] ?? [];
  const points = handPoints(hand);
  if (points >= RESHUFFLE_POINT_THRESHOLD) {
    throw new InvalidBidError(
      `Hand has ${points} points. Must be less than ${RESHUFFLE_POINT_THRESHOLD} to reshuffle.`,
    );
  }
};

export const checkRedeal8Eligibility = (
  state: GameState,
  seat: Seat,
): void => {
  if (state.phase !== 'betting_8') {
    throw new InvalidPhaseError('Can only pass-on during 8-card betting.');
  }
  const bidding = state.bidding;
  if (bidding === null) {
    throw new InvalidPhaseError('Bidding state not initialised.');
  }
  if (seat !== bidding.currentBidder) {
    throw new InvalidBidError('Pass-on can only be called on your own turn.');
  }
  const playerState = bidding.playerState[seat];
  if (playerState === undefined || playerState.speechCount !== 0) {
    throw new InvalidBidError(
      'Pass-on must be declared on your first 8-card speech.',
    );
  }
  const hand = state.hands[seat] ?? [];
  const points = handPoints(hand);
  if (points >= REDEAL_POINT_THRESHOLD) {
    throw new InvalidBidError(
      `Hand has ${points} points. Must be less than ${REDEAL_POINT_THRESHOLD} to pass-on.`,
    );
  }
};

export const needsFullShuffle = (state: GameState): boolean =>
  state.consecutiveReshuffles >= MAX_CONSECUTIVE_RESHUFFLES;
