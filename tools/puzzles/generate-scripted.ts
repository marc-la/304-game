// Scripted-puzzle generator. Runs slap-shuffled matches with bots
// playing all four seats; collects sweep-games; for each sweep
// computes the first state at which a sweep-team seat becomes
// caps-obligated; rotates that seat into south's slot and emits a
// ScriptedPuzzle.
//
// CLI:
//   npm run puzzles:generate -- \
//     --count 365 --mode closed \
//     --master-seed 1 \
//     --out site/public/puzzles/scripts.json
//
// --mode open|closed (default closed; per user's judgement closed is
// the realistic majority in real 304)
// --bot id (only used for open mode; closed mode uses the closed-trump
// heuristic bot since the engine zoo is open-trump-only)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CardId, Suit } from '../../engine/card';
import { suitOf } from '../../engine/card';
import { checkCapsObligation } from '../../engine/caps';
import type { Seat, Team } from '../../engine/seating';
import { SEAT_INDEX, teamOf } from '../../engine/seating';
import type {
  CompletedRound,
  EngineGameState,
  RoundEntry,
} from '../../engine/state';
import { computeDeductionLabour } from '../curator/layers/3-labour';
import { DEFAULT_THRESHOLDS } from '../curator/types';
import { runMatch } from './match-collector';
import type { GameRecord, TrumpMode } from './match-collector';
import type { ScriptedPlay, ScriptedPuzzle, ScriptedPuzzleFile } from '../../apps/304dle/types';

const REPO_ROOT = resolve(__dirname, '../..');

interface Args {
  count: number;
  bot: string;
  mode: TrumpMode;
  masterSeed: number;
  out: string;
  gamesPerMatch: number;
  maxMatches: number;
  minObligationRound: number;
  maxObligationRound: number;
}

const parseArgs = (): Args => {
  const args = process.argv.slice(2);
  let count = 365;
  let bot = 'b3-heuristic';
  let mode: TrumpMode = 'closed';
  let masterSeed = 1;
  let out = resolve(REPO_ROOT, 'site/public/puzzles/scripts.json');
  let gamesPerMatch = 30;
  let maxMatches = 10_000;
  let minObligationRound = 3;
  let maxObligationRound = 7;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count') count = parseInt(args[++i], 10);
    else if (args[i] === '--bot') bot = args[++i];
    else if (args[i] === '--mode') {
      const m = args[++i];
      if (m !== 'open' && m !== 'closed') {
        throw new Error(`--mode must be 'open' or 'closed', got ${m}`);
      }
      mode = m;
    }
    else if (args[i] === '--master-seed') masterSeed = parseInt(args[++i], 10);
    else if (args[i] === '--out') out = resolve(args[++i]);
    else if (args[i] === '--games-per-match') gamesPerMatch = parseInt(args[++i], 10);
    else if (args[i] === '--max-matches') maxMatches = parseInt(args[++i], 10);
    else if (args[i] === '--min-round') minObligationRound = parseInt(args[++i], 10);
    else if (args[i] === '--max-round') maxObligationRound = parseInt(args[++i], 10);
  }
  return {
    count, bot, mode, masterSeed, out, gamesPerMatch, maxMatches,
    minObligationRound, maxObligationRound,
  };
};

const SEATS: Seat[] = ['north', 'west', 'south', 'east'];

interface LiveTrump {
  trumperSeat: Seat;
  trumpSuit: Suit;
  trumpCard: CardId | null;
  trumpCardInHand: boolean;
  isRevealed: boolean;
  isOpen: boolean;
}

const cloneTrump = (t: LiveTrump): LiveTrump => ({ ...t });

