// Run a single 2-vs-2 game between four bot instances and report the
// outcome under a fixed-bid (160) scoring rule.
//
// Real-304 simplifications:
//   - No bidding: every game is contested at a fixed bid of 160.
//   - Trumper-seat is chosen by the caller (rotation lives in tournament.ts).
//     Trump suit/card derived deterministically from the trumper's hand
//     (longest suit, strongest card).
//   - Priority is chosen by the caller (decoupled from trumper, per the
//     real rules where priority = player-to-dealer's-right and the
//     dealer rotates independently of who wins the bid).
//   - Open trump only (closed-trump bots live elsewhere; this is an
//     open-trump benchmark).
//   - Win/loss is points-threshold based: the trumping team wins iff
//     they take ≥160 of the 304 points. Total = 304, so the opponent's
//     threshold (≥145) is mutually exclusive: no draws are possible.

import { suitOf } from '../../../engine/card';
import type { CardId, Suit } from '../../../engine/card';
import { powerOf } from '../../../engine/card';
import { dealForSeed, makeRng } from '../../../engine/dealing';
import { roundTurnOrder, roundWinner, roundPoints } from '../../../engine/play';
import type { Seat, Team } from '../../../engine/seating';
import { teamOf } from '../../../engine/seating';
import type {
  CompletedRound,
  EngineGameState,
  RoundEntry,
} from '../../../engine/state';
import { botById } from '../../../engine/bots';

export interface SeatBotAssignment {
  north: string;
  west: string;
  south: string;
  east: string;
}

export const TOURNAMENT_BID = 160;
export const OPP_THRESHOLD = 304 - TOURNAMENT_BID + 1; // 145

export interface MatchResult {
  trumperSeat: Seat;
  prioritySeat: Seat;
  trumpingTeam: Team;
  trumpingTeamPoints: number;
  opposingTeamPoints: number;
  trumperWon: boolean;                    // trumping team took ≥160
  team_a_rounds: number;
  team_b_rounds: number;
  team_a_points: number;
  team_b_points: number;
  caps_team: Team | null;                 // sweep team (informational)
  sweep_winner: Seat | null;              // 8-round-winning seat
  log: CompletedRound[];
}

const SEATS: Seat[] = ['north', 'west', 'south', 'east'];

const SUIT_ORDER: readonly Suit[] = ['c', 'd', 'h', 's'];

const longestSuit = (hand: ReadonlyArray<CardId>): Suit => {
  const counts: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 };
  for (const c of hand) counts[suitOf(c)]++;
  let best: Suit = SUIT_ORDER[0];
  for (const s of SUIT_ORDER) if (counts[s] > counts[best]) best = s;
  return best;
};

const strongestInSuit = (hand: ReadonlyArray<CardId>, s: Suit): CardId => {
  const inS = hand.filter(c => suitOf(c) === s);
  return inS.reduce((best, c) => (powerOf(c) < powerOf(best) ? c : best));
};

