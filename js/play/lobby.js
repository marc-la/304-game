/**
 * Lobby UI controller.
 *
 * Two-step flow: Host/Join -> Lobby Room (with in-lobby customization).
 * Players connect first, then customize name/avatar/team inside the lobby.
 */

import { getState, setState, AVATARS } from "./state.js";
import * as actions from "./firebase-actions.js";

let lobbyUnsubscribe = null;
let editPanelOpen = false;

// Track previous lobby data for team-switch animation
let prevLobbySeats = null;

const ALL_AVATARS = ["spade", "heart", "diamond", "club", "crown", "knight", "tower", "star"];

/**
 * Initialise lobby UI event listeners.
 */
export function initLobby(db, doc, onSnapshot) {
  const $ = (id) => document.getElementById(id);

  // Host button — create game immediately
  $("btn-host").addEventListener("click", async () => {
    $("btn-host").disabled = true;
    $("btn-host").classList.add("loading");
    try {
      const result = await actions.createGame({});
      setState({ lobbyCode: result.code, mySeat: result.seat, isHost: true });
      sessionStorage.setItem("lobbyCode", result.code);
      showLobbyRoom(db, doc, onSnapshot);
    } catch (err) {
      showToast(err.message || "Failed to create game.");
      $("btn-host").disabled = false;
      $("btn-host").classList.remove("loading");
    }
  });

  // Join button — join game immediately
  $("btn-join").addEventListener("click", async () => {
    const code = $("join-code").value.toUpperCase().trim();
    if (code.length !== 4) {
      showToast("Enter a 4-letter game code.");
      return;
    }
    $("btn-join").disabled = true;
    $("btn-join").classList.add("loading");
    try {
      const result = await actions.joinGame({ code });
      setState({ lobbyCode: result.code, mySeat: result.seat, isHost: false });
      sessionStorage.setItem("lobbyCode", result.code);
      showLobbyRoom(db, doc, onSnapshot);
    } catch (err) {
      showToast(err.message || "Failed to join game.");
      $("btn-join").disabled = false;
      $("btn-join").classList.remove("loading");
    }
  });

  // Code input — auto-uppercase
  $("join-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
  });

  // Enter key on code input
  $("join-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-join").click();
  });

  // Copy code button
  $("btn-copy-code").addEventListener("click", () => {
    const code = getState().lobbyCode;
    if (code) {
      navigator.clipboard.writeText(code).catch(() => {});
      $("btn-copy-code").textContent = "\u2713";
      setTimeout(() => { $("btn-copy-code").textContent = "\ud83d\udccb"; }, 1500);
    }
  });

  // Leave button
  $("btn-leave").addEventListener("click", async () => {
    const state = getState();
    try {
      await actions.leaveGame({ code: state.lobbyCode });
    } catch { /* ignore */ }
    sessionStorage.removeItem("lobbyCode");
    resetToLobby();
  });

  // Start game button (host only)
  $("btn-start").addEventListener("click", async () => {
    try {
      $("btn-start").disabled = true;
      await actions.startGame({ code: getState().lobbyCode });
    } catch (err) {
      showToast(err.message || "Failed to start game.");
      $("btn-start").disabled = false;
    }
  });

  // Save profile button
  $("btn-save-profile").addEventListener("click", async () => {
    const state = getState();
    const nameInput = $("player-name");
    const newName = nameInput.value.trim();
    const selectedAvatar = document.querySelector("#avatar-grid .avatar-btn.selected");
    const newAvatar = selectedAvatar ? selectedAvatar.dataset.avatar : null;

    if (!newName) {
      $("name-hint").textContent = "Name cannot be empty.";
      return;
    }

    // Check client-side for duplicate name
    const lobbyData = state.lobbyData;
    if (lobbyData) {
      const seats = ["north", "east", "south", "west"];
      for (const seat of seats) {
        const p = lobbyData.seats[seat];
        if (p && p.uid !== state.uid && p.name.toLowerCase() === newName.toLowerCase()) {
          $("name-hint").textContent = "That name is already taken.";
          return;
        }
      }
    }

    $("btn-save-profile").disabled = true;
    try {
      const updates = { code: state.lobbyCode };
      updates.name = newName;
      if (newAvatar) updates.avatar = newAvatar;
      await actions.updateProfile(updates);
      closeEditPanel();
    } catch (err) {
      $("name-hint").textContent = err.message || "Failed to update profile.";
    }
    $("btn-save-profile").disabled = false;
  });
}

