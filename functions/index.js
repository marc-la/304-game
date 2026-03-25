/**
 * Cloud Functions for the 304 card game.
 *
 * All game state mutations flow through these callable functions.
 * Clients never write to Firestore directly.
 */

const { initializeApp } = require("firebase-admin/app");
const { onCall } = require("firebase-functions/v2/https");

initializeApp();

const lobby = require("./src/lobby");
const bidding = require("./src/bidding");
const trump = require("./src/trump");
const play = require("./src/play");
const caps = require("./src/caps");
const scoring = require("./src/scoring");

const OPTS = { region: "australia-southeast1" };

// --- Lobby Functions ---

exports.createGame = onCall(OPTS, async (request) => {
  return lobby.createGame(request.data, { auth: request.auth });
});

exports.joinGame = onCall(OPTS, async (request) => {
  return lobby.joinGame(request.data, { auth: request.auth });
});

exports.leaveGame = onCall(OPTS, async (request) => {
  return lobby.leaveGame(request.data, { auth: request.auth });
});

exports.updateTeam = onCall(OPTS, async (request) => {
  return lobby.updateTeam(request.data, { auth: request.auth });
});

exports.updateProfile = onCall(OPTS, async (request) => {
  return lobby.updateProfile(request.data, { auth: request.auth });
});

exports.kickPlayer = onCall(OPTS, async (request) => {
  return lobby.kickPlayer(request.data, { auth: request.auth });
});

exports.startGame = onCall(OPTS, async (request) => {
  return lobby.startGame(request.data, { auth: request.auth });
});

exports.handleCut = onCall(OPTS, async (request) => {
  return lobby.handleCut(request.data, { auth: request.auth });
});

exports.heartbeat = onCall(OPTS, async (request) => {
  return lobby.heartbeat(request.data, { auth: request.auth });
});

exports.reconnect = onCall(OPTS, async (request) => {
  return lobby.reconnect(request.data, { auth: request.auth });
});

// --- Bidding Functions ---

exports.placeBid = onCall(OPTS, async (request) => {
  return bidding.placeBid(request.data, { auth: request.auth });
});

exports.callReshuffle = onCall(OPTS, async (request) => {
  return bidding.callReshuffle(request.data, { auth: request.auth });
});

exports.callRedeal8 = onCall(OPTS, async (request) => {
  return bidding.callRedeal8(request.data, { auth: request.auth });
});

// --- Trump Functions ---

exports.selectTrump = onCall(OPTS, async (request) => {
  return trump.selectTrump(request.data, { auth: request.auth });
});

exports.declareOpenTrump = onCall(OPTS, async (request) => {
  return trump.declareOpenTrump(request.data, { auth: request.auth });
});

exports.proceedClosedTrump = onCall(OPTS, async (request) => {
  return trump.proceedClosedTrump(request.data, { auth: request.auth });
});

// --- Play Functions ---

exports.playCard = onCall(OPTS, async (request) => {
  return play.playCard(request.data, { auth: request.auth });
});

exports.callSpoiltTrumps = onCall(OPTS, async (request) => {
  return play.callSpoiltTrumps(request.data, { auth: request.auth });
});

exports.callAbsoluteHand = onCall(OPTS, async (request) => {
  return play.callAbsoluteHand(request.data, { auth: request.auth });
});

// --- Caps Functions ---

exports.callCaps = onCall(OPTS, async (request) => {
  return caps.callCaps(request.data, { auth: request.auth });
});

// --- Scoring Functions ---

exports.nextGame = onCall(OPTS, async (request) => {
  return scoring.nextGame(request.data, { auth: request.auth });
});
