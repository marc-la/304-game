// Seat navigation: anticlockwise N -> W -> S -> E -> N.
// Partners sit opposite: N/S = team_a, E/W = team_b.

export type Seat = 'north' | 'west' | 'south' | 'east';
export type Team = 'team_a' | 'team_b';

export const ANTICLOCKWISE: readonly Seat[] = [
  'north', 'west', 'south', 'east',
];
export const SEATS = ANTICLOCKWISE;

// SEAT_INDEX is the canonical seat→array-index map. Exported so any
// module that stores per-seat data in a flat Array (e.g. the slim
// EngineGameState.hands, dds-core's hand bitmasks, info.ts World.hands)
// can convert between Seat and 0..3 without re-deriving the order.
// SEATS_BY_INDEX is the inverse — for `for (let i = 0; i < 4; i++)`
// loops that need to round-trip back to a Seat (alias of ANTICLOCKWISE).
export const SEAT_INDEX: Record<Seat, number> = {
  north: 0, west: 1, south: 2, east: 3,
};
export const SEATS_BY_INDEX: readonly Seat[] = ANTICLOCKWISE;

export const nextSeat = (seat: Seat): Seat =>
  ANTICLOCKWISE[(SEAT_INDEX[seat] + 1) % 4];

export const prevSeat = (seat: Seat): Seat =>
  ANTICLOCKWISE[(SEAT_INDEX[seat] + 3) % 4];

export const partnerSeat = (seat: Seat): Seat =>
  ANTICLOCKWISE[(SEAT_INDEX[seat] + 2) % 4];

export const teamOf = (seat: Seat): Team =>
  (seat === 'north' || seat === 'south') ? 'team_a' : 'team_b';

export const sameTeam = (a: Seat, b: Seat): boolean =>
  teamOf(a) === teamOf(b);

// Dealing/play order starting with the player to the dealer's right.
// Mirrors game304.seating.deal_order. Cards are dealt anticlockwise,
// dealer last.
export const dealOrder = (dealer: Seat): Seat[] => {
  const first = nextSeat(dealer);
  const startIdx = SEAT_INDEX[first];
  return [0, 1, 2, 3].map(i => ANTICLOCKWISE[(startIdx + i) % 4]);
};

// Player who cuts the deck — to the dealer's left (clockwise neighbour).
export const cutterSeat = (dealer: Seat): Seat => prevSeat(dealer);
