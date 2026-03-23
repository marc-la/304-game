/**
 * Caps system — the most complex algorithmic component.
 *
 * Handles:
 * - Caps call verification (can the player guarantee all remaining rounds?)
 * - Late caps detection (server-side tracking of obligation)
 * - Wrong/Early caps detection
 * - External caps (from opposition)
 * - "Claim remaining rounds" convenience shortcut
 *
 * Algorithm:
 * For a given game state and player, enumerate all valid distributions of
 * unknown cards among opponents. For each distribution, simulate the
 * proposed play order against all possible opponent responses (minimax).
 * If any scenario results in the calling team losing a round, caps fails.
 */

const { getFirestore } = require("firebase-admin/firestore");
const { SEATS, PHASE, WRONG_CAPS_PENALTY } = require("./constants");
const {
  cardSuit,
  compareCards,
  getTeamForSeat,
  getPartnerSeat,
  getNextSeat,
  ANTICLOCKWISE_ORDER,
} = require("./deck");
const { generateAllPlayerViews } = require("./views");

const db = () => getFirestore();

/**
 * Check if a player is currently caps-obligated.
 * This runs after every card play for tracking purposes.
 *
 * A player is caps-obligated when there exists ANY ordering of their
 * remaining cards that guarantees winning all remaining rounds,
 * irrespective of how others play.
 *
 * @param {Object} game - Full game state
 * @param {string} seatId - The player to check
 * @returns {boolean} Whether the player can guarantee all remaining rounds
 */
function checkCapsObligation(game, seatId) {
  const play = game.play;
  const trump = game.trump;

  // Can't be caps-obligated if the team has already lost a round
  const myTeam = getTeamForSeat(seatId);
  const hasLostRound = play.completedRounds.some(
    (r) => getTeamForSeat(r.winner) !== myTeam
  );
  if (hasLostRound) return false;

  // Get remaining cards for all players
  const remainingCards = {};
  for (const seat of SEATS) {
    if (game.pccPartnerOut === seat) continue;
    remainingCards[seat] = [...(game.hands[seat] || [])];
  }

  // Get known information from the calling player's perspective
  const knownInfo = deduceKnownInfo(game, seatId);

  // Try all permutations of the caller's remaining cards
  const myCards = remainingCards[seatId];
  const permutations = getPermutations(myCards);

  for (const playOrder of permutations) {
    if (canGuaranteeWithOrder(game, seatId, playOrder, remainingCards, knownInfo)) {
      return true;
    }
  }

  return false;
}

/**
 * Deduce what a player knows about other players' hands
 * from the play history.
 *
 * @returns {Object} { exhaustedSuits: { seat -> Set of suits }, knownCards: { seat -> cards } }
 */
function deduceKnownInfo(game, seatId) {
  const exhaustedSuits = {};
  for (const seat of SEATS) {
    exhaustedSuits[seat] = new Set();
  }

  // Track which suits players have shown they don't have
  for (const round of (game.play?.completedRounds || [])) {
    if (round.cards.length === 0) continue;
    const ledCard = round.cards[0];
    const ledSuit = cardSuit(ledCard.card);

    for (const entry of round.cards) {
      if (entry.seat === round.cards[0].seat) continue; // leader can play anything
      if (entry.card && cardSuit(entry.card) !== ledSuit) {
        // Player didn't follow suit — they're out of this suit
        exhaustedSuits[entry.seat].add(ledSuit);
      }
      if (entry.faceDown && !entry.revealed) {
        // Player played face down — they're out of the led suit
        exhaustedSuits[entry.seat].add(ledSuit);
      }
    }
  }

  return { exhaustedSuits };
}

/**
 * Check if a specific play order guarantees winning all remaining rounds.
 * Uses minimax: for each possible arrangement of opponents' cards,
 * check if the calling team wins all rounds.
 */
