/**
 * Lobby management Cloud Functions.
 *
 * Handles game creation, joining, leaving, team selection,
 * and starting a game once 4 players are ready.
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const {
  CODE_LENGTH,
  MAX_NAME_LENGTH,
  SEATS,
  INITIAL_STONE,
  PHASE,
  ALL_AVATARS,
} = require("./constants");
const { generateDefaultName } = require("./names");
const { getDealOrder, minimalShuffle, createPack, dealCards, getCutterSeat } = require("./deck");
const { generateAllPlayerViews } = require("./views");

const db = () => getFirestore();

/**
 * Generate a random 4-letter lobby code.
 */
function generateCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ"; // exclude I, L, O to avoid confusion
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Create a new game lobby.
 * Server assigns a default name and random avatar.
 *
 * @param {Object} data - {} (no required params)
 * @param {Object} context - Firebase callable context
 */
async function createGame(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const name = generateDefaultName();
  const avatar = ALL_AVATARS[Math.floor(Math.random() * ALL_AVATARS.length)];

  // Generate a unique code
  let code;
  let attempts = 0;
  do {
    code = generateCode();
    const existing = await db().collection("lobbies").doc(code).get();
    if (!existing.exists) break;
    attempts++;
  } while (attempts < 10);

  if (attempts >= 10) throw new Error("Could not generate a unique code. Try again.");

  const firstSeat = "north";

  const lobbyData = {
    code,
    hostUid: uid,
    createdAt: FieldValue.serverTimestamp(),
    status: "waiting",
    seats: {
      north: {
        uid,
        name,
        avatar,
        team: "teamA",
        connected: true,
        lastSeen: FieldValue.serverTimestamp(),
      },
      east: null,
      south: null,
      west: null,
    },
    teamAssignment: {
      teamA: ["north", "south"],
      teamB: ["east", "west"],
    },
    teamLocked: false,
    gameId: null,
  };

  await db().collection("lobbies").doc(code).set(lobbyData);

  return { code, seat: firstSeat };
}

/**
 * Join an existing game lobby.
 * Server assigns a unique default name, available avatar, and balanced team.
 *
 * @param {Object} data - { code: string }
 * @param {Object} context - Firebase callable context
 */
async function joinGame(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  if (!code || code.length !== CODE_LENGTH) throw new Error("Invalid game code.");

  const lobbyRef = db().collection("lobbies").doc(code);

  const result = await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");

    const lobby = lobbyDoc.data();
    if (lobby.status !== "waiting") throw new Error("Game has already started.");

    // Check if player is already in the lobby
    for (const seat of SEATS) {
      if (lobby.seats[seat] && lobby.seats[seat].uid === uid) {
        return { code, seat, alreadyJoined: true };
      }
    }

    // Find an empty seat
    const emptySeat = SEATS.find((s) => lobby.seats[s] === null);
    if (!emptySeat) throw new Error("Game is full.");

    // Collect taken names and avatars
    const takenNames = [];
    const takenAvatars = [];
    let teamACount = 0;
    let teamBCount = 0;
    for (const s of SEATS) {
      if (lobby.seats[s]) {
        takenNames.push(lobby.seats[s].name.toLowerCase());
        takenAvatars.push(lobby.seats[s].avatar);
        if (lobby.seats[s].team === "teamA") teamACount++;
        else teamBCount++;
      }
    }

    // Generate a unique name
    let name = generateDefaultName();
    let nameAttempts = 0;
    while (takenNames.includes(name.toLowerCase()) && nameAttempts < 20) {
      name = generateDefaultName();
      nameAttempts++;
    }

    // Pick an available avatar
    const avatar = ALL_AVATARS.find((a) => !takenAvatars.includes(a)) || "spade";

    // Auto-balance team
    const team = teamACount <= teamBCount ? "teamA" : "teamB";

    lobby.seats[emptySeat] = {
      uid,
      name,
      avatar,
      team,
      connected: true,
      lastSeen: FieldValue.serverTimestamp(),
    };

    transaction.update(lobbyRef, { seats: lobby.seats });
    return { code, seat: emptySeat, alreadyJoined: false };
  });

  return result;
}

