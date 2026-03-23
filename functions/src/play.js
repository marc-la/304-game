/**
 * Card play Cloud Functions.
 *
 * Handles playing cards, round resolution (including closed trump
 * face-down card mechanics), and exhausted trumps enforcement.
 */

const { getFirestore } = require("firebase-admin/firestore");
const { SEATS, PHASE } = require("./constants");
const {
  cardSuit,
  getNextSeat,
  getPartnerSeat,
  getTeamForSeat,
  resolveRound,
  getDealOrder,
  ANTICLOCKWISE_ORDER,
} = require("./deck");
const { generateAllPlayerViews } = require("./views");
const { checkCapsObligation } = require("./caps");
const { calculateResult } = require("./scoring");

const db = () => getFirestore();

/**
 * Play a card.
 *
 * @param {Object} data - { code: string, card: string }
 * @param {Object} context - Firebase callable context
 */
async function playCard(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const card = data.card;
  if (!card) throw new Error("Must specify a card.");

  const lobbyRef = db().collection("lobbies").doc(code);

  await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");
    const lobby = lobbyDoc.data();

    const gameRef = lobbyRef.collection("games").doc(lobby.gameId);
    const gameDoc = await transaction.get(gameRef);
    if (!gameDoc.exists) throw new Error("Game not found.");
    const game = gameDoc.data();

    if (game.phase !== PHASE.PLAYING) throw new Error("Not in play phase.");

    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (!callerSeat) throw new Error("You are not in this game.");
    if (callerSeat !== game.play.currentTurn) throw new Error("It's not your turn.");

    // Skip PCC partner
    if (game.pccPartnerOut === callerSeat) throw new Error("You are out of play (PCC).");

    const hand = game.hands[callerSeat];
    if (!hand.includes(card)) throw new Error("That card is not in your hand.");

    const play = game.play;
    const trump = game.trump;
    const isTrumper = callerSeat === trump.trumperSeat;
    const trumpIsOpen = trump.isRevealed || trump.isOpen;
    const isLeading = play.currentRound.length === 0;

    // Determine the led suit
    let ledSuit = null;
    if (!isLeading) {
      const leadCard = play.currentRound.find((c) => !c.faceDown);
      if (leadCard) ledSuit = cardSuit(leadCard.card);
    }

    // Validate the play
    const playedSuit = cardSuit(card);
    let faceDown = false;

    if (isLeading) {
      // Leading a round
      if (!trumpIsOpen && isTrumper && play.roundNumber === 1) {
        // Trumper cannot lead with trump suit on first round in Closed Trump
        if (playedSuit === trump.trumpSuit) {
          throw new Error("Cannot lead with trump suit on the first round in Closed Trump. Declare Open Trump first.");
        }
      }

      // Exhausted trumps: if trumper has priority, leads trump, and holds
      // all remaining trump, must lead all trump before any other suit.
      // [House Rule] Only applies when trump is revealed.
      if (trumpIsOpen && isTrumper && play.roundNumber > 1) {
        const mustLeadTrump = checkExhaustedTrumps(game, callerSeat);
        if (mustLeadTrump && playedSuit !== trump.trumpSuit) {
          throw new Error("Exhausted Trumps: you must lead all remaining trump cards before playing another suit.");
        }
      }
    } else {
      // Following in a round
      const hasLedSuit = hand.some((c) => cardSuit(c) === ledSuit);

      if (hasLedSuit) {
        // Must follow suit
        if (playedSuit !== ledSuit) {
          throw new Error(`You must follow suit (${ledSuit}). You have cards of that suit.`);
        }
      } else {
        // Cannot follow suit — may play any card
        if (!trumpIsOpen) {
          // In Closed Trump, cards played when unable to follow suit go face down
          faceDown = true;

          // Trumper constraints on the trump card
          if (isTrumper && card === trump.trumpCard) {
            // Trump card can only be played face down to cut
            // This is allowed — it's a valid cut attempt
          }

          // Trumper: if led suit IS the trump suit and trumper has no trump
          // except the face-down trump card, must minus a non-trump card
          if (isTrumper && ledSuit === trump.trumpSuit) {
            const trumpCardsInHand = hand.filter(
              (c) => cardSuit(c) === trump.trumpSuit && c !== trump.trumpCard
            );
            if (trumpCardsInHand.length === 0) {
              // Trumper has no playable trump — must minus (non-trump card)
              if (playedSuit === trump.trumpSuit && card !== trump.trumpCard) {
                throw new Error("You have no trump to follow with. Play a non-trump card.");
              }
              // The trump card itself cannot be played face up to follow suit
              if (card === trump.trumpCard) {
                throw new Error("The trump card cannot be played face up to follow the trump suit while it remains the indicator.");
              }
            }
          }
        }
      }
    }

    // The trump card can only be played face up in round 8 as the last card
    if (isTrumper && card === trump.trumpCard && !faceDown) {
      if (play.roundNumber < 8 || hand.length > 1) {
        throw new Error("The trump card can only be played face down (to cut) or in round 8 as your last card.");
      }
    }

    // Remove card from hand
    game.hands[callerSeat] = hand.filter((c) => c !== card);

    // Add to current round
    play.currentRound.push({
      seat: callerSeat,
      card: card,
      faceDown: faceDown,
    });

    // Check caps obligation BEFORE advancing turn
    // (the server tracks when each player becomes caps-obligated)
    try {
      checkAndTrackCapsObligation(game, callerSeat);
    } catch (e) {
      // Non-fatal — just tracking
    }

    // Advance turn or resolve round
    const expectedPlayers = game.pccPartnerOut
      ? SEATS.filter((s) => s !== game.pccPartnerOut).length
      : 4;

    if (play.currentRound.length >= expectedPlayers) {
      // Round complete — resolve
      resolveCurrentRound(game, lobby);
    } else {
      // Advance to next player
      let nextTurn = getNextSeat(callerSeat);
      if (game.pccPartnerOut === nextTurn) {
        nextTurn = getNextSeat(nextTurn);
      }
      play.currentTurn = nextTurn;
    }

    transaction.update(gameRef, game);

    const views = generateAllPlayerViews(game, lobby);
    for (const seat of SEATS) {
      if (views[seat]) {
        const viewRef = gameRef.collection("playerViews").doc(seat);
        transaction.set(viewRef, views[seat]);
      }
    }
  });

  return { success: true };
}