/**
 * Show the lobby room and start listening for updates.
 */
function showLobbyRoom(db, doc, onSnapshot) {
  const $ = (id) => document.getElementById(id);
  const state = getState();

  $("lobby-actions").hidden = true;
  $("lobby-room").hidden = false;
  $("display-code").textContent = state.lobbyCode;

  // Mode indicator
  $("lobby-mode-label").textContent = state.isHost ? "Hosting" : `Joined ${state.lobbyCode}`;

  // Show host/guest controls
  if (state.isHost) {
    $("host-controls").hidden = false;
    $("guest-waiting").hidden = true;
  } else {
    $("host-controls").hidden = true;
    $("guest-waiting").hidden = false;
  }

  // Listen for lobby updates
  const lobbyRef = doc(db, "lobbies", state.lobbyCode);
  lobbyUnsubscribe = onSnapshot(lobbyRef, (snapshot) => {
    if (!snapshot.exists()) {
      showToast("Game was cancelled.");
      sessionStorage.removeItem("lobbyCode");
      resetToLobby();
      return;
    }

    const data = snapshot.data();
    setState({ lobbyData: data });

    // Update host status (may have changed if original host left)
    const isNowHost = data.hostUid === state.uid;
    if (isNowHost !== state.isHost) {
      setState({ isHost: isNowHost });
      $("lobby-mode-label").textContent = isNowHost ? "Hosting" : `Joined ${state.lobbyCode}`;
      $("host-controls").hidden = !isNowHost;
      $("guest-waiting").hidden = isNowHost;
    }

    // Find our seat (may have changed) or detect if we were kicked
    const seats = ["north", "east", "south", "west"];
    let foundSeat = null;
    for (const seat of seats) {
      if (data.seats[seat] && data.seats[seat].uid === state.uid) {
        foundSeat = seat;
        break;
      }
    }

    if (!foundSeat) {
      // We were kicked from the lobby
      showToast("You were removed from the lobby.");
      sessionStorage.removeItem("lobbyCode");
      resetToLobby();
      return;
    }
    setState({ mySeat: foundSeat });

    updateLobbyRoom(data);

    // If game started, transition to game view
    if (data.status === "in_game" && data.gameId) {
      setState({ gameId: data.gameId });
      window.dispatchEvent(new CustomEvent("game-started"));
    }
  });
}

/**
 * Update the lobby room UI with current data.
 */
function updateLobbyRoom(data) {
  const $ = (id) => document.getElementById(id);
  const state = getState();
  const seats = ["north", "east", "south", "west"];

  // Detect team switches for animation
  const switched = [];
  if (prevLobbySeats) {
    for (const seat of seats) {
      const prev = prevLobbySeats[seat];
      const curr = data.seats[seat];
      if (prev && curr && prev.uid === curr.uid && prev.team !== curr.team) {
        switched.push(curr.uid);
      }
    }
  }

  // Count players per team
  const teamAPlayers = [];
  const teamBPlayers = [];

  for (const seat of seats) {
    const player = data.seats[seat];
    if (!player) continue;
    if (player.team === "teamA") {
      teamAPlayers.push({ seat, ...player });
    } else {
      teamBPlayers.push({ seat, ...player });
    }
  }

  // Animate team switches
  if (switched.length > 0) {
    for (const uid of switched) {
      const el = document.querySelector(`[data-uid="${uid}"]`);
      if (el) el.classList.add("switching-out");
    }
    setTimeout(() => {
      renderTeams(teamAPlayers, teamBPlayers, data.hostUid, state);
      for (const uid of switched) {
        const el = document.querySelector(`[data-uid="${uid}"]`);
        if (el) {
          el.classList.add("switching-in");
          setTimeout(() => el.classList.remove("switching-in"), 300);
        }
      }
    }, 250);
  } else {
    renderTeams(teamAPlayers, teamBPlayers, data.hostUid, state);
  }

  // Update edit panel avatar states if open
  if (editPanelOpen) {
    updateAvatarGrid(data);
  }

  // Enable start button if 4 players and 2 per team
  const totalPlayers = teamAPlayers.length + teamBPlayers.length;
  const validTeams = teamAPlayers.length === 2 && teamBPlayers.length === 2;
  const startBtn = $("btn-start");

  if (startBtn) {
    startBtn.disabled = !(totalPlayers === 4 && validTeams);
    const hint = $("host-hint");
    if (hint) {
      if (validTeams) {
        hint.textContent = "Ready to start!";
      } else if (totalPlayers < 4) {
        hint.textContent = `Waiting for players \u2014 ${totalPlayers}/4 joined`;
      } else {
        const aCount = teamAPlayers.length;
        const bCount = teamBPlayers.length;
        hint.textContent = `Teams unbalanced (${aCount} vs ${bCount}) \u2014 need 2 per team`;
      }
    }
  }

  // Save for next diff
  prevLobbySeats = JSON.parse(JSON.stringify(data.seats));
}