/**
 * Leave a game lobby.
 *
 * @param {Object} data - { code: string }
 * @param {Object} context - Firebase callable context
 */
async function leaveGame(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const lobbyRef = db().collection("lobbies").doc(code);

  await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) return;

    const lobby = lobbyDoc.data();
    if (lobby.status !== "waiting") return; // can't leave mid-game

    for (const seat of SEATS) {
      if (lobby.seats[seat] && lobby.seats[seat].uid === uid) {
        lobby.seats[seat] = null;
        break;
      }
    }

    // If host left, either reassign or delete lobby
    if (lobby.hostUid === uid) {
      const remainingPlayer = SEATS.find((s) => lobby.seats[s] !== null);
      if (remainingPlayer) {
        lobby.hostUid = lobby.seats[remainingPlayer].uid;
      } else {
        transaction.delete(lobbyRef);
        return;
      }
    }

    transaction.update(lobbyRef, {
      seats: lobby.seats,
      hostUid: lobby.hostUid,
    });
  });

  return { success: true };
}

/**
 * Update team assignment for a player.
 * Players can switch their own team. Host can switch anyone.
 *
 * @param {Object} data - { code: string, targetSeat: string, newTeam: string }
 * @param {Object} context - Firebase callable context
 */
async function updateTeam(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const { targetSeat, newTeam } = data;

  if (!SEATS.includes(targetSeat)) throw new Error("Invalid seat.");
  if (newTeam !== "teamA" && newTeam !== "teamB") throw new Error("Invalid team.");

  const lobbyRef = db().collection("lobbies").doc(code);

  await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");

    const lobby = lobbyDoc.data();
    if (lobby.status !== "waiting") throw new Error("Game has already started.");
    if (!lobby.seats[targetSeat]) throw new Error("No player in that seat.");

    // Allow self-switch or host-switch
    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (callerSeat !== targetSeat && lobby.hostUid !== uid) {
      throw new Error("Only the host can change other players' teams.");
    }

    lobby.seats[targetSeat].team = newTeam;
    transaction.update(lobbyRef, { seats: lobby.seats });
  });

  return { success: true };
}

/**
 * Kick a player from the lobby (host only).
 *
 * @param {Object} data - { code: string, targetSeat: string }
 * @param {Object} context - Firebase callable context
 */
async function kickPlayer(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const { targetSeat } = data;

  if (!SEATS.includes(targetSeat)) throw new Error("Invalid seat.");

  const lobbyRef = db().collection("lobbies").doc(code);

  await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");

    const lobby = lobbyDoc.data();
    if (lobby.hostUid !== uid) throw new Error("Only the host can kick players.");
    if (lobby.status !== "waiting") throw new Error("Game has already started.");
    if (!lobby.seats[targetSeat]) throw new Error("No player in that seat.");
    if (lobby.seats[targetSeat].uid === uid) throw new Error("You cannot kick yourself.");

    lobby.seats[targetSeat] = null;
    transaction.update(lobbyRef, { seats: lobby.seats });
  });

  return { success: true };
}

/**
 * Update a player's name and/or avatar within the lobby.
 * Enforces uniqueness for both name and avatar.
 *
 * @param {Object} data - { code: string, name?: string, avatar?: string }
 * @param {Object} context - Firebase callable context
 */
