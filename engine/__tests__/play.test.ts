import { describe, expect, it } from 'vitest';
import type { CardId } from '../card';
import {
  legalPlays,
  roundPoints,
  roundTurnOrder,
  roundWinner,
  seatsHoldingTrump,
} from '../play';

const c = (s: string): CardId => s as CardId;

describe('legalPlays', () => {
  it('lead: any card may be led when no exhaustion', () => {
    const out = legalPlays({
      hand: [c('Jc'), c('9d'), c('Ah')],
      ledSuit: null,
      trumpSuit: 'h',
      isLead: true,
      seatsWithTrumps: new Set(['north', 'south', 'east', 'west']),
      seat: 'south',
    });
    expect(out).toEqual([c('Jc'), c('9d'), c('Ah')]);
  });

  it('follow: must follow led suit if able', () => {
    const out = legalPlays({
      hand: [c('Jc'), c('7c'), c('Ah')],
      ledSuit: 'c',
      trumpSuit: 'h',
      isLead: false,
      seatsWithTrumps: new Set(['north']),
      seat: 'south',
    });
    expect(out).toEqual([c('Jc'), c('7c')]);
  });

  it('follow: any card if cannot follow', () => {
    const out = legalPlays({
      hand: [c('Jd'), c('7s'), c('Ah')],
      ledSuit: 'c',
      trumpSuit: 'h',
      isLead: false,
      seatsWithTrumps: new Set(['south']),
      seat: 'south',
    });
    expect(out).toEqual([c('Jd'), c('7s'), c('Ah')]);
  });

  it('lead: sole trump-holder must lead trump', () => {
    const out = legalPlays({
      hand: [c('Jh'), c('9c'), c('Ad')],
      ledSuit: null,
      trumpSuit: 'h',
      isLead: true,
      seatsWithTrumps: new Set(['south']),
      seat: 'south',
    });
    expect(out).toEqual([c('Jh')]);
  });

  // §T-1 / §T-6: closed-trump R1 trumper with priority cannot lead trump.
  it('R1 closed-trump trumper-with-priority cannot lead a trump card', () => {
    const out = legalPlays({
      hand: [c('Jh'), c('9h'), c('Ac'), c('10d')],
      ledSuit: null,
      trumpSuit: 'h',
      isLead: true,
      seatsWithTrumps: new Set(['south', 'east']),
      seat: 'south',
      roundNumber: 1,
      trumperSeat: 'south',
      isOpen: false,
    });
    expect(out).toEqual([c('Ac'), c('10d')]);
  });

  it('R1 closed-trump trumper with only trumps yields no legal face-up lead', () => {
    const out = legalPlays({
      hand: [c('Jh'), c('9h'), c('Ah'), c('Kh')],
      ledSuit: null,
      trumpSuit: 'h',
      isLead: true,
      seatsWithTrumps: new Set(['south', 'east']),
      seat: 'south',
      roundNumber: 1,
      trumperSeat: 'south',
      isOpen: false,
    });
    expect(out).toEqual([]);
  });

  // §T-7: open-trump R1 trumper non-PCC must lead trump if any held.
  it('R1 open-trump non-PCC trumper must lead trump when holding any', () => {
    const out = legalPlays({
      hand: [c('Jh'), c('9h'), c('Ac'), c('10d')],
      ledSuit: null,
      trumpSuit: 'h',
      isLead: true,
      seatsWithTrumps: new Set(['south', 'east']),
      seat: 'south',
      roundNumber: 1,
      trumperSeat: 'south',
      isOpen: true,
      isPcc: false,
    });
    expect(out).toEqual([c('Jh'), c('9h')]);
  });

  it('R1 open-trump PCC trumper may lead any card', () => {
    const out = legalPlays({
      hand: [c('Jh'), c('9h'), c('Ac'), c('10d')],
      ledSuit: null,
      trumpSuit: 'h',
      isLead: true,
      seatsWithTrumps: new Set(['south', 'east']),
      seat: 'south',
      roundNumber: 1,
      trumperSeat: 'south',
      isOpen: true,
      isPcc: true,
    });
    expect(out).toEqual([c('Jh'), c('9h'), c('Ac'), c('10d')]);
  });

  it('R2+ trumper: no R1 lead restriction applied', () => {
    const out = legalPlays({
      hand: [c('Jh'), c('Ac')],
      ledSuit: null,
      trumpSuit: 'h',
      isLead: true,
      seatsWithTrumps: new Set(['south', 'east']),
      seat: 'south',
      roundNumber: 3,
      trumperSeat: 'south',
      isOpen: false,
    });
    expect(out).toEqual([c('Jh'), c('Ac')]);
  });
});

describe('roundWinner', () => {
  it('highest led-suit wins when no trump played', () => {
    const winner = roundWinner(
      [
        ['south', c('Kc')],
        ['west', c('7c')],
        ['north', c('9c')],
        ['east', c('Ad')],
      ],
      'h',
    );
    // 9c power=1 beats Kc power=4 in suit clubs
    expect(winner).toBe('north');
  });

  it('any trump beats every non-trump', () => {
    const winner = roundWinner(
      [
        ['south', c('Kc')],
        ['west', c('7h')],
        ['north', c('Ac')],
        ['east', c('Jc')],
      ],
      'h',
    );
    expect(winner).toBe('west');
  });

  it('highest trump wins among multiple trumps', () => {
    const winner = roundWinner(
      [
        ['south', c('Kc')],
        ['west', c('7h')],
        ['north', c('Jh')],
        ['east', c('9h')],
      ],
      'h',
    );
    expect(winner).toBe('north');
  });
});

describe('roundPoints', () => {
  it('sums point values', () => {
    expect(roundPoints([
      ['south', c('Jh')], ['north', c('9h')], ['east', c('Kh')], ['west', c('Qh')],
    ])).toBe(30 + 20 + 3 + 2);
  });
});

describe('roundTurnOrder', () => {
  it('starts from leader, anticlockwise', () => {
    expect(roundTurnOrder('north', null)).toEqual(['north', 'west', 'south', 'east']);
    expect(roundTurnOrder('east', null)).toEqual(['east', 'north', 'west', 'south']);
  });

  it('skips PCC-out seat', () => {
    expect(roundTurnOrder('north', 'south')).toEqual(['north', 'west', 'east']);
  });
});

describe('seatsHoldingTrump', () => {
  it('detects trump holders', () => {
    // Indexed N=0, W=1, S=2, E=3.
    const hands: ReadonlyArray<readonly CardId[]> = [
      [c('Jh'), c('Ac')],
      [c('Qd'), c('Kc')],
      [c('9h')],
      [c('Ks')],
    ];
    const out = seatsHoldingTrump(hands, 'h');
    expect(out).toEqual(new Set(['north', 'south']));
  });

  it('returns empty when no trump', () => {
    const hands: ReadonlyArray<readonly CardId[]> = [[c('Jc')], [], [], []];
    expect(seatsHoldingTrump(hands, null).size).toBe(0);
  });
});