/**
 * Render team columns with player slots.
 */
function renderTeams(teamAPlayers, teamBPlayers, hostUid, state) {
  const $ = (id) => document.getElementById(id);
  renderTeamSlots($("team-a-slots"), teamAPlayers, hostUid, state);
  renderTeamSlots($("team-b-slots"), teamBPlayers, hostUid, state);
}

function renderTeamSlots(container, players, hostUid, state) {
  container.innerHTML = "";

  // Show all players on this team (may be 0, 1, 2, 3, or 4)
  for (const player of players) {
    container.appendChild(renderPlayerSlot(player, hostUid, state));
  }

  // Fill remaining empty slots up to 2 (the target per team)
  const emptyCount = Math.max(0, 2 - players.length);
  for (let i = 0; i < emptyCount; i++) {
    const slot = document.createElement("div");
    slot.className = "player-slot empty";
    slot.innerHTML = '<span class="slot-placeholder">Waiting...</span>';
    container.appendChild(slot);
  }

  // Mark container as unbalanced if too many players
  container.classList.toggle("team-overflow", players.length > 2);
}

/**
 * Render an interactive player slot.
 */
function renderPlayerSlot(player, hostUid, state) {
  const slot = document.createElement("div");
  slot.className = "player-slot";
  slot.dataset.uid = player.uid;
  slot.dataset.seat = player.seat;

  const isSelf = player.uid === state.uid;
  const isHost = player.uid === hostUid;
  const viewerIsHost = state.isHost;

  const avatarSymbol = AVATARS[player.avatar] || "\u2660";
  const connected = player.connected !== false;

  let html = `<span class="connection-dot ${connected ? "connected" : "disconnected"}"></span>`;
  html += `<span class="slot-avatar">${esc(avatarSymbol)}</span>`;
  html += `<span class="slot-name">${esc(player.name)}</span>`;
  if (isHost) html += '<span class="slot-host-badge">Host</span>';
  if (isSelf) html += '<span class="slot-you-badge">You</span>';

  // Action buttons
  html += '<span class="slot-actions">';
  if (isSelf) html += '<button class="slot-edit-btn" title="Edit profile">\u270e</button>';
  if (isSelf || viewerIsHost) html += '<button class="slot-swap-btn" title="Switch team">\u21c4</button>';
  if (viewerIsHost && !isSelf) html += '<button class="slot-kick-btn" title="Remove player">\u2715</button>';
  html += '</span>';

  slot.innerHTML = html;

  // Wire up edit button
  if (isSelf) {
    const editBtn = slot.querySelector(".slot-edit-btn");
    if (editBtn) {
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleEditPanel(player);
      });
    }
  }

  // Wire up swap button
  const swapBtn = slot.querySelector(".slot-swap-btn");
  if (swapBtn && (isSelf || viewerIsHost)) {
    swapBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newTeam = player.team === "teamA" ? "teamB" : "teamA";
      try {
        await actions.updateTeam({
          code: state.lobbyCode,
          targetSeat: player.seat,
          newTeam,
        });
      } catch (err) {
        showToast(err.message || "Cannot switch team.");
      }
    });
  }

  // Wire up kick button
  const kickBtn = slot.querySelector(".slot-kick-btn");
  if (kickBtn) {
    kickBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await actions.kickPlayer({
          code: state.lobbyCode,
          targetSeat: player.seat,
        });
      } catch (err) {
        showToast(err.message || "Cannot remove player.");
      }
    });
  }

  return slot;
}

/**
 * Toggle the inline edit panel.
 */