const buildEngineState = (
  hands: Record<Seat, CardId[]>,
  trump: LiveTrump,
  priority: Seat,
  completed: CompletedRound[],
  pts: Record<Team, number>,
): EngineGameState => {
  const handsArr: CardId[][] = [[], [], [], []];
  for (const s of SEATS) handsArr[SEAT_INDEX[s]] = hands[s];
  return {
    hands: handsArr,
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
      currentRound: [],
      completedRounds: completed,
      pointsWon: pts,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

// Walk the game's rounds, mutating hands + trump state correctly per
// each round's plays + §T9 reveals. After each round, check whether
// any sweep-team seat is caps-obligated; return the first hit.
const findObligation = (
  game: GameRecord,
): {
  obligatedSeat: Seat;
  obligatedAtRound: number;
  state: EngineGameState;
} | null => {
  if (game.caps_team === null) return null;
  const sweepTeam = game.caps_team;
  const eligibleSeats = SEATS.filter(s => teamOf(s) === sweepTeam);

  const hands: Record<Seat, CardId[]> = {
    north: [...game.hands.north],
    west: [...game.hands.west],
    south: [...game.hands.south],
    east: [...game.hands.east],
  };
  if (game.mode === 'closed') {
    // Folded trump card sat on the table from the start.
    hands[game.trump.trumper] = hands[game.trump.trumper].filter(c => c !== game.trump.card);
  }
  const trump: LiveTrump = {
    trumperSeat: game.trump.trumper,
    trumpSuit: game.trump.suit,
    trumpCard: game.trump.card,
    trumpCardInHand: game.mode === 'open',
    isRevealed: game.mode === 'open',
    isOpen: game.mode === 'open',
  };
  const pts: Record<Team, number> = { team_a: 0, team_b: 0 };
  const completed: CompletedRound[] = [];
  let priority: Seat = game.priority;

  for (let r = 0; r < game.rounds.length; r++) {
    const round = game.rounds[r];
    // Apply each play (mutate hands + trump-card slot for folded
    // trump plays). Build a fresh entries array preserving the
    // revealed flag the simulator set.
    const entries: RoundEntry[] = [];
    for (const e of round.cards) {
      if (e.card === null) {
        entries.push({ ...e });
        continue;
      }
      if (
        e.seat === trump.trumperSeat &&
        !trump.trumpCardInHand &&
        trump.trumpCard === e.card
      ) {
        trump.trumpCard = null;
      } else {
        const idx = hands[e.seat].indexOf(e.card);
        if (idx >= 0) hands[e.seat].splice(idx, 1);
      }
      entries.push({ ...e });
    }
    // Apply §T9 reveal effects if a face-down trump was played.
    if (!trump.isOpen) {
      const hasFaceDownTrump = entries.some(
        e => e.faceDown && e.card !== null && suitOf(e.card) === trump.trumpSuit,
      );
      if (hasFaceDownTrump) {
        for (const e of entries) {
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
      }
    }
    pts[teamOf(round.winner)] += round.pointsWon;
    priority = round.winner;
    completed.push({
      ...round,
      cards: entries,
    });

    const state = buildEngineState(hands, cloneTrump(trump), priority, completed, pts);
    for (const seat of eligibleSeats) {
      try {
        if (checkCapsObligation(state, seat)) {
          return { obligatedSeat: seat, obligatedAtRound: r + 1, state };
        }
      } catch {
        // continue
      }
    }
  }
  return null;
};

const SEAT_ORDER: Seat[] = ['north', 'west', 'south', 'east'];

const seatRotation = (target: Seat): Record<Seat, Seat> => {
  const targetIdx = SEAT_ORDER.indexOf(target);
  const southIdx = SEAT_ORDER.indexOf('south');
  const shift = (southIdx - targetIdx + 4) % 4;
  const map: Record<Seat, Seat> = {
    north: 'north', west: 'west', south: 'south', east: 'east',
  };
  for (let i = 0; i < 4; i++) {
    const from = SEAT_ORDER[i];
    const to = SEAT_ORDER[(i + shift) % 4];
    map[from] = to;
  }
  return map;
};

const main = () => {
  const args = parseArgs();
  console.log(
    `Generating up to ${args.count} ${args.mode}-trump scripted puzzles ` +
    `(open mode bot=${args.bot})`,
  );

  const accepted: ScriptedPuzzle[] = [];
  let matchIdx = 0;
  let sweepsSeen = 0;
  const tStart = Date.now();

  while (accepted.length < args.count && matchIdx < args.maxMatches) {
    matchIdx++;
    const matchSeed = (Math.imul(args.masterSeed ^ matchIdx, 0x9e3779b1)) >>> 0;
    const bots: Record<Seat, string> = {
      north: args.bot, west: args.bot, south: args.bot, east: args.bot,
    };
    for (const game of runMatch({
      initialDeckSeed: matchSeed,
      bots,
      gamesPerMatch: args.gamesPerMatch,
      trumperSeat: 'south',
      mode: args.mode,
      // priority varies per game inside runMatch (cycles N/W/S/E)
      prioritySeat: null,
    })) {
      if (game.caps_team === null) continue;
      sweepsSeen++;

      const obl = findObligation(game);
      if (obl === null) continue;
      if (
        obl.obligatedAtRound < args.minObligationRound ||
        obl.obligatedAtRound > args.maxObligationRound
      ) continue;

      const labour = computeDeductionLabour({
        state: obl.state,
        thresholds: DEFAULT_THRESHOLDS,
      });
      if (!labour.pass) continue;

      // Rotate the obligated seat into south's slot. Hands, trumper,
      // priority, and all script entries rotate together.
      const rot = seatRotation(obl.obligatedSeat);
      const rotatedHands: Record<Seat, CardId[]> = {
        north: [], west: [], south: [], east: [],
      };
      for (const s of SEATS) rotatedHands[rot[s]] = [...game.hands[s]];

      // Build the script directly from playLog (preserves face-down).
      const script: ScriptedPlay[] = game.playLog.map(p => ({
        round: p.round,
        seat: rot[p.seat],
        card: p.card,
        faceDown: p.faceDown,
      }));
      let cardIndexAtObligation = 0;
      for (let i = 0; i < script.length; i++) {
        if (script[i].round === obl.obligatedAtRound &&
            i + 1 < script.length &&
            script[i + 1].round !== obl.obligatedAtRound) {
          cardIndexAtObligation = i + 1;
          break;
        }
      }

      const rotatedTrumper = rot[game.trump.trumper];
      const rotatedPriority = rot[game.priority];

      const puzzle: ScriptedPuzzle = {
        schemaVersion: 2,
        id: `s2-${String(accepted.length + 1).padStart(5, '0')}`,
        seed: matchSeed,
        hands: rotatedHands,
        trump: {
          suit: game.trump.suit,
          card: game.trump.card,
          trumper: rotatedTrumper,
          mode: game.mode,
          // For closed mode the folded card sits on the table at start.
          trumpCardInHand: game.mode === 'open',
        },
        priority: rotatedPriority,
        script,
        obligation: {
          round: obl.obligatedAtRound,
          afterCardIndex: cardIndexAtObligation,
        },
        meta: {
          bot: { id: game.mode === 'closed' ? 'closed-trump-bot' : args.bot, rating: null },
          capsType: teamOf(rotatedTrumper) === teamOf('south')
            ? 'internal' : 'external',
          labour: labour.labour,
          witnessSuitSpan: labour.witnessSuitSpan,
        },
      };
      accepted.push(puzzle);

      if (accepted.length % 10 === 0) {
        const dt = ((Date.now() - tStart) / 1000).toFixed(1);
        console.log(
          `  accepted=${accepted.length}/${args.count}  sweeps=${sweepsSeen}  ` +
          `matches=${matchIdx}  ${dt}s`,
        );
      }
      if (accepted.length >= args.count) break;
    }
  }

  const file: ScriptedPuzzleFile = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    puzzles: accepted,
  };
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(file, null, 2));
  console.log(`\nWrote ${accepted.length} puzzles to ${args.out}`);
  console.log(`  ${sweepsSeen} sweeps observed across ${matchIdx} matches`);
};

main();
