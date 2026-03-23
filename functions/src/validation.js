/**
 * Shared validation helpers for Cloud Functions.
 */

const { SEATS } = require("./constants");
const { getTeamForSeat, getPartnerSeat } = require("./deck");

/**
 * Validate that the caller is authenticated and seated in the lobby.
 * Returns { uid, seat, lobby } or throws.
 */
function validateCaller(auth, lobbyData) {
  if (!auth || !auth.uid) {
    throw new Error("Authentication required.");
  }
  const uid = auth.uid;

  // Find the caller's seat
  let callerSeat = null;
  for (const seat of SEATS) {
    if (lobbyData.seats[seat] && lobbyData.seats[seat].uid === uid) {
      callerSeat = seat;
      break;
    }
  }

  if (!callerSeat) {
    throw new Error("You are not in this game.");
  }

  return { uid, seat: callerSeat };
}

/**
 * Validate that it is the caller's turn in the current game phase.
 */
function validateTurn(gameState, seat, expectedPhase) {
  if (gameState.phase !== expectedPhase) {
    throw new Error(`Invalid phase. Expected ${expectedPhase}, got ${gameState.phase}.`);
  }
}

/**
 * Validate that a card exists in a player's hand.
 */
function validateCardInHand(hand, card) {
  if (!hand.includes(card)) {
    throw new Error(`Card ${card} is not in your hand.`);
  }
}

/**
 * Check if two seats are on the same team.
 */
function sameTeam(seatA, seatB) {
  return getTeamForSeat(seatA) === getTeamForSeat(seatB);
}

/**
 * Check if two seats are partners.
 */
function arePartners(seatA, seatB) {
  return getPartnerSeat(seatA) === seatB;
}

/**
 * Create a standard HttpsError.
 */
function gameError(message) {
  const { HttpsError } = require("firebase-functions/v2/https");
  return new HttpsError("failed-precondition", message);
}

module.exports = {
  validateCaller,
  validateTurn,
  validateCardInHand,
  sameTeam,
  arePartners,
  gameError,
};
