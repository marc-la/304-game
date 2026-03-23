/**
 * Bidding Cloud Functions.
 *
 * Handles all bidding actions (bet, pass, partner) for both
 * 4-card and 8-card betting phases with full validation.
 *
 * Rules implemented:
 * - Minimum bid 160 (4-card) or 220 (8-card "Honest")
 * - Increments of 10 below 200, 5 at 200+
 * - Below-200 bids (4-card) / below-250 bids (8-card): first speech only
 * - Cannot undercut your own partner's highest bid
 * - Partner action: both players consume a speech, partner's turn skipped
 * - Three consecutive passes end bidding
 * - PCC as highest possible bid (8-card only)
 */

const { getFirestore } = require("firebase-admin/firestore");
const {
  SEATS,
  PHASE,
  BID_ACTION,
  MIN_BID_4_CARD,
  MIN_BID_8_CARD,
  THRESHOLD_4_CARD,
  THRESHOLD_8_CARD,
  INCREMENT_BELOW_200,
  INCREMENT_200_PLUS,
  RESHUFFLE_POINT_THRESHOLD,
  REDEAL_POINT_THRESHOLD,
} = require("./constants");
const {
  getNextSeat,
  getPartnerSeat,
  getDealOrder,
  handPoints,
  dealCards,
  getCutterSeat,
  minimalShuffle,
  fullShuffle,
} = require("./deck");
const { generateAllPlayerViews } = require("./views");

const db = () => getFirestore();

/**
 * Place a bid (bet, pass, or partner).
 *
 * @param {Object} data - { code: string, action: "bet"|"pass"|"partner", value?: number }
 * @param {Object} context - Firebase callable context
 */
