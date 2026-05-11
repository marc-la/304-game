// End-to-end smoke test for LocalTransport.
// Mirrors the backend's TestBotMatch tests.

import { describe, expect, it } from 'vitest';
import { localTransport } from '../localTransport';

describe('LocalTransport', () => {
  it('reports as healthy and local', async () => {
    expect(localTransport.isLocal).toBe(true);
    expect(await localTransport.isHealthy()).toBe(true);
  });

  it('creates a bot match where bots have auto-played to the human turn', async () => {
    const view = await localTransport.newBotMatch({
      playerId: 'p1',
      seat: 'south',
      dealer: 'north',
    });
    // Dealer=north → west(bot) bids first, passes → south's turn.
    expect(view.phase).toBe('betting_4');
    expect(view.whoseTurn).toBe('south');
    expect(view.hands.south).toHaveLength(4);
    // Other seats redacted to empty list (they're hidden from south).
    expect(view.hands.north).toHaveLength(0);
    expect(view.hands.east).toHaveLength(0);
    expect(view.hands.west).toHaveLength(0);
  });

  it('plays a full bot match end-to-end', async () => {
    let view = await localTransport.newBotMatch({
      playerId: 'p1',
      seat: 'south',
    });
    // South bids 160.
    view = await localTransport.bid('' + view.matchId, 'p1', 'bet', 160);
    expect(view.phase).toBe('trump_selection');

    // Pick south's first card as trump (deterministic).
    const trumpCard = view.hands.south[0].str;
    view = await localTransport.selectTrump(view.matchId, 'p1', trumpCard);
    expect(view.phase).toBe('betting_8');

    // Pass on 8-card.
    view = await localTransport.bid(view.matchId, 'p1', 'pass');
    expect(view.phase).toBe('pre_play');

    // Closed trump.
    view = await localTransport.closedTrump(view.matchId, 'p1');
    expect(view.phase).toBe('playing');
    expect(view.whoseTurn).toBe('south');

    // Play out 8 rounds.
    let guard = 50;
    while (view.phase === 'playing' && guard-- > 0) {
      const valid = view.validPlays.south;
      expect(valid.length).toBeGreaterThan(0);
      view = await localTransport.playCard(
        view.matchId,
        'p1',
        valid[0].str,
      );
    }
    expect(view.phase).toBe('complete');
    expect(view.state.result).not.toBeNull();
  });

  it('rejects actions from the wrong playerId', async () => {
    const view = await localTransport.newBotMatch({ playerId: 'p1' });
    await expect(
      localTransport.bid(view.matchId, 'p2', 'pass'),
    ).rejects.toThrow(/not seated/i);
  });
});
