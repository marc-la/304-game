// Scripted-puzzle generator. Runs slap-shuffled matches with bots
// playing all four seats; collects sweep-games; for each sweep
// computes the first state at which a sweep-team seat becomes
// caps-obligated; rotates that seat into south's slot and emits a
// ScriptedPuzzle.
//
// CLI:
//   npm run puzzles:generate -- \
//     --count 30 --start-date 2026-07-27 \
//     --master-seed 1 \
//     --out-dir site/public/puzzles
//
// --mode open|closed (default OPEN — soul §VI.1.1 makes Open Trump the
// v1 mode, and closed mode empirically yields nothing: the closed-trump
// heuristic bot defends so weakly that every sweep it produces is an
// over-determined caps with labour 0. See --bot below.)
//
// --bot id — the opponent policy, and the single most important knob in
// this pipeline. Acceptance is gated on *deduction labour* (how many of
// south's observations are load-bearing for the caps obligation), and
// labour is a direct function of how hard the defence made south work.
// Weak bots hand out monster hands whose caps is over-determined
// (labour 0 = south would still be obligated having forgotten any one
// card) — those are trivial puzzles and layer 3 rejects them. Measured
// accept-per-sweep: b3-heuristic 2.3%, b4-infoset-1ply 5.1%.
// b6-dds-mc is stronger still but too slow to generate with.
//
// Output modes (mutually exclusive):
//   --out <file>      single bundle file (schema v2 ScriptedPuzzleFile)
//   --out-dir <dir>   one file per date, `<dir>/YYYY-MM-DD.json`, plus
//                     an index.json. Preferred: the client then fetches
//                     ~2KB for today instead of ~800KB for the year, and
//                     view-source leaks only the puzzle you are playing.
//                     Requires --start-date.

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
  out: string | null;
  outDir: string | null;
  startDate: string | null;
  gamesPerMatch: number;
  maxMatches: number;
  minObligationRound: number;
  maxObligationRound: number;
  maxPerRoundFrac: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseArgs = (): Args => {
  const args = process.argv.slice(2);
  let count = 30;
  let bot = 'b4-infoset-1ply';
  let mode: TrumpMode = 'open';
  let masterSeed = 1;
  let out: string | null = null;
  let outDir: string | null = null;
  let startDate: string | null = null;
  let gamesPerMatch = 30;
  let maxMatches = 10_000;
  let minObligationRound = 3;
  let maxObligationRound = 7;
  let maxPerRoundFrac = 0.35;
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
    else if (args[i] === '--out-dir') outDir = resolve(args[++i]);
    else if (args[i] === '--start-date') startDate = args[++i];
    else if (args[i] === '--games-per-match') gamesPerMatch = parseInt(args[++i], 10);
    else if (args[i] === '--max-matches') maxMatches = parseInt(args[++i], 10);
    else if (args[i] === '--min-round') minObligationRound = parseInt(args[++i], 10);
    else if (args[i] === '--max-round') maxObligationRound = parseInt(args[++i], 10);
    else if (args[i] === '--max-per-round-frac') maxPerRoundFrac = parseFloat(args[++i]);
  }
  if (out !== null && outDir !== null) {
    throw new Error('--out and --out-dir are mutually exclusive');
  }
  if (outDir !== null && startDate === null) {
    throw new Error('--out-dir requires --start-date YYYY-MM-DD');
  }
  if (startDate !== null && !DATE_RE.test(startDate)) {
    throw new Error(`--start-date must be YYYY-MM-DD, got ${startDate}`);
  }
  if (out === null && outDir === null) {
    outDir = resolve(REPO_ROOT, 'site/public/puzzles');
    if (startDate === null) {
      throw new Error('--start-date YYYY-MM-DD is required (or pass --out <file>)');
    }
  }
  return {
    count, bot, mode, masterSeed, out, outDir, startDate, gamesPerMatch,
    maxMatches, minObligationRound, maxObligationRound, maxPerRoundFrac,
  };
};

// Date arithmetic in UTC so a generator run is reproducible regardless
// of the machine's timezone.
const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(t);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
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

