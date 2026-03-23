/**
 * Game controller.
 *
 * Manages the Firestore listener for the playerView document
 * and dispatches actions based on user interactions.
 */

import { getState, setState } from "./state.js";
import { renderGame } from "./renderer.js";
import * as actions from "./firebase-actions.js";

let gameUnsubscribe = null;
let heartbeatInterval = null;

/**
 * Start listening to the game's playerView document.
 */
export function startGameListener(db, doc, onSnapshot) {
  const state = getState();
  const { lobbyCode, gameId, mySeat } = state;

  if (!lobbyCode || !gameId || !mySeat) {
    console.error("Missing game info for listener setup.");
    return;
  }

  // Show game view
  document.getElementById("view-lobby").hidden = true;
  document.getElementById("view-game").hidden = false;

  // Listen to playerView
  const viewRef = doc(db, "lobbies", lobbyCode, "games", gameId, "playerViews", mySeat);
  gameUnsubscribe = onSnapshot(viewRef, (snapshot) => {
    if (!snapshot.exists()) {
      console.warn("PlayerView document does not exist.");
      return;
    }

    const gameState = snapshot.data();
    setState({ gameState });
    renderGame(gameState);
  }, (error) => {
    console.error("Game listener error:", error);
  });

  // Start heartbeat
  heartbeatInterval = setInterval(() => {
    actions.heartbeat({ code: lobbyCode }).catch(() => {});
  }, 30000);

  // Set up game UI event handlers
  setupGameEventHandlers();
}

/**
 * Set up event handlers for in-game actions.
 */
function setupGameEventHandlers() {
  const state = getState();
  const code = state.lobbyCode;

  // Card click — play a card
  window.addEventListener("card-clicked", async (e) => {
    const card = e.detail.card;
    try {
      await actions.playCard({ code, card });
    } catch (err) {
      alert(err.message || "Cannot play that card.");
    }
  });

  // Trump selection
  window.addEventListener("trump-selected", async (e) => {
    const card = e.detail.card;
    try {
      await actions.selectTrump({ code, card });
    } catch (err) {
      alert(err.message || "Cannot select that card as trump.");
    }
  });

  // Cutting
  document.getElementById("btn-cut").addEventListener("click", async () => {
    try {
      await actions.handleCut({ code, doCut: true });
    } catch (err) {
      alert(err.message || "Error during cut.");
    }
  });

  document.getElementById("btn-decline-cut").addEventListener("click", async () => {
    try {
      await actions.handleCut({ code, doCut: false });
    } catch (err) {
      alert(err.message || "Error declining cut.");
    }
  });

  // Bidding controls
  document.getElementById("bid-minus").addEventListener("click", () => {
    const el = document.getElementById("bid-value");
    const val = parseInt(el.dataset.value);
    const min = parseInt(el.dataset.min);
    const inc = parseInt(el.dataset.increment);
    const newVal = Math.max(min, val - inc);
    el.textContent = newVal;
    el.dataset.value = newVal;
  });

  document.getElementById("bid-plus").addEventListener("click", () => {
    const el = document.getElementById("bid-value");
    const val = parseInt(el.dataset.value);
    const inc = parseInt(el.dataset.increment);
    const newVal = val + inc;
    el.textContent = newVal;
    el.dataset.value = newVal;
  });

  document.getElementById("btn-bet").addEventListener("click", async () => {
    const value = parseInt(document.getElementById("bid-value").dataset.value);
    try {
      await actions.placeBid({ code, action: "bet", value });
    } catch (err) {
      alert(err.message || "Invalid bid.");
    }
  });

  document.getElementById("btn-pass").addEventListener("click", async () => {
    try {
      await actions.placeBid({ code, action: "pass" });
    } catch (err) {
      alert(err.message || "Cannot pass.");
    }
  });

  document.getElementById("btn-partner").addEventListener("click", async () => {
    try {
      await actions.placeBid({ code, action: "partner" });
    } catch (err) {
      alert(err.message || "Cannot partner.");
    }
  });

  // Open/Closed Trump
  document.getElementById("btn-open-trump").addEventListener("click", async () => {
    // For Open Trump, reveal the first trump suit card
    const gs = getState().gameState;
    const myHand = gs?.myHand || [];
    const trumpSuit = gs?.trump?.trumpSuit;
    const trumpCard = myHand.find((c) => {
      if (c.startsWith("10")) return c[2] === trumpSuit;
      return c[1] === trumpSuit;
    });

    try {
      await actions.declareOpenTrump({ code, revealCard: trumpCard || null });
    } catch (err) {
      alert(err.message || "Cannot declare Open Trump.");
    }
  });

  document.getElementById("btn-closed-trump").addEventListener("click", async () => {
    try {
      await actions.proceedClosedTrump({ code });
    } catch (err) {
      alert(err.message || "Cannot proceed.");
    }
  });

  // Caps
  document.getElementById("btn-caps").addEventListener("click", async () => {
    const gs = getState().gameState;
    const myHand = gs?.myHand || [];

    // Prompt player to order their cards
    // For now, use current hand order
    const playOrder = [...myHand];
    const confirmed = confirm(
      `Call Caps with play order: ${playOrder.join(", ")}?\n\n` +
      "If this is wrong, you'll receive a 5 stone penalty."
    );
    if (!confirmed) return;

    try {
      await actions.callCaps({ code, playOrder });
    } catch (err) {
      alert(err.message || "Caps call failed.");
    }
  });

  // Next game
  document.getElementById("btn-next-game").addEventListener("click", async () => {
    try {
      const result = await actions.nextGame({ code });
      if (result.matchComplete) {
        alert(`Match over! ${result.winner === getState().gameState?.myTeam ? "You win!" : "You lose."}`);
      } else {
        setState({ gameId: result.gameId });
        // Re-subscribe to new game
        cleanup();
        // The lobby listener should handle the transition
        window.dispatchEvent(new CustomEvent("game-started"));
      }
    } catch (err) {
      alert(err.message || "Cannot start next game.");
    }
  });
}

export function cleanup() {
  if (gameUnsubscribe) {
    gameUnsubscribe();
    gameUnsubscribe = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
