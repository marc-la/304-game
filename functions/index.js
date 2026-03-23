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

// --- Lobby Functions ---

exports.createGame = onCall(async (request) => {
  return lobby.createGame(request.data, { auth: request.auth });
});

exports.joinGame = onCall(async (request) => {
  return lobby.joinGame(request.data, { auth: request.auth });
});

exports.leaveGame = onCall(async (request) => {
  return lobby.leaveGame(request.data, { auth: request.auth });
});

exports.updateTeam = onCall(async (request) => {
  return lobby.updateTeam(request.data, { auth: request.auth });
});

exports.startGame = onCall(async (request) => {
  return lobby.startGame(request.data, { auth: request.auth });
});

exports.handleCut = onCall(async (request) => {
  return lobby.handleCut(request.data, { auth: request.auth });
});

exports.heartbeat = onCall(async (request) => {
  return lobby.heartbeat(request.data, { auth: request.auth });
});

exports.reconnect = onCall(async (request) => {
  return lobby.reconnect(request.data, { auth: request.auth });
});

// --- Bidding Functions ---

exports.placeBid = onCall(async (request) => {
  return bidding.placeBid(request.data, { auth: request.auth });
});

exports.callReshuffle = onCall(async (request) => {
  return bidding.callReshuffle(request.data, { auth: request.auth });
});

exports.callRedeal8 = onCall(async (request) => {
  return bidding.callRedeal8(request.data, { auth: request.auth });
});

// --- Trump Functions ---

exports.selectTrump = onCall(async (request) => {
  return trump.selectTrump(request.data, { auth: request.auth });
});

exports.declareOpenTrump = onCall(async (request) => {
  return trump.declareOpenTrump(request.data, { auth: request.auth });
});

exports.proceedClosedTrump = onCall(async (request) => {
  return trump.proceedClosedTrump(request.data, { auth: request.auth });
});

// --- Play Functions ---

exports.playCard = onCall(async (request) => {
  return play.playCard(request.data, { auth: request.auth });
});

exports.callSpoiltTrumps = onCall(async (request) => {
  return play.callSpoiltTrumps(request.data, { auth: request.auth });
});

exports.callAbsoluteHand = onCall(async (request) => {
  return play.callAbsoluteHand(request.data, { auth: request.auth });
});

// --- Caps Functions ---

exports.callCaps = onCall(async (request) => {
  return caps.callCaps(request.data, { auth: request.auth });
});

// --- Scoring Functions ---

exports.nextGame = onCall(async (request) => {
  return scoring.nextGame(request.data, { auth: request.auth });
});
