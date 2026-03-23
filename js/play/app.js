/**
 * Play page entry point.
 *
 * Initialises Firebase (Anonymous Auth, Firestore, Cloud Functions),
 * sets up the lobby, and transitions to the game when ready.
 *
 * Firebase SDK loaded via CDN ES modules.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

import { setState, getState } from "./state.js";
import { initLobby } from "./lobby.js";
import { startGameListener } from "./game.js";
import * as firebaseActions from "./firebase-actions.js";

// ============================================================
// Firebase Configuration
// ============================================================
// IMPORTANT: Replace these values with your actual Firebase project config.
// You can find these in Firebase Console > Project Settings > General > Your apps.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
// ============================================================

// Initialise Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "australia-southeast1");

// Initialise action wrappers
firebaseActions.init(functions, httpsCallable);

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
function init() {
  // Initialise lobby UI
  initLobby(db, doc, onSnapshot);

  // Listen for game start event from lobby
  window.addEventListener("game-started", () => {
    const state = getState();
    startGameListener(db, doc, onSnapshot);
  });

  // Handle page visibility for heartbeat / disconnect
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Could trigger disconnect notification
    }
  });

  // Handle page unload
  window.addEventListener("beforeunload", () => {
    const state = getState();
    if (state.lobbyCode) {
      // Best-effort disconnect notification
      // navigator.sendBeacon doesn't work with Cloud Functions
      // The heartbeat timeout will handle this
    }
  });
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