async function updateProfile(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const lobbyRef = db().collection("lobbies").doc(code);

  await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");

    const lobby = lobbyDoc.data();
    if (lobby.status !== "waiting") throw new Error("Game has already started.");

    // Find caller's seat
    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (!callerSeat) throw new Error("You are not in this lobby.");

    // Collect other players' names and avatars
    const otherNames = [];
    const otherAvatars = [];
    for (const s of SEATS) {
      if (s !== callerSeat && lobby.seats[s]) {
        otherNames.push(lobby.seats[s].name.toLowerCase());
        otherAvatars.push(lobby.seats[s].avatar);
      }
    }

    // Update name if provided
    if (data.name !== undefined) {
      const newName = (data.name || "").trim().slice(0, MAX_NAME_LENGTH);
      if (!newName) throw new Error("Name cannot be empty.");
      if (otherNames.includes(newName.toLowerCase())) {
        throw new Error("That name is already taken.");
      }
      lobby.seats[callerSeat].name = newName;
    }

    // Update avatar if provided
    if (data.avatar !== undefined) {
      if (!ALL_AVATARS.includes(data.avatar)) throw new Error("Invalid avatar.");
      if (otherAvatars.includes(data.avatar)) {
        throw new Error("That avatar is already taken.");
      }
      lobby.seats[callerSeat].avatar = data.avatar;
    }

    transaction.update(lobbyRef, { seats: lobby.seats });
  });

  return { success: true };
}

/**
 * Start the game (host only). Validates teams are 2v2,
 * deals first 4 cards, and creates the game document.
 *
 * @param {Object} data - { code: string }
 * @param {Object} context - Firebase callable context
 */
async function startGame(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const lobbyRef = db().collection("lobbies").doc(code);

  const result = await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");

    const lobby = lobbyDoc.data();
    if (lobby.hostUid !== uid) throw new Error("Only the host can start the game.");
    if (lobby.status !== "waiting") throw new Error("Game has already started.");

    // Validate all 4 seats are filled
    for (const seat of SEATS) {
      if (!lobby.seats[seat]) throw new Error("Not all seats are filled.");
    }

    // Validate teams are 2v2
    const teamACounts = SEATS.filter((s) => lobby.seats[s].team === "teamA").length;
    if (teamACounts !== 2) throw new Error("Teams must be 2 vs 2.");

    // Assign seats to match team preferences:
    // teamA gets north+south, teamB gets east+west
    const teamAPlayers = SEATS.filter((s) => lobby.seats[s].team === "teamA");
    const teamBPlayers = SEATS.filter((s) => lobby.seats[s].team === "teamB");

    // Rearrange seats so teamA is north/south and teamB is east/west
    const finalSeats = {};
    const teamASeats = ["north", "south"];
    const teamBSeats = ["east", "west"];

    // If players are already in correct team seats, keep them. Otherwise swap.
    const needsRearrange = !(
      teamAPlayers.every((s) => teamASeats.includes(s)) &&
      teamBPlayers.every((s) => teamBSeats.includes(s))
    );

    if (needsRearrange) {
      // Collect player data by team
      const teamAData = teamAPlayers.map((s) => lobby.seats[s]);
      const teamBData = teamBPlayers.map((s) => lobby.seats[s]);

      finalSeats.north = teamAData[0];
      finalSeats.south = teamAData[1];
      finalSeats.east = teamBData[0];
      finalSeats.west = teamBData[1];
    } else {
      for (const seat of SEATS) {
        finalSeats[seat] = lobby.seats[seat];
      }
    }

    // Create the deck and deal
    const deck = minimalShuffle(createPack());
    const dealerSeat = "north"; // first dealer
    const dealOrder = getDealOrder(dealerSeat);
    const cutterSeat = getCutterSeat(dealerSeat);

    // Create game state (pre-cutting phase)
    const gameState = {
      gameNumber: 1,
      dealerSeat,
      phase: PHASE.DEALING_4,
      stone: { teamA: INITIAL_STONE, teamB: INITIAL_STONE },
      deck: deck, // the full deck before dealing
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
      previousDeck: null, // for reshuffle (preserving order)
    };

    // Create game document
    const gameRef = lobbyRef.collection("games").doc();
    transaction.set(gameRef, gameState);

    // Update lobby
    transaction.update(lobbyRef, {
      seats: finalSeats,
      status: "in_game",
      teamLocked: true,
      gameId: gameRef.id,
      teamAssignment: {
        teamA: ["north", "south"],
        teamB: ["east", "west"],
      },
    });

    // Generate player views
    const updatedLobby = { ...lobby, seats: finalSeats };
    const views = generateAllPlayerViews(gameState, updatedLobby);
    for (const seat of SEATS) {
      if (views[seat]) {
        const viewRef = gameRef.collection("playerViews").doc(seat);
        transaction.set(viewRef, views[seat]);
      }
    }

    return { gameId: gameRef.id };
  });

  return result;
}

