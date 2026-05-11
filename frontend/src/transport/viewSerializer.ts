// Convert a TS engine GameState into the GameView shape the frontend
// UI consumes. The shape matches what the Python backend's
// `serialize_game_view` produces (snake_case keys, CardData objects)
// so the same React components render either transport's output.

import type { CardId } from '../304dle/engine/card';
import { pointsOf, rankOf, suitOf } from '../304dle/engine/card';
import type { Game } from '../304dle/engine/game';
import type {
  BiddingState,
  CapsCall,
  CompletedRound as EngineCompletedRound,
  GameResult as EngineGameResult,
  GameState,
  PlayState,
  RoundEntry as EngineRoundEntry,
  TrumpState,
} from '../304dle/engine/state';
import { SEATS } from '../304dle/engine/seating';
import type { Seat } from '../304dle/engine/seating';
import type {
  BiddingState as ViewBidding,
  CardData,
  CompletedRound as ViewCompletedRound,
  GameResult as ViewGameResult,
  GameState as ViewState,
  GameView,
  PlayState as ViewPlay,
  RoundEntry as ViewRoundEntry,
  TrumpState as ViewTrump,
} from '../types/game';

const toCardData = (c: CardId): CardData => ({
  rank: rankOf(c),
  suit: suitOf(c),
  str: c,
  points: pointsOf(c),
});

const toViewRoundEntry = (
  e: EngineRoundEntry,
  viewerSeat: Seat | null,
  isComplete: boolean,
): ViewRoundEntry => {
  // Redact face-down, unrevealed cards from non-owner viewers.
  const ownerSees =
    viewerSeat !== null && e.seat === viewerSeat;
  const visible = !e.faceDown || e.revealed || ownerSees || isComplete;
  return {
    seat: e.seat,
    card: visible && e.card !== null ? toCardData(e.card) : null,
    face_down: e.faceDown,
    revealed: e.revealed,
  };
};

const toViewCompleted = (
  r: EngineCompletedRound,
  viewerSeat: Seat | null,
  isComplete: boolean,
): ViewCompletedRound => ({
  round_number: r.roundNumber,
  cards: r.cards.map(e => toViewRoundEntry(e, viewerSeat, isComplete)),
  winner: r.winner,
  points_won: r.pointsWon,
  trump_revealed: r.trumpRevealed,
});

const toViewTrump = (
  t: TrumpState,
  trumpKnown: boolean,
): ViewTrump => ({
  trumper_seat: t.trumperSeat,
  trump_suit: trumpKnown ? t.trumpSuit : null,
  trump_card: trumpKnown && t.trumpCard !== null ? toCardData(t.trumpCard) : null,
  is_revealed: t.isRevealed,
  is_open: t.isOpen,
  trump_card_in_hand: t.trumpCardInHand,
});

const toViewBidding = (b: BiddingState | null): ViewBidding | null => {
  if (b === null) return null;
  return {
    is_four_card: b.isFourCard,
    current_bidder: b.currentBidder,
    highest_bid: b.highestBid,
    highest_bidder: b.highestBidder,
    consecutive_passes: b.consecutivePasses,
    speeches: b.speeches.map(s => ({
      seat: s.seat,
      action: s.action,
      value: s.value,
      speech_number: s.speechNumber,
      on_behalf_of: s.onBehalfOf,
    })),
    player_state: {
      north: {
        speech_count: b.playerState.north.speechCount,
        has_partnered: b.playerState.north.hasPartnered,
        partner_used_by: b.playerState.north.partnerUsedBy,
        skipped: b.playerState.north.skipped,
      },
      west: {
        speech_count: b.playerState.west.speechCount,
        has_partnered: b.playerState.west.hasPartnered,
        partner_used_by: b.playerState.west.partnerUsedBy,
        skipped: b.playerState.west.skipped,
      },
      south: {
        speech_count: b.playerState.south.speechCount,
        has_partnered: b.playerState.south.hasPartnered,
        partner_used_by: b.playerState.south.partnerUsedBy,
        skipped: b.playerState.south.skipped,
      },
      east: {
        speech_count: b.playerState.east.speechCount,
        has_partnered: b.playerState.east.hasPartnered,
        partner_used_by: b.playerState.east.partnerUsedBy,
        skipped: b.playerState.east.skipped,
      },
    },
    is_pcc: b.isPcc,
    pending_partner: b.pendingPartner
      ? {
          original_seat: b.pendingPartner.originalSeat,
          partner_seat: b.pendingPartner.partnerSeat,
        }
      : null,
    four_card_bid: b.fourCardBid,
    four_card_bidder: b.fourCardBidder,
  };
};

