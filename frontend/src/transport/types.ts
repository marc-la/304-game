// Transport interface — the abstraction over "where the game state
// lives". Two implementations:
//
//   - BackendTransport — forwards every action to /api endpoints.
//
//   - LocalTransport — runs an in-memory Game/Match + SimpleBot in
//     the browser. Used as a fallback when the backend is unreachable.
//
// The method names match the original `api` object in gameApi.ts
// exactly, so swapping the active transport at runtime is transparent
// to existing call sites in gameStore.

import type {
  BidAction,
  CardData,
  GameView,
  Seat,
} from '../types/game';

export interface NewBotMatchOptions {
  playerId: string;
  seat?: Seat;
  seed?: number | null;
  dealer?: Seat;
}

export interface Transport {
  /** True if this transport runs locally (no backend). */
  readonly isLocal: boolean;

  /** Liveness — for diagnostics. Always true for LocalTransport. */
  isHealthy(): Promise<boolean>;

  /** Start a new match against bots. Local mode handles this entirely
   *  in-browser; backend mode hits /api/match/new-bots. */
  newBotMatch(opts: NewBotMatchOptions): Promise<GameView>;

  /** Solo/test match (no roster, no auth). Backend-only —
   *  LocalTransport throws if called. */
  newMatch(seed?: number, dealer?: Seat): Promise<GameView>;

  newGame(matchId: string, playerId: string): Promise<GameView>;
  getState(matchId: string, playerId: string): Promise<GameView>;
  deal(matchId: string, playerId: string): Promise<GameView>;
  bid(
    matchId: string,
    playerId: string,
    action: BidAction,
    value?: number,
  ): Promise<GameView>;
  reshuffle(matchId: string, playerId: string): Promise<GameView>;
  redeal8(matchId: string, playerId: string): Promise<GameView>;
  selectTrump(
    matchId: string,
    playerId: string,
    card: string,
  ): Promise<GameView>;
  openTrump(
    matchId: string,
    playerId: string,
    revealCard?: string,
  ): Promise<GameView>;
  closedTrump(matchId: string, playerId: string): Promise<GameView>;
  playCard(
    matchId: string,
    playerId: string,
    card: string,
  ): Promise<GameView>;
  callCaps(
    matchId: string,
    playerId: string,
    playOrder: string[],
  ): Promise<GameView>;
  spoiltTrumps(matchId: string, playerId: string): Promise<GameView>;
  absoluteHand(matchId: string, playerId: string): Promise<GameView>;
  getValidPlays(
    matchId: string,
    playerId: string,
    seat: Seat,
  ): Promise<{ cards: CardData[] }>;
}
