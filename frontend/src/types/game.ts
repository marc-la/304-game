// TypeScript types mirroring game304 Python types

export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank = 'J' | '9' | 'A' | '10' | 'K' | 'Q' | '8' | '7';
export type Seat = 'north' | 'west' | 'south' | 'east';
export type Team = 'team_a' | 'team_b';
export type BidAction = 'bet' | 'pass' | 'partner' | 'bet_for_partner' | 'pass_for_partner' | 'pcc';

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

export interface CardData {
  rank: Rank;
  suit: Suit;
  str: string;
  points: number;
}

export interface Speech {
  seat: Seat;
  action: BidAction;
  value: number | null;
  speech_number: number;
  on_behalf_of: Seat | null;
}

export interface PlayerBidState {
  speech_count: number;
  has_partnered: boolean;
  partner_used_by: Seat | null;
  skipped: boolean;
}

export interface PendingPartnerResponse {
  original_seat: Seat;
  partner_seat: Seat;
}

export interface BiddingState {
  is_four_card: boolean;
  current_bidder: Seat;
  highest_bid: number;
  highest_bidder: Seat | null;
  consecutive_passes: number;
  speeches: Speech[];
  player_state: Record<Seat, PlayerBidState>;
  is_pcc: boolean;
  pending_partner: PendingPartnerResponse | null;
  four_card_bid: number | null;
  four_card_bidder: Seat | null;
}

export interface TrumpState {
  trumper_seat: Seat | null;
  trump_suit: Suit | null;
  trump_card: CardData | null;
  is_revealed: boolean;
  is_open: boolean;
  trump_card_in_hand: boolean;
}

export interface RoundEntry {
  seat: Seat;
  card: CardData;
  face_down: boolean;
  revealed: boolean;
}

export interface CompletedRound {
  round_number: number;
  cards: RoundEntry[];
  winner: Seat;
  points_won: number;
  trump_revealed: boolean;
}

export interface CapsObligation {
  obligated_at_round: number;
  obligated_at_card: number;
}

export interface CapsCall {
  called_by: Seat;
  called_at_round: number;
  play_order: CardData[];
  is_external: boolean;
  result: string | null;
}

export interface PlayState {
  round_number: number;
  priority: Seat | null;
  current_turn: Seat | null;
  current_round: RoundEntry[];
  completed_rounds: CompletedRound[];
  points_won: Record<Team, number>;
  caps_call: CapsCall | null;
  caps_obligations: Record<Seat, CapsObligation>;
}

export interface GameResult {
  reason: string;
  stone_exchanged: number;
  stone_direction: string;
  winner_team: Team | null;
  description: string;
  trumper_points: number | null;
  opposition_points: number | null;
  bid: number | null;
  caps_by: Seat | null;
}

export interface GameState {
  game_number: number;
  dealer: Seat;
  phase: Phase;
  stone: Record<Team, number>;
  hands: Record<Seat, CardData[]>;
  deck: null;
  trump: TrumpState;
  bidding: BiddingState | null;
  play: PlayState | null;
  result: GameResult | null;
  consecutive_reshuffles: number;
  pcc_partner_out: Seat | null;
}

export interface GameView {
  matchId: string;
  phase: Phase;
  whoseTurn: Seat | null;
  state: GameState;
  hands: Record<Seat, CardData[]>;
  validPlays: Record<Seat, CardData[]>;
  matchComplete: boolean;
  matchWinner: Team | null;
  gameCount: number;
  completedRound?: CompletedRound;
}

export interface LogEntry {
  id: number;
  message: string;
  type: 'info' | 'bid' | 'play' | 'result' | 'error' | 'trump';
  seat?: Seat;
  team?: Team;
}

// Constants
export const SEATS: Seat[] = ['north', 'west', 'south', 'east'];
export const ANTICLOCKWISE: Seat[] = ['north', 'west', 'south', 'east'];

export const SUIT_SYMBOLS: Record<Suit, string> = {
  c: '\u2663', // ♣
  d: '\u2666', // ♦
  h: '\u2665', // ♥
  s: '\u2660', // ♠
};

export const SUIT_NAMES: Record<Suit, string> = {
  c: 'Clubs', d: 'Diamonds', h: 'Hearts', s: 'Spades',
};

export const SEAT_NAMES: Record<Seat, string> = {
  north: 'North', west: 'West', south: 'South', east: 'East',
};

export const TEAM_SEATS: Record<Team, [Seat, Seat]> = {
  team_a: ['north', 'south'],
  team_b: ['east', 'west'],
};

export const SEAT_TEAM: Record<Seat, Team> = {
  north: 'team_a', south: 'team_a',
  east: 'team_b', west: 'team_b',
};

export const RANK_ORDER: Rank[] = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];

export const BID_NAMES: Record<number, string> = {
  160: '60', 170: '70', 180: '80', 190: '90',
  200: '100', 205: '105', 210: '110', 215: '115',
  220: 'Honest', 225: 'Honest 5', 230: 'Honest 10',
  235: 'Honest 15', 240: 'Honest 20', 245: 'Honest 25',
  250: '250', 999: 'PCC',
};