/**
 * Resolve the current round after all cards are played.
 */
function resolveCurrentRound(game, lobby) {
  const play = game.play;
  const trump = game.trump;
  const roundCards = play.currentRound;

  // Check for face-down cards
  const hasFaceDown = roundCards.some((c) => c.faceDown);

  let result;
  let trumpRevealed = false;

  if (hasFaceDown && !trump.isRevealed && !trump.isOpen) {
    // Closed Trump resolution
    result = resolveRound(roundCards, trump.trumpSuit, false);

    if (result.trumpFound) {
      // Trump was played — reveal trump card and trump suit
      trump.isRevealed = true;
      trumpRevealed = true;

      // If the trump card itself was not played this round,
      // it gets picked up and added to the trumper's hand
      const trumpCardPlayed = roundCards.some(
        (c) => c.card === trump.trumpCard
      );
      if (!trumpCardPlayed) {
        game.hands[trump.trumperSeat].push(trump.trumpCard);
        trump.trumpCardInHand = true;
      }

      // Mark revealed cards in the round
      for (const entry of roundCards) {
        if (entry.faceDown && cardSuit(entry.card) === trump.trumpSuit) {
          entry.revealed = true;
        }
      }
    }
    // If no trump found, face-down cards stay hidden
  } else {
    // Open trump or no face-down cards
    result = resolveRound(roundCards, trump.trumpSuit, true);
  }

  // Record completed round
  play.completedRounds.push({
    roundNumber: play.roundNumber,
    cards: roundCards.map((c) => ({
      seat: c.seat,
      card: c.card,
      faceDown: c.faceDown,
      revealed: c.revealed || false,
    })),
    winner: result.winner,
    pointsWon: result.pointsWon,
    trumpRevealed: trumpRevealed,
  });

  // Update points
  const winnerTeam = getTeamForSeat(result.winner);
  play.pointsWon[winnerTeam] += result.pointsWon;

  // Check if all 8 rounds are done
  if (play.roundNumber >= 8) {
    // Move to scrutiny
    game.phase = PHASE.SCRUTINY;
    const gameResult = calculateResult(game);
    game.result = gameResult;

    // Apply stone changes
    applyStoneChanges(game, gameResult);

    game.phase = PHASE.COMPLETE;
  } else {
    // Next round
    play.roundNumber++;
    play.priority = result.winner;
    play.currentTurn = result.winner;
    play.currentRound = [];
    play.roundComplete = false;

    // Skip PCC partner
    if (game.pccPartnerOut === play.currentTurn) {
      play.currentTurn = getNextSeat(play.currentTurn);
    }
  }
}

