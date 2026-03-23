/**
 * 304 Card Game Constants
 *
 * Card encoding: rank + suit initial (e.g. "Jc" = Jack of Clubs, "10d" = 10 of Diamonds)
 * Suits: c (clubs), d (diamonds), h (hearts), s (spades)
 * Ranks in power order (high to low): J, 9, A, 10, K, Q, 8, 7
 */

const SUITS = ["c", "d", "h", "s"];
const SUIT_NAMES = { c: "Clubs", d: "Diamonds", h: "Hearts", s: "Spades" };

// Ranks ordered by power (highest first)
const RANKS = ["J", "9", "A", "10", "K", "Q", "8", "7"];

// Point values per rank
const POINT_VALUES = {
  J: 30,
  "9": 20,
  A: 11,
  "10": 10,
  K: 3,
  Q: 2,
  "8": 0,
  "7": 0,
};

// Rank power index (lower = more powerful)
const RANK_POWER = {};
RANKS.forEach((r, i) => { RANK_POWER[r] = i; });

// Total points in the pack
const TOTAL_POINTS = 304;

// All 32 cards in the pack
const FULL_PACK = [];
for (const suit of SUITS) {
  for (const rank of RANKS) {
    FULL_PACK.push(rank + suit);
  }
}

// Seats in anticlockwise order
const SEATS = ["north", "east", "south", "west"];

// Teams: partners sit opposite (north/south vs east/west)
const TEAMS = {
  teamA: ["north", "south"],
  teamB: ["east", "west"],
};

// Game phases
const PHASE = {
  DEALING_4: "dealing_4",
  BETTING_4: "betting_4",
  TRUMP_SELECTION: "trump_selection",
  DEALING_8: "dealing_8",
  BETTING_8: "betting_8",
  PRE_PLAY: "pre_play",
  PLAYING: "playing",
  ROUND_RESOLUTION: "round_resolution",
  SCRUTINY: "scrutiny",
  COMPLETE: "complete",
};

// Bidding actions
const BID_ACTION = {
  BET: "bet",
  PASS: "pass",
  PARTNER: "partner",
  BET_FOR_PARTNER: "bet_for_partner",
  PASS_FOR_PARTNER: "pass_for_partner",
  PCC: "pcc",
};

// Scoring table: bid -> { win, loss }
// win = stone given by betting team on success
// loss = stone received by betting team on failure
const SCORING_TABLE = {
  160: { win: 1, loss: 2, name: "60" },
  170: { win: 1, loss: 2, name: "70" },
  180: { win: 1, loss: 2, name: "80" },
  190: { win: 1, loss: 2, name: "90" },
  200: { win: 2, loss: 3, name: "100" },
  205: { win: 2, loss: 3, name: "105" },
  210: { win: 2, loss: 3, name: "110" },
  215: { win: 2, loss: 3, name: "115" },
  220: { win: 2, loss: 3, name: "Honest" },
  225: { win: 2, loss: 3, name: "Honest 5" },
  230: { win: 2, loss: 3, name: "Honest 10" },
  235: { win: 2, loss: 3, name: "Honest 15" },
  240: { win: 2, loss: 3, name: "Honest 20" },
  245: { win: 2, loss: 3, name: "Honest 25" },
  250: { win: 3, loss: 4, name: "250" },
};

// PCC scoring (separate — not a numeric bid)
const PCC_SCORING = { win: 5, loss: 5, name: "PCC" };

// Minimum bids
const MIN_BID_4_CARD = 160;
const MIN_BID_8_CARD = 220;
const THRESHOLD_4_CARD = 200;  // after first speech, minimum becomes this
const THRESHOLD_8_CARD = 250;  // after first speech, minimum becomes this

// Bid increments
const INCREMENT_BELOW_200 = 10;
const INCREMENT_200_PLUS = 5;

// Reshuffle threshold (4-card hand must be less than this)
const RESHUFFLE_POINT_THRESHOLD = 15;

// Redeal threshold (8-card hand must be less than this)
const REDEAL_POINT_THRESHOLD = 25;

// Max consecutive reshuffles before full shuffle
const MAX_CONSECUTIVE_RESHUFFLES = 3;

// Initial stone per team
const INITIAL_STONE = 10;

// Caps penalties
const WRONG_CAPS_PENALTY = 5;

// Lobby
const CODE_LENGTH = 4;
const MAX_NAME_LENGTH = 12;
const HEARTBEAT_INTERVAL_MS = 30000;
const DISCONNECT_TIMEOUT_MS = 120000;

module.exports = {
  SUITS,
  SUIT_NAMES,
  RANKS,
  POINT_VALUES,
  RANK_POWER,
  TOTAL_POINTS,
  FULL_PACK,
  SEATS,
  TEAMS,
  PHASE,
  BID_ACTION,
  SCORING_TABLE,
  PCC_SCORING,
  MIN_BID_4_CARD,
  MIN_BID_8_CARD,
  THRESHOLD_4_CARD,
  THRESHOLD_8_CARD,
  INCREMENT_BELOW_200,
  INCREMENT_200_PLUS,
  RESHUFFLE_POINT_THRESHOLD,
  REDEAL_POINT_THRESHOLD,
  MAX_CONSECUTIVE_RESHUFFLES,
  INITIAL_STONE,
  WRONG_CAPS_PENALTY,
  CODE_LENGTH,
  MAX_NAME_LENGTH,
  HEARTBEAT_INTERVAL_MS,
  DISCONNECT_TIMEOUT_MS,
};
