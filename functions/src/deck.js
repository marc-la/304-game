/**
 * Deck management: shuffling, cutting, dealing.
 *
 * Shuffling preserves the rules' intent of minimal shuffling —
 * 1-4 partial passes (overhand-style) keep partial card order from
 * the previous game, encouraging higher bids.
 */

const { FULL_PACK, POINT_VALUES, RANKS, RANK_POWER, SUITS } = require("./constants");

/**
 * Parse a card string into { rank, suit }.
 */
function parseCard(card) {
  // Handle "10x" (3-char) vs "Jx" (2-char)
  if (card.startsWith("10")) {
    return { rank: "10", suit: card[2] };
  }
  return { rank: card[0], suit: card[1] };
}

/**
 * Get the point value of a card.
 */
function cardPoints(card) {
  const { rank } = parseCard(card);
  return POINT_VALUES[rank];
}

/**
 * Sum the point values of an array of cards.
 */
function handPoints(cards) {
  return cards.reduce((sum, card) => sum + cardPoints(card), 0);
}

/**
 * Compare two cards of the same suit by power. Returns negative if a > b.
 */
function compareCards(a, b) {
  const ra = parseCard(a);
  const rb = parseCard(b);
  return RANK_POWER[ra.rank] - RANK_POWER[rb.rank];
}

/**
 * Get the suit of a card.
 */
function cardSuit(card) {
  return parseCard(card).suit;
}

/**
 * Perform an overhand-style partial shuffle.
 * Splits the deck into chunks and reassembles in a partially reversed order.
 * This preserves some card adjacency, mimicking a real overhand shuffle.
 */
function overhardShuffle(cards) {
  const result = [];
  const arr = [...cards];
  while (arr.length > 0) {
    // Take a random chunk of 2-6 cards from the top
    const chunkSize = Math.min(2 + Math.floor(Math.random() * 5), arr.length);
    const chunk = arr.splice(0, chunkSize);
    // Place chunk on top of the result (prepend)
    result.unshift(...chunk);
  }
  return result;
}

/**
 * Perform 1-4 overhand shuffles (minimal shuffling per rules).
 * Preserves partial card order from the previous game.
 */
function minimalShuffle(cards) {
  const numShuffles = 1 + Math.floor(Math.random() * 4);
  let deck = [...cards];
  for (let i = 0; i < numShuffles; i++) {
    deck = overhardShuffle(deck);
  }
  return deck;
}

/**
 * Full Fisher-Yates shuffle (used after 3 consecutive reshuffles).
 */
