// Match collector — runs a multi-game match between four bot
// instances, gathering won-piles at end of each game and re-shuffling
// per rules-faithful slap+cut. Designed to bias toward clumpy / strong
// hands so caps-callable positions arise naturally.
//
// Two play modes:
//   - 'open':   bots from the engine zoo, all plays face-up
//   - 'closed': closed-trump bot (tools/curator/closed-trump-bot.ts),
//               face-down plays when off-suit pre-reveal, §T9 reveal
//               on round resolution
//
// Critically, after each game we collect tricks in the order they were
// won (the two side stacks pattern from the rules), then shuffle and
// re-deal. This is the path the curator uses to find sweep-games.

import { suitOf } from '../../engine/card';
import type { CardId, Suit } from '../../engine/card';
import { PACK } from '../../engine/card';
import { makeRng } from '../../engine/dealing';
import { roundTurnOrder, roundWinner, roundPoints } from '../../engine/play';
import type { Seat, Team } from '../../engine/seating';
import { teamOf, ANTICLOCKWISE } from '../../engine/seating';
import type {
  CompletedRound,
  EngineGameState,
  RoundEntry,
} from '../../engine/state';
import { botById } from '../../engine/bots';
import { chooseClosedTrumpPlay } from '../curator/closed-trump-bot';
import { slapShuffleAndCut } from './slap-shuffle';

const SEATS: Seat[] = ['north', 'west', 'south', 'east'];

export type TrumpMode = 'open' | 'closed';

export interface MatchCollectorOptions {
  initialDeckSeed: number;        // seed for first deck shuffle
  bots: Record<Seat, string>;     // bot id per seat (ignored in closed mode — uses closed-trump-bot)
  gamesPerMatch: number;
  trumperSeat?: Seat;             // defaults to 'south'
  // Priority for round 1 — independent of trumper per the real rules
  // (it's the player to the dealer's right, dealer rotates). If null,
  // priority is sampled per game from a deterministic shuffle.
  prioritySeat?: Seat | null;
  mode?: TrumpMode;               // default 'closed' (matches real-game distribution)
  shuffleSeedFor?: (gameIndex: number, baseSeed: number) => number;
}

export interface GameRecord {
  gameIndex: number;
  mode: TrumpMode;
  hands: Record<Seat, CardId[]>;   // hands as dealt
  trump: { suit: Suit; card: CardId; trumper: Seat; trumpCardInHand: boolean };
  priority: Seat;                  // round-1 leader
  // Each play has true ground-truth identity; closed-trump face-down
  // plays carry the true card alongside faceDown=true.
  playLog: Array<{
    round: number;
    seat: Seat;
    card: CardId;
    faceDown: boolean;
  }>;
  rounds: CompletedRound[];
  caps_team: Team | null;          // team that won all 8 rounds, if any
  sweep_winner: Seat | null;       // seat that won all 8 rounds, if any
  team_points: Record<Team, number>;
}

const longestSuit = (hand: ReadonlyArray<CardId>): Suit => {
  const counts: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 };
  for (const c of hand) counts[suitOf(c)]++;
  const order: Suit[] = ['c', 'd', 'h', 's'];
  let best: Suit = order[0];
  for (const s of order) if (counts[s] > counts[best]) best = s;
  return best;
};

const strongestInSuit = (hand: ReadonlyArray<CardId>, s: Suit): CardId => {
  const inS = hand.filter(c => suitOf(c) === s);
  inS.sort((a, b) => {
    const POWER: Record<string, number> = {
      J: 0, '9': 1, A: 2, '10': 3, K: 4, Q: 5, '8': 6, '7': 7,
    };
    const ra = a.length === 3 ? '10' : a[0];
    const rb = b.length === 3 ? '10' : b[0];
    return POWER[ra] - POWER[rb];
  });
  return inS[0];
};

const dealFromDeck = (deck: ReadonlyArray<CardId>): Record<Seat, CardId[]> => ({
  north: deck.slice(0, 8),
  west: deck.slice(8, 16),
  south: deck.slice(16, 24),
  east: deck.slice(24, 32),
});