/**
 * Handle the cutting decision (cut or decline).
 *
 * @param {Object} data - { code: string, doCut: boolean }
 * @param {Object} context - Firebase callable context
 */
async function handleCut(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const doCut = !!data.doCut;
  const lobbyRef = db().collection("lobbies").doc(code);

  await db().runTransaction(async (transaction) => {
    const lobbyDoc = await transaction.get(lobbyRef);
    if (!lobbyDoc.exists) throw new Error("Game not found.");
    const lobby = lobbyDoc.data();

    const gameRef = lobbyRef.collection("games").doc(lobby.gameId);
    const gameDoc = await transaction.get(gameRef);
    if (!gameDoc.exists) throw new Error("Game not found.");
    const game = gameDoc.data();

    if (game.phase !== PHASE.DEALING_4) throw new Error("Not in dealing phase.");
    if (!game.cutting || game.cutting.resolved) throw new Error("Cutting already resolved.");

    // Validate cutter
    const callerSeat = SEATS.find((s) => lobby.seats[s] && lobby.seats[s].uid === uid);
    if (callerSeat !== game.cutting.cutterSeat) throw new Error("It's not your turn to cut.");

    // Apply cut
    let deck = [...game.deck];
    if (doCut) {
      // Cut at a random point
      const { cutDeck } = require("./deck");
      deck = cutDeck(deck);
    }

    // Deal 4 cards to each player
    const dealOrder = getDealOrder(game.dealerSeat);
    const hands = dealCards(deck, dealOrder, 4);

    game.deck = deck;
    game.hands = hands;
    game.cutting.resolved = true;
    game.cutting.didCut = doCut;
    game.phase = PHASE.BETTING_4;

    // Initialise bidding state
    const firstBidder = dealOrder[0]; // player to dealer's right
    game.bidding = {
      phase: "four_card",
      currentBidder: firstBidder,
      highestBid: 0,
      highestBidder: null,
      consecutivePasses: 0,
      speeches: [],
      playerState: {},
      isPCC: false,
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
 * Player heartbeat — updates lastSeen timestamp.
 */
async function heartbeat(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const lobbyRef = db().collection("lobbies").doc(code);

  const lobbyDoc = await lobbyRef.get();
  if (!lobbyDoc.exists) return { success: false };

  const lobby = lobbyDoc.data();
  for (const seat of SEATS) {
    if (lobby.seats[seat] && lobby.seats[seat].uid === uid) {
      lobby.seats[seat].lastSeen = FieldValue.serverTimestamp();
      lobby.seats[seat].connected = true;
      await lobbyRef.update({ seats: lobby.seats });
      return { success: true };
    }
  }

  return { success: false };
}

/**
 * Reconnect a player to their existing game.
 */
async function reconnect(data, context) {
  const uid = context.auth?.uid;
  if (!uid) throw new Error("Authentication required.");

  const code = (data.code || "").toUpperCase().trim();
  const lobbyRef = db().collection("lobbies").doc(code);

  const lobbyDoc = await lobbyRef.get();
  if (!lobbyDoc.exists) throw new Error("Game not found.");

  const lobby = lobbyDoc.data();
  let mySeat = null;

  for (const seat of SEATS) {
    if (lobby.seats[seat] && lobby.seats[seat].uid === uid) {
      mySeat = seat;
      lobby.seats[seat].connected = true;
      lobby.seats[seat].lastSeen = FieldValue.serverTimestamp();
      break;
    }
  }

  if (!mySeat) throw new Error("You are not in this game.");

  await lobbyRef.update({ seats: lobby.seats });

  return {
    code,
    seat: mySeat,
    gameId: lobby.gameId,
    status: lobby.status,
  };
}

module.exports = {
  createGame,
  joinGame,
  leaveGame,
  updateTeam,
  updateProfile,
  kickPlayer,
  startGame,
  handleCut,
  heartbeat,
  reconnect,
};
