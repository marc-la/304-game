// Heuristic bot for opponent (and pre-classifier) play. Deterministic
// given (seed, history). Intentionally weak — strong defense kills
// caps lines. Plays legally and plausibly, with light noise.

import type { CardId, Suit } from './card';
import { pointsOf, powerOf, suitOf } from './card';
import { legalPlays, roundWinner, seatsHoldingTrump } from './play';
import type { Seat } from './seating';
import { partnerSeat } from './seating';
import type { EngineGameState } from './state';

export interface BotContext {
  seat: Seat;
  hand: ReadonlyArray<CardId>;
  state: EngineGameState;
  rng: () => number;
}

const lowestByPoints = (cards: ReadonlyArray<CardId>): CardId =>
  [...cards].sort(
    (a, b) => pointsOf(a) - pointsOf(b) || powerOf(b) - powerOf(a),
  )[0];

// Would my card outrank the current best in the round so far?
// Pure function: needs no sentinel seats.
const cardWinsTrick = (
  candidate: CardId,
  ledSuit: Suit,
  trump: Suit | null,
  inProgress: ReadonlyArray<readonly [Seat, CardId]>,
): boolean => {
  // Treat trump-or-led-suit ranking. If trumps are present, only trump
  // beats trump and trumps always beat led. Otherwise highest led-suit wins.
  const cards = inProgress.map(([, c]) => c);
  const trumpsPresent = trump !== null && cards.some(c => suitOf(c) === trump);
  const isCandTrump = trump !== null && suitOf(candidate) === trump;

  if (trumpsPresent) {
    if (!isCandTrump) return false;
    const minPower = Math.min(
      ...cards.filter(c => suitOf(c) === trump).map(powerOf),
    );
    return powerOf(candidate) < minPower;
  }
  if (isCandTrump) return true;
  if (suitOf(candidate) !== ledSuit) return false;
  const minLedPower = Math.min(
    ...cards.filter(c => suitOf(c) === ledSuit).map(powerOf),
  );
  return powerOf(candidate) < minLedPower;
};

const cheapestWinnerVs = (
  candidates: ReadonlyArray<CardId>,
  ledSuit: Suit,
  trump: Suit | null,
  inProgress: ReadonlyArray<readonly [Seat, CardId]>,
): CardId | null => {
  const sorted = [...candidates].sort(
    (a, b) => pointsOf(a) - pointsOf(b) || powerOf(b) - powerOf(a),
  );
  for (const c of sorted) {
    if (cardWinsTrick(c, ledSuit, trump, inProgress)) return c;
  }
  return null;
};

const wouldWinIfPlayed = (
  candidate: CardId,
  ledSuit: Suit | null,
  trump: Suit | null,
  inProgress: ReadonlyArray<readonly [Seat, CardId]>,
): boolean => {
  if (inProgress.length === 0) return true;
  return cardWinsTrick(candidate, ledSuit!, trump, inProgress);
};

const partnerIsWinning = (
  seat: Seat,
  trump: Suit | null,
  inProgress: ReadonlyArray<readonly [Seat, CardId]>,
): boolean => {
  if (inProgress.length === 0) return false;
  const w = roundWinner(inProgress, trump);
  return w === partnerSeat(seat);
};

const longestNonTrumpSuit = (
  hand: ReadonlyArray<CardId>,
  trump: Suit | null,
): Suit | null => {
  const counts: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 };
  let any = false;
  for (const c of hand) {
    if (trump !== null && suitOf(c) === trump) continue;
    counts[suitOf(c)]++;
    any = true;
  }
  if (!any) return null;
  const order: Suit[] = ['c', 'd', 'h', 's'];
  let best: Suit = order[0];
  for (const s of order) if (counts[s] > counts[best]) best = s;
  return counts[best] > 0 ? best : null;
};

export const chooseBotPlay = (ctx: BotContext): CardId => {
  const { seat, hand, state, rng } = ctx;
  const cur = state.play.currentRound;
  const ledSuit: Suit | null =
    cur.length > 0 && cur[0].card !== null ? suitOf(cur[0].card) : null;
  const isLead = cur.length === 0;
  const trump = state.trump.trumpSuit;
  const allHands = state.hands;
  const trumpHolders = seatsHoldingTrump(allHands, trump);

  const legal = legalPlays({
    hand,
    ledSuit,
    trumpSuit: trump,
    isLead,
    seatsWithTrumps: trumpHolders,
    seat,
  });

  if (legal.length === 1) return legal[0];

  // Light noise: occasionally pick a random legal play.
  if (rng() < 0.07) {
    const idx = Math.floor(rng() * legal.length);
    return legal[idx];
  }

  const inProgressTyped: Array<readonly [Seat, CardId]> = cur
    .filter(e => e.card !== null)
    .map(e => [e.seat, e.card!]);

  // Rule: partner currently winning → sluff lowest-pointed legal card.
  if (!isLead && partnerIsWinning(seat, trump, inProgressTyped)) {
    return lowestByPoints(legal);
  }

  // Rule: I can take the trick cheaply when there are points showing.
  if (!isLead) {
    const points = inProgressTyped.reduce((s, [, c]) => s + pointsOf(c), 0);
    if (points >= 5) {
      const winner = cheapestWinnerVs(legal, ledSuit!, trump, inProgressTyped);
      if (winner !== null) return winner;
    }
  }

  // Rule: cut when rich (off-suit, hold ≥2 trumps, points ≥10, opp winning).
  if (!isLead && trump !== null) {
    const ledHolders = legal.filter(c => suitOf(c) === ledSuit);
    if (ledHolders.length === 0) {
      const trumps = legal.filter(c => suitOf(c) === trump);
      const points = inProgressTyped.reduce((s, [, c]) => s + pointsOf(c), 0);
      if (
        trumps.length >= 2 &&
        points >= 10 &&
        !partnerIsWinning(seat, trump, inProgressTyped)
      ) {
        // Check that cutting would actually win.
        const cheapTrump = lowestByPoints(trumps);
        if (wouldWinIfPlayed(cheapTrump, ledSuit, trump, inProgressTyped)) {
          return cheapTrump;
        }
      }
    }
  }

  // Lead rule: lead from longest non-trump suit, lowest non-Jack card.
  if (isLead) {
    const ls = longestNonTrumpSuit(hand, trump);
    if (ls !== null) {
      const candidates = legal.filter(c => suitOf(c) === ls);
      const ranked = [...candidates].sort((a, b) => {
        // prefer non-J, low points
        const aJ = a.startsWith('J') ? 1 : 0;
        const bJ = b.startsWith('J') ? 1 : 0;
        return aJ - bJ || pointsOf(a) - pointsOf(b);
      });
      if (ranked.length > 0) return ranked[0];
    }
    // All trumps → lead lowest trump.
    return lowestByPoints(legal);
  }

  // Default: lowest-pointed legal.
  return lowestByPoints(legal);
};