async function placeBid(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const action = data.action;
  const bidValue = data.value || 0;

  if (![BID_ACTION.BET, BID_ACTION.PASS, BID_ACTION.PARTNER, BID_ACTION.PCC].includes(action)) {
    throw new Error("Invalid bid action.");
  }

  const lobbyRef = db().collection("lobbies").doc(code);

  await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");
    const lobby = lobbyDoc.data();

    const gameRef = lobbyRef.collection("games").doc(lobby.gameId);
    const gameDoc = await transaction.get(gameRef);
    if (!gameDoc.exists) throw new Error("Game not found.");
    const game = gameDoc.data();

    // Validate phase
    if (game.phase !== PHASE.BETTING_4 && game.phase !== PHASE.BETTING_8) {
      throw new Error("Not in a betting phase.");
    }

    const bidding = game.bidding;
    const isFourCard = bidding.phase === "four_card";

    // Find caller's seat
    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (!callerSeat) throw new Error("You are not in this game.");

    // Validate it's the caller's turn
    if (callerSeat !== bidding.currentBidder) {
      throw new Error("It's not your turn to bid.");
    }

    const playerState = bidding.playerState[callerSeat];
    const partnerSeat = getPartnerSeat(callerSeat);
    const partnerState = bidding.playerState[partnerSeat];

    // Handle each action type
    if (action === BID_ACTION.PARTNER) {
      // Partner action
      if (partnerState.skipped || partnerState.partnerUsedBy) {
        throw new Error("Your partner has already been used via partnering.");
      }

      // Mark both players' speech
      playerState.speechCount++;
      playerState.hasPartnered = true;
      partnerState.partnerUsedBy = callerSeat;
      partnerState.speechCount++;

      // Log the partner action
      bidding.speeches.push({
        seat: callerSeat,
        action: BID_ACTION.PARTNER,
        speechNumber: playerState.speechCount,
      });

      // The partner now bids in the caller's position
      // We don't advance the turn yet — the partner must respond
      // For simplicity, we'll set currentBidder to the partner,
      // but track that they're bidding on behalf of the original player
      bidding.currentBidder = partnerSeat;
      bidding.pendingPartnerResponse = {
        originalSeat: callerSeat,
        partnerSeat: partnerSeat,
      };
    } else if (bidding.pendingPartnerResponse && callerSeat === bidding.pendingPartnerResponse.partnerSeat) {
      // This is the partner responding to a partner action
      const originalSeat = bidding.pendingPartnerResponse.originalSeat;

      if (action === BID_ACTION.BET) {
        validateBetValue(bidding, bidValue, partnerState, isFourCard, partnerSeat);

        bidding.highestBid = bidValue;
        bidding.highestBidder = partnerSeat;
        bidding.consecutivePasses = 0;

        bidding.speeches.push({
          seat: partnerSeat,
          action: BID_ACTION.BET_FOR_PARTNER,
          value: bidValue,
          speechNumber: partnerState.speechCount,
          onBehalfOf: originalSeat,
        });
      } else if (action === BID_ACTION.PASS) {
        bidding.consecutivePasses++;

        bidding.speeches.push({
          seat: partnerSeat,
          action: BID_ACTION.PASS_FOR_PARTNER,
          speechNumber: partnerState.speechCount,
          onBehalfOf: originalSeat,
        });
      } else {
        throw new Error("When responding to a partner request, you can only bet or pass.");
      }

      // Partner's own turn will be skipped
      partnerState.skipped = true;
      delete bidding.pendingPartnerResponse;

      // Advance to next bidder
      advanceBidder(bidding, game);

      // Check if bidding ended
      checkBiddingEnd(bidding, game, transaction, gameRef, lobby, lobbyRef);
    } else if (action === BID_ACTION.BET) {
      validateBetValue(bidding, bidValue, playerState, isFourCard, callerSeat);

      playerState.speechCount++;
      bidding.highestBid = bidValue;
      bidding.highestBidder = callerSeat;
      bidding.consecutivePasses = 0;

      bidding.speeches.push({
        seat: callerSeat,
        action: BID_ACTION.BET,
        value: bidValue,
        speechNumber: playerState.speechCount,
      });

      advanceBidder(bidding, game);
      checkBiddingEnd(bidding, game, transaction, gameRef, lobby, lobbyRef);
    } else if (action === BID_ACTION.PASS) {
      playerState.speechCount++;
      bidding.consecutivePasses++;

      bidding.speeches.push({
        seat: callerSeat,
        action: BID_ACTION.PASS,
        speechNumber: playerState.speechCount,
      });

      advanceBidder(bidding, game);
      checkBiddingEnd(bidding, game, transaction, gameRef, lobby, lobbyRef);
    } else if (action === BID_ACTION.PCC) {
      // PCC is only available on 8-card betting, subsequent speech
      if (isFourCard) throw new Error("PCC is only available on 8-card betting.");
      if (playerState.speechCount === 0) {
        // PCC requires a subsequent speech (first speech min is 220)
        // Actually PCC can be bid at any time on 8 cards if the player wants
        // but it must be higher than current bid
        // PCC is effectively infinite — always highest
      }

      playerState.speechCount++;
      bidding.highestBid = 999; // sentinel for PCC
      bidding.highestBidder = callerSeat;
      bidding.consecutivePasses = 0;
      bidding.isPCC = true;

      bidding.speeches.push({
        seat: callerSeat,
        action: BID_ACTION.PCC,
        speechNumber: playerState.speechCount,
      });

      advanceBidder(bidding, game);
      checkBiddingEnd(bidding, game, transaction, gameRef, lobby, lobbyRef);
    }

    transaction.update(gameRef, game);

    // Update player views
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
 * Validate a bet value against bidding rules.
 */
function validateBetValue(bidding, value, playerState, isFourCard, callerSeat) {
  const minFirst = isFourCard ? MIN_BID_4_CARD : MIN_BID_8_CARD;
  const threshold = isFourCard ? THRESHOLD_4_CARD : THRESHOLD_8_CARD;
  const isFirstSpeech = playerState.speechCount === 0;
  const partnerSeat = getPartnerSeat(callerSeat);
  const partnerIsHighest = bidding.highestBidder === partnerSeat;

  // Determine minimum bid
  let minBid;
  if (isFirstSpeech) {
    minBid = Math.max(minFirst, bidding.highestBid + getIncrement(bidding.highestBid));
  } else {
    // After first speech, minimum is the threshold (200 for 4-card, 250 for 8-card)
    minBid = Math.max(threshold, bidding.highestBid + getIncrement(bidding.highestBid));
  }

  // Cannot undercut partner
  if (partnerIsHighest && value < threshold) {
    throw new Error(
      `Cannot undercut your partner. Minimum bid is ${threshold}.`
    );
  }

  // If no bids yet, the minimum is the floor
  if (bidding.highestBid === 0) {
    minBid = minFirst;
  }

  if (value < minBid) {
    throw new Error(`Bid must be at least ${minBid}.`);
  }

  // Validate increment
  const increment = getIncrement(value);
  if (value > minFirst && bidding.highestBid > 0) {
    const diff = value - bidding.highestBid;
    if (diff < increment || diff % increment !== 0) {
      // Allow any valid increment as long as it's >= the required increment
      const requiredIncrement = getIncrement(Math.max(bidding.highestBid, value));
      if ((value - bidding.highestBid) % requiredIncrement !== 0 || value <= bidding.highestBid) {
        throw new Error(`Invalid bid increment. Must increase by multiples of ${requiredIncrement}.`);
      }
    }
  }
}

/**
 * Get the bid increment for a given bid level.
 */
function getIncrement(currentBid) {
  return currentBid >= 200 ? INCREMENT_200_PLUS : INCREMENT_BELOW_200;
}

/**
 * Advance to the next bidder, skipping players whose turn was consumed.
 */
function advanceBidder(bidding, game) {
  let nextSeat = getNextSeat(bidding.currentBidder);

  // Skip players whose turn was consumed by partnering
  let attempts = 0;
  while (attempts < 4) {
    const state = bidding.playerState[nextSeat];
    if (state.skipped) {
      state.skipped = false; // consume the skip
      nextSeat = getNextSeat(nextSeat);
      attempts++;
    } else {
      break;
    }
  }

  bidding.currentBidder = nextSeat;
}

/**
 * Check if bidding has ended (3 consecutive passes) and handle transitions.
 */
function checkBiddingEnd(bidding, game, transaction, gameRef, lobby, lobbyRef) {
  if (bidding.consecutivePasses < 3) return;

  const isFourCard = bidding.phase === "four_card";

  if (isFourCard) {
    if (bidding.highestBidder === null) {
      // All 4 players passed — redeal
      handleRedeal(game, transaction, gameRef, lobby, lobbyRef);
    } else {
      // Bidding established — move to trump selection
      game.phase = PHASE.TRUMP_SELECTION;
      game.trump.trumperSeat = bidding.highestBidder;
    }
  } else {
    // 8-card bidding ended
    if (bidding.highestBid > 0 && bidding.highestBid !== game._fourCardBid) {
      // New 8-card bid supersedes 4-card bid
      game.trump.trumperSeat = bidding.highestBidder;

      if (bidding.isPCC) {
        // PCC: partner sits out, trumper plays open, must win all 8 rounds
        game.pccPartnerOut = getPartnerSeat(bidding.highestBidder);
        game.phase = PHASE.TRUMP_SELECTION;
      } else {
        // Pick up old trump card if there was one, select new one
        if (game.trump.trumpCard) {
          game.hands[game.trump.trumperSeat] = game.hands[game.trump.trumperSeat] || [];
          // The old trumper gets their card back in hand (already in their hand concept-wise)
        }
        game.trump.trumpCard = null;
        game.trump.trumpSuit = null;
        game.phase = PHASE.TRUMP_SELECTION;
      }
    } else {
      // No 8-card bids — proceed with 4-card bid
      game.phase = PHASE.PRE_PLAY;
    }
  }
}

/**
 * Handle a redeal (all pass on 4 cards, or 8-card redeal).
 */
function handleRedeal(game, transaction, gameRef, lobby, lobbyRef) {
  // Move dealer anticlockwise
  game.dealerSeat = getNextSeat(game.dealerSeat);

  // Reshuffle the full pack
  const { createPack, minimalShuffle: shuffle, getCutterSeat: getCutter } = require("./deck");
  const deck = shuffle(createPack());

  // Reset game state for new deal
  game.phase = PHASE.DEALING_4;
  game.deck = deck;
  game.hands = { north: [], east: [], south: [], west: [] };
  game.trump = {
    trumperSeat: null,
    trumpSuit: null,
    trumpCard: null,
    isRevealed: false,
    isOpen: false,
    trumpCardInHand: false,
  };
  game.bidding = null;
  game.play = null;
  game.cutting = {
    cutterSeat: getCutter(game.dealerSeat),
    resolved: false,
    didCut: null,
  };
}

/**
 * Declare a reshuffle (4-card hand < 15 points).
 *
 * @param {Object} data - { code: string }
 * @param {Object} context - Firebase callable context
 */
async function callReshuffle(data, context) {
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

    if (game.phase !== PHASE.BETTING_4) throw new Error("Can only reshuffle during 4-card betting.");

    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (!callerSeat) throw new Error("You are not in this game.");

    const dealOrder = getDealOrder(game.dealerSeat);
    const prioritySeat = dealOrder[0]; // player to dealer's right

    // Validate eligibility: must be the priority player or their partner via "partner" action
    const isEligible =
      callerSeat === prioritySeat ||
      (game.bidding.playerState[callerSeat].partnerUsedBy === prioritySeat);

    if (!isEligible) {
      throw new Error("Only the player with priority (or their partner via 'partner') can reshuffle.");
    }

    // Validate hand points < 15
    const myHand = game.hands[callerSeat];
    const points = handPoints(myHand);
    if (points >= RESHUFFLE_POINT_THRESHOLD) {
      throw new Error(`Hand has ${points} points. Must be less than ${RESHUFFLE_POINT_THRESHOLD} to reshuffle.`);
    }

    // Increment consecutive reshuffles
    game.consecutiveReshuffles = (game.consecutiveReshuffles || 0) + 1;

    // Reshuffle: same dealer deals again
    const { createPack } = require("./deck");
    let deck;
    if (game.consecutiveReshuffles >= 3) {
      // 3 consecutive reshuffles → full shuffle
      deck = fullShuffle(createPack());
      game.consecutiveReshuffles = 0;
    } else {
      deck = minimalShuffle(createPack());
    }

    // Reset for new deal (same dealer)
    game.phase = PHASE.DEALING_4;
    game.deck = deck;
    game.hands = { north: [], east: [], south: [], west: [] };
    game.trump = {
      trumperSeat: null,
      trumpSuit: null,
      trumpCard: null,
      isRevealed: false,
      isOpen: false,
      trumpCardInHand: false,
    };
    game.bidding = null;
    game.play = null;
    game.cutting = {
      cutterSeat: getCutterSeat(game.dealerSeat),
      resolved: false,
      didCut: null,
    };
    game.reshuffleCount = (game.reshuffleCount || 0) + 1;

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
 * Declare a redeal on 8 cards (hand < 25 points).
 *
 * @param {Object} data - { code: string }
 * @param {Object} context - Firebase callable context
 */
async function callRedeal8(data, context) {
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

    if (game.phase !== PHASE.BETTING_8) throw new Error("Can only redeal during 8-card betting.");

    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (!callerSeat) throw new Error("You are not in this game.");

    // Validate hand points < 25
    const myHand = game.hands[callerSeat];
    const points = handPoints(myHand);
    if (points >= REDEAL_POINT_THRESHOLD) {
      throw new Error(`Hand has ${points} points. Must be less than ${REDEAL_POINT_THRESHOLD} to redeal.`);
    }

    // Redeal: new dealer
    handleRedeal(game, transaction, gameRef, lobby, lobbyRef);

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
  placeBid,
  callReshuffle,
  callRedeal8,
};
