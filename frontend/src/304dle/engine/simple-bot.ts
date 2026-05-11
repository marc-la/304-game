// Simple deterministic bot for vs-bots play. Mirrors game304/bot.py.
//
// The class is intentionally lean — bidding always passes, trump
// selection picks the longest-suit highest-power card, play picks the
// highest-power matching-led-suit card (or lowest-power if leading /
// cannot follow). It exists so the frontend has a working bot when
// the backend is unreachable. The backend uses the Python Bot class
// (same heuristics) and is the canonical implementation; the TS bot
// is a fallback.
//
// `autoPlayBots` walks the phase machine, applying bot decisions
// until it's a human's turn (or the game ends).

import type { CardId, Suit } from './card';
import { powerOf, suitOf } from './card';
import type { Game } from './game';
import type { Seat } from './seating';
import type { BidAction } from './types';

const SUIT_ORDER: Record<Suit, number> = { c: 0, d: 1, h: 2, s: 3 };

export class SimpleBot {
  readonly seat: Seat;
  readonly name: string;

  constructor(seat: Seat, name?: string) {
    this.seat = seat;
    this.name = name ?? `Bot (${seat})`;
  }

  chooseBid(_game: Game): { action: BidAction; value: number } {
    void _game;
    return { action: 'pass', value: 0 };
  }

  chooseTrump(game: Game): CardId {
    const hand = game.getHand(this.seat);
    if (hand.length === 0) {
      throw new Error(`chooseTrump: empty hand for ${this.seat}`);
    }
    const counts: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 };
    for (const card of hand) counts[suitOf(card)]++;
    const suits: Suit[] = ['c', 'd', 'h', 's'];
    const target = suits.reduce((best, s) =>
      counts[s] > counts[best] ||
      (counts[s] === counts[best] && SUIT_ORDER[s] > SUIT_ORDER[best])
        ? s
        : best,
    );
    const suitCards = hand.filter(c => suitOf(c) === target);
    // Lower power index = stronger.
    return suitCards.reduce((best, c) =>
      powerOf(c) < powerOf(best) ? c : best,
    );
  }

  choosePrePlay(_game: Game): 'open' | 'closed' {
    void _game;
    return 'closed';
  }

  choosePlay(game: Game): CardId {
    const valid = game.validPlays(this.seat);
    if (valid.length === 0) {
      throw new Error(`choosePlay: no valid plays for ${this.seat}`);
    }
    const ledSuit = ledSuitFromGame(game);
    if (ledSuit !== null) {
      const matching = valid.filter(c => suitOf(c) === ledSuit);
      if (matching.length > 0) {
        return matching.reduce((best, c) =>
          powerOf(c) < powerOf(best) ? c : best,
        );
      }
    }
    // Leading, or cannot follow: lowest-power card.
    return valid.reduce((best, c) =>
      powerOf(c) > powerOf(best) ? c : best,
    );
  }
}

const ledSuitFromGame = (game: Game): Suit | null => {
  const play = game.state.play;
  if (play === null) return null;
  for (const entry of play.currentRound) {
    if (!entry.faceDown && entry.card !== null) {
      return suitOf(entry.card);
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

// Advance the game by running every bot turn until a human's turn
// (or the game completes). Returns the number of bot actions taken.
// Caller is responsible for `game.dealFour()` at the start of each game;
// dealing the second 4 happens inside `selectTrump`.
export const autoPlayBots = (
  game: Game,
  bots: Map<Seat, SimpleBot>,
): number => {
  let actions = 0;
  let guard = 200;
  while (guard-- > 0) {
    const phase = game.phase;

    if (phase === 'complete' || phase === 'scrutiny') return actions;

    if (phase === 'dealing_4') {
      game.dealFour();
      actions++;
      continue;
    }
    if (phase === 'dealing_8') {
      game.dealEight();
      actions++;
      continue;
    }

    const turnSeat = game.whoseTurn();
    if (turnSeat === null) return actions;
    const bot = bots.get(turnSeat);
    if (bot === undefined) return actions; // human's turn

    if (phase === 'betting_4' || phase === 'betting_8') {
      const { action, value } = bot.chooseBid(game);
      game.placeBid(turnSeat, action, value);
    } else if (phase === 'trump_selection') {
      game.selectTrump(turnSeat, bot.chooseTrump(game));
    } else if (phase === 'pre_play') {
      if (bot.choosePrePlay(game) === 'open') {
        game.declareOpenTrump(turnSeat);
      } else {
        game.proceedClosedTrump(turnSeat);
      }
    } else if (phase === 'playing') {
      game.playCard(turnSeat, bot.choosePlay(game));
    } else {
      return actions;
    }
    actions++;
  }
  throw new Error('autoPlayBots: guard limit exceeded');
};
