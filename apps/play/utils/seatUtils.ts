import type { Seat } from '../types/game';
import { ANTICLOCKWISE } from '../types/game';

/**
 * Get the visual position of a seat relative to the viewer.
 * The activeSeat is always at the bottom ('south' position visually).
 * Returns: 'bottom' | 'left' | 'top' | 'right'
 */
export type VisualPosition = 'bottom' | 'left' | 'top' | 'right';

const POSITION_MAP: VisualPosition[] = ['bottom', 'right', 'top', 'left'];

export function getVisualPosition(seat: Seat, activeSeat: Seat): VisualPosition {
  const activeIdx = ANTICLOCKWISE.indexOf(activeSeat);
  const seatIdx = ANTICLOCKWISE.indexOf(seat);
  // How many steps from active seat (anticlockwise)
  const offset = (seatIdx - activeIdx + 4) % 4;
  return POSITION_MAP[offset];
}

export function getPartner(seat: Seat): Seat {
  const idx = ANTICLOCKWISE.indexOf(seat);
  return ANTICLOCKWISE[(idx + 2) % 4];
}

export function nextSeat(seat: Seat): Seat {
  const idx = ANTICLOCKWISE.indexOf(seat);
  return ANTICLOCKWISE[(idx + 1) % 4];
}