/**
 * Apply stone changes based on the game result.
 */
function applyStoneChanges(game, result) {
  if (result.reason === "spoilt_trumps" || result.reason === "redeal" || result.reason === "absolute_hand") {
    // No stone exchanged
    return;
  }

  const trumperTeam = getTeamForSeat(game.trump.trumperSeat);
  const oppositionTeam = trumperTeam === "teamA" ? "teamB" : "teamA";

  if (result.stoneDirection === "give") {
    // Betting team won — they give stone (subtract from their count)
    game.stone[trumperTeam] = Math.max(0, game.stone[trumperTeam] - result.stoneExchanged);
  } else {
    // Betting team lost — they receive stone (add to their count)
    game.stone[trumperTeam] += result.stoneExchanged;
  }
}

/**
 * Check Exhausted Trumps condition.
 * Returns true if the trumper must lead trump.
 *
 * Condition: Trumper has priority, leads with trump, and no other
 * player can respond with the trump suit (trumper holds all remaining trump).
 * [House Rule] Only applies when trump is revealed.
 */
function checkExhaustedTrumps(game, seatId) {
  if (!game.trump.isRevealed && !game.trump.isOpen) return false;
  if (seatId !== game.trump.trumperSeat) return false;

  const trumpSuit = game.trump.trumpSuit;

  // Check if any other player has trump cards
  for (const seat of SEATS) {
    if (seat === seatId) continue;
    if (game.pccPartnerOut === seat) continue;
    const hand = game.hands[seat];
    if (hand.some((c) => cardSuit(c) === trumpSuit)) {
      return false; // someone else has trump
    }
  }

  // Trumper holds all remaining trump
  const trumperHand = game.hands[seatId];
  const hasTrump = trumperHand.some((c) => cardSuit(c) === trumpSuit);
  const hasNonTrump = trumperHand.some((c) => cardSuit(c) !== trumpSuit);

  // Only enforce if trumper has both trump and non-trump cards
  // (if they only have trump, any play is valid)
  return hasTrump && hasNonTrump;
}

/**
 * Track caps obligation for a player after they play a card.
 * This is for Late Caps detection.
 */
function checkAndTrackCapsObligation(game, seatId) {
  // Only track once trump is known (or for the trumper who knows it)
  try {
    const isObligated = checkCapsObligation(game, seatId);
    if (isObligated && !game.play.capsObligations[seatId]) {
      game.play.capsObligations[seatId] = {
        obligatedAtRound: game.play.roundNumber,
        obligatedAtCard: game.play.currentRound.length,
      };
    }
  } catch (e) {
    // Caps check is best-effort for tracking
  }
}

/**
 * Call Spoilt Trumps — opposition holds zero trump cards.
 *
 * @param {Object} data - { code: string }
 * @param {Object} context - Firebase callable context
 */
