/**
 * Game renderer — DOM rendering for the card table.
 *
 * Takes a playerView state object and updates the DOM accordingly.
 * Handles all game phases: cutting, bidding, trump selection,
 * open/closed trump, playing, and results.
 */

import { getState, AVATARS, SUIT_SYMBOLS, SCORING_TABLE } from "./state.js";

// Anticlockwise seat order
const SEAT_ORDER = ["north", "west", "south", "east"];

/**
 * Get relative positions for the other players.
 * "You" is at bottom. Partner is top. Opponents are left/right.
 * Play is anticlockwise: next player is to your right.
 */
function getRelativeSeats(mySeat) {
  const idx = SEAT_ORDER.indexOf(mySeat);
  const partner = SEAT_ORDER[(idx + 2) % 4]; // opposite
  const right = SEAT_ORDER[(idx + 1) % 4];   // next (anticlockwise)
  const left = SEAT_ORDER[(idx + 3) % 4];    // previous
  return { partner, left, right };
}

/**
 * Render the full game state.
 */
export function renderGame(gameState) {
  if (!gameState) return;

  const state = getState();
  const mySeat = state.mySeat;
  const positions = getRelativeSeats(mySeat);

  renderPlayerInfo(gameState, mySeat, positions);
  renderStone(gameState);
  renderOtherPlayersCards(gameState, mySeat, positions);
  renderHand(gameState, mySeat);

  // Phase-specific rendering
  switch (gameState.phase) {
  case "dealing_4":
  case "dealing_8":
    renderCutting(gameState, mySeat);
    break;
  case "betting_4":
  case "betting_8":
    renderBidding(gameState, mySeat);
    break;
  case "trump_selection":
    renderTrumpSelection(gameState, mySeat);
    break;
  case "pre_play":
    renderPrePlay(gameState, mySeat);
    break;
  case "playing":
  case "round_resolution":
    renderPlaying(gameState, mySeat, positions);
    break;
  case "complete":
    renderResult(gameState);
    break;
  }

  renderTrumpIndicator(gameState);
  renderRoundInfo(gameState);
  renderCapsButton(gameState, mySeat);
  renderStatus(gameState, mySeat);
}

function $(id) { return document.getElementById(id); }

function renderPlayerInfo(gs, mySeat, pos) {
  const players = gs.players || {};

  // Self
  const self = players[mySeat] || {};
  $("self-avatar").textContent = AVATARS[self.avatar] || "♠";
  $("self-name").textContent = self.name || "You";

  // Partner
  const partner = players[pos.partner] || {};
  $("partner-avatar").textContent = AVATARS[partner.avatar] || "?";
  $("partner-name").textContent = partner.name || "Partner";

  // Left
  const left = players[pos.left] || {};
  $("left-avatar").textContent = AVATARS[left.avatar] || "?";
  $("left-name").textContent = left.name || "Left";

  // Right
  const right = players[pos.right] || {};
  $("right-avatar").textContent = AVATARS[right.avatar] || "?";
  $("right-name").textContent = right.name || "Right";

  // Active turn indicator
  const waitingFor = gs.waitingFor;
  document.querySelectorAll(".player-position").forEach((el) => el.classList.remove("active-turn"));
  if (waitingFor) {
    if (waitingFor === mySeat) $("pos-self").classList.add("active-turn");
    else if (waitingFor === pos.partner) $("pos-partner").classList.add("active-turn");
    else if (waitingFor === pos.left) $("pos-left").classList.add("active-turn");
    else if (waitingFor === pos.right) $("pos-right").classList.add("active-turn");
  }
}

function renderStone(gs) {
  $("stone-a").textContent = gs.stone?.teamA ?? 10;
  $("stone-b").textContent = gs.stone?.teamB ?? 10;

  // Highlight your team
  const myTeam = gs.myTeam;
  $("stone-team-a").style.fontWeight = myTeam === "teamA" ? "700" : "400";
  $("stone-team-b").style.fontWeight = myTeam === "teamB" ? "700" : "400";
}

function renderOtherPlayersCards(gs, mySeat, pos) {
  // Show card backs for other players' hands
  for (const [posKey, seatId] of Object.entries(pos)) {
    const containerId = posKey + "-cards";
    const container = $(containerId);
    if (!container) continue;

    // Estimate number of cards (8 minus cards played)
    const roundsPlayed = gs.play?.completedRounds?.length || 0;
    const inCurrentRound = (gs.play?.currentRound || []).some((c) => c.seat === seatId);
    let cardCount = 8 - roundsPlayed - (inCurrentRound ? 1 : 0);
    // Trumper has 7 cards (one is the trump card)
    if (gs.trump?.trumperSeat === seatId && !gs.trump?.isRevealed) {
      cardCount = Math.max(0, cardCount - 1);
    }
    cardCount = Math.max(0, cardCount);

    container.innerHTML = "";
    for (let i = 0; i < cardCount; i++) {
      const back = document.createElement("div");
      back.className = "card-back";
      container.appendChild(back);
    }
  }
}

