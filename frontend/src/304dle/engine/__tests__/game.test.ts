// Unit tests for the new TS Game/Match engine.
//
// Covers:
//  - Bidding edge cases (bid step validation, partner eligibility, PCC,
//    termination, redeal/reshuffle eligibility).
//  - Trump-selection rules (round-1 closed-trump can't lead trump, PCC
//    requires open trump).
//  - Scoring and match completion.
//
// Happy-path engine flow is covered by the parity fixtures
// (parity.test.ts + tools/engine_parity_fixtures.py).

import { describe, expect, it } from 'vitest';

import type { CardId } from '../card';
import {
  CapsError,
  GameError,
  InvalidBidError,
  InvalidPhaseError,
  InvalidTrumpSelectionError,
  NotYourTurnError,
} from '../errors';
import { Game } from '../game';
import { Match } from '../match';
import type { Seat } from '../seating';

// Reference 32-card layout used by the parity fixtures.
const HANDS_A: Record<Seat, CardId[]> = {
  north: ['9h', 'Ah', '10h', 'Kh', 'Qh', '8h', '7h', 'Js'] as CardId[],
  west: ['Jc', '9c', 'Ac', 'Kc', 'Qd', '8c', '7c', 'Jh'] as CardId[],
  south: ['10c', '9d', 'Ad', '10d', 'Kd', 'Jd', '8d', '7d'] as CardId[],
  east: ['9s', 'As', '10s', 'Ks', 'Qs', '8s', '7s', 'Qc'] as CardId[],
};

const seedGame = (
  dealer: Seat = 'north',
  hands: Record<Seat, CardId[]> = HANDS_A,
): Game => {
  const game = new Game({ dealer });
  game.seedDeal({
    north: [...hands.north],
    west: [...hands.west],
    south: [...hands.south],
    east: [...hands.east],
  });
  return game;
};

describe('Game — bidding', () => {
  it('rejects out-of-turn bids', () => {
    const g = seedGame();
    // Order: west (priority), south, east, north.
    expect(() => g.placeBid('south', 'bet', 160)).toThrow(NotYourTurnError);
  });

  it('rejects illegal bid steps', () => {
    const g = seedGame();
    // 165 not on the legal step (160-190 step 10).
    expect(() => g.placeBid('west', 'bet', 165)).toThrow(InvalidBidError);
  });

  it('rejects bids above 250 (only PCC may exceed)', () => {
    const g = seedGame();
    expect(() => g.placeBid('west', 'bet', 260)).toThrow(InvalidBidError);
  });

  it('accepts a valid 160 opening then advances', () => {
    const g = seedGame();
    g.placeBid('west', 'bet', 160);
    expect(g.state.bidding!.highestBid).toBe(160);
    expect(g.state.bidding!.highestBidder).toBe('west');
    expect(g.state.bidding!.currentBidder).toBe('south');
    expect(g.state.bidding!.consecutivePasses).toBe(0);
  });

  it('three passes after a bid + all-spoken ends bidding → trump_selection', () => {
    const g = seedGame();
    g.placeBid('west', 'bet', 160);
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    expect(g.phase).toBe('trump_selection');
    expect(g.state.trump.trumperSeat).toBe('west');
  });

  it('all-pass on 4 cards triggers pass-on (deal moves to next dealer)', () => {
    const g = seedGame();
    g.placeBid('west', 'pass');
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    // pass_on resets to dealing_4 with the next dealer.
    expect(g.phase).toBe('dealing_4');
    expect(g.state.dealer).toBe('west'); // anticlockwise from north.
  });
});

