// Game orchestrator for 304. Mirrors game304/game.py:Game.
//
// Owns a GameState and exposes action methods that validate,
// delegate to engine modules, and manage phase transitions.

import { trackCapsObligation, validateCapsCall } from './caps';
import type { CardId } from './card';
import {
  INITIAL_STONE,
  WRONG_CAPS_PENALTY,
} from './constants';
import { Deck, makeRandom, type Random } from './deck';
import {
  CapsError,
  GameError,
  InvalidPhaseError,
} from './errors';
import {
  checkRedeal8Eligibility,
  checkReshuffleEligibility,
  initBiddingState,
  needsFullShuffle,
  placeBid,
  type BiddingTransition,
} from './bidding';
import {
  advanceAfterRound,
  advanceTurn,
  checkSpoiltTrumps,
  getValidPlays,
  isRoundComplete,
  resolveCurrentRound,
  validateAndPlay,
} from './play-engine';
import {
  applyStoneChanges,
  calculateCapsResult,
  calculateResult,
} from './scoring';
import {
  dealOrder,
  nextSeat,
  partnerSeat,
  SEATS,
  teamOf,
} from './seating';
import type { Seat, Team } from './seating';
import type {
  CompletedRound,
  EngineGameState,
  EnginePlayState,
  EngineTrumpState,
  GameResult,
  GameState,
} from './state';
import {
  newPlayState,
  newTrumpState,
} from './state';
import {
  declareOpenTrump as _declareOpenTrump,
  proceedClosedTrump as _proceedClosedTrump,
  selectTrump as _selectTrump,
} from './trump';
import type { BidAction, Phase } from './types';

export interface GameOptions {
  dealer?: Seat;
  stone?: Record<Team, number>;
  rng?: Random;
  gameNumber?: number;
}

const ALL_SEATS: ReadonlyArray<Seat> = SEATS;

// ---------------------------------------------------------------------------
// Projection: GameState → EngineGameState
// ---------------------------------------------------------------------------
//
// Used to call play-phase pure functions that operate on the slim
// EngineGameState (caps.ts, bot.ts, dd.ts, etc.). Only meaningful
// when state.phase is PLAYING (or post-play scrutiny). The viewer
// argument controls hand redaction; pass `null` for the omniscient
// "engine-internal" view used by caps validation.
export const toEngineState = (state: GameState): EngineGameState => {
  const trump = state.trump;
  const engineTrump: EngineTrumpState = {
    trumperSeat: trump.trumperSeat!,
    trumpSuit: trump.trumpSuit!,
    trumpCard: trump.trumpCard,
    trumpCardInHand: trump.trumpCardInHand,
    isRevealed: trump.isRevealed,
    isOpen: trump.isOpen,
  };

  const play = state.play!;
  const enginePlay: EnginePlayState = {
    roundNumber: play.roundNumber,
    priority: play.priority!,
    currentRound: play.currentRound,
    completedRounds: play.completedRounds,
    pointsWon: play.pointsWon,
    capsObligations: play.capsObligations,
  };

  const hands = new Map<Seat, ReadonlyArray<CardId>>();
  for (const seat of ALL_SEATS) {
    hands.set(seat, state.hands[seat] ?? []);
  }

  return {
    hands,
    trump: engineTrump,
    play: enginePlay,
    pccPartnerOut: state.pccPartnerOut,
  };
};

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

export class Game {
  private _state: GameState;
  private _rng: Random;

  constructor(opts: GameOptions = {}) {
    this._rng = opts.rng ?? makeRandom(Date.now() | 0);
    this._state = {
      gameNumber: opts.gameNumber ?? 1,
      dealer: opts.dealer ?? 'north',
      phase: 'dealing_4',
      stone:
        opts.stone ?? { team_a: INITIAL_STONE, team_b: INITIAL_STONE },
      hands: { north: [], west: [], south: [], east: [] },
      deck: null,
      trump: newTrumpState(),
      bidding: null,
      play: null,
      result: null,
      consecutiveReshuffles: 0,
      pccPartnerOut: null,
    };
  }

  get state(): GameState {
    return this._state;
  }

  get phase(): Phase {
    return this._state.phase;
  }