async function callSpoiltTrumps(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const lobbyRef = db().collection("lobbies").doc(code);

  await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");
    const lobby = lobbyDoc.data();

    const gameRef = lobbyRef.collection("games").doc(lobby.gameId);
    const gameDoc = await transaction.get(gameRef);
    if (!gameDoc.exists) throw new Error("Game not found.");
    const game = gameDoc.data();

    if (game.phase !== PHASE.PLAYING && game.phase !== PHASE.PRE_PLAY) {
      throw new Error("Can only call Spoilt Trumps during play.");
    }

    // Check if the last card of the last round has been played
    if (game.play && game.play.roundNumber === 8 &&
        game.play.currentRound.length >= (game.pccPartnerOut ? 3 : 4)) {
      throw new Error("Too late to call Spoilt Trumps — the last card has been played.");
    }

    const trumpSuit = game.trump.trumpSuit;
    const trumperSeat = game.trump.trumperSeat;
    const trumperTeam = getTeamForSeat(trumperSeat);
    const oppositionSeats = SEATS.filter(
      (s) => getTeamForSeat(s) !== trumperTeam && s !== game.pccPartnerOut
    );

    // Check if opposition originally held zero trump
    // We need the original deal — check initial hands
    // Since cards have been played, we need to reconstruct
    // For simplicity, we track this at deal time
    // TODO: store original hands at deal time for verification

    // For now, check current + played cards
    let oppositionTrumpCount = 0;

    // Check current hands
    for (const seat of oppositionSeats) {
      oppositionTrumpCount += (game.hands[seat] || []).filter(
        (c) => cardSuit(c) === trumpSuit
      ).length;
    }

    // Check played cards
    for (const round of (game.play?.completedRounds || [])) {
      for (const entry of round.cards) {
        if (oppositionSeats.includes(entry.seat) && cardSuit(entry.card) === trumpSuit) {
          oppositionTrumpCount++;
        }
      }
    }

    // Check current round in progress
    for (const entry of (game.play?.currentRound || [])) {
      if (oppositionSeats.includes(entry.seat) && entry.card && cardSuit(entry.card) === trumpSuit) {
        oppositionTrumpCount++;
      }
    }

    if (oppositionTrumpCount > 0) {
      throw new Error("Opposition holds (or held) trump cards. Not Spoilt Trumps.");
    }

    // Spoilt Trumps confirmed — void game
    game.phase = PHASE.COMPLETE;
    game.result = {
      reason: "spoilt_trumps",
      stoneExchanged: 0,
      stoneDirection: "none",
      winnerTeam: null,
      description: "Spoilt Trumps — opposition held zero trump cards from the deal.",
    };

    transaction.update(gameRef, game);

    const views = generateAllPlayerViews(game, lobby);
    for (const seat of SEATS) {
      if (views[seat]) {
        const viewRef = gameRef.collection("playerViews").doc(seat);
        transaction.set(viewRef, views[seat]);
      }
    }
  });

  return { success: true };
}

/**
 * Call Absolute Hand — guaranteed to win all 8 rounds before play begins.
 *
 * @param {Object} data - { code: string }
 * @param {Object} context - Firebase callable context
 */
async function callAbsoluteHand(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const lobbyRef = db().collection("lobbies").doc(code);

  await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");
    const lobby = lobbyDoc.data();

    const gameRef = lobbyRef.collection("games").doc(lobby.gameId);
    const gameDoc = await transaction.get(gameRef);
    if (!gameDoc.exists) throw new Error("Game not found.");
    const game = gameDoc.data();

    if (game.phase !== PHASE.PRE_PLAY) {
      throw new Error("Absolute Hand can only be declared before play begins.");
    }

    // Verify the claim — this is complex and would need full analysis
    // For now, accept the claim and void the game
    // TODO: implement verification (check if hand guarantees all 8 rounds)

    game.phase = PHASE.COMPLETE;
    game.result = {
      reason: "absolute_hand",
      stoneExchanged: 0,
      stoneDirection: "none",
      winnerTeam: null,
      description: "Absolute Hand declared — redeal with no stone exchanged.",
    };

    transaction.update(gameRef, game);

    const views = generateAllPlayerViews(game, lobby);
    for (const seat of SEATS) {
      if (views[seat]) {
        const viewRef = gameRef.collection("playerViews").doc(seat);
        transaction.set(viewRef, views[seat]);
      }
    }
  });

  return { success: true };
}

module.exports = {
  playCard,
  callSpoiltTrumps,
  callAbsoluteHand,
};