function toggleEditPanel(player) {
  if (editPanelOpen) {
    closeEditPanel();
  } else {
    openEditPanel(player);
  }
}

function openEditPanel(player) {
  const $ = (id) => document.getElementById(id);
  const panel = $("edit-panel");

  // Pre-fill
  $("player-name").value = player.name;
  $("name-hint").textContent = "";

  // Build avatar grid
  const state = getState();
  const lobbyData = state.lobbyData;
  buildAvatarGrid(lobbyData, player.avatar);

  panel.hidden = false;
  editPanelOpen = true;
  $("player-name").focus();
}

function closeEditPanel() {
  const panel = document.getElementById("edit-panel");
  panel.hidden = true;
  editPanelOpen = false;
}

/**
 * Build the avatar grid with taken-state indicators.
 */
function buildAvatarGrid(lobbyData, selectedAvatar) {
  const grid = document.getElementById("avatar-grid");
  grid.innerHTML = "";

  const state = getState();
  const takenAvatars = [];
  if (lobbyData) {
    const seats = ["north", "east", "south", "west"];
    for (const seat of seats) {
      const p = lobbyData.seats[seat];
      if (p && p.uid !== state.uid) {
        takenAvatars.push(p.avatar);
      }
    }
  }

  for (const key of ALL_AVATARS) {
    const btn = document.createElement("button");
    btn.className = "avatar-btn";
    btn.dataset.avatar = key;
    btn.title = key.charAt(0).toUpperCase() + key.slice(1);
    btn.textContent = AVATARS[key] || key;

    if (key === selectedAvatar) btn.classList.add("selected");
    if (takenAvatars.includes(key)) {
      btn.classList.add("taken");
    } else {
      btn.addEventListener("click", () => {
        grid.querySelectorAll(".avatar-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
    }

    grid.appendChild(btn);
  }
}

/**
 * Update avatar grid taken states without rebuilding.
 */
function updateAvatarGrid(lobbyData) {
  const state = getState();
  const takenAvatars = [];
  const seats = ["north", "east", "south", "west"];
  for (const seat of seats) {
    const p = lobbyData.seats[seat];
    if (p && p.uid !== state.uid) {
      takenAvatars.push(p.avatar);
    }
  }

  const buttons = document.querySelectorAll("#avatar-grid .avatar-btn");
  for (const btn of buttons) {
    const key = btn.dataset.avatar;
    if (takenAvatars.includes(key)) {
      btn.classList.add("taken");
    } else {
      btn.classList.remove("taken");
    }
  }
}

function resetToLobby() {
  const $ = (id) => document.getElementById(id);
  if (lobbyUnsubscribe) {
    lobbyUnsubscribe();
    lobbyUnsubscribe = null;
  }
  prevLobbySeats = null;
  editPanelOpen = false;
  setState({ lobbyCode: null, mySeat: null, isHost: false, lobbyData: null });

  $("lobby-actions").hidden = false;
  $("lobby-room").hidden = true;
  $("btn-host").disabled = false;
  $("btn-host").classList.remove("loading");
  $("btn-join").disabled = false;
  $("btn-join").classList.remove("loading");
  $("join-code").value = "";
}

/**
 * Attempt to reconnect to an existing lobby from sessionStorage.
 */
export async function tryReconnect(db, doc, onSnapshot) {
  const savedCode = sessionStorage.getItem("lobbyCode");
  if (!savedCode) return false;

  try {
    const result = await actions.reconnect({ code: savedCode });
    setState({
      lobbyCode: result.code,
      mySeat: result.seat,
      isHost: false, // will be updated by snapshot
    });

    if (result.status === "in_game" && result.gameId) {
      setState({ gameId: result.gameId });
      // Show game view directly
      showLobbyRoom(db, doc, onSnapshot);
      return true;
    }

    showLobbyRoom(db, doc, onSnapshot);
    return true;
  } catch {
    sessionStorage.removeItem("lobbyCode");
    return false;
  }
}

export function cleanup() {
  if (lobbyUnsubscribe) {
    lobbyUnsubscribe();
    lobbyUnsubscribe = null;
  }
}

/**
 * Show a toast message (replaces alert()).
 */
function showToast(message) {
  const existing = document.querySelector(".lobby-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "lobby-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3200);
}

function esc(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}