function renderHand(gs, mySeat) {
  const container = $("hand-container");
  container.innerHTML = "";

  const myHand = gs.myHand || [];
  const isMyTurn = gs.play?.currentTurn === mySeat && gs.phase === "playing";

  // Sort hand by suit then rank
  const suitOrder = { c: 0, d: 1, h: 2, s: 3 };
  const rankOrder = { J: 0, "9": 1, A: 2, "10": 3, K: 4, Q: 5, "8": 6, "7": 7 };

  const sorted = [...myHand].sort((a, b) => {
    const sa = parseCard(a), sb = parseCard(b);
    if (suitOrder[sa.suit] !== suitOrder[sb.suit]) return suitOrder[sa.suit] - suitOrder[sb.suit];
    return rankOrder[sa.rank] - rankOrder[sb.rank];
  });

  for (const card of sorted) {
    const el = createCardElement(card);
    if (isMyTurn) {
      el.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("card-clicked", { detail: { card } }));
      });
    } else {
      el.classList.add("disabled");
    }
    container.appendChild(el);
  }
}

function renderCutting(gs, mySeat) {
  const overlay = $("cutting-overlay");
  if (!gs.cutting || gs.cutting.resolved) {
    overlay.hidden = true;
    return;
  }

  if (gs.cutting.cutterSeat === mySeat) {
    overlay.hidden = false;
  } else {
    overlay.hidden = true;
  }
}

function renderBidding(gs, mySeat) {
  const overlay = $("bidding-overlay");
  const bidding = gs.bidding;
  if (!bidding) { overlay.hidden = true; return; }

  overlay.hidden = false;

  const isFourCard = bidding.phase === "four_card";
  $("bidding-title").textContent = isFourCard ? "4-Card Betting" : "8-Card Betting";

  const bidName = bidding.highestBid > 0
    ? formatBid(bidding.highestBid, bidding.isPCC)
    : "None";
  $("current-bid").textContent = bidName;

  const bidderName = bidding.highestBidder
    ? (gs.players?.[bidding.highestBidder]?.name || bidding.highestBidder)
    : "—";
  $("current-bidder").textContent = bidderName;

  const isMyTurn = bidding.currentBidder === mySeat;
  const controls = $("bid-controls");

  if (isMyTurn) {
    $("bid-status").textContent = "Your turn to bid";
    controls.hidden = false;

    // Set up bid value
    const playerState = bidding.playerState?.[mySeat];
    const isFirstSpeech = !playerState || playerState.speechCount === 0;
    const minBid = isFourCard
      ? (isFirstSpeech ? Math.max(160, (bidding.highestBid || 0) + 10) : Math.max(200, (bidding.highestBid || 0) + 5))
      : (isFirstSpeech ? Math.max(220, (bidding.highestBid || 0) + 5) : Math.max(250, (bidding.highestBid || 0) + 5));

    $("bid-value").textContent = minBid;
    $("bid-value").dataset.value = minBid;
    $("bid-value").dataset.min = minBid;

    const increment = minBid >= 200 ? 5 : 10;
    $("bid-value").dataset.increment = increment;
  } else {
    const waitingName = gs.players?.[bidding.currentBidder]?.name || bidding.currentBidder;
    $("bid-status").textContent = `Waiting for ${waitingName}...`;
    controls.hidden = true;
  }
}

function renderTrumpSelection(gs, mySeat) {
  const overlay = $("trump-overlay");
  const isTrumper = gs.trump?.trumperSeat === mySeat;

  if (!isTrumper) {
    overlay.hidden = true;
    return;
  }

  overlay.hidden = false;
  const container = $("trump-card-options");
  container.innerHTML = "";

  for (const card of gs.myHand || []) {
    const el = createCardElement(card);
    el.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("trump-selected", { detail: { card } }));
    });
    container.appendChild(el);
  }
}

function renderPrePlay(gs, mySeat) {
  const overlay = $("preplay-overlay");
  const isTrumper = gs.trump?.trumperSeat === mySeat;

  if (isTrumper) {
    overlay.hidden = false;
    // Hide bidding/trump overlays
    $("bidding-overlay").hidden = true;
    $("trump-overlay").hidden = true;
  } else {
    overlay.hidden = true;
  }
}

