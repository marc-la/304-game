// Scoring table, bid thresholds, and stone-exchange constants.
// Mirrors game304/constants.py.

export const TOTAL_POINTS = 304;

// Bidding thresholds and increments
export const MIN_BID_4_CARD = 160;
export const MIN_BID_8_CARD = 220;
export const THRESHOLD_4_CARD = 200;
export const THRESHOLD_8_CARD = 250;
export const INCREMENT_BELOW_200 = 10;
export const INCREMENT_200_PLUS = 5;
export const PCC_BID_VALUE = 999;

// Reshuffle / redeal thresholds
export const RESHUFFLE_POINT_THRESHOLD = 15;
export const REDEAL_POINT_THRESHOLD = 25;
export const MAX_CONSECUTIVE_RESHUFFLES = 3;

// Match scoring
export const INITIAL_STONE = 10;
export const WRONG_CAPS_PENALTY = 5;

export interface ScoringEntry {
  win: number;
  loss: number;
  name: string;
}

export const SCORING_TABLE: Record<number, ScoringEntry> = {
  160: { win: 1, loss: 2, name: '60' },
  170: { win: 1, loss: 2, name: '70' },
  180: { win: 1, loss: 2, name: '80' },
  190: { win: 1, loss: 2, name: '90' },
  200: { win: 2, loss: 3, name: '100' },
  205: { win: 2, loss: 3, name: '105' },
  210: { win: 2, loss: 3, name: '110' },
  215: { win: 2, loss: 3, name: '115' },
  220: { win: 2, loss: 3, name: 'Honest' },
  225: { win: 2, loss: 3, name: 'Honest 5' },
  230: { win: 2, loss: 3, name: 'Honest 10' },
  235: { win: 2, loss: 3, name: 'Honest 15' },
  240: { win: 2, loss: 3, name: 'Honest 20' },
  245: { win: 2, loss: 3, name: 'Honest 25' },
  250: { win: 3, loss: 4, name: '250' },
};

export const PCC_SCORING: ScoringEntry = { win: 5, loss: 5, name: 'PCC' };