// Write the accepted puzzles as one file per consecutive date, plus an
// index the client can use to know the available horizon. Idempotent —
// safe to call after every acceptance.
const flushDated = (accepted: ScriptedPuzzle[], args: Args): string[] => {
  mkdirSync(args.outDir!, { recursive: true });
  const dates: string[] = [];
  for (let i = 0; i < accepted.length; i++) {
    const date = addDays(args.startDate!, i);
    dates.push(date);
    const puzzle: ScriptedPuzzle = { ...accepted[i], date };
    writeFileSync(resolve(args.outDir!, `${date}.json`), JSON.stringify(puzzle));
  }
  writeFileSync(
    resolve(args.outDir!, 'index.json'),
    JSON.stringify({ schemaVersion: 2, dates }, null, 2),
  );
  return dates;
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
  // Rejection funnel, printed at the end. Without it a zero-yield run
  // is indistinguishable from a broken one.
  const reject: Record<string, number> = {};
  // Accepted count per obligation round, and the ceiling any one round
  // may occupy. See the quota check in the loop below.
  const perRound: Record<number, number> = {};
  const maxPerRound = Math.max(1, Math.ceil(args.count * args.maxPerRoundFrac));
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
      if (obl === null) {
        reject['no-obligation'] = (reject['no-obligation'] ?? 0) + 1;
        continue;
      }
      if (
        obl.obligatedAtRound < args.minObligationRound ||
        obl.obligatedAtRound > args.maxObligationRound
      ) {
        const k = `round-${obl.obligatedAtRound}-out-of-band`;
        reject[k] = (reject[k] ?? 0) + 1;
        continue;
      }

      // Par-round quota. Left unconstrained, this pipeline produces a
      // brutally skewed distribution — a measured run came back 12/14
      // at R5 — because with a guaranteed sweep, obligation either
      // crystallises immediately (R1-2, rejected above) or once south's
      // hand goes provably dominant around R5. A player who notices
      // that just calls R5 every day and never reads the table again,
      // which defeats the entire puzzle. Capping any single round's
      // share forces the generator to keep hunting for the rarer
      // shapes.
      if ((perRound[obl.obligatedAtRound] ?? 0) >= maxPerRound) {
        const k = `round-${obl.obligatedAtRound}-quota-full`;
        reject[k] = (reject[k] ?? 0) + 1;
        continue;
      }

      // The obligated seat has NOT been rotated into south's slot yet
      // (that happens below), so layer 3 must be told which seat it is
      // measuring. Passing the wrong seat silently rejects ~3 in 4
      // candidates as `no-witness`.
      const labour = computeDeductionLabour({
        state: obl.state,
        thresholds: DEFAULT_THRESHOLDS,
        seat: obl.obligatedSeat,
      });
      if (!labour.pass) {
        const k = labour.reason === 'low-labour'
          ? `low-labour(=${labour.labour},span=${labour.witnessSuitSpan})`
          : labour.reason;
        reject[k] = (reject[k] ?? 0) + 1;
        continue;
      }

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
      perRound[obl.obligatedAtRound] = (perRound[obl.obligatedAtRound] ?? 0) + 1;
      // Flush immediately in per-date mode. Acceptance is rare (a few
      // percent of sweeps) so a long run represents hours of compute;
      // losing it to a timeout or a Ctrl-C is not acceptable.
      if (args.outDir !== null) flushDated(accepted, args);

      const dt = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(
        `  accepted=${accepted.length}/${args.count}  sweeps=${sweepsSeen}  ` +
        `matches=${matchIdx}  labour=${labour.labour} span=${labour.witnessSuitSpan}  ` +
        `R${obl.obligatedAtRound}  ${dt}s`,
      );
      if (accepted.length >= args.count) break;
    }
  }

  const generatedAt = new Date().toISOString();

  if (args.outDir !== null) {
    const dates = flushDated(accepted, args);
    console.log(
      `\nWrote ${accepted.length} puzzles to ${args.outDir}/` +
      (dates.length > 0 ? ` (${dates[0]} … ${dates[dates.length - 1]})` : ''),
    );
  } else {
    const file: ScriptedPuzzleFile = {
      schemaVersion: 2,
      generatedAt,
      puzzles: accepted,
    };
    mkdirSync(dirname(args.out!), { recursive: true });
    writeFileSync(args.out!, JSON.stringify(file, null, 2));
    console.log(`\nWrote ${accepted.length} puzzles to ${args.out}`);
  }
  console.log(`  ${sweepsSeen} sweeps observed across ${matchIdx} matches`);
  // Par-round spread. If one round dominates, the puzzle is a fixed
  // answer and the daily is dead — so this is printed on every run,
  // not hidden behind a flag.
  const spread = Object.keys(perRound).map(Number).sort((a, b) => a - b);
  if (spread.length > 0) {
    const parts = spread.map(r => {
      const n = perRound[r];
      return `R${r}=${n} (${Math.round((100 * n) / accepted.length)}%)`;
    });
    console.log(`  par spread: ${parts.join('  ')}`);
  }
  const funnel = Object.entries(reject).sort((a, b) => b[1] - a[1]);
  if (funnel.length > 0) {
    console.log('  rejected:');
    for (const [reason, n] of funnel) console.log(`    ${reason.padEnd(28)} ${n}`);
  }
};

main();
