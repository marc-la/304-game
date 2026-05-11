// Match orchestrator — a series of Games until one team has 0 stone.
// Mirrors game304/game.py:Match.

import { INITIAL_STONE } from './constants';
import { makeRandom, type Random } from './deck';
import { GameError } from './errors';
import { Game } from './game';
import { nextSeat } from './seating';
import type { Seat, Team } from './seating';

export interface MatchOptions {
  firstDealer?: Seat;
  rng?: Random;
}

export class Match {
  private _rng: Random;
  private _stone: Record<Team, number>;
  private _games: Game[] = [];
  private _nextDealer: Seat;
  private _currentGame: Game | null = null;

  constructor(opts: MatchOptions = {}) {
    this._rng = opts.rng ?? makeRandom(Date.now() | 0);
    this._stone = { team_a: INITIAL_STONE, team_b: INITIAL_STONE };
    this._nextDealer = opts.firstDealer ?? 'north';
  }

  get stone(): Record<Team, number> {
    return { ...this._stone };
  }

  get games(): Game[] {
    return [...this._games];
  }

  get currentGame(): Game | null {
    return this._currentGame;
  }

  isComplete(): boolean {
    let stone = this._stone;
    if (
      this._currentGame !== null &&
      this._currentGame.phase === 'complete'
    ) {
      stone = this._currentGame.state.stone;
    }
    return stone.team_a <= 0 || stone.team_b <= 0;
  }

  winner(): Team | null {
    if (this._stone.team_a <= 0) return 'team_a';
    if (this._stone.team_b <= 0) return 'team_b';
    return null;
  }

  newGame(): Game {
    if (this._currentGame !== null) {
      if (this._currentGame.phase !== 'complete') {
        throw new GameError('Current game is not complete.');
      }
      this._games.push(this._currentGame);
      this._stone = { ...this._currentGame.state.stone };
      this._nextDealer = nextSeat(this._currentGame.state.dealer);
    }
    if (this.isComplete()) {
      throw new GameError('Match is already complete.');
    }
    const game = new Game({
      dealer: this._nextDealer,
      stone: { ...this._stone },
      rng: this._rng,
      gameNumber: this._games.length + 1,
    });
    this._currentGame = game;
    return game;
  }
}
