import { describe, expect, it } from 'vitest';
import {
  ANTICLOCKWISE,
  nextSeat,
  partnerSeat,
  prevSeat,
  sameTeam,
  teamOf,
} from '../seating';

describe('seating', () => {
  it('anticlockwise order is N -> W -> S -> E', () => {
    expect(ANTICLOCKWISE).toEqual(['north', 'west', 'south', 'east']);
  });

  it('nextSeat cycles correctly', () => {
    expect(nextSeat('north')).toBe('west');
    expect(nextSeat('west')).toBe('south');
    expect(nextSeat('south')).toBe('east');
    expect(nextSeat('east')).toBe('north');
  });

  it('prevSeat is inverse of nextSeat', () => {
    for (const s of ANTICLOCKWISE) {
      expect(prevSeat(nextSeat(s))).toBe(s);
    }
  });

  it('partnerSeat is opposite', () => {
    expect(partnerSeat('north')).toBe('south');
    expect(partnerSeat('south')).toBe('north');
    expect(partnerSeat('east')).toBe('west');
    expect(partnerSeat('west')).toBe('east');
  });

  it('teamOf groups N/S vs E/W', () => {
    expect(teamOf('north')).toBe('team_a');
    expect(teamOf('south')).toBe('team_a');
    expect(teamOf('east')).toBe('team_b');
    expect(teamOf('west')).toBe('team_b');
  });

  it('sameTeam works for partners', () => {
    expect(sameTeam('north', 'south')).toBe(true);
    expect(sameTeam('north', 'east')).toBe(false);
  });
});
