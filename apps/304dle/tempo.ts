// Bot tempo. Soul §IV.9: tempo is meaning. A uniform delay strips
// out the table's only legal speech act between partners. This
// module returns a per-play delay derived from the bot's decision
// width plus context (partner-winning sluff is fast; trump-cut
// deliberation is slow).
//
// Phase-4 scope: latency only. Phase-5 will layer micro-animation
// tells (hesitation, slow-place) on top of these numbers.

import type { CardId } from '@engine/card';
import { suitOf } from '@engine/card';
import { legalPlays, roundWinner, seatsHoldingTrump } from '@engine/play';
import { SEAT_INDEX, partnerSeat, type Seat } from '@engine/seating';
import type { Runtime } from './runtime';
import { ledSuit as runtimeLedSuit } from './runtime';

export interface BotTempo {
  delayMs: number;
  reason: string; // for debugging / future tell-animations
}

const jitter = (ms: number, frac = 0.15): number => {
  const span = ms * frac;
  return Math.round(ms + (Math.random() * 2 - 1) * span);
};

export const tempoForBotPlay = (rt: Runtime, seat: Seat): BotTempo => {
  const handsArr: ReadonlyArray<CardId>[] = [[], [], [], []];
  for (const s of ['north', 'west', 'south', 'east'] as Seat[]) {
    handsArr[SEAT_INDEX[s]] = rt.hands[s];
  }
  const trumpHolders = seatsHoldingTrump(handsArr, rt.trump.trumpSuit);
  const ledSuitNow = runtimeLedSuit(rt);
  const isLead = rt.currentRound.length === 0;

  const legals = legalPlays({
    hand: rt.hands[seat],
    ledSuit: ledSuitNow,
    trumpSuit: rt.trump.trumpSuit,
    isLead,
    seatsWithTrumps: trumpHolders,
    seat,
  });

  // 1) Forced move — fast snap.
  if (legals.length <= 1) {
    return { delayMs: jitter(280), reason: 'forced' };
  }

  // 2) Partner already winning — bot will sluff cheap. Snappy.
  if (!isLead) {
    const inProgress: Array<readonly [Seat, CardId]> = rt.currentRound
      .filter(e => e.card !== null)
      .map(e => [e.seat, e.card!] as const);
    if (inProgress.length > 0) {
      const winSoFar = roundWinner(inProgress, rt.trump.trumpSuit);
      if (winSoFar === partnerSeat(seat)) {
        return { delayMs: jitter(420), reason: 'partner-winning-sluff' };
      }
    }
  }

  // 3) Trump cut decision — bot must follow off-suit but holds
  //    trump and is on a trick they don't otherwise win.
  if (!isLead && ledSuitNow !== null && ledSuitNow !== rt.trump.trumpSuit) {
    const hasOffLed = rt.hands[seat].some(c => suitOf(c) === ledSuitNow);
    const holdsTrump = rt.hands[seat].some(c => suitOf(c) === rt.trump.trumpSuit);
    if (!hasOffLed && holdsTrump) {
      return { delayMs: jitter(1500), reason: 'trump-cut-decision' };
    }
  }

  // 4) Lead with broad choice — slow deliberation.
  if (isLead && legals.length >= 4) {
    return { delayMs: jitter(1300), reason: 'lead-broad' };
  }

  // 5) General choice — medium beat, scaled by width.
  const scale = Math.min(legals.length, 5);
  const base = 550 + scale * 90; // 4 ⇒ 910, 5 ⇒ 1000
  return { delayMs: jitter(base), reason: `width-${legals.length}` };
};

// Dead air after a card lands, before the next seat starts thinking.
//
// This is the beat the app was missing entirely: `tempoForBotPlay`
// returns a *pre-placement* gap, and App.tsx used to start the next
// seat's timer the moment state committed — while the previous card
// was still animating in. Cards overlapped in flight and a 280ms
// forced play gave the player no time to update a void ledger.
//
// It is deliberately CONSTANT. The pre-placement gap is the tell and
// must stay expressive; this is reading time and must carry no signal
// at all, or it becomes a second, noisier tell.
export const SETTLE_MS = 420;

// How long a completed round stays on the table before play moves on.
//
// Soul §VI.2 preserves "last-round lingering"; §VI.4 forbids countdown
// bars. So the linger is a real duration, but rounds 5–8 do not
// auto-advance at all — past the midpoint the table waits for you.
// The game hurries you while information is cheap and waits when the
// call is expensive, and the hesitation is self-paced, which is the
// thing the puzzle is actually measuring.
//
// The early rounds are where the suit ledger gets built — you are
// watching four cards land and recording who played what of which
// suit. The first pass at this (900–1300ms) swept them away before
// they could be read. These are deliberately generous; a player who
// has already read the trick clicks through, and clicking is always
// available, so the cost of being too slow is nothing while the cost
// of being too fast is an unreadable table.
//
// Returns null when the round must be advanced by the player.
export const lingerMsForRound = (roundNumber: number): number | null => {
  if (roundNumber >= 5) return null;
  return [0, 3000, 2800, 2600, 2400][roundNumber] ?? 2400;
};