interface LiveTrump {
  trumperSeat: Seat;
  trumpSuit: Suit;
  trumpCard: CardId | null;    // null once folded card is played and not picked up
  trumpCardInHand: boolean;
  isRevealed: boolean;
  isOpen: boolean;
}

const buildState = (
  hands: Record<Seat, CardId[]>,
  trump: LiveTrump,
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
      trumperSeat: trump.trumperSeat,
      trumpSuit: trump.trumpSuit,
      trumpCard: trump.trumpCard,
      trumpCardInHand: trump.trumpCardInHand,
      isRevealed: trump.isRevealed,
      isOpen: trump.isOpen,
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

// One face-down or face-up play: removes from source, pushes to round.
const playCard = (
  hands: Record<Seat, CardId[]>,
  trump: LiveTrump,
  seat: Seat,
  card: CardId,
  faceDown: boolean,
  current: RoundEntry[],
): void => {
  if (
    seat === trump.trumperSeat &&
    !trump.trumpCardInHand &&
    trump.trumpCard === card
  ) {
    // Trumper played the folded trump card as a face-down cut.
    trump.trumpCard = null;
  } else {
    const idx = hands[seat].indexOf(card);
    if (idx === -1) {
      throw new Error(`playCard: ${card} not in ${seat}'s hand`);
    }
    hands[seat].splice(idx, 1);
  }
  current.push({ seat, card, faceDown, revealed: false });
};

// §T9 round resolution effects on trump state. Mutates `trump` and
// the `current` round entries (revealed flag).
const resolveTrumpRevealEffects = (
  current: RoundEntry[],
  trump: LiveTrump,
  hands: Record<Seat, CardId[]>,
): boolean => {
  if (trump.isOpen) return false;
  const hasFaceDownTrump = current.some(
    e => e.faceDown && e.card !== null && suitOf(e.card) === trump.trumpSuit,
  );
  if (!hasFaceDownTrump) return false;
  for (const e of current) {
    if (e.faceDown && e.card !== null && suitOf(e.card) === trump.trumpSuit) {
      e.revealed = true;
    }
  }
  if (trump.trumpCard !== null && !trump.trumpCardInHand) {
    hands[trump.trumperSeat].push(trump.trumpCard);
    trump.trumpCardInHand = true;
  }
  trump.isRevealed = true;
  trump.isOpen = true;
  return true;
};

export const playOneGame = (
  deck: ReadonlyArray<CardId>,
  bots: Record<Seat, string>,
  trumperSeat: Seat,
  prioritySeat: Seat,
  gameIndex: number,
  rngSeed: number,
  mode: TrumpMode,
): { game: GameRecord; newDeck: CardId[] } => {
  const hands = dealFromDeck(deck);
  const handsForBots: Record<Seat, CardId[]> = {
    north: [...hands.north],
    west: [...hands.west],
    south: [...hands.south],
    east: [...hands.east],
  };
  const trumpSuit = longestSuit(handsForBots[trumperSeat]);
  const trumpCard = strongestInSuit(handsForBots[trumperSeat], trumpSuit);

  // Closed: folded card sits on the table, removed from in-hand pool.
  // Open: folded card stays in hand (per Open Trump game rules).
  if (mode === 'closed') {
    handsForBots[trumperSeat] = handsForBots[trumperSeat].filter(c => c !== trumpCard);
  }

  const liveTrump: LiveTrump = {
    trumperSeat,
    trumpSuit,
    trumpCard,
    trumpCardInHand: mode === 'open',
    isRevealed: mode === 'open',
    isOpen: mode === 'open',
  };

  const completed: CompletedRound[] = [];
  const playLog: GameRecord['playLog'] = [];
  const pts: Record<Team, number> = { team_a: 0, team_b: 0 };
  let priority: Seat = prioritySeat;
  const rng = makeRng(rngSeed);

  for (let round = 1; round <= 8; round++) {
    const order = roundTurnOrder(priority, null);
    const current: RoundEntry[] = [];
    for (const seat of order) {
      const state = buildState(
        handsForBots, liveTrump, priority, current, completed, pts,
      );
      let card: CardId;
      let faceDown: boolean;
      if (mode === 'closed') {
        const choice = chooseClosedTrumpPlay({
          seat,
          hand: handsForBots[seat],
          state,
          rng,
        });
        card = choice.card;
        faceDown = choice.faceDown;
      } else {
        const bot = botById(bots[seat]);
        if (bot === undefined) throw new Error(`Unknown bot ${bots[seat]}`);
        card = bot.play({
          seat,
          hand: handsForBots[seat],
          state,
          rng,
        }).card;
        faceDown = false;
      }
      playCard(handsForBots, liveTrump, seat, card, faceDown, current);
      playLog.push({ round, seat, card, faceDown });
    }

    const plays: Array<readonly [Seat, CardId]> = current.map(
      e => [e.seat, e.card!],
    );
    const winner = roundWinner(plays, liveTrump.trumpSuit);
    const points = roundPoints(plays);
    pts[teamOf(winner)] += points;

    const trumpRevealedInRound = resolveTrumpRevealEffects(current, liveTrump, handsForBots);

    completed.push({
      roundNumber: round,
      cards: current,
      winner,
      pointsWon: points,
      trumpRevealed: trumpRevealedInRound,
    });
    priority = winner;
  }

  let caps_team: Team | null = null;
  if (completed.every(r => teamOf(r.winner) === 'team_a')) caps_team = 'team_a';
  if (completed.every(r => teamOf(r.winner) === 'team_b')) caps_team = 'team_b';
  let sweep_winner: Seat | null = null;
  const seatRoundCount: Record<Seat, number> = { north: 0, west: 0, south: 0, east: 0 };
  for (const r of completed) seatRoundCount[r.winner]++;
  for (const s of SEATS) if (seatRoundCount[s] === 8) sweep_winner = s;

  // Collect piles for the next deal (winning team's pile first then losing).
  const winningPile: CardId[] = [];
  const losingPile: CardId[] = [];
  const myTeam: Team = caps_team ?? (pts.team_a > pts.team_b ? 'team_a' : 'team_b');
  for (const r of completed) {
    const stack = teamOf(r.winner) === myTeam ? winningPile : losingPile;
    for (const e of r.cards) {
      if (e.card !== null) stack.push(e.card);
    }
  }
  const newDeck = [...winningPile, ...losingPile];

  return {
    game: {
      gameIndex,
      mode,
      hands,
      trump: { suit: trumpSuit, card: trumpCard, trumper: trumperSeat, trumpCardInHand: mode === 'open' },
      priority: prioritySeat,
      playLog,
      rounds: completed,
      caps_team,
      sweep_winner,
      team_points: { team_a: pts.team_a, team_b: pts.team_b },
    },
    newDeck,
  };
};

// Deterministic priority pick from a salt. In real 304, priority for
// R1 is "player to the dealer's right" and the dealer rotates each
// game, so the priority seat cycles. We approximate by deterministic
// rotation off the game index.
const PRIORITY_CYCLE: Seat[] = ['south', 'east', 'north', 'west'];

export function* runMatch(opts: MatchCollectorOptions): Generator<GameRecord> {
  const trumperSeat = opts.trumperSeat ?? 'south';
  const mode: TrumpMode = opts.mode ?? 'closed';
  let deck: CardId[] = slapShuffleAndCut([...PACK], opts.initialDeckSeed);
  const shuffleSeedFor =
    opts.shuffleSeedFor ?? ((i, base) => (Math.imul(base ^ i, 0x9e3779b1)) >>> 0);

  for (let g = 0; g < opts.gamesPerMatch; g++) {
    const prioritySeat: Seat = opts.prioritySeat ?? PRIORITY_CYCLE[g % 4];
    const { game, newDeck } = playOneGame(
      deck, opts.bots, trumperSeat, prioritySeat, g,
      shuffleSeedFor(g, opts.initialDeckSeed),
      mode,
    );
    yield game;
    deck = slapShuffleAndCut(newDeck, shuffleSeedFor(g + 1, opts.initialDeckSeed));
  }
}

// Silence unused
void ANTICLOCKWISE;
