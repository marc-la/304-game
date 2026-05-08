// Closed-trump bot decisions. Wraps the engine's chooseBotPlay with
// face-down logic for the closed-trump mode: when a player cannot
// follow the led suit, they must play face-down, choosing between a
// "cut" (trump-suit card face-down, attempts to win) and a "minus"
// (non-trump non-led-suit card face-down, concedes the round).
//
// Trumper-specific constraints (rules.md §T-1..§T-6):
//   §T-2: the folded trump card may only be played face-down to cut a
//         non-trump round, or as the trumper's last card on round 8.
//   §T-3: when trumper can't follow, choice is cut (folded card) or
//         minus (non-trump non-led card from hand).
//   §T-4: the trumper cannot fold in-hand trump-suit cards. In-hand
//         trumps must be played face-up.
//   §T-5: when led suit IS the trump suit and trumper has in-hand
//         trumps, must follow normally with a face-up in-hand trump.
//   §T-6: when led suit IS the trump suit and trumper has only the
//         folded trump card, must minus a non-trump.

import { pointsOf, powerOf, suitOf } from '../../frontend/src/304dle/engine/card';
import type { CardId, Suit } from '../../frontend/src/304dle/engine/card';
import type { Seat } from '../../frontend/src/304dle/engine/seating';
import { partnerSeat } from '../../frontend/src/304dle/engine/seating';
import type { EngineGameState } from '../../frontend/src/304dle/engine/state';

export interface ClosedTrumpPlay {
  card: CardId;
  faceDown: boolean;
}

export interface ClosedTrumpBotArgs {
  seat: Seat;
  hand: ReadonlyArray<CardId>;     // seat's in-hand cards (trumper's 7 if folded card on table)
  state: EngineGameState;
  rng: () => number;
}

const lowestByPoints = (cards: ReadonlyArray<CardId>): CardId =>
  [...cards].sort((a, b) => pointsOf(a) - pointsOf(b) || powerOf(b) - powerOf(a))[0];

const highestByPower = (cards: ReadonlyArray<CardId>): CardId =>
  [...cards].sort((a, b) => powerOf(a) - powerOf(b))[0];

const lowestByPower = (cards: ReadonlyArray<CardId>): CardId =>
  [...cards].sort((a, b) => powerOf(b) - powerOf(a))[0];

// Return the highest face-up card in the in-progress round, or null
// if empty. Used to decide if our played card would win.
const inProgressBest = (
  state: EngineGameState,
  trump: Suit,
): { card: CardId | null; ledSuit: Suit | null } => {
  const cur = state.play.currentRound;
  if (cur.length === 0) return { card: null, ledSuit: null };
  let ledSuit: Suit | null = null;
  for (const e of cur) {
    if (!e.faceDown && e.card !== null) {
      ledSuit = suitOf(e.card);
      break;
    }
  }
  // Find the best face-up card under standard ranking (trump > led suit).
  // Face-down cards in closed trump are unknown to the seat playing
  // next, so we only rank from face-up.
  const faceUp = cur.filter(e => !e.faceDown && e.card !== null).map(e => e.card!);
  if (faceUp.length === 0) return { card: null, ledSuit };
  const trumps = faceUp.filter(c => suitOf(c) === trump);
  if (trumps.length > 0) return { card: highestByPower(trumps), ledSuit };
  if (ledSuit === null) return { card: null, ledSuit };
  const led = faceUp.filter(c => suitOf(c) === ledSuit);
  if (led.length === 0) return { card: faceUp[0], ledSuit };
  return { card: highestByPower(led), ledSuit };
};

const partnerWinningHeuristic = (
  state: EngineGameState,
  seat: Seat,
  trump: Suit,
): boolean => {
  // Best face-up card's seat — heuristic only (face-down cards unknown).
  const cur = state.play.currentRound;
  if (cur.length === 0) return false;
  const ptr = partnerSeat(seat);
  let bestSeat: Seat | null = null;
  let bestCard: CardId | null = null;
  let ledSuit: Suit | null = null;
  for (const e of cur) {
    if (!e.faceDown && e.card !== null) {
      ledSuit = suitOf(e.card);
      break;
    }
  }
  for (const e of cur) {
    if (e.faceDown || e.card === null) continue;
    const c = e.card;
    if (bestCard === null) {
      bestCard = c;
      bestSeat = e.seat;
      continue;
    }
    const cT = suitOf(c) === trump;
    const bT = suitOf(bestCard) === trump;
    if (cT && !bT) { bestCard = c; bestSeat = e.seat; continue; }
    if (!cT && bT) continue;
    if (cT && bT) {
      if (powerOf(c) < powerOf(bestCard)) { bestCard = c; bestSeat = e.seat; }
      continue;
    }
    // both non-trump
    if (ledSuit !== null && suitOf(c) === ledSuit && suitOf(bestCard) !== ledSuit) {
      bestCard = c; bestSeat = e.seat; continue;
    }
    if (ledSuit !== null && suitOf(c) !== ledSuit && suitOf(bestCard) === ledSuit) continue;
    if (powerOf(c) < powerOf(bestCard)) { bestCard = c; bestSeat = e.seat; }
  }
  return bestSeat === ptr;
};

