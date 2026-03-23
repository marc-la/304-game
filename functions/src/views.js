/**
 * Generate per-player filtered views of the game state.
 *
 * This is the critical security boundary: the full game document contains
 * all hands, but each player only receives their own cards and filtered
 * information about face-down cards.
 */

const { SEATS, PHASE } = require("./constants");
const { getTeamForSeat, getPartnerSeat, cardSuit } = require("./deck");

/**
 * Generate the player view for a specific seat.
 */
function generatePlayerView(gameState, seatId, lobbyData) {
  const isTrumper = gameState.trump && gameState.trump.trumperSeat === seatId;
  const myTeam = getTeamForSeat(seatId);
  const partnerSeat = getPartnerSeat(seatId);

  const view = {
    // Game metadata
    phase: gameState.phase,
    gameNumber: gameState.gameNumber,
    dealerSeat: gameState.dealerSeat,

    // Player identity
    mySeat: seatId,
    myTeam: myTeam,
    myHand: gameState.hands ? (gameState.hands[seatId] || []) : [],

    // Stone (match-level)
    stone: gameState.stone,

    // Player info (names, avatars)
    players: buildPlayerInfo(lobbyData),

    // Trump info (filtered)
    trump: filterTrumpState(gameState.trump, seatId, isTrumper),

    // Bidding (fully public)
    bidding: gameState.bidding || null,

    // Play state (filtered)
    play: gameState.play ? filterPlayState(gameState.play, seatId, isTrumper, gameState.trump) : null,

    // Special states
    reshuffleCount: gameState.reshuffleCount || 0,
    isPCC: gameState.bidding ? gameState.bidding.isPCC : false,
    pccPartnerOut: gameState.pccPartnerOut || null,

    // Result (end of game)
    result: gameState.result || null,

    // Waiting for action from
    waitingFor: getWaitingFor(gameState, seatId),

    // Cutting prompt
    cutting: gameState.cutting || null,
  };

  return view;
}

/**
 * Build player info map from lobby data.
 */
function buildPlayerInfo(lobbyData) {
  const players = {};
  for (const seat of SEATS) {
    if (lobbyData.seats[seat]) {
      players[seat] = {
        name: lobbyData.seats[seat].name,
        avatar: lobbyData.seats[seat].avatar,
        team: lobbyData.seats[seat].team,
        connected: lobbyData.seats[seat].connected,
      };
    }
  }
  return players;
}

/**
 * Filter trump state — hide suit/card until revealed.
 */
function filterTrumpState(trump, seatId, isTrumper) {
  if (!trump) return null;

  const filtered = {
    trumperSeat: trump.trumperSeat,
    isRevealed: trump.isRevealed,
    isOpen: trump.isOpen,
    trumpCardPlaced: trump.trumpCard !== null,
  };

  // Only show trump suit/card once revealed
  if (trump.isRevealed || trump.isOpen) {
    filtered.trumpSuit = trump.trumpSuit;
  }

  // Trumper always knows their own trump suit
  if (isTrumper) {
    filtered.trumpSuit = trump.trumpSuit;
    filtered.trumpCard = trump.trumpCard;
    filtered.trumpCardInHand = trump.trumpCardInHand;
  }

  return filtered;
}

/**
 * Filter play state — hide face-down card identities from non-trumper.
 */
function filterPlayState(play, seatId, isTrumper, trump) {
  const filtered = {
    roundNumber: play.roundNumber,
    priority: play.priority,
    currentTurn: play.currentTurn,
    pointsWon: play.pointsWon,
    capsCall: play.capsCall,
    roundComplete: play.roundComplete || false,
  };

  // Filter current round cards
  filtered.currentRound = (play.currentRound || []).map((entry) => {
    if (entry.faceDown && !isTrumper && entry.seat !== seatId) {
      // Hide card identity for face-down cards (unless you're the trumper or it's your own card)
      return { seat: entry.seat, card: null, faceDown: true };
    }
    if (entry.faceDown && entry.seat === seatId) {
      // You can always see your own card
      return { seat: entry.seat, card: entry.card, faceDown: true, isOwn: true };
    }
    return { ...entry };
  });

  // Filter completed rounds
  filtered.completedRounds = (play.completedRounds || []).map((round) => {
    return {
      roundNumber: round.roundNumber,
      winner: round.winner,
      pointsWon: round.pointsWon,
      trumpRevealed: round.trumpRevealed,
      cards: round.cards.map((entry) => {
        // After resolution: revealed cards are shown, unrevealed face-down stay hidden
        if (entry.faceDown && !entry.revealed && !isTrumper && entry.seat !== seatId) {
          return { seat: entry.seat, card: null, faceDown: true };
        }
        if (entry.revealed) {
          return { seat: entry.seat, card: entry.card, faceDown: true, revealed: true };
        }
        return { ...entry };
      }),
    };
  });

  return filtered;
}

/**
 * Determine who the game is waiting for (for UI display).
 */
function getWaitingFor(gameState, seatId) {
  switch (gameState.phase) {
  case PHASE.BETTING_4:
  case PHASE.BETTING_8:
    return gameState.bidding ? gameState.bidding.currentBidder : null;
  case PHASE.TRUMP_SELECTION:
    return gameState.bidding ? gameState.bidding.highestBidder : null;
  case PHASE.PLAYING:
    return gameState.play ? gameState.play.currentTurn : null;
  case PHASE.PRE_PLAY:
    return gameState.trump ? gameState.trump.trumperSeat : null;
  case PHASE.DEALING_4:
  case PHASE.DEALING_8:
    if (gameState.cutting && !gameState.cutting.resolved) {
      return gameState.cutting.cutterSeat;
    }
    return gameState.dealerSeat;
  default:
    return null;
  }
}

/**
 * Generate all 4 player views and return them as a map.
 */
function generateAllPlayerViews(gameState, lobbyData) {
  const views = {};
  for (const seat of SEATS) {
    if (lobbyData.seats[seat]) {
      views[seat] = generatePlayerView(gameState, seat, lobbyData);
    }
  }
  return views;
}

module.exports = {
  generatePlayerView,
  generateAllPlayerViews,
};
