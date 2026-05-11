// Game-phase and bidding-action enums. Mirrors game304/types.py.
// Suit/Rank live in card.ts; Seat/Team live in seating.ts.

export type Phase =
  | 'dealing_4'
  | 'betting_4'
  | 'trump_selection'
  | 'dealing_8'
  | 'betting_8'
  | 'pre_play'
  | 'playing'
  | 'round_resolution'
  | 'scrutiny'
  | 'complete';

export const PHASES: readonly Phase[] = [
  'dealing_4',
  'betting_4',
  'trump_selection',
  'dealing_8',
  'betting_8',
  'pre_play',
  'playing',
  'round_resolution',
  'scrutiny',
  'complete',
];

export type BidAction =
  | 'bet'
  | 'pass'
  | 'partner'
  | 'bet_for_partner'
  | 'pass_for_partner'
  | 'pcc';
