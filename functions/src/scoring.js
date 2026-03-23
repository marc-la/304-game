/**
 * Scoring Cloud Functions.
 *
 * Calculates game results, stone exchange, and match progression.
 *
 * Scoring rules:
 * - Betting team must meet or exceed their bid in points
 * - Opposition threshold is 304 - bid + 1
 * - Stone given (win) or received (loss) varies by bid level
 * - Caps modifiers apply on top of normal scoring
 * - PCC: 5 stone win or loss
 */

const { SCORING_TABLE, PCC_SCORING, TOTAL_POINTS, INITIAL_STONE, PHASE, SEATS } = require("./constants");
const { getTeamForSeat, getPartnerSeat, getDealOrder, getNextSeat, getCutterSeat, createPack, minimalShuffle } = require("./deck");
const { generateAllPlayerViews } = require("./views");
const { getFirestore } = require("firebase-admin/firestore");

const db = () => getFirestore();

/**
 * Calculate the result of a completed game.
 *
 * @param {Object} game - The full game state
 * @returns {Object} Result with reason, stoneExchanged, stoneDirection, winnerTeam
 */
function calculateResult(game) {
  const bidding = game.bidding;
  const play = game.play;
  const trump = game.trump;

  const trumperSeat = trump.trumperSeat;
  const trumperTeam = getTeamForSeat(trumperSeat);
  const oppositionTeam = trumperTeam === "teamA" ? "teamB" : "teamA";

  // Check for caps situations first
  if (play.capsCall) {
    // Caps result already determined in caps.js
    return game.result;
  }

  // Check for late caps (player was obligated but never called)
  for (const seat of SEATS) {
    if (play.capsObligations && play.capsObligations[seat]) {
      const obligation = play.capsObligations[seat];
      const obligatedTeam = getTeamForSeat(seat);

      // Check if the team actually won all rounds from the obligation point onward
      const allWon = play.completedRounds
        .filter((r) => r.roundNumber >= obligation.obligatedAtRound)
        .every((r) => getTeamForSeat(r.winner) === obligatedTeam);

      if (allWon) {
        // Late caps — penalty
        const bid = bidding.isPCC ? "pcc" : bidding.highestBid;
        const scoring = bidding.isPCC ? PCC_SCORING : SCORING_TABLE[bid];
        const normalLoss = scoring ? scoring.loss : 2;

        return {
          reason: "caps_late",
          stoneExchanged: normalLoss + 1,
          stoneDirection: "receive",
          winnerTeam: obligatedTeam === "teamA" ? "teamB" : "teamA",
          capsBy: seat,
          lateDetected: true,
          description: `Late Caps detected for ${seat}. ${normalLoss + 1} stone penalty.`,
        };
      }
    }
  }

  // PCC scoring
  if (bidding.isPCC) {
    const allWon = play.completedRounds.every(
      (r) => getTeamForSeat(r.winner) === trumperTeam
    );

    if (allWon) {
      return {
        reason: "pcc_won",
        stoneExchanged: PCC_SCORING.win,
        stoneDirection: "give",
        winnerTeam: trumperTeam,
        description: `PCC successful! ${PCC_SCORING.win} stone given.`,
      };
    } else {
      return {
        reason: "pcc_lost",
        stoneExchanged: PCC_SCORING.loss,
        stoneDirection: "receive",
        winnerTeam: oppositionTeam,
        description: `PCC failed. ${PCC_SCORING.loss} stone received.`,
      };
    }
  }

  // Normal scoring
  const bid = bidding.highestBid;
  const scoring = SCORING_TABLE[bid];
  if (!scoring) {
    return {
      reason: "error",
      stoneExchanged: 0,
      stoneDirection: "none",
      winnerTeam: null,
      description: `Unknown bid value: ${bid}`,
    };
  }

  const trumperPoints = play.pointsWon[trumperTeam];
  const oppositionPoints = play.pointsWon[oppositionTeam];

  if (trumperPoints >= bid) {
    // Betting team met their bid
    return {
      reason: "bid_met",
      stoneExchanged: scoring.win,
      stoneDirection: "give",
      winnerTeam: trumperTeam,
      trumperPoints,
      oppositionPoints,
      bid,
      description: `Bid of ${scoring.name} met with ${trumperPoints} points. ${scoring.win} stone given.`,
    };
  } else {
    // Betting team failed
    return {
      reason: "bid_failed",
      stoneExchanged: scoring.loss,
      stoneDirection: "receive",
      winnerTeam: oppositionTeam,
      trumperPoints,
      oppositionPoints,
      bid,
      description: `Bid of ${scoring.name} failed with ${trumperPoints} points (needed ${bid}). ${scoring.loss} stone received.`,
    };
  }
}

/**
 * Start a new game within the same match (next dealer).
 *
 * @param {Object} data - { code: string }
 * @param {Object} context - Firebase callable context
 */
async function nextGame(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const lobbyRef = db().collection("lobbies").doc(code);

  const result = await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");
    const lobby = lobbyDoc.data();

    const gameRef = lobbyRef.collection("games").doc(lobby.gameId);
    const gameDoc = await transaction.get(gameRef);
    if (!gameDoc.exists) throw new Error("Game not found.");
    const prevGame = gameDoc.data();

    if (prevGame.phase !== PHASE.COMPLETE) throw new Error("Current game is not complete.");

    // Check if match is over
    const stone = prevGame.stone || { teamA: INITIAL_STONE, teamB: INITIAL_STONE };
    if (stone.teamA <= 0) {
      return { matchComplete: true, winner: "teamA" };
    }
    if (stone.teamB <= 0) {
      return { matchComplete: true, winner: "teamB" };
    }

    // Create new game with next dealer
    const nextDealer = getNextSeat(prevGame.dealerSeat);
    const deck = minimalShuffle(createPack());
    const cutterSeat = getCutterSeat(nextDealer);

    const newGameState = {
      gameNumber: (prevGame.gameNumber || 1) + 1,
      dealerSeat: nextDealer,
      phase: PHASE.DEALING_4,
      stone: stone,
      deck: deck,
      hands: { north: [], east: [], south: [], west: [] },
      trump: {
        trumperSeat: null,
        trumpSuit: null,
        trumpCard: null,
        isRevealed: false,
        isOpen: false,
        trumpCardInHand: false,
      },
      bidding: null,
      play: null,
      reshuffleCount: 0,
      consecutiveReshuffles: 0,
      result: null,
      cutting: {
        cutterSeat,
        resolved: false,
        didCut: null,
      },
      pccPartnerOut: null,
    };

    const newGameRef = lobbyRef.collection("games").doc();
    transaction.set(newGameRef, newGameState);
    transaction.update(lobbyRef, { gameId: newGameRef.id });

    const views = generateAllPlayerViews(newGameState, lobby);
    for (const seat of SEATS) {
      if (views[seat]) {
        const viewRef = newGameRef.collection("playerViews").doc(seat);
        transaction.set(viewRef, views[seat]);
      }
    }

    return { matchComplete: false, gameId: newGameRef.id };
  });

  return result;
}

module.exports = {
  calculateResult,
  nextGame,
};
