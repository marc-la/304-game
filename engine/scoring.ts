// Game-end scoring and stone exchange. Mirrors game304/scoring.py.

import {
  PCC_SCORING,
  SCORING_TABLE,
  WRONG_CAPS_PENALTY,
  type ScoringEntry,
} from './constants';
import { teamOf } from './seating';
import type { Seat, Team } from './seating';
import type {
  BiddingState,
  GameResult,
  GameState,
  PlayState,
} from './state';

const otherTeam = (team: Team): Team =>
  team === 'team_a' ? 'team_b' : 'team_a';

// Lenient policy mirroring Python's is_caps_late default — late iff V
// has played at least one card since obligation arose.
const isCapsLateLenient = (play: PlayState, seat: Seat): boolean => {
  const obligation = play.capsObligations.get(seat);
  if (!obligation) return false;
  const vPlayedInCurrent = play.currentRound.some(e => e.seat === seat);
  const vPlaysNow = (play.roundNumber - 1) + (vPlayedInCurrent ? 1 : 0);
  return vPlaysNow > obligation.vPlaysAtObligation;
};

const getScoring = (bidding: BiddingState): ScoringEntry => {
  if (bidding.isPcc) return PCC_SCORING;
  return SCORING_TABLE[bidding.highestBid] ?? PCC_SCORING;
};

export const calculateResult = (state: GameState): GameResult => {
  const bidding = state.bidding!;
  const play = state.play!;
  const trump = state.trump;
  const trumperSeat = trump.trumperSeat!;
  const trumperTeam = teamOf(trumperSeat);
  const oppositionTeam = otherTeam(trumperTeam);

  // 1. Already-resolved caps call.
  if (play.capsCall !== null && state.result !== null) {
    return state.result;
  }

  // 2. PCC scoring (caps modifiers don't apply).
  if (bidding.isPcc) {
    const allWon = play.completedRounds.every(
      r => teamOf(r.winner) === trumperTeam,
    );
    if (allWon) {
      return {
        reason: 'pcc_won',
        stoneExchanged: PCC_SCORING.win,
        stoneDirection: 'give',
        winnerTeam: trumperTeam,
        description: `PCC successful! ${PCC_SCORING.win} stone given.`,
      };
    }
    return {
      reason: 'pcc_lost',
      stoneExchanged: PCC_SCORING.loss,
      stoneDirection: 'receive',
      winnerTeam: oppositionTeam,
      description: `PCC failed. ${PCC_SCORING.loss} stone received.`,
    };
  }

  // 3. Late caps detection.
  if (play.capsObligations.size > 0) {
    for (const [seatKey, obligation] of play.capsObligations.entries()) {
      const obligatedTeam = teamOf(seatKey);
      const roundsAfter = play.completedRounds.filter(
        r => r.roundNumber >= obligation.obligatedAtRound,
      );
      const allWon =
        roundsAfter.length > 0 &&
        roundsAfter.every(r => teamOf(r.winner) === obligatedTeam);
      const wonEverything = play.completedRounds.every(
        r => teamOf(r.winner) === obligatedTeam,
      );
      if (allWon && wonEverything) {
        const scoring = getScoring(bidding);
        if (obligatedTeam === trumperTeam) {
          return {
            reason: 'caps_late',
            stoneExchanged: scoring.loss + 1,
            stoneDirection: 'receive',
            winnerTeam: oppositionTeam,
            capsBy: seatKey,
            description: `Late Caps detected for ${seatKey}. ${scoring.loss + 1} stone penalty.`,
          };
        }
        return {
          reason: 'caps_late',
          stoneExchanged: scoring.win + 1,
          stoneDirection: 'give',
          winnerTeam: trumperTeam,
          capsBy: seatKey,
          description: `Late External Caps detected for ${seatKey}. Betting team gives ${scoring.win + 1} stone to the external team.`,
        };
      }
    }
  }

  // 4. Normal scoring.
  const bid = bidding.highestBid;
  const scoring = SCORING_TABLE[bid];
  if (scoring === undefined) {
    return {
      reason: 'error',
      stoneExchanged: 0,
      stoneDirection: 'none',
      winnerTeam: null,
      description: `Unknown bid value: ${bid}`,
    };
  }

  const trumperPoints = play.pointsWon[trumperTeam];
  const oppositionPoints = play.pointsWon[oppositionTeam];

  if (trumperPoints >= bid) {
    return {
      reason: 'bid_met',
      stoneExchanged: scoring.win,
      stoneDirection: 'give',
      winnerTeam: trumperTeam,
      trumperPoints,
      oppositionPoints,
      bid,
      description: `Bid of ${scoring.name} met with ${trumperPoints} points. ${scoring.win} stone given.`,
    };
  }
  return {
    reason: 'bid_failed',
    stoneExchanged: scoring.loss,
    stoneDirection: 'receive',
    winnerTeam: oppositionTeam,
    trumperPoints,
    oppositionPoints,
    bid,
    description: `Bid of ${scoring.name} failed with ${trumperPoints} points (needed ${bid}). ${scoring.loss} stone received.`,
  };
};