function fullShuffle(cards) {
  const arr = [...cards];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Cut the deck at a random point.
 */
function cutDeck(cards) {
  const cutPoint = 1 + Math.floor(Math.random() * (cards.length - 2));
  return [...cards.slice(cutPoint), ...cards.slice(0, cutPoint)];
}

/**
 * Create a fresh pack (32 cards) in standard order.
 */
function createPack() {
  return [...FULL_PACK];
}

/**
 * Deal cards from the top of the deck to players in anticlockwise order
 * starting from the player to the dealer's right.
 *
 * @param {string[]} deck - The deck to deal from (mutated: cards are removed)
 * @param {string[]} seatOrder - Seats in deal order (starting right of dealer, anticlockwise)
 * @param {number} numCards - Number of cards to deal to each player
 * @returns {Object} Map of seat -> cards dealt
 */
function dealCards(deck, seatOrder, numCards) {
  const hands = {};
  for (const seat of seatOrder) {
    hands[seat] = [];
  }
  for (let i = 0; i < numCards; i++) {
    for (const seat of seatOrder) {
      if (deck.length > 0) {
        hands[seat].push(deck.shift());
      }
    }
  }
  return hands;
}

/**
 * Get the dealing order (anticlockwise from dealer's right).
 * Seats are: north, east, south, west.
 * Anticlockwise order from a seat: seat, then going right (anticlockwise).
 *
 * Physical arrangement (anticlockwise):
 *   north -> west -> south -> east -> north
 *
 * Dealer's right (next in anticlockwise order):
 *   north's right = west
 *   west's right = south
 *   south's right = east
 *   east's right = north
 */
const ANTICLOCKWISE_ORDER = ["north", "west", "south", "east"];

function getNextSeat(seat) {
  const idx = ANTICLOCKWISE_ORDER.indexOf(seat);
  return ANTICLOCKWISE_ORDER[(idx + 1) % 4];
}

function getPrevSeat(seat) {
  const idx = ANTICLOCKWISE_ORDER.indexOf(seat);
  return ANTICLOCKWISE_ORDER[(idx + 3) % 4];
}

/**
 * Get the dealing order starting from the player to the dealer's right.
 */
function getDealOrder(dealerSeat) {
  const rightOfDealer = getNextSeat(dealerSeat);
  const order = [rightOfDealer];
  let current = rightOfDealer;
  for (let i = 0; i < 3; i++) {
    current = getNextSeat(current);
    order.push(current);
  }
  return order;
}

/**
 * Get the seat to the left of the dealer (the cutter).
 */
function getCutterSeat(dealerSeat) {
  return getPrevSeat(dealerSeat);
}

/**
 * Get the partner of a seat.
 */
function getPartnerSeat(seat) {
  const partners = { north: "south", south: "north", east: "west", west: "east" };
  return partners[seat];
}

/**
 * Get the team a seat belongs to.
 */
function getTeamForSeat(seat) {
  if (seat === "north" || seat === "south") return "teamA";
  return "teamB";
}

/**
 * Determine the winner of a round.
 *
 * @param {Array} roundCards - Array of { seat, card, faceDown } in play order
 * @param {string} trumpSuit - The trump suit
 * @param {boolean} trumpRevealed - Whether trump is revealed (for resolution purposes)
 * @returns {{ winner: string, pointsWon: number, trumpFound: boolean, revealedCards: Array }}
 */
function resolveRound(roundCards, trumpSuit, trumpRevealed) {
  const ledCard = roundCards.find((c) => !c.faceDown);
  const ledSuit = cardSuit(ledCard.card);

  // Separate face-up and face-down cards
  const faceUpCards = roundCards.filter((c) => !c.faceDown);
  const faceDownCards = roundCards.filter((c) => c.faceDown);

  // Check if any face-down cards are trump
  const trumpFolds = faceDownCards.filter((c) => cardSuit(c.card) === trumpSuit);
  const nonTrumpFolds = faceDownCards.filter((c) => cardSuit(c.card) !== trumpSuit);
  const trumpFound = trumpFolds.length > 0;

  let winner;
  const revealedCards = [];

  if (trumpFound) {
    // Reveal all trump folds
    for (const tf of trumpFolds) {
      revealedCards.push(tf.card);
    }

    // Also consider face-up trump cards
    const allTrumpCards = [
      ...trumpFolds.map((c) => ({ seat: c.seat, card: c.card })),
      ...faceUpCards
        .filter((c) => cardSuit(c.card) === trumpSuit)
        .map((c) => ({ seat: c.seat, card: c.card })),
    ];

    // Highest trump wins
    allTrumpCards.sort((a, b) => compareCards(a.card, b.card));
    winner = allTrumpCards[0].seat;
  } else {
    // No trump played — highest card of led suit wins
    const ledSuitCards = faceUpCards
      .filter((c) => cardSuit(c.card) === ledSuit)
      .map((c) => ({ seat: c.seat, card: c.card }));

    ledSuitCards.sort((a, b) => compareCards(a.card, b.card));
    winner = ledSuitCards[0].seat;
  }

  // Calculate points (all cards contribute, even face-down ones)
  const pointsWon = roundCards.reduce((sum, c) => sum + cardPoints(c.card), 0);

  return { winner, pointsWon, trumpFound, revealedCards };
}

module.exports = {
  parseCard,
  cardPoints,
  handPoints,
  compareCards,
  cardSuit,
  overhardShuffle,
  minimalShuffle,
  fullShuffle,
  cutDeck,
  createPack,
  dealCards,
  getDealOrder,
  getCutterSeat,
  getNextSeat,
  getPrevSeat,
  getPartnerSeat,
  getTeamForSeat,
  resolveRound,
  ANTICLOCKWISE_ORDER,
};