  // ---------------------------------------------------------------------
  // Test/fixture helper — inject pre-shuffled hands and skip the deck.
  // ---------------------------------------------------------------------
  //
  // Used by parity fixtures and unit tests where the deal is fixed by
  // the test author rather than produced by the in-engine shuffle.
  // Caller supplies all 4 seats' 8-card hands; the engine treats this
  // as "after deal_four + select_trump's deal_eight" — i.e. ready for
  // 4-card betting. Trump is not yet selected.
  //
  // For tests that want to exercise just the play phase, prefer
  // `seedPlayPhase` below.
  seedDeal(hands: Record<Seat, CardId[]>): void {
    if (this._state.phase !== 'dealing_4') {
      throw new InvalidPhaseError('seedDeal must be called pre-deal.');
    }
    // Take only 4 cards each into the hands; the rest go into a synthetic
    // deck that select_trump's deal_eight will draw from.
    const firstFour: Record<Seat, CardId[]> = {
      north: [],
      west: [],
      south: [],
      east: [],
    };
    const reserve: CardId[] = [];
    for (const seat of ALL_SEATS) {
      const all = hands[seat];
      if (all.length !== 8) {
        throw new GameError(
          `seedDeal expects 8 cards per seat, got ${all.length} for ${seat}.`,
        );
      }
      firstFour[seat] = all.slice(0, 4);
      reserve.push(...all.slice(4));
    }
    this._state.hands = firstFour;

    // Build a synthetic deck whose dealOrder pop-batched output equals
    // each seat's reserve cards. The deal order is anticlockwise from
    // dealer's right.
    const order = dealOrder(this._state.dealer);
    const deckCards: CardId[] = [];
    for (const seat of order) {
      const all = hands[seat];
      deckCards.push(...all.slice(4));
    }
    void reserve; // unused; kept for clarity
    const deck = new Deck([], this._rng);
    deck.setOrder(deckCards);
    this._state.deck = deck;

    this._state.phase = 'betting_4';
    this._state.bidding = initBiddingState(order[0], true);
  }

  // ---------------------------------------------------------------------
  // Dealing
  // ---------------------------------------------------------------------

  dealFour(): Record<Seat, CardId[]> {
    if (this._state.phase !== 'dealing_4') {
      throw new InvalidPhaseError('Not in the dealing phase.');
    }
    const deck = new Deck(undefined, this._rng);
    if (needsFullShuffle(this._state)) {
      deck.fullShuffle();
      this._state.consecutiveReshuffles = 0;
    } else {
      deck.minimalShuffle();
    }
    deck.cut();
    this._state.deck = deck;

    const hands = deck.deal(this._state.dealer, 4);
    this._state.hands = {
      north: [...hands.north],
      west: [...hands.west],
      south: [...hands.south],
      east: [...hands.east],
    };

    this._state.phase = 'betting_4';
    const order = dealOrder(this._state.dealer);
    this._state.bidding = initBiddingState(order[0], true);
    return hands;
  }

  dealEight(): Record<Seat, CardId[]> {
    if (this._state.phase !== 'dealing_8') {
      throw new InvalidPhaseError('Not in the 8-card dealing phase.');
    }
    const deck = this._state.deck;
    if (deck === null) throw new GameError('No deck available for dealing.');
    const hands = deck.popN(16);
    // Re-batch in dealing order (4 each).
    const order = dealOrder(this._state.dealer);
    const result: Record<Seat, CardId[]> = {
      north: [],
      west: [],
      south: [],
      east: [],
    };
    let i = 0;
    for (const seat of order) {
      const cards = hands.slice(i, i + 4);
      i += 4;
      result[seat] = cards;
      if (this._state.hands[seat] === undefined) this._state.hands[seat] = [];
      this._state.hands[seat].push(...cards);
    }
    this._state.phase = 'betting_8';
    return result;
  }

  // ---------------------------------------------------------------------
  // Bidding
  // ---------------------------------------------------------------------

  placeBid(seat: Seat, action: BidAction, value = 0): void {
    const transition = placeBid(this._state, seat, action, value);
    if (transition !== null) this._handleBiddingTransition(transition);
  }

  callReshuffle(seat: Seat): void {
    checkReshuffleEligibility(this._state, seat);
    this._state.consecutiveReshuffles += 1;
    this._resetForDeal(true);
  }

  callRedeal8(seat: Seat): void {
    checkRedeal8Eligibility(this._state, seat);
    this._resetForDeal(false);
  }

  // ---------------------------------------------------------------------
  // Trump
  // ---------------------------------------------------------------------

  selectTrump(seat: Seat, card: CardId): void {
    _selectTrump(this._state, seat, card);
    if (this._state.phase === 'betting_8') {
      // Initialise 8-card bidding (carrying forward 4-card bid context).
      const order = dealOrder(this._state.dealer);
      const fourCardBid = this._state.bidding?.highestBid ?? null;
      const fourCardBidder = this._state.bidding?.highestBidder ?? null;
      this._state.bidding = initBiddingState(
        order[0],
        false,
        fourCardBid,
        fourCardBidder,
      );
    }
  }

