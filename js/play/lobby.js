/**
 * Lobby UI controller.
 *
 * Handles the host/join flow, player setup (name, avatar, team),
 * and the waiting room with real-time updates.
 */

import { getState, setState, AVATARS } from "./state.js";
import * as actions from "./firebase-actions.js";

let lobbyUnsubscribe = null;

/**
 * Initialise lobby UI event listeners.
 */
export function initLobby(db, doc, onSnapshot) {
  const $ = (id) => document.getElementById(id);

  // Host button
  $("btn-host").addEventListener("click", () => {
    setState({ isHost: true });
    showPlayerSetup();
  });

  // Join button
  $("btn-join").addEventListener("click", () => {
    const code = $("join-code").value.toUpperCase().trim();
    if (code.length !== 4) {
      alert("Enter a 4-letter game code.");
      return;
    }
    setState({ lobbyCode: code, isHost: false });
    showPlayerSetup();
  });

  // Code input — auto-uppercase
  $("join-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
  });

  // Avatar selection
  $("avatar-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".avatar-btn");
    if (!btn) return;
    document.querySelectorAll(".avatar-btn").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    setState({ playerAvatar: btn.dataset.avatar });
  });

  // Team selection
  document.querySelectorAll(".team-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".team-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      setState({ playerTeam: btn.dataset.team });
    });
  });

  // Ready button
  $("btn-ready").addEventListener("click", async () => {
    const state = getState();
    const name = $("player-name").value.trim();
    if (!name) {
      alert("Enter your name.");
      return;
    }
    setState({ playerName: name });

    try {
      $("btn-ready").disabled = true;

      if (state.isHost) {
        const result = await actions.createGame({
          name,
          avatar: state.playerAvatar,
          team: state.playerTeam,
        });
        setState({ lobbyCode: result.code, mySeat: result.seat });
      } else {
        const result = await actions.joinGame({
          code: state.lobbyCode,
          name,
          avatar: state.playerAvatar,
          team: state.playerTeam,
        });
        setState({ mySeat: result.seat });
      }

      showWaitingRoom(db, doc, onSnapshot);
    } catch (err) {
      alert(err.message || "Failed to join game.");
      $("btn-ready").disabled = false;
    }
  });

  // Copy code button
  $("btn-copy-code").addEventListener("click", () => {
    const code = getState().lobbyCode;
    if (code) {
      navigator.clipboard.writeText(code).catch(() => {});
      $("btn-copy-code").textContent = "✓";
      setTimeout(() => { $("btn-copy-code").textContent = "📋"; }, 1500);
    }
  });

  // Start game button (host only)
  $("btn-start").addEventListener("click", async () => {
    try {
      $("btn-start").disabled = true;
      await actions.startGame({ code: getState().lobbyCode });
    } catch (err) {
      alert(err.message || "Failed to start game.");
      $("btn-start").disabled = false;
    }
  });
}

function showPlayerSetup() {
  document.getElementById("lobby-actions").hidden = true;
  document.getElementById("player-setup").hidden = false;
}

function showWaitingRoom(db, doc, onSnapshot) {
  const $ = (id) => document.getElementById(id);
  const state = getState();

  $("player-setup").hidden = true;
  $("waiting-room").hidden = false;
  $("display-code").textContent = state.lobbyCode;

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
      alert("Game was cancelled.");
      resetToLobby();
      return;
    }

    const data = snapshot.data();
    setState({ lobbyData: data });
    updateWaitingRoom(data);

    // If game started, transition to game view
    if (data.status === "in_game" && data.gameId) {
      setState({ gameId: data.gameId });
      // Find our new seat (may have been rearranged)
      const seats = ["north", "east", "south", "west"];
      for (const seat of seats) {
        if (data.seats[seat] && data.seats[seat].uid === state.uid) {
          setState({ mySeat: seat });
          break;
        }
      }
      // Emit custom event for app.js to handle
      window.dispatchEvent(new CustomEvent("game-started"));
    }
  });
}

function updateWaitingRoom(data) {
  const $ = (id) => document.getElementById(id);
  const seats = ["north", "east", "south", "west"];

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

  // Render team slots
  renderTeamSlots($("team-a-slots"), teamAPlayers, data.hostUid);
  renderTeamSlots($("team-b-slots"), teamBPlayers, data.hostUid);

  // Enable start button if 4 players and 2 per team
  const totalPlayers = teamAPlayers.length + teamBPlayers.length;
  const validTeams = teamAPlayers.length === 2 && teamBPlayers.length === 2;
  const startBtn = $("btn-start");

  if (startBtn) {
    startBtn.disabled = !(totalPlayers === 4 && validTeams);
    $("host-hint").textContent = validTeams
      ? "Ready to start!"
      : `Waiting for 4 players (2 per team) — ${totalPlayers}/4 joined`;
  }
}

function renderTeamSlots(container, players, hostUid) {
  container.innerHTML = "";

  for (let i = 0; i < 2; i++) {
    const slot = document.createElement("div");
    slot.className = "player-slot";

    if (players[i]) {
      const p = players[i];
      const avatarSymbol = AVATARS[p.avatar] || "♠";
      const isHost = p.uid === hostUid;

      slot.innerHTML = `
        <span class="slot-avatar">${esc(avatarSymbol)}</span>
        <span class="slot-name">${esc(p.name)}</span>
        ${isHost ? '<span class="slot-host-badge">Host</span>' : ""}
      `;
    } else {
      slot.classList.add("empty");
      slot.innerHTML = '<span class="slot-placeholder">Waiting...</span>';
    }

    container.appendChild(slot);
  }
}

function resetToLobby() {
  if (lobbyUnsubscribe) {
    lobbyUnsubscribe();
    lobbyUnsubscribe = null;
  }
  document.getElementById("lobby-actions").hidden = false;
  document.getElementById("player-setup").hidden = true;
  document.getElementById("waiting-room").hidden = true;
}

export function cleanup() {
  if (lobbyUnsubscribe) {
    lobbyUnsubscribe();
    lobbyUnsubscribe = null;
  }
}

function esc(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}
