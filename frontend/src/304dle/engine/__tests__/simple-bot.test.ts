// Unit tests for the TS SimpleBot and autoPlayBots orchestration.

import { describe, expect, it } from 'vitest';

import type { CardId } from '../card';
import { Game } from '../game';
import type { Seat } from '../seating';
import { SimpleBot, autoPlayBots } from '../simple-bot';

// Reference 32-card layout matching parity fixtures.
const HANDS: Record<Seat, CardId[]> = {
  north: ['9h', 'Ah', '10h', 'Kh', 'Qh', '8h', '7h', 'Js'] as CardId[],
  west: ['Jc', '9c', 'Ac', 'Kc', 'Qd', '8c', '7c', 'Jh'] as CardId[],
  south: ['10c', '9d', 'Ad', '10d', 'Kd', 'Jd', '8d', '7d'] as CardId[],
  east: ['9s', 'As', '10s', 'Ks', 'Qs', '8s', '7s', 'Qc'] as CardId[],
};

const seedGame = (): Game => {
  const g = new Game({ dealer: 'north' });
  g.seedDeal({
    north: [...HANDS.north],
    west: [...HANDS.west],
    south: [...HANDS.south],
    east: [...HANDS.east],
  });
  return g;
};

// Run west-bids-160 then west-trumps-Jc then all-pass-8-card then closed
// trump. After this helper, phase=playing, current_turn=west (priority).
const setupClosedTrumpGame = (g: Game) => {
  g.placeBid('west', 'bet', 160);
  g.placeBid('south', 'pass');
  g.placeBid('east', 'pass');
  g.placeBid('north', 'pass');
  g.selectTrump('west', 'Jc' as CardId);
  g.placeBid('west', 'pass');
  g.placeBid('south', 'pass');
  g.placeBid('east', 'pass');
  g.placeBid('north', 'pass');
  g.proceedClosedTrump('west');
};

describe('SimpleBot', () => {
  it('chooseBid always passes', () => {
    const g = seedGame();
    const bot = new SimpleBot('west');
    expect(bot.chooseBid(g)).toEqual({ action: 'pass', value: 0 });
  });

  it('chooseTrump picks the longest suit, highest-power card', () => {
    const g = seedGame();
    // North's first 4 (post-seedDeal): 9h, Ah, 10h, Kh — all hearts.
    // Longest suit = hearts. Highest power: 9h (power=1).
    const bot = new SimpleBot('north');
    expect(bot.chooseTrump(g)).toBe('9h');
  });

  it('choosePlay matches led suit with highest-power card', () => {
    const g = seedGame();
    setupClosedTrumpGame(g);
    // West leads (priority = dealer's right; dealer=north).
    // Closed trump round 1: west cannot lead trump (Jc removed; west's
    // remaining = 9c Ac Kc Qd 8c 7c Jh). Leads Jh (the only non-trump
    // and a high card).
    g.playCard('west', 'Jh' as CardId);
    // South can't follow hearts. Plays anything.
    g.playCard('south', '7d' as CardId);
    // East can't follow. Plays.
    g.playCard('east', '7s' as CardId);
    // North's turn. North has hearts: 9h, Ah, 10h, Kh, Qh, 8h, 7h.
    // Highest power = 9h (power 1; only Jh=0 is stronger and is on table).
    const nBot = new SimpleBot('north');
    expect(nBot.choosePlay(g)).toBe('9h');
  });

  it('choosePlay plays lowest-power valid card when cannot follow', () => {
    const g = seedGame();
    setupClosedTrumpGame(g);
    g.playCard('west', 'Jh' as CardId);
    // South can't follow hearts. South's hand: 10c, 9d, Ad, 10d, Kd, Jd, 8d, 7d.
    // Lowest power: 8d (power 6) and 7d (power 7). 7d has the highest
    // power index → lowest card. SimpleBot picks 7d.
    const sBot = new SimpleBot('south');
    expect(sBot.choosePlay(g)).toBe('7d');
  });
});

describe('autoPlayBots', () => {
  it('runs a full match-step with user-as-south', () => {
    const g = seedGame();
    const bots = new Map<Seat, SimpleBot>([
      ['north', new SimpleBot('north')],
      ['west', new SimpleBot('west')],
      ['east', new SimpleBot('east')],
    ]);

    expect(g.phase).toBe('betting_4');
    expect(g.whoseTurn()).toBe('west');

    // Bot west passes; loop yields to south.
    autoPlayBots(g, bots);
    expect(g.whoseTurn()).toBe('south');

    // South bids 160 → bot east passes, bot north passes, bot west passes again
    // → 3 consecutive passes, all spoken → trump_selection.
    g.placeBid('south', 'bet', 160);
    autoPlayBots(g, bots);
    expect(g.phase).toBe('trump_selection');
    expect(g.whoseTurn()).toBe('south');

    // South's first 4: 10c, 9d, Ad, 10d. Pick 9d as trump (longest = diamonds, highest power = 9d).
    g.selectTrump('south', '9d' as CardId);
    expect(g.phase).toBe('betting_8');

    // 8-card: west passes first, then south's turn.
    autoPlayBots(g, bots);
    expect(g.whoseTurn()).toBe('south');
    g.placeBid('south', 'pass');

    // East/north/west pass → no new 8-card bid → pre_play.
    autoPlayBots(g, bots);
    expect(g.phase).toBe('pre_play');
    expect(g.whoseTurn()).toBe('south');

    g.proceedClosedTrump('south');
    expect(g.phase).toBe('playing');

    // Auto-play bots until south's turn (south has priority? Dealer=north → priority=west).
    // West leads first. After west, south. So autoPlayBots will play west,
    // stop on south.
    autoPlayBots(g, bots);
    expect(g.whoseTurn()).toBe('south');

    // Auto-play the rest with south using the same simple heuristic.
    const sBot = new SimpleBot('south');
    let guard = 50;
    while (g.phase === 'playing' && guard-- > 0) {
      g.playCard('south', sBot.choosePlay(g));
      autoPlayBots(g, bots);
    }
    expect(g.phase).toBe('complete');
    expect(g.state.result).not.toBeNull();
  });
});
