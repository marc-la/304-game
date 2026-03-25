/**
 * Local state management for the play page.
 *
 * Stores the current view state, lobby state, and game state.
 * Emits change events so the UI can react.
 */

const listeners = [];

const state = {
  // Auth
  uid: null,

  // View
  currentView: "lobby", // "lobby" | "game" | "error"

  // Lobby
  lobbyCode: null,
  mySeat: null,
  isHost: false,
  playerName: "",
  playerAvatar: null,
  playerTeam: null,
  lobbyData: null,

  // Game
  gameId: null,
  gameState: null, // the playerView data from Firestore
};

export function getState() {
  return state;
}

export function setState(updates) {
  Object.assign(state, updates);
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error("State listener error:", e); }
  }
}

export function onStateChange(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

// Avatar map for display
export const AVATARS = {
  spade: "♠",
  heart: "♥",
  diamond: "♦",
  club: "♣",
  crown: "♚",
  knight: "♞",
  tower: "♜",
  star: "★",
};

// Card suit symbols
export const SUIT_SYMBOLS = {
  c: "♣",
  d: "♦",
  h: "♥",
  s: "♠",
};

// Scoring table for display
export const SCORING_TABLE = {
  160: { name: "60", win: 1, loss: 2 },
  170: { name: "70", win: 1, loss: 2 },
  180: { name: "80", win: 1, loss: 2 },
  190: { name: "90", win: 1, loss: 2 },
  200: { name: "100", win: 2, loss: 3 },
  205: { name: "105", win: 2, loss: 3 },
  210: { name: "110", win: 2, loss: 3 },
  215: { name: "115", win: 2, loss: 3 },
  220: { name: "Honest", win: 2, loss: 3 },
  225: { name: "Honest 5", win: 2, loss: 3 },
  230: { name: "Honest 10", win: 2, loss: 3 },
  235: { name: "Honest 15", win: 2, loss: 3 },
  240: { name: "Honest 20", win: 2, loss: 3 },
  245: { name: "Honest 25", win: 2, loss: 3 },
  250: { name: "250", win: 3, loss: 4 },
};