export const chooseClosedTrumpPlay = (
  args: ClosedTrumpBotArgs,
): ClosedTrumpPlay => {
  const { seat, hand, state, rng } = args;
  const trump = state.trump.trumpSuit;
  const trumperSeat = state.trump.trumperSeat;
  const isTrumper = seat === trumperSeat;
  const foldedCardOnTable = state.trump.trumpCard !== null && !state.trump.trumpCardInHand;
  const foldedCard = foldedCardOnTable ? state.trump.trumpCard! : null;

  const cur = state.play.currentRound;
  const isLead = cur.length === 0;
  const { ledSuit } = inProgressBest(state, trump);

  // Leading: face-up only. Defer to existing heuristic style — lead
  // longest non-trump suit lowest non-J card; all-trump → lowest trump.
  if (isLead) {
    const handsLen = state.hands.get(seat)?.length ?? hand.length;
    void handsLen;
    // §T-1: closed-trump trumper cannot lead trump on round 1 from
    // priority. We check completedRounds.length === 0 to detect R1.
    const isR1 = state.play.completedRounds.length === 0;
    const restrictTrumpLead = isR1 && isTrumper && state.play.priority === seat;

    const nonTrumps = hand.filter(c => suitOf(c) !== trump);
    if (nonTrumps.length > 0) {
      const sorted = [...nonTrumps].sort((a, b) =>
        powerOf(a) - powerOf(b) || pointsOf(a) - pointsOf(b),
      );
      // Prefer non-J first.
      const nonJ = sorted.find(c => !c.startsWith('J'));
      return { card: nonJ ?? sorted[0], faceDown: false };
    }
    if (restrictTrumpLead) {
      // Edge: trumper has only trump but can't lead trump on R1. The
      // rules require Open Trump declaration for this; but in our
      // simulator we accept it as a degenerate trumper-leads-trump
      // play (rare; the bot should not generate this state often).
    }
    return { card: lowestByPoints(hand), faceDown: false };
  }

  // Following — can we follow the led suit (face-up required)?
  const ledMatches = hand.filter(c => suitOf(c) === ledSuit);
  if (ledMatches.length > 0) {
    // Must follow face-up. Pick best card by simple rule.
    if (partnerWinningHeuristic(state, seat, trump)) {
      return { card: lowestByPoints(ledMatches), faceDown: false };
    }
    // Try to win cheaply.
    const winners = ledMatches.filter(c => {
      const best = inProgressBest(state, trump).card;
      if (best === null) return true;
      const aT = suitOf(c) === trump;
      const bT = suitOf(best) === trump;
      if (aT && !bT) return true;
      if (!aT && bT) return false;
      return powerOf(c) < powerOf(best);
    });
    if (winners.length > 0) {
      return { card: lowestByPower(winners), faceDown: false };
    }
    return { card: lowestByPoints(ledMatches), faceDown: false };
  }

  // Cannot follow. Must play face-down (closed trump).
  // Decide between cut and minus.
  const points = cur.reduce((s, e) =>
    s + (!e.faceDown && e.card !== null ? pointsOf(e.card) : 0), 0);
  const partnerWinning = partnerWinningHeuristic(state, seat, trump);

  if (isTrumper) {
    // §T-3, §T-4: trumper can cut with folded card OR minus with
    // non-trump in-hand card. Cannot fold in-hand trumps.
    const inHandNonTrump = hand.filter(c => suitOf(c) !== trump);
    const canCut = foldedCard !== null && ledSuit !== trump;
    const wantsCut = !partnerWinning && points >= 5 && rng() < 0.5;
    if (canCut && (wantsCut || inHandNonTrump.length === 0)) {
      return { card: foldedCard!, faceDown: true };
    }
    if (inHandNonTrump.length > 0) {
      return { card: lowestByPoints(inHandNonTrump), faceDown: true };
    }
    // Forced: only in-hand trumps left. §T-4 forbids folding them,
    // so we must cut with the folded card if available.
    if (foldedCard !== null) {
      return { card: foldedCard, faceDown: true };
    }
    // Pathological: no in-hand non-trumps and no folded card. Should
    // not occur in valid scenarios. Play any in-hand card face-down
    // as a fallback to keep the simulator advancing.
    return { card: lowestByPoints(hand), faceDown: true };
  }

  // Non-trumper: cut with any in-hand trump, or minus non-led non-trump.
  const inHandTrumps = hand.filter(c => suitOf(c) === trump);
  const inHandNonTrumpNonLed = hand.filter(c =>
    suitOf(c) !== trump && suitOf(c) !== ledSuit,
  );
  const canCut = inHandTrumps.length > 0;
  const wantsCut = !partnerWinning && points >= 10 && rng() < 0.5;

  if (canCut && (wantsCut || inHandNonTrumpNonLed.length === 0)) {
    return { card: lowestByPoints(inHandTrumps), faceDown: true };
  }
  if (inHandNonTrumpNonLed.length > 0) {
    return { card: lowestByPoints(inHandNonTrumpNonLed), faceDown: true };
  }
  // Only trumps left — must cut.
  if (inHandTrumps.length > 0) {
    return { card: lowestByPoints(inHandTrumps), faceDown: true };
  }
  // Fallback (shouldn't happen): play anything face-down.
  return { card: lowestByPoints(hand), faceDown: true };
};