export const applyStoneChanges = (
  stone: Record<Team, number>,
  result: GameResult,
  trumperTeam: Team,
): void => {
  if (result.stoneDirection === 'none') return;
  if (result.stoneDirection === 'give') {
    stone[trumperTeam] = Math.max(0, stone[trumperTeam] - result.stoneExchanged);
  } else if (result.stoneDirection === 'receive') {
    stone[trumperTeam] += result.stoneExchanged;
  }
};

export const calculateCapsResult = (
  state: GameState,
  seat: Seat,
  isValid: boolean,
  isExternal: boolean,
): GameResult => {
  const myTeam = teamOf(seat);

  if (!isValid) {
    return {
      reason: 'caps_wrong',
      stoneExchanged: WRONG_CAPS_PENALTY,
      stoneDirection: 'receive',
      winnerTeam: otherTeam(myTeam),
      capsBy: seat,
      description: `Wrong/Early Caps by ${seat}. ${WRONG_CAPS_PENALTY} stone penalty.`,
    };
  }

  const play = state.play!;
  const isLate = isCapsLateLenient(play, seat);

  // Bonus eligibility (§C-1, §C-13): determined by the round in which
  // the caller's *first obligation* arose. Falls back to call round if
  // no obligation tracked.
  const obligation = play.capsObligations.get(seat);
  const obligationRound = obligation
    ? obligation.obligatedAtRound
    : play.roundNumber;
  const isBeforeRound7 = obligationRound < 7;
  const scoring = getScoring(state.bidding!);

  if (isLate) {
    return {
      reason: 'caps_late',
      stoneExchanged: scoring.loss + 1,
      stoneDirection: 'receive',
      winnerTeam: otherTeam(myTeam),
      capsBy: seat,
      description: `Late Caps by ${seat}. ${scoring.loss + 1} stone penalty.`,
    };
  }

  if (isBeforeRound7) {
    if (isExternal) {
      return {
        reason: 'external_caps',
        stoneExchanged: scoring.loss + 1,
        stoneDirection: 'receive',
        winnerTeam: myTeam,
        capsBy: seat,
        description: `External Caps (correct, before Round 7). Betting team receives ${scoring.loss + 1} stone.`,
      };
    }
    return {
      reason: 'caps_correct',
      stoneExchanged: scoring.win + 1,
      stoneDirection: 'give',
      winnerTeam: myTeam,
      capsBy: seat,
      description: `Caps correct (before Round 7). Betting team gives ${scoring.win + 1} stone.`,
    };
  }

  if (isExternal) {
    return {
      reason: 'external_caps',
      stoneExchanged: scoring.loss,
      stoneDirection: 'receive',
      winnerTeam: myTeam,
      capsBy: seat,
      description: `External Caps (correct, after Round 7). Normal loss applies.`,
    };
  }
  return {
    reason: 'caps_correct',
    stoneExchanged: scoring.win,
    stoneDirection: 'give',
    winnerTeam: myTeam,
    capsBy: seat,
    description: `Caps correct (after Round 7). Normal win applies.`,
  };
};
