// Closed-trump runtime tests. Covers initial state, face-down
// visibility for non-trumpers, §T9 trump reveal mid-game, and the
// folded-card sink when the trumper cuts with it.

import { describe, expect, it } from 'vitest';
import type { CardId } from '@engine/card';
import { applyPlay, newRuntime, resolveRound, toEngineState } from '../runtime';
import { buildInfoSet } from '@engine/info';

const c = (s: string): CardId => s as CardId;

describe('closed-trump runtime', () => {
  it('initial state: folded card on table, not in hand, not open', () => {
    const rt = newRuntime({
      hands: {
        // South would normally have Jh — folded on the table in closed.
        south: [c('9h'), c('Ah'), c('Kc')],
        north: [c('Qh'), c('10h'), c('8c')],
        west:  [c('10c'), c('7c'), c('Ac')],
        east:  [c('Jc'), c('9c'), c('9d')],
      },
      trumpSuit: 'h',
      trumpCard: c('Jh'),
      trumperSeat: 'south',
      priority: 'east',
      script: [],
      mode: 'closed',
    });
    expect(rt.trump.trumpCardInHand).toBe(false);
    expect(rt.trump.isRevealed).toBe(false);
    expect(rt.trump.isOpen).toBe(false);
    expect(rt.trump.trumpCard).toBe('Jh');
    expect(rt.hands.south).not.toContain('Jh');
  });

  it('face-down play does not leak identity to non-trumpers', () => {
    const rt = newRuntime({
      hands: {
        south: [c('Ah'), c('Kc'), c('9d')],
        north: [c('Qh'), c('10h'), c('8c')],
        west:  [c('10c'), c('7c'), c('Ac')],
        east:  [c('Jc'), c('9c'), c('Js')],
      },
      trumpSuit: 'h',
      trumpCard: c('Jh'),
      trumperSeat: 'south',
      priority: 'east',
      script: [],
      mode: 'closed',
    });
    // East leads Js — only east has spades. North/west/south can't
    // follow → face-down. North plays Qh face-down (illegal in real
    // play since trumper-partner doesn't have §T-4 restrictions on
    // face-down trumps, but engine allows it). For this test we
    // care that non-trumpers can't read others' face-down cards.
    applyPlay(rt, 'east', c('Js'), false);
    applyPlay(rt, 'north', c('8c'), true);    // minus
    applyPlay(rt, 'west',  c('Ac'), true);    // minus
    applyPlay(rt, 'south', c('Kc'), true);    // minus

    // East (non-trumper) cannot see south's face-down card identity.
    const eastInfo = buildInfoSet(toEngineState(rt), 'east');
    expect(eastInfo.knownPlayed.has(c('Kc'))).toBe(false);

    // South (own play) sees their own card.
    const southInfo = buildInfoSet(toEngineState(rt), 'south');
    expect(southInfo.knownPlayed.has(c('Kc'))).toBe(true);
  });

  it('§T9: a face-down trump triggers public reveal, folded card lifts to hand', () => {
    const rt = newRuntime({
      hands: {
        south: [c('Ah'), c('Kc'), c('9d')],
        north: [c('Qh'), c('10h'), c('8c')],
        west:  [c('10c'), c('7c'), c('Ac')],
        east:  [c('9h'), c('Jd'), c('Js')],    // east has 9h trump
      },
      trumpSuit: 'h',
      trumpCard: c('Jh'),
      trumperSeat: 'south',
      priority: 'south',
      script: [],
      mode: 'closed',
    });
    // South leads Kc. North follows 8c. West follows Ac (wins so far).
    // East can't follow (no clubs) → cuts with 9h face-down.
    applyPlay(rt, 'south', c('Kc'), false);
    applyPlay(rt, 'north', c('8c'), false);
    applyPlay(rt, 'west',  c('Ac'), false);
    applyPlay(rt, 'east',  c('9h'), true);

    resolveRound(rt);

    expect(rt.trump.isRevealed).toBe(true);
    expect(rt.trump.isOpen).toBe(true);
    // Folded Jh wasn't played, so it moves to south's hand.
    expect(rt.trump.trumpCardInHand).toBe(true);
    expect(rt.hands.south).toContain(c('Jh'));

    const r1 = rt.completedRounds[0];
    const eastEntry = r1.cards.find(e => e.seat === 'east')!;
    expect(eastEntry.revealed).toBe(true);
    expect(r1.trumpRevealed).toBe(true);
    expect(r1.winner).toBe('east');  // 9h beats clubs
  });

  it('trumper plays the folded trump as a face-down cut: slot empties', () => {
    const rt = newRuntime({
      hands: {
        south: [c('Kc'), c('Qc')],     // no in-hand trump
        north: [c('Qh'), c('10h')],
        west:  [c('Ac'), c('7c')],
        east:  [c('Ad'), c('7d')],
      },
      trumpSuit: 'h',
      trumpCard: c('Jh'),
      trumperSeat: 'south',
      priority: 'east',
      script: [],
      mode: 'closed',
    });
    // East leads Ad. North can't follow (all hearts) → minus Qh face-down.
    // West can't follow (clubs) → minus 7c face-down.
    // South can't follow either, and §T-4 forbids folding in-hand
    // trumps — south has none anyway. South cuts with the folded Jh.
    applyPlay(rt, 'east',  c('Ad'), false);
    applyPlay(rt, 'north', c('Qh'), true);
    applyPlay(rt, 'west',  c('7c'), true);
    applyPlay(rt, 'south', c('Jh'), true);

    // Folded card slot now empty.
    expect(rt.trump.trumpCard).toBeNull();

    resolveRound(rt);

    expect(rt.trump.isRevealed).toBe(true);
    expect(rt.trump.isOpen).toBe(true);
    // Folded card was PLAYED, not picked up: trumpCardInHand stays
    // false; the card is in the completed round.
    expect(rt.trump.trumpCardInHand).toBe(false);
    expect(rt.completedRounds[0].winner).toBe('south');
  });

  it('the engine treats trumper as info-privileged for face-down identities post-round', () => {
    // After resolve, completedRound.cards has the face-down entries.
    // viewerKnowsIdentity should return true for the trumper viewing
    // a non-revealed face-down minus in a completed round.
    const rt = newRuntime({
      hands: {
        south: [c('Ah'), c('Kc'), c('9d')],
        north: [c('Qh'), c('10h'), c('8c')],
        west:  [c('10c'), c('7c'), c('Ac')],
        east:  [c('9c'), c('Jd'), c('Js')],
      },
      trumpSuit: 'h',
      trumpCard: c('Jh'),
      trumperSeat: 'south',
      priority: 'east',
      script: [],
      mode: 'closed',
    });
    // East leads Js. Others minus non-trump face-downs (no §T9
    // reveal because nothing was trump).
    applyPlay(rt, 'east', c('Js'), false);
    applyPlay(rt, 'north', c('8c'), true);
    applyPlay(rt, 'west',  c('Ac'), true);
    applyPlay(rt, 'south', c('Kc'), true);
    resolveRound(rt);

    // South (trumper) knows the identities of all face-down plays in
    // the completed round — per caps-formalism §3 clause 6.
    const southInfo = buildInfoSet(toEngineState(rt), 'south');
    expect(southInfo.knownPlayed.has(c('8c'))).toBe(true);   // north's minus
    expect(southInfo.knownPlayed.has(c('Ac'))).toBe(true);   // west's minus

    // East (non-trumper) does NOT learn those identities.
    const eastInfo = buildInfoSet(toEngineState(rt), 'east');
    expect(eastInfo.knownPlayed.has(c('8c'))).toBe(false);
    expect(eastInfo.knownPlayed.has(c('Ac'))).toBe(false);
  });
});