function renderPlaying(gs, mySeat, positions) {
  // Hide all other overlays
  $("bidding-overlay").hidden = true;
  $("trump-overlay").hidden = true;
  $("preplay-overlay").hidden = true;
  $("cutting-overlay").hidden = true;

  // Render current trick
  const currentRound = gs.play?.currentRound || [];
  const trickSlots = {
    [mySeat]: $("trick-self"),
    [positions.partner]: $("trick-partner"),
    [positions.left]: $("trick-left"),
    [positions.right]: $("trick-right"),
  };

  // Clear all slots
  for (const el of Object.values(trickSlots)) {
    if (el) el.innerHTML = "";
  }

  // Place played cards
  for (const entry of currentRound) {
    const slot = trickSlots[entry.seat];
    if (!slot) continue;

    if (entry.faceDown && !entry.card) {
      // Hidden face-down card
      const back = document.createElement("div");
      back.className = "card face-down";
      slot.appendChild(back);
    } else if (entry.faceDown && entry.card) {
      // Your own face-down card (you can see it)
      const el = createCardElement(entry.card);
      el.classList.add("face-down-own");
      el.style.opacity = "0.7";
      slot.appendChild(el);
    } else if (entry.card) {
      slot.appendChild(createCardElement(entry.card));
    }
  }
}

function renderTrumpIndicator(gs) {
  const indicator = $("trump-indicator");
  const display = $("trump-card-display");
  const label = $("trump-label");

  if (!gs.trump || !gs.trump.trumpCardPlaced) {
    indicator.hidden = true;
    return;
  }

  indicator.hidden = false;

  if (gs.trump.isRevealed || gs.trump.isOpen) {
    display.className = "trump-card";
    display.textContent = SUIT_SYMBOLS[gs.trump.trumpSuit] || "?";
    display.style.fontSize = "1.6rem";
    display.style.display = "flex";
    display.style.alignItems = "center";
    display.style.justifyContent = "center";
    display.style.background = "var(--clr-surface)";
    display.style.border = "2px solid var(--clr-border)";
    display.style.borderRadius = "4px";
    label.textContent = `Trump: ${suitName(gs.trump.trumpSuit)}`;
  } else {
    display.className = "trump-card face-down";
    display.textContent = "";
    display.style = "";
    label.textContent = "Trump (hidden)";
  }
}

function renderRoundInfo(gs) {
  const info = $("round-info");
  if (!gs.play) { info.hidden = true; return; }

  info.hidden = false;
  $("round-number").textContent = `Round ${gs.play.roundNumber || 1} of 8`;

  const bid = gs.bidding?.highestBid;
  $("bid-display").textContent = bid ? `Bid: ${formatBid(bid, gs.bidding?.isPCC)}` : "";
}

function renderCapsButton(gs, mySeat) {
  const container = $("caps-container");
  // Show caps button during play phase
  container.hidden = gs.phase !== "playing";
}

function renderResult(gs) {
  const overlay = $("result-overlay");
  if (!gs.result) { overlay.hidden = true; return; }

  overlay.hidden = false;
  $("bidding-overlay").hidden = true;
  $("trump-overlay").hidden = true;
  $("preplay-overlay").hidden = true;

  const result = gs.result;
  $("result-title").textContent = result.winnerTeam === gs.myTeam ? "You Win!" : "You Lose";
  $("result-description").textContent = result.description || "";
  $("result-stone").innerHTML = `
    <span>Team A: ${gs.stone?.teamA ?? "?"}</span>
    <span>Team B: ${gs.stone?.teamB ?? "?"}</span>
  `;

  // Check if match is over
  const matchOver = (gs.stone?.teamA <= 0) || (gs.stone?.teamB <= 0);
  $("match-complete").hidden = !matchOver;
  $("btn-next-game").hidden = matchOver;

  if (matchOver) {
    const winner = gs.stone?.teamA <= 0 ? "Team A" : "Team B";
    $("match-winner").textContent = `${winner} wins the match!`;
  }
}

function renderStatus(gs, mySeat) {
  const waitingFor = gs.waitingFor;
  let msg = "";

  if (waitingFor === mySeat) {
    msg = "Your turn";
  } else if (waitingFor) {
    const name = gs.players?.[waitingFor]?.name || waitingFor;
    msg = `Waiting for ${name}...`;
  } else {
    msg = gs.phase || "...";
  }

  $("status-message").textContent = msg;
}

// --- Helpers ---

function parseCard(card) {
  if (card.startsWith("10")) return { rank: "10", suit: card[2] };
  return { rank: card[0], suit: card[1] };
}

function createCardElement(card) {
  const { rank, suit } = parseCard(card);
  const el = document.createElement("div");
  el.className = `card suit-${suit}`;
  el.dataset.card = card;
  el.innerHTML = `
    <span class="card-rank">${rank}</span>
    <span class="card-suit">${SUIT_SYMBOLS[suit] || suit}</span>
  `;
  return el;
}

function formatBid(value, isPCC) {
  if (isPCC || value === 999) return "PCC";
  const entry = SCORING_TABLE[value];
  return entry ? entry.name : String(value);
}

function suitName(suit) {
  const names = { c: "Clubs", d: "Diamonds", h: "Hearts", s: "Spades" };
  return names[suit] || suit;
}

export { getRelativeSeats, createCardElement, parseCard };