  declareOpenTrump(seat: Seat, revealCard: CardId | null = null): void {
    _declareOpenTrump(this._state, seat, revealCard);
  }

  proceedClosedTrump(seat: Seat): void {
    _proceedClosedTrump(this._state, seat);
  }

  // ---------------------------------------------------------------------
  // Play
  // ---------------------------------------------------------------------

  playCard(seat: Seat, card: CardId): CompletedRound | null {
    validateAndPlay(this._state, seat, card);

    // Track caps obligation for every eligible seat (mirrors Python).
    this._trackCapsObligationsAllSeats();

    if (isRoundComplete(this._state)) {
      const completed = resolveCurrentRound(this._state);
      const gameOver = advanceAfterRound(this._state, completed);
      // Re-track after round resolution: trump may have been revealed.
      this._trackCapsObligationsAllSeats();
      if (gameOver) this._finalizeGame();
      return completed;
    }
    advanceTurn(this._state, seat);
    return null;
  }

  callCaps(seat: Seat, playOrder: ReadonlyArray<CardId>): void {
    if (this._state.phase !== 'playing') {
      throw new InvalidPhaseError('Not in play phase.');
    }
    const play = this._state.play;
    if (play === null) {
      throw new InvalidPhaseError('Play state not initialised.');
    }

    const myTeam = teamOf(seat);
    const trumperTeam = teamOf(this._state.trump.trumperSeat!);
    const isExternal = myTeam !== trumperTeam;

    const hasLost = play.completedRounds.some(
      r => teamOf(r.winner) !== myTeam,
    );
    if (hasLost) {
      throw new CapsError(
        'Cannot call Caps — your team has already lost a round.',
      );
    }

    const myHand = this._state.hands[seat] ?? [];
    const sortedOrder = [...playOrder].sort();
    const sortedHand = [...myHand].sort();
    if (
      sortedOrder.length !== sortedHand.length ||
      sortedOrder.some((c, i) => c !== sortedHand[i])
    ) {
      throw new CapsError(
        'Play order must contain exactly your remaining cards.',
      );
    }

    const engine = toEngineState(this._state);
    const isValid = validateCapsCall(engine, seat, [...playOrder]);

    // Determine result classification.
    const isLate = ((): boolean => {
      const ob = play.capsObligations.get(seat);
      if (!ob) return false;
      const playedInCurrent = play.currentRound.some(e => e.seat === seat);
      const vPlaysNow = (play.roundNumber - 1) + (playedInCurrent ? 1 : 0);
      return vPlaysNow > ob.vPlaysAtObligation;
    })();

    play.capsCall = {
      calledBy: seat,
      calledAtRound: play.roundNumber,
      playOrder: [...playOrder],
      isExternal,
      result: !isValid ? 'wrong_early' : isLate ? 'late' : 'correct',
    };

    const result = calculateCapsResult(this._state, seat, isValid, isExternal);
    this._state.result = result;
    this._state.phase = 'complete';

    if (!isValid) {
      this._state.stone[myTeam] += WRONG_CAPS_PENALTY;
    } else {
      applyStoneChanges(this._state.stone, result, trumperTeam);
    }
  }

  callSpoiltTrumps(seat: Seat): void {
    if (
      this._state.phase !== 'playing' &&
      this._state.phase !== 'pre_play'
    ) {
      throw new InvalidPhaseError(
        'Can only call Spoilt Trumps during play.',
      );
    }
    const play = this._state.play;
    if (play !== null) {
      const expected = this._state.pccPartnerOut !== null ? 3 : 4;
      if (play.roundNumber === 8 && play.currentRound.length >= expected) {
        throw new GameError(
          'Too late to call Spoilt Trumps — the last card has been played.',
        );
      }
    }

    if (checkSpoiltTrumps(this._state)) {
      this._state.phase = 'complete';
      this._state.result = {
        reason: 'spoilt_trumps',
        stoneExchanged: 0,
        stoneDirection: 'none',
        winnerTeam: null,
        description:
          'Spoilt Trumps — opposition held zero trump cards from the deal.',
      };
      return;
    }

    // False call: 1-stone penalty to caller's team. Game continues.
    this.applyPenalty(teamOf(seat), 1);
  }