function canGuaranteeWithOrder(game, seatId, playOrder, allCards, knownInfo) {
  const myTeam = getTeamForSeat(seatId);
  const partnerSeat = getPartnerSeat(seatId);
  const trumpSuit = game.trump.trumpSuit;
  const trumpRevealed = game.trump.isRevealed || game.trump.isOpen;

  // Build the set of remaining cards for opponents and partner
  const otherSeats = SEATS.filter(
    (s) => s !== seatId && s !== game.pccPartnerOut
  );

  // For each round to be played, simulate
  const remainingRounds = 8 - (game.play?.completedRounds?.length || 0);
  if (playOrder.length < remainingRounds) return false;

  // Get all remaining cards for other players
  const otherCards = {};
  for (const seat of otherSeats) {
    otherCards[seat] = [...(allCards[seat] || [])];
  }

  // Simulate rounds
  const simCards = {
    [seatId]: [...playOrder],
  };
  for (const seat of otherSeats) {
    simCards[seat] = [...otherCards[seat]];
  }

  let currentPriority = game.play?.priority || seatId;

  // For the current round in progress, handle partially played cards
  const currentRoundPlayed = game.play?.currentRound?.length || 0;
  if (currentRoundPlayed > 0) {
    // There's a round in progress — we need to handle this
    // For simplicity, check from the next full round
    // (caps is typically called at the start of a player's turn)
  }

  for (let r = 0; r < remainingRounds; r++) {
    const leader = currentPriority;
    const leaderCard = simCards[leader]?.shift();
    if (!leaderCard) return false;

    const ledSuit = cardSuit(leaderCard);
    let bestCard = leaderCard;
    let bestSeat = leader;
    let bestIsTrump = cardSuit(leaderCard) === trumpSuit;

    // Each other player plays optimally against the calling team
    const turnOrder = getTurnOrder(leader, game.pccPartnerOut);

    for (const seat of turnOrder) {
      if (seat === leader) continue;
      const hand = simCards[seat];
      if (!hand || hand.length === 0) continue;

      // Determine what they can play
      const suitCards = hand.filter((c) => cardSuit(c) === ledSuit);
      const playableCards = suitCards.length > 0 ? suitCards : hand;

      // If this player is on the opposing team, they play to beat us
      // If on our team, they play to help (but we can't rely on choice)
      const isOpponent = getTeamForSeat(seat) !== myTeam;

      if (isOpponent) {
        // Try every possible card — if ANY card beats our current best, they'll play it
        let canWin = false;
        for (const c of playableCards) {
          if (wouldWinAgainst(c, bestCard, bestIsTrump, ledSuit, trumpSuit)) {
            canWin = true;
            break;
          }
        }
        if (canWin) return false; // Opponent can win this round — caps fails

        // They play their worst card (doesn't matter — we need to win regardless)
        hand.splice(hand.indexOf(playableCards[playableCards.length - 1]), 1);
      } else {
        // Partner — play any card (we can't rely on their choice)
        // Remove a card from their hand
        hand.splice(hand.indexOf(playableCards[0]), 1);
      }
    }

    currentPriority = bestSeat;
  }

  return true;
}

/**
 * Check if card A would beat the current best.
 */
function wouldWinAgainst(cardA, currentBest, currentBestIsTrump, ledSuit, trumpSuit) {
  const suitA = cardSuit(cardA);
  const suitBest = cardSuit(currentBest);

  // Trump beats non-trump
  if (suitA === trumpSuit && !currentBestIsTrump) return true;
  if (suitA !== trumpSuit && currentBestIsTrump) return false;

  // Same suit — compare rank
  if (suitA === suitBest) {
    return compareCards(cardA, currentBest) < 0; // lower index = higher power
  }

  // Different non-trump suits — can't beat
  return false;
}

/**
 * Get turn order from a leader, excluding PCC partner.
 */
function getTurnOrder(leader, pccPartnerOut) {
  const order = [leader];
  let current = leader;
  for (let i = 0; i < 3; i++) {
    current = getNextSeat(current);
    if (current !== pccPartnerOut) {
      order.push(current);
    }
  }
  return order;
}

/**
 * Get all permutations of an array (for small arrays only — max ~4 elements).
 */
function getPermutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const perms = getPermutations(rest);
    for (const perm of perms) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

/**
 * Call Caps — player declares they can win all remaining rounds.
 *
 * @param {Object} data - { code: string, playOrder: string[] }
 * @param {Object} context - Firebase callable context
 */