const buildState = (
  hands: Record<Seat, CardId[]>,
  trumpSuit: Suit,
  trumpCard: CardId,
  trumperSeat: Seat,
  priority: Seat,
  current: RoundEntry[],
  completed: CompletedRound[],
  pts: Record<Team, number>,
): EngineGameState => {
  const handsMap = new Map<Seat, CardId[]>();
  for (const s of SEATS) handsMap.set(s, hands[s]);
  return {
    hands: handsMap,
    trump: {
      trumperSeat,
      trumpSuit,
      trumpCard,
      trumpCardInHand: true,
      isRevealed: true,
      isOpen: true,
    },
    play: {
      roundNumber: completed.length + 1,
      priority,
      currentRound: current,
      completedRounds: completed,
      pointsWon: pts,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

export interface MatchOptions {
  trumperSeat: Seat;
  prioritySeat: Seat;
}

export const runMatch = (
  seed: number,
  bots: SeatBotAssignment,
  options: MatchOptions,
): MatchResult => {
  const deal = dealForSeed(seed);
  const trumperSeat = options.trumperSeat;
  const prioritySeat = options.prioritySeat;

  const hands: Record<Seat, CardId[]> = {
    north: [...deal.hands.north],
    west: [...deal.hands.west],
    south: [...deal.hands.south],
    east: [...deal.hands.east],
  };
  // Derive trump from the actual trumper's hand (not always south).
  const trumpSuit = longestSuit(hands[trumperSeat]);
  const trumpCard = strongestInSuit(hands[trumperSeat], trumpSuit);

  const completed: CompletedRound[] = [];
  const pts: Record<Team, number> = { team_a: 0, team_b: 0 };
  let priority: Seat = prioritySeat;
  const rng = makeRng(deal.botSeed);

  for (let round = 1; round <= 8; round++) {
    const order = roundTurnOrder(priority, null);
    const current: RoundEntry[] = [];
    for (const seat of order) {
      const state = buildState(
        hands, trumpSuit, trumpCard, trumperSeat,
        priority, current, completed, pts,
      );
      const botId = bots[seat];
      const bot = botById(botId);
      if (bot === undefined) throw new Error(`Unknown bot ${botId}`);
      const { card } = bot.play({
        seat,
        hand: hands[seat],
        state,
        rng,
      });
      const idx = hands[seat].indexOf(card);
      if (idx === -1) {
        throw new Error(`Bot ${botId} chose card ${card} not in ${seat}'s hand`);
      }
      hands[seat].splice(idx, 1);
      current.push({ seat, card, faceDown: false, revealed: false });
    }
    const plays: Array<readonly [Seat, CardId]> = current.map(
      e => [e.seat, e.card!],
    );
    const winner = roundWinner(plays, trumpSuit);
    const points = roundPoints(plays);
    pts[teamOf(winner)] += points;
    completed.push({
      roundNumber: round,
      cards: current,
      winner,
      pointsWon: points,
      trumpRevealed: false,
    });
    priority = winner;
  }

  let team_a_rounds = 0;
  let team_b_rounds = 0;
  for (const r of completed) {
    if (teamOf(r.winner) === 'team_a') team_a_rounds++;
    else team_b_rounds++;
  }

  let caps_team: Team | null = null;
  if (team_a_rounds === 8) caps_team = 'team_a';
  if (team_b_rounds === 8) caps_team = 'team_b';
  const seatRoundCount: Record<Seat, number> = {
    north: 0, west: 0, south: 0, east: 0,
  };
  for (const r of completed) seatRoundCount[r.winner]++;
  let sweep_winner: Seat | null = null;
  for (const s of SEATS) if (seatRoundCount[s] === 8) sweep_winner = s;

  const trumpingTeam: Team = teamOf(trumperSeat);
  const trumpingTeamPoints = pts[trumpingTeam];
  const opposingTeamPoints = pts[trumpingTeam === 'team_a' ? 'team_b' : 'team_a'];
  // 304 - 160 + 1 = 145 → mutually exclusive thresholds. Sanity-check:
  // exactly one side meets its threshold.
  const trumperWon = trumpingTeamPoints >= TOURNAMENT_BID;
  const oppWonByThreshold = opposingTeamPoints >= OPP_THRESHOLD;
  if (trumperWon === oppWonByThreshold) {
    throw new Error(
      `Threshold paradox at seed ${seed}: trumping=${trumpingTeamPoints} ` +
      `opposing=${opposingTeamPoints} (sum should be 304)`,
    );
  }

  return {
    trumperSeat,
    prioritySeat,
    trumpingTeam,
    trumpingTeamPoints,
    opposingTeamPoints,
    trumperWon,
    team_a_rounds,
    team_b_rounds,
    team_a_points: pts.team_a,
    team_b_points: pts.team_b,
    caps_team,
    sweep_winner,
    log: completed,
  };
};