describe('Game — partner action', () => {
  it('only the player at dealer\'s right or across may partner', () => {
    const g = seedGame();
    // Order: west (priority), south, east, north. East is neither
    // priority nor across-from-dealer.
    g.placeBid('west', 'pass');
    g.placeBid('south', 'pass');
    expect(() => g.placeBid('east', 'partner')).toThrow(InvalidBidError);
  });

  it('priority player can partner; partner takes the turn', () => {
    const g = seedGame();
    g.placeBid('west', 'partner');
    // pendingPartner now expects east (west's partner) to bet/pass.
    expect(g.state.bidding!.pendingPartner).toEqual({
      originalSeat: 'west',
      partnerSeat: 'east',
    });
    expect(g.state.bidding!.currentBidder).toBe('east');
  });

  it('cannot partner on 8-card betting', () => {
    const g = seedGame();
    g.placeBid('west', 'bet', 160);
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    g.selectTrump('west', 'Jc' as CardId);
    expect(g.phase).toBe('betting_8');
    // 8-card opening: west to bid first.
    expect(() => g.placeBid('west', 'partner')).toThrow(InvalidBidError);
  });
});

describe('Game — PCC', () => {
  it('rejects PCC on first speech', () => {
    const g = seedGame();
    expect(() => g.placeBid('west', 'pcc')).toThrow(InvalidBidError);
  });

  it('PCC on subsequent speech is accepted', () => {
    const g = seedGame();
    g.placeBid('west', 'bet', 160);
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    g.selectTrump('west', 'Jc' as CardId);
    g.placeBid('west', 'pass'); // first 8-card speech
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass'); // bidding ends, no new 8-card bid → pre_play
    // Re-route: try a different sequence where someone PCCs on second speech.
    const g2 = seedGame();
    g2.placeBid('west', 'bet', 160);
    g2.placeBid('south', 'pass');
    g2.placeBid('east', 'pass');
    g2.placeBid('north', 'pass');
    g2.selectTrump('west', 'Jc' as CardId);
    // 8-card: west speaks first (a pass), then second speech can PCC.
    g2.placeBid('west', 'pass');
    g2.placeBid('south', 'bet', 220);
    g2.placeBid('east', 'pass');
    g2.placeBid('north', 'pass');
    // West now has speech_count = 1 in 8-card phase.
    g2.placeBid('west', 'pcc');
    expect(g2.state.bidding!.isPcc).toBe(true);
    expect(g2.state.bidding!.highestBidder).toBe('west');
  });
});

describe('Game — trump selection', () => {
  it('only the trumper may select trump', () => {
    const g = seedGame();
    g.placeBid('west', 'bet', 160);
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    expect(() =>
      g.selectTrump('south', '10c' as CardId),
    ).toThrow(InvalidTrumpSelectionError);
  });

  it('trump card must be in hand', () => {
    const g = seedGame();
    g.placeBid('west', 'bet', 160);
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    expect(() =>
      g.selectTrump('west', 'Ks' as CardId), // not in west's first 4
    ).toThrow(InvalidTrumpSelectionError);
  });

  it('PCC requires Open Trump (proceedClosedTrump rejected)', () => {
    const g = seedGame();
    g.placeBid('west', 'bet', 160);
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    g.selectTrump('west', 'Jc' as CardId);
    g.placeBid('west', 'pass');
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'bet', 220);
    g.placeBid('west', 'pcc');
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    // PCC supersedes 4-card bid → re-enter trump_selection. The
    // original Jc is no longer in the engine state (Python parity:
    // when old_trumper == pcc_bidder, the original trump card is
    // dropped). West selects a new trump from their remaining cards.
    expect(g.phase).toBe('trump_selection');
    g.selectTrump('west', '9c' as CardId);
    expect(g.phase).toBe('pre_play');
    expect(() => g.proceedClosedTrump('west')).toThrow(
      InvalidTrumpSelectionError,
    );
  });
});