const toViewCapsCall = (c: CapsCall | null) => {
  if (c === null) return null;
  return {
    called_by: c.calledBy,
    called_at_round: c.calledAtRound,
    play_order: c.playOrder.map(toCardData),
    is_external: c.isExternal,
    result: c.result,
  };
};

const toViewPlay = (
  p: PlayState | null,
  viewerSeat: Seat | null,
  isComplete: boolean,
): ViewPlay | null => {
  if (p === null) return null;
  // Only expose viewer's own caps obligation.
  const obs: Record<string, unknown> = {};
  if (viewerSeat !== null) {
    const own = p.capsObligations.get(viewerSeat);
    if (own !== undefined) {
      obs[viewerSeat] = {
        obligated_at_round: own.obligatedAtRound,
        obligated_at_card: own.obligatedAtCard,
        v_plays_at_obligation: own.vPlaysAtObligation,
      };
    }
  }
  return {
    round_number: p.roundNumber,
    priority: p.priority,
    current_turn: p.currentTurn,
    current_round: p.currentRound.map(e => toViewRoundEntry(e, viewerSeat, isComplete)),
    completed_rounds: p.completedRounds.map(r => toViewCompleted(r, viewerSeat, isComplete)),
    points_won: { team_a: p.pointsWon.team_a, team_b: p.pointsWon.team_b },
    caps_call: toViewCapsCall(p.capsCall) as ViewPlay['caps_call'],
    caps_obligations: obs as ViewPlay['caps_obligations'],
  };
};

const toViewResult = (r: EngineGameResult | null): ViewGameResult | null => {
  if (r === null) return null;
  return {
    reason: r.reason,
    stone_exchanged: r.stoneExchanged,
    stone_direction: r.stoneDirection,
    winner_team: r.winnerTeam,
    description: r.description,
    trumper_points: r.trumperPoints ?? null,
    opposition_points: r.oppositionPoints ?? null,
    bid: r.bid ?? null,
    caps_by: r.capsBy ?? null,
  };
};

export interface MatchSummary {
  matchComplete: boolean;
  matchWinner: 'team_a' | 'team_b' | null;
  gameCount: number;
}

export const serializeGameView = (
  matchId: string,
  game: Game,
  viewerSeat: Seat | null,
  matchSummary: MatchSummary,
): GameView => {
  const state: GameState = game.state;
  const isComplete = state.phase === 'complete';
  const trump = state.trump;
  const isTrumper = viewerSeat !== null && viewerSeat === trump.trumperSeat;
  const trumpKnown =
    isTrumper || trump.isRevealed || trump.isOpen || isComplete;

  const hands: Record<Seat, CardData[]> = {
    north: [], west: [], south: [], east: [],
  };
  const handCounts: Record<Seat, number> = {
    north: 0, west: 0, south: 0, east: 0,
  };
  for (const seat of SEATS) {
    const cards = state.hands[seat] ?? [];
    handCounts[seat] = cards.length;
    if (viewerSeat === null || isComplete || seat === viewerSeat) {
      hands[seat] = cards.map(toCardData);
    } else {
      hands[seat] = [];
    }
  }

  const validPlays: Record<Seat, CardData[]> = {
    north: [], west: [], south: [], east: [],
  };
  if (state.phase === 'playing') {
    if (viewerSeat === null) {
      for (const seat of SEATS) {
        validPlays[seat] = game.validPlays(seat).map(toCardData);
      }
    } else {
      validPlays[viewerSeat] = game.validPlays(viewerSeat).map(toCardData);
    }
  }

  const viewState: ViewState = {
    game_number: state.gameNumber,
    dealer: state.dealer,
    phase: state.phase,
    stone: { team_a: state.stone.team_a, team_b: state.stone.team_b },
    hands, // mirrors the top-level hands; backend includes it too
    deck: null,
    trump: toViewTrump(trump, trumpKnown),
    bidding: toViewBidding(state.bidding),
    play: toViewPlay(state.play, viewerSeat, isComplete),
    result: toViewResult(state.result),
    consecutive_reshuffles: state.consecutiveReshuffles,
    pcc_partner_out: state.pccPartnerOut,
  };

  return {
    matchId,
    phase: state.phase,
    whoseTurn: game.whoseTurn(),
    viewerSeat,
    state: viewState,
    hands,
    handCounts,
    validPlays,
    matchComplete: matchSummary.matchComplete,
    matchWinner: matchSummary.matchWinner,
    gameCount: matchSummary.gameCount,
  };
};
