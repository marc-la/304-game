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
    const hands = new Map([
      ['north' as const, [c('Jh'), c('Ac')] as readonly CardId[]],
      ['west' as const, [c('Qd'), c('Kc')] as readonly CardId[]],
      ['south' as const, [c('9h')] as readonly CardId[]],
      ['east' as const, [c('Ks')] as readonly CardId[]],
    ]);
    const out = seatsHoldingTrump(hands, 'h');
    expect(out).toEqual(new Set(['north', 'south']));
  });

  it('returns empty when no trump', () => {
    const hands = new Map([['north' as const, [c('Jc')] as readonly CardId[]]]);
    expect(seatsHoldingTrump(hands, null).size).toBe(0);
  });
});
