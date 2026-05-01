import type { CardData, Seat, Suit } from '../types/game';

/**
 * A practice scenario presents one decision point: should the player
 * call Caps right now? If yes, in what order do they play their cards?
 *
 * The frontend is pure CSR — every scenario carries its own ground
 * truth (``shouldCall`` and the correct ``correctOrder`` if applicable),
 * authored by hand against the rules. No engine call is needed at
 * runtime. This sidesteps the ongoing caps-info-set work and lets the
 * trainer ship as static files (GitHub Pages compatible).
 */

export type TrumpMode = 'open' | 'closed-pre-reveal' | 'closed-post-reveal';

export interface ScenarioRoundCard {
  seat: Seat;
  /** Card string ('Jc', '10d'). Undefined for hidden minuses. */
  cardStr?: string;
  /** True if the card was played face-down. */
  faceDown?: boolean;
  /** True if a face-down card was revealed at end of round (= it was a trump). */
  revealed?: boolean;
}

export interface ScenarioLatestRound {
  roundNumber: number;
  cards: ScenarioRoundCard[];
  winner: Seat;
  pointsWon: number;
  /** True if trump was revealed in this round. */
  trumpRevealed?: boolean;
}

export interface Scenario {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Multi-paragraph setup, including the relevant history. Plain text;
   *  newlines render as paragraph breaks. */
  setup: string;

  // ----- Game state -----
  trumpSuit: Suit;
  trumpMode: TrumpMode;
  trumperSeat: Seat;
  partnerSeat: Seat;
  isPcc?: boolean;

  // ----- Player perspective -----
  yourSeat: Seat;
  yourHand: string[];

  // ----- Round context -----
  /** The round about to be played (1..8). */
  currentRound: number;
  yourPriority: boolean;
  /** If not your priority, who leads. */
  currentRoundLeader?: Seat;
  /** Cards already played in the in-progress round. */
  currentRoundCards?: ScenarioRoundCard[];

  // ----- Visual context -----
  /** The most recently completed round (rules permit visual inspection
   *  of this one and only this one). */
  latestRound?: ScenarioLatestRound;

  // ----- Public deductions to surface -----
  knownVoids?: Partial<Record<Seat, Suit[]>>;

  // ----- Ground truth -----
  shouldCall: boolean;
  /** Required if shouldCall is true. Card strings in play order. */
  correctOrder?: string[];

  // ----- Pedagogy -----
  rationale: string;
  hint?: string;
}

export type Verdict =
  | { kind: 'correct' }
  | { kind: 'right_call_wrong_order'; expected: string[]; given: string[] }
  | { kind: 'too_early' }
  | { kind: 'should_have_called' }
  | { kind: 'correctly_waited' };

export function cardFromStr(s: string): CardData {
  const ranks = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'] as const;
  const points: Record<(typeof ranks)[number], number> = {
    J: 30, '9': 20, A: 11, '10': 10, K: 3, Q: 2, '8': 0, '7': 0,
  };
  let rankPart: string;
  let suitPart: string;
  if (s.length === 3 && s.startsWith('10')) {
    rankPart = '10';
    suitPart = s[2];
  } else if (s.length === 2) {
    rankPart = s[0];
    suitPart = s[1];
  } else {
    throw new Error(`Cannot parse card: ${s}`);
  }
  return {
    rank: rankPart as CardData['rank'],
    suit: suitPart as CardData['suit'],
    str: s,
    points: points[rankPart as (typeof ranks)[number]],
  };
}
