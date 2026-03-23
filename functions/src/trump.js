/**
 * Trump selection and declaration Cloud Functions.
 *
 * Handles:
 * - Selecting a trump card (face down) after winning the bid
 * - Declaring Open Trump before play begins
 * - Dealing the remaining 4 cards after trump selection
 */

const { getFirestore } = require("firebase-admin/firestore");
const { SEATS, PHASE } = require("./constants");
const { cardSuit, getDealOrder, dealCards, getPartnerSeat } = require("./deck");
const { generateAllPlayerViews } = require("./views");

const db = () => getFirestore();

/**
 * Select a trump card from the trumper's 4-card hand.
 * The card is placed face down. The trumper must not see
 * their remaining 4 cards before selecting.
 *
 * @param {Object} data - { code: string, card: string }
 * @param {Object} context - Firebase callable context
 */
async function selectTrump(data, context) {
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

    if (game.phase !== PHASE.TRUMP_SELECTION) {
      throw new Error("Not in trump selection phase.");
    }

    // Validate caller is the trumper
    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (callerSeat !== game.trump.trumperSeat) {
      throw new Error("Only the trumper can select the trump card.");
    }

    // Validate card is in hand
    const hand = game.hands[callerSeat];
    if (!hand.includes(card)) {
      throw new Error("That card is not in your hand.");
    }

    // Set trump
    game.trump.trumpCard = card;
    game.trump.trumpSuit = cardSuit(card);

    // Remove card from hand (it's placed face down on the table)
    game.hands[callerSeat] = hand.filter((c) => c !== card);

    // Deal remaining 4 cards to each player
    const dealOrder = getDealOrder(game.dealerSeat);
    const remainingDeck = [...game.deck];
    // The deck already had the first 16 cards dealt; remove them
    // Actually, cards were dealt from the top, so the deck
    // still has the remaining cards from index 16 onward
    // Let's recalculate: after dealing 4 to each (16 total),
    // deck should have 16 remaining
    const secondDealHands = dealCards(remainingDeck, dealOrder, 4);

    for (const seat of SEATS) {
      game.hands[seat] = [...game.hands[seat], ...secondDealHands[seat]];
    }

    game.deck = remainingDeck; // should be empty now

    // Move to 8-card betting
    game.phase = PHASE.BETTING_8;

    // Initialise 8-card bidding state
    // [House Rule] 8-card betting begins with player to dealer's right
    const firstBidder = dealOrder[0];
    game._fourCardBid = game.bidding.highestBid; // store for comparison
    game._fourCardBidder = game.bidding.highestBidder;

    game.bidding = {
      phase: "eight_card",
      currentBidder: firstBidder,
      highestBid: game._fourCardBid,
      highestBidder: game._fourCardBidder,
      consecutivePasses: 0,
      speeches: [],
      playerState: {},
      isPCC: false,
      fourCardBid: game._fourCardBid,
      fourCardBidder: game._fourCardBidder,
    };

    for (const seat of SEATS) {
      game.bidding.playerState[seat] = {
        speechCount: 0,
        hasPartnered: false,
        partnerUsedBy: null,
        skipped: false,
      };
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
 * Declare Open Trump before play begins.
 * The trumper picks up the trump card, reveals any trump-suit card,
 * and play proceeds with all cards face up.
 *
 * [House Rule] The trumper can reveal any card of the trump suit,
 * not necessarily the original trump card.
 *
 * @param {Object} data - { code: string, revealCard: string }
 * @param {Object} context - Firebase callable context
 */
async function declareOpenTrump(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const revealCard = data.revealCard; // the card to show (any trump suit card)

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
      throw new Error("Can only declare Open Trump before play begins.");
    }

    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (callerSeat !== game.trump.trumperSeat) {
      throw new Error("Only the trumper can declare Open Trump.");
    }

    // Pick up the trump card
    game.hands[callerSeat].push(game.trump.trumpCard);

    // Validate the revealed card is a trump suit card in their hand
    if (revealCard) {
      const allCards = game.hands[callerSeat];
      if (!allCards.includes(revealCard)) {
        throw new Error("That card is not in your hand.");
      }
      if (cardSuit(revealCard) !== game.trump.trumpSuit) {
        throw new Error("Revealed card must be of the trump suit.");
      }
    }

    // Set open trump
    game.trump.isRevealed = true;
    game.trump.isOpen = true;
    game.trump.trumpCardInHand = true;
    game.trump.trumpCard = null; // no longer on table

    // Move to playing
    game.phase = PHASE.PLAYING;

    // Initialise play state
    const dealOrder = getDealOrder(game.dealerSeat);
    const priority = dealOrder[0]; // player to dealer's right

    game.play = {
      roundNumber: 1,
      priority: priority,
      currentTurn: priority,
      currentRound: [],
      completedRounds: [],
      pointsWon: { teamA: 0, teamB: 0 },
      capsCall: null,
      roundComplete: false,
      capsObligations: {}, // tracks when each player became caps-obligated
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
 * Proceed to play without declaring Open Trump (Closed Trump).
 * Called by the trumper or auto-triggered.
 *
 * @param {Object} data - { code: string }
 * @param {Object} context - Firebase callable context
 */
async function proceedClosedTrump(data, context) {
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
      throw new Error("Not in pre-play phase.");
    }

    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (callerSeat !== game.trump.trumperSeat) {
      throw new Error("Only the trumper can proceed.");
    }

    // If PCC, must play Open Trump
    if (game.bidding && game.bidding.isPCC) {
      throw new Error("PCC requires Open Trump. Use declareOpenTrump instead.");
    }

    game.phase = PHASE.PLAYING;

    const dealOrder = getDealOrder(game.dealerSeat);
    const priority = dealOrder[0];

    game.play = {
      roundNumber: 1,
      priority: priority,
      currentTurn: priority,
      currentRound: [],
      completedRounds: [],
      pointsWon: { teamA: 0, teamB: 0 },
      capsCall: null,
      roundComplete: false,
      capsObligations: {},
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
  selectTrump,
  declareOpenTrump,
  proceedClosedTrump,
};