  applyPenalty(team: Team, stones = 1): void {
    if (stones < 0) {
      throw new GameError('Penalty stones must be non-negative.');
    }
    this._state.stone[team] = (this._state.stone[team] ?? 0) + stones;
  }

  callAbsoluteHand(seat: Seat): void {
    if (this._state.phase !== 'pre_play') {
      throw new InvalidPhaseError(
        'Absolute Hand can only be declared before play begins.',
      );
    }
    void seat;
    this._state.phase = 'complete';
    this._state.result = {
      reason: 'absolute_hand',
      stoneExchanged: 0,
      stoneDirection: 'none',
      winnerTeam: null,
      description:
        'Absolute Hand declared — redeal with no stone exchanged.',
    };
  }

  // ---------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------

  getHand(seat: Seat): CardId[] {
    return [...(this._state.hands[seat] ?? [])];
  }

  validPlays(seat: Seat): CardId[] {
    return getValidPlays(this._state, seat);
  }

  whoseTurn(): Seat | null {
    const phase = this._state.phase;
    if (phase === 'betting_4' || phase === 'betting_8') {
      return this._state.bidding?.currentBidder ?? null;
    }
    if (phase === 'playing') {
      return this._state.play?.currentTurn ?? null;
    }
    if (phase === 'trump_selection' || phase === 'pre_play') {
      return this._state.trump.trumperSeat ?? null;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private _trackCapsObligationsAllSeats(): void {
    if (this._state.play === null) return;
    const engine = toEngineState(this._state);
    trackCapsObligation(engine, this._state.play.capsObligations, {
      seats: ALL_SEATS,
    });
  }

  private _handleBiddingTransition(transition: BiddingTransition): void {
    if (transition === 'pass_on') {
      this._resetForDeal(false);
      return;
    }
    if (transition === 'trump_selection') {
      this._state.phase = 'trump_selection';
      const bidder = this._state.bidding?.highestBidder;
      if (bidder !== null && bidder !== undefined) {
        this._state.trump.trumperSeat = bidder;
      }
      return;
    }
    if (transition === 'pre_play') {
      this._state.phase = 'pre_play';
      return;
    }
    if (transition === 'new_8_card_trump') {
      // Old trump card returns to previous trumper's hand.
      if (this._state.trump.trumpCard !== null) {
        const oldTrumper = this._state.trump.trumperSeat;
        if (oldTrumper !== null) {
          if (this._state.hands[oldTrumper] === undefined) {
            this._state.hands[oldTrumper] = [];
          }
          this._state.hands[oldTrumper].push(this._state.trump.trumpCard);
        }
      }
      const newBidder = this._state.bidding?.highestBidder ?? null;
      this._state.trump = newTrumpState();
      this._state.trump.trumperSeat = newBidder;
      this._state.phase = 'trump_selection';
      return;
    }
    if (transition === 'pcc') {
      const pccBidder = this._state.bidding?.highestBidder;
      if (pccBidder === null || pccBidder === undefined) return;
      this._state.pccPartnerOut = partnerSeat(pccBidder);

      if (this._state.trump.trumpCard !== null) {
        const oldTrumper = this._state.trump.trumperSeat;
        if (oldTrumper !== null && oldTrumper !== pccBidder) {
          if (this._state.hands[oldTrumper] === undefined) {
            this._state.hands[oldTrumper] = [];
          }
          this._state.hands[oldTrumper].push(this._state.trump.trumpCard);
        }
      }
      this._state.trump = newTrumpState();
      this._state.trump.trumperSeat = pccBidder;
      this._state.phase = 'trump_selection';
      return;
    }
  }

  private _resetForDeal(sameDealer: boolean): void {
    if (!sameDealer) {
      this._state.dealer = nextSeat(this._state.dealer);
      this._state.consecutiveReshuffles = 0;
    }
    this._state.phase = 'dealing_4';
    this._state.hands = { north: [], west: [], south: [], east: [] };
    this._state.deck = null;
    this._state.trump = newTrumpState();
    this._state.bidding = null;
    this._state.play = null;
    this._state.pccPartnerOut = null;
  }

  private _finalizeGame(): void {
    this._state.phase = 'scrutiny';
    const result = calculateResult(this._state);
    this._state.result = result;

    const trumperTeam = teamOf(this._state.trump.trumperSeat!);
    applyStoneChanges(this._state.stone, result, trumperTeam);
    this._state.phase = 'complete';
  }
}

// Re-export GameResult type for callers.
export type { GameResult };
// Reference newPlayState to silence unused-import lint in environments
// where dead-code analysis flags it through chained re-exports.
void newPlayState;