describe('Game — reshuffle / pass-on eligibility', () => {
  it('reshuffle requires <15 points and priority seat', () => {
    // Build a deal where west has a strong hand (>15 points in first 4).
    const g = seedGame();
    expect(() => g.callReshuffle('west')).toThrow(InvalidBidError);
  });

  it('reshuffle with low-points hand resets to dealing_4 (same dealer)', () => {
    const lowHands: Record<Seat, CardId[]> = {
      // West's first 4 = 8c 7c 8d 7d → 0 points.
      north: ['Jc', '9c', 'Ac', '10c', 'Kc', 'Qc', 'Jd', '9d'] as CardId[],
      west: ['8c', '7c', '8d', '7d', 'Jh', '9h', 'Ah', '10h'] as CardId[],
      south: ['Ad', '10d', 'Kd', 'Qd', 'Kh', 'Qh', '8h', '7h'] as CardId[],
      east: ['Js', '9s', 'As', '10s', 'Ks', 'Qs', '8s', '7s'] as CardId[],
    };
    const g = seedGame('north', lowHands);
    g.callReshuffle('west');
    expect(g.phase).toBe('dealing_4');
    expect(g.state.dealer).toBe('north'); // same dealer
    expect(g.state.consecutiveReshuffles).toBe(1);
  });

  it('pass-on (8-card) requires <25 points', () => {
    const g = seedGame();
    g.placeBid('west', 'bet', 160);
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    g.selectTrump('west', 'Jc' as CardId);
    // West's 8-card is strong; pass-on rejected.
    expect(() => g.callRedeal8('west')).toThrow(InvalidBidError);
  });
});

describe('Game — caps', () => {
  it('rejects caps if team has lost a round', () => {
    // Force an opposition-win scenario, then attempt caps from the
    // losing team. We script a flow where round 1 goes to north (south
    // can't follow) then south tries to call caps.
    const g = seedGame();
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
    // Round 1: west leads Jh. North (partner of south) follows hearts, beats with… let it play out.
    g.playCard('west', 'Jh' as CardId);
    g.playCard('south', '7d' as CardId);
    g.playCard('east', '7s' as CardId);
    g.playCard('north', '9h' as CardId);
    // West won round 1 (Jh > 9h). South is on team_a (lost), can't call caps.
    expect(() =>
      g.callCaps('south', g.getHand('south')),
    ).toThrow(CapsError);
  });
});

describe('Game — absolute hand and spoilt trumps', () => {
  it('absolute hand can only be declared in pre_play', () => {
    const g = seedGame();
    expect(() => g.callAbsoluteHand('west')).toThrow(InvalidPhaseError);
  });

  it('absolute hand declared in pre_play voids the game', () => {
    const g = seedGame();
    g.placeBid('west', 'bet', 160);
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    g.selectTrump('west', 'Jc' as CardId);
    g.placeBid('west', 'pass');
    g.placeBid('south', 'pass');
    g.placeBid('east', 'pass');
    g.placeBid('north', 'pass');
    g.callAbsoluteHand('west');
    expect(g.phase).toBe('complete');
    expect(g.state.result?.reason).toBe('absolute_hand');
    expect(g.state.result?.stoneExchanged).toBe(0);
  });
});

describe('Match', () => {
  it('starts with 10 stone each and rotates dealer', () => {
    const m = new Match({ firstDealer: 'north' });
    const g1 = m.newGame();
    expect(m.stone).toEqual({ team_a: 10, team_b: 10 });
    expect(g1.state.dealer).toBe('north');

    // Force completion of g1 with a dummy result so newGame() advances.
    g1.state.phase = 'complete';
    g1.state.result = {
      reason: 'bid_met',
      stoneExchanged: 1,
      stoneDirection: 'give',
      winnerTeam: 'team_a',
      description: 'test',
    };
    // Apply stone change manually to mirror what _finalizeGame would have done.
    g1.state.stone.team_a = 9;

    const g2 = m.newGame();
    expect(g2.state.dealer).toBe('west'); // anticlockwise from north
    expect(g2.state.gameNumber).toBe(2);
    expect(m.stone).toEqual({ team_a: 9, team_b: 10 });
    expect(m.isComplete()).toBe(false);
  });

  it('completes when one team reaches 0 stone', () => {
    const m = new Match({ firstDealer: 'north' });
    const g1 = m.newGame();
    g1.state.phase = 'complete';
    g1.state.stone.team_a = 0;
    g1.state.result = {
      reason: 'bid_met',
      stoneExchanged: 10,
      stoneDirection: 'give',
      winnerTeam: 'team_a',
      description: 'test',
    };
    expect(m.isComplete()).toBe(true);
    expect(() => m.newGame()).toThrow(GameError);
  });
});
