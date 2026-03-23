/**
 * Firebase action wrappers.
 *
 * All game actions call Cloud Functions via httpsCallable.
 * This module provides a clean API for the UI layer.
 */

let functionsInstance = null;
let httpsCallableRef = null;

/**
 * Initialise with Firebase Functions instance and httpsCallable function.
 */
export function init(functions, httpsCallable) {
  functionsInstance = functions;
  httpsCallableRef = httpsCallable;
}

function call(name, data) {
  if (!functionsInstance || !httpsCallableRef) {
    throw new Error("Firebase not initialised. Call init() first.");
  }
  const fn = httpsCallableRef(functionsInstance, name);
  return fn(data).then((result) => result.data);
}

// --- Lobby ---
export const createGame = (data) => call("createGame", data);
export const joinGame = (data) => call("joinGame", data);
export const leaveGame = (data) => call("leaveGame", data);
export const updateTeam = (data) => call("updateTeam", data);
export const startGame = (data) => call("startGame", data);
export const handleCut = (data) => call("handleCut", data);
export const heartbeat = (data) => call("heartbeat", data);
export const reconnect = (data) => call("reconnect", data);

// --- Bidding ---
export const placeBid = (data) => call("placeBid", data);
export const callReshuffle = (data) => call("callReshuffle", data);
export const callRedeal8 = (data) => call("callRedeal8", data);

// --- Trump ---
export const selectTrump = (data) => call("selectTrump", data);
export const declareOpenTrump = (data) => call("declareOpenTrump", data);
export const proceedClosedTrump = (data) => call("proceedClosedTrump", data);

// --- Play ---
export const playCard = (data) => call("playCard", data);
export const callSpoiltTrumps = (data) => call("callSpoiltTrumps", data);
export const callAbsoluteHand = (data) => call("callAbsoluteHand", data);

// --- Caps ---
export const callCaps = (data) => call("callCaps", data);

// --- Scoring ---
export const nextGame = (data) => call("nextGame", data);
