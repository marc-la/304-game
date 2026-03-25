/**
 * Play page entry point.
 *
 * Initialises Firebase (Anonymous Auth, Firestore, Cloud Functions),
 * sets up the lobby, and transitions to the game when ready.
 *
 * Firebase SDK loaded via CDN ES modules.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";

import { setState, getState } from "./state.js";
import { initLobby, tryReconnect } from "./lobby.js";
import { startGameListener } from "./game.js";
import * as firebaseActions from "./firebase-actions.js";

// ============================================================
// Firebase Configuration
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCNV83CkF79_N9k7xpMX656XBNnNAvsqHY",
  authDomain: "game-6e76c.firebaseapp.com",
  projectId: "game-6e76c",
  storageBucket: "game-6e76c.firebasestorage.app",
  messagingSenderId: "855694500663",
  appId: "1:855694500663:web:9ee2a44926e5b5a88730b2"
};
// ============================================================

// Initialise Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "australia-southeast1");

// Initialise action wrappers
firebaseActions.init(functions, httpsCallable);

// Lobby heartbeat interval
let lobbyHeartbeatInterval = null;

// Anonymous auth
signInAnonymously(auth).catch((err) => {
  console.error("Auth failed:", err);
  showError("Failed to connect. Please refresh and try again.");
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    setState({ uid: user.uid });
    init();
  }
});

/**
 * Initialise the app after auth.
 */
async function init() {
  // Initialise lobby UI
  initLobby(db, doc, onSnapshot);

  // Attempt reconnection from sessionStorage
  await tryReconnect(db, doc, onSnapshot);

  // Listen for game start event from lobby
  window.addEventListener("game-started", () => {
    stopLobbyHeartbeat();
    startGameListener(db, doc, onSnapshot);
  });

  // Start lobby heartbeat when lobby code is set
  startLobbyHeartbeat();

  // Handle page visibility — send heartbeat on return
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const state = getState();
      if (state.lobbyCode) {
        firebaseActions.heartbeat({ code: state.lobbyCode }).catch(() => {});
      }
    }
  });
}

/**
 * Start heartbeat for lobby presence.
 */
function startLobbyHeartbeat() {
  stopLobbyHeartbeat();
  lobbyHeartbeatInterval = setInterval(() => {
    const state = getState();
    if (state.lobbyCode) {
      firebaseActions.heartbeat({ code: state.lobbyCode }).catch(() => {});
    }
  }, 30000);
}

function stopLobbyHeartbeat() {
  if (lobbyHeartbeatInterval) {
    clearInterval(lobbyHeartbeatInterval);
    lobbyHeartbeatInterval = null;
  }
}

function showError(message) {
  document.getElementById("view-lobby").hidden = true;
  document.getElementById("view-game").hidden = true;
  document.getElementById("view-error").hidden = false;
  document.getElementById("error-message").textContent = message;
}

document.getElementById("btn-retry")?.addEventListener("click", () => {
  window.location.reload();
});
