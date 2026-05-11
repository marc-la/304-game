// LocalTransport — runs Game + Match + SimpleBot entirely in-browser.
// Method names match the legacy `api` object exactly.

import type { CardId } from '../304dle/engine/card';
import { pointsOf, rankOf, suitOf } from '../304dle/engine/card';
import { Match } from '../304dle/engine/match';
import { autoPlayBots, SimpleBot } from '../304dle/engine/simple-bot';
import { SEATS } from '../304dle/engine/seating';
import type { Seat } from '../304dle/engine/seating';
import type {
  BidAction,
  CardData,
  GameView,
} from '../types/game';
import { serializeGameView } from './viewSerializer';
import type {
  NewBotMatchOptions,
  Transport,
} from './types';

interface LocalMatchState {
  match: Match;
  bots: Map<Seat, SimpleBot>;
  humanSeat: Seat;
  humanPlayerId: string;
}

const matches = new Map<string, LocalMatchState>();

const newMatchId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const getMatch = (matchId: string, playerId: string): LocalMatchState => {
  const ms = matches.get(matchId);
  if (!ms) throw new Error(`Local match not found: ${matchId}`);
  if (ms.humanPlayerId !== playerId) {
    throw new Error('Player not seated in this match.');
  }
  return ms;
};

const view = (matchId: string): GameView => {
  const ms = matches.get(matchId);
  if (!ms) throw new Error(`Local match not found: ${matchId}`);
  const game = ms.match.currentGame!;
  return serializeGameView(matchId, game, ms.humanSeat, {
    matchComplete: ms.match.isComplete(),
    matchWinner: ms.match.winner(),
    gameCount: ms.match.games.length + (ms.match.currentGame ? 1 : 0),
  });
};

const advanceBots = (ms: LocalMatchState): void => {
  if (ms.match.currentGame === null) return;
  autoPlayBots(ms.match.currentGame, ms.bots);
};

const toCardData = (c: CardId): CardData => ({
  rank: rankOf(c),
  suit: suitOf(c),
  str: c,
  points: pointsOf(c),
});

export const localTransport: Transport = {
  isLocal: true,

  async isHealthy() {
    return true;
  },

  async newBotMatch(opts: NewBotMatchOptions): Promise<GameView> {
    const humanSeat: Seat = opts.seat ?? 'south';
    const dealer: Seat = opts.dealer ?? 'north';
    const match = new Match({ firstDealer: dealer });
    match.newGame();

    const bots = new Map<Seat, SimpleBot>();
    for (const seat of SEATS) {
      if (seat !== humanSeat) bots.set(seat, new SimpleBot(seat));
    }

    const matchId = newMatchId();
    const ms: LocalMatchState = {
      match,
      bots,
      humanSeat,
      humanPlayerId: opts.playerId,
    };
    matches.set(matchId, ms);

    advanceBots(ms);
    return view(matchId);
  },

  async newMatch(): Promise<GameView> {
    throw new Error(
      'newMatch (solo backend match) is not supported in local mode. Use newBotMatch.',
    );
  },

  async newGame(matchId: string, playerId: string): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.newGame();
    advanceBots(ms);
    return view(matchId);
  },

  async getState(matchId: string, playerId: string): Promise<GameView> {
    getMatch(matchId, playerId);
    return view(matchId);
  },

  async deal(matchId: string, playerId: string): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.dealFour();
    advanceBots(ms);
    return view(matchId);
  },

  async bid(
    matchId: string,
    playerId: string,
    action: BidAction,
    value?: number,
  ): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.placeBid(ms.humanSeat, action, value ?? 0);
    advanceBots(ms);
    return view(matchId);
  },

  async reshuffle(matchId: string, playerId: string): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.callReshuffle(ms.humanSeat);
    advanceBots(ms);
    return view(matchId);
  },

  async redeal8(matchId: string, playerId: string): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.callRedeal8(ms.humanSeat);
    advanceBots(ms);
    return view(matchId);
  },

  async selectTrump(
    matchId: string,
    playerId: string,
    card: string,
  ): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.selectTrump(ms.humanSeat, card as CardId);
    advanceBots(ms);
    return view(matchId);
  },

  async openTrump(
    matchId: string,
    playerId: string,
    revealCard?: string,
  ): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.declareOpenTrump(
      ms.humanSeat,
      (revealCard as CardId | undefined) ?? null,
    );
    advanceBots(ms);
    return view(matchId);
  },

  async closedTrump(matchId: string, playerId: string): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.proceedClosedTrump(ms.humanSeat);
    advanceBots(ms);
    return view(matchId);
  },

  async playCard(
    matchId: string,
    playerId: string,
    card: string,
  ): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.playCard(ms.humanSeat, card as CardId);
    advanceBots(ms);
    return view(matchId);
  },

  async callCaps(
    matchId: string,
    playerId: string,
    playOrder: string[],
  ): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.callCaps(ms.humanSeat, playOrder as CardId[]);
    advanceBots(ms);
    return view(matchId);
  },

  async spoiltTrumps(matchId: string, playerId: string): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.callSpoiltTrumps(ms.humanSeat);
    advanceBots(ms);
    return view(matchId);
  },

  async absoluteHand(matchId: string, playerId: string): Promise<GameView> {
    const ms = getMatch(matchId, playerId);
    ms.match.currentGame!.callAbsoluteHand(ms.humanSeat);
    advanceBots(ms);
    return view(matchId);
  },

  async getValidPlays(
    matchId: string,
    _playerId: string,
    seat: Seat,
  ): Promise<{ cards: CardData[] }> {
    const ms = matches.get(matchId);
    if (!ms) throw new Error(`Local match not found: ${matchId}`);
    const cards = ms.match.currentGame!.validPlays(seat).map(toCardData);
    return { cards };
  },
};