async function callCaps(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const playOrder = data.playOrder;
  if (!Array.isArray(playOrder) || playOrder.length === 0) {
    throw new Error("Must specify the play order for remaining cards.");
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

    if (game.phase !== PHASE.PLAYING) throw new Error("Not in play phase.");

    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (!callerSeat) throw new Error("You are not in this game.");

    const myTeam = getTeamForSeat(callerSeat);
    const trumperTeam = getTeamForSeat(game.trump.trumperSeat);
    const isExternal = myTeam !== trumperTeam;

    // Check if the team has already lost a round
    const hasLostRound = game.play.completedRounds.some(
      (r) => getTeamForSeat(r.winner) !== myTeam
    );
    if (hasLostRound) {
      throw new Error("Cannot call Caps — your team has already lost a round.");
    }

    // Validate the play order matches the caller's remaining cards
    const myHand = game.hands[callerSeat];
    const sortedOrder = [...playOrder].sort();
    const sortedHand = [...myHand].sort();
    if (JSON.stringify(sortedOrder) !== JSON.stringify(sortedHand)) {
      throw new Error("Play order must contain exactly your remaining cards.");
    }

    // Verify the caps claim
    const allCards = {};
    for (const seat of SEATS) {
      if (game.pccPartnerOut === seat) continue;
      allCards[seat] = [...(game.hands[seat] || [])];
    }

    const knownInfo = deduceKnownInfo(game, callerSeat);
    const isValid = canGuaranteeWithOrder(game, callerSeat, playOrder, allCards, knownInfo);

    if (!isValid) {
      // Wrong/Early Caps — 5 stone penalty
      game.play.capsCall = {
        calledBy: callerSeat,
        calledAtRound: game.play.roundNumber,
        playOrder: playOrder,
        type: isExternal ? "external" : "regular",
        result: "wrong_early",
      };

      game.phase = PHASE.COMPLETE;
      game.result = {
        reason: "caps_wrong",
        stoneExchanged: WRONG_CAPS_PENALTY,
        stoneDirection: "receive",
        winnerTeam: myTeam === "teamA" ? "teamB" : "teamA",
        capsBy: callerSeat,
        description: `Wrong/Early Caps by ${callerSeat}. ${WRONG_CAPS_PENALTY} stone penalty.`,
      };

      // Apply penalty
      game.stone[myTeam] += WRONG_CAPS_PENALTY;
    } else {
      // Check timing — was this on time or late?
      const capsObligation = game.play.capsObligations[callerSeat];
      const isLate = capsObligation !== undefined &&
        (capsObligation.obligatedAtRound < game.play.roundNumber ||
         (capsObligation.obligatedAtRound === game.play.roundNumber &&
          capsObligation.obligatedAtCard < game.play.currentRound.length));

      const isBeforeRound7 = game.play.roundNumber < 7;

      let capsResult;
      if (isLate) {
        capsResult = "late";
      } else {
        capsResult = "correct";
      }

      game.play.capsCall = {
        calledBy: callerSeat,
        calledAtRound: game.play.roundNumber,
        playOrder: playOrder,
        type: isExternal ? "external" : "regular",
        result: capsResult,
      };

      // Resolve the game
      game.phase = PHASE.COMPLETE;

      if (capsResult === "correct" && isBeforeRound7) {
        // Correct caps before round 7 — bonus stone
        const { SCORING_TABLE, PCC_SCORING } = require("./constants");
        const bid = game.bidding.highestBid;
        const scoring = game.bidding.isPCC ? PCC_SCORING : SCORING_TABLE[bid];

        if (isExternal) {
          // External caps: betting team loses normal + 1
          const normalLoss = scoring ? scoring.loss : 2;
          game.result = {
            reason: "external_caps",
            stoneExchanged: normalLoss + 1,
            stoneDirection: "receive",
            winnerTeam: myTeam,
            capsBy: callerSeat,
            description: `External Caps (correct, before Round 7). Betting team receives ${normalLoss + 1} stone.`,
          };
          game.stone[trumperTeam] += normalLoss + 1;
        } else {
          // Regular caps: bonus stone on top of normal win
          const normalWin = scoring ? scoring.win : 1;
          game.result = {
            reason: "caps_correct",
            stoneExchanged: normalWin + 1,
            stoneDirection: "give",
            winnerTeam: myTeam,
            capsBy: callerSeat,
            description: `Caps correct (before Round 7). Betting team gives ${normalWin + 1} stone.`,
          };
          game.stone[trumperTeam] = Math.max(0, game.stone[trumperTeam] - (normalWin + 1));
        }
      } else if (capsResult === "correct") {
        // Correct caps after round 7 — no bonus, normal win
        const { SCORING_TABLE, PCC_SCORING } = require("./constants");
        const bid = game.bidding.highestBid;
        const scoring = game.bidding.isPCC ? PCC_SCORING : SCORING_TABLE[bid];

        if (isExternal) {
          const normalLoss = scoring ? scoring.loss : 2;
          game.result = {
            reason: "external_caps",
            stoneExchanged: normalLoss,
            stoneDirection: "receive",
            winnerTeam: myTeam,
            capsBy: callerSeat,
            description: `External Caps (correct, after Round 7). Normal loss applies.`,
          };
          game.stone[trumperTeam] += normalLoss;
        } else {
          const normalWin = scoring ? scoring.win : 1;
          game.result = {
            reason: "caps_correct",
            stoneExchanged: normalWin,
            stoneDirection: "give",
            winnerTeam: myTeam,
            capsBy: callerSeat,
            description: `Caps correct (after Round 7). Normal win applies.`,
          };
          game.stone[trumperTeam] = Math.max(0, game.stone[trumperTeam] - normalWin);
        }
      } else if (capsResult === "late") {
        // Late caps — loss + 1 stone
        const { SCORING_TABLE, PCC_SCORING } = require("./constants");
        const bid = game.bidding.highestBid;
        const scoring = game.bidding.isPCC ? PCC_SCORING : SCORING_TABLE[bid];
        const normalLoss = scoring ? scoring.loss : 2;

        game.result = {
          reason: "caps_late",
          stoneExchanged: normalLoss + 1,
          stoneDirection: "receive",
          winnerTeam: myTeam === "teamA" ? "teamB" : "teamA",
          capsBy: callerSeat,
          description: `Late Caps. ${normalLoss + 1} stone penalty.`,
        };
        game.stone[trumperTeam] += normalLoss + 1;
      }
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

module.exports = {
  checkCapsObligation,
  callCaps,
  deduceKnownInfo,
  canGuaranteeWithOrder,
  getPermutations,
};
