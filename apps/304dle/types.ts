// Shared 304dle types — schema v2 (scripted-playout puzzles).
//
// A puzzle is a fully pre-computed 32-card script. The runtime advances
// bots on a tempo timer; at south's turn, the single scripted card is
// highlighted while the rest of the hand greys out. The caps call
// button is live from round 1.
//
// The pre-computed plays are produced by `tools/puzzles/generate-scripted.ts`
// running 4 copies of B6 (DDS Monte-Carlo) against rules-faithful slap-
// shuffled matches; only games where one team sweeps all 8 rounds and
// south's seat becomes caps-obligated at some round in [1..7] are
// retained.

import type { CardId, Suit } from '@engine/card';
import type { Seat } from '@engine/seating';

export const SUIT_SYMBOLS: Record<Suit, string> = {
  c: '♣',
  d: '♦',
  h: '♥',
  s: '♠',
};

// One play in the script. faceDown is reserved for future closed-trump
// scripts but always false in v1 (Open Trump only — soul §VI.1.1).
export interface ScriptedPlay {
  round: number;          // 1..8
  seat: Seat;
  card: CardId;
  faceDown: boolean;
}

export interface ScriptedPuzzle {
  schemaVersion: 2;
  id: string;
  date?: string;          // optional ISO date for the daily slot
  seed: number;           // master seed for this puzzle
  hands: Record<Seat, CardId[]>;            // dealt hands (south = caller)
  trump: {
    suit: Suit;
    card: CardId;
    trumper: Seat;
    // Open Trump: trumpCardInHand = true from the start.
    // Closed Trump: trumpCardInHand = false (the card sits on the
    //   table); reveals during play via §T9.
    mode: 'open' | 'closed';
    trumpCardInHand: boolean;
  };
  // Round-1 leader. INDEPENDENT of trumper — in real 304 priority is
  // assigned to the player to the dealer's right; the dealer rotates,
  // so any of the four seats can be R1 leader regardless of which
  // seat won the bid. v1 puzzles vary this.
  priority: Seat;
  script: ScriptedPlay[]; // exactly 32 entries (24 for PCC, future)
  obligation: {
    round: number;        // 1..7
    afterCardIndex: number; // 0..31 — index into script
  };
  meta: {
    bot: { id: string; rating: number | null };
    capsType: 'internal' | 'external';
    labour: number;       // load-bearing facts at S*
    witnessSuitSpan: number;
  };
}

export interface ScriptedPuzzleFile {
  schemaVersion: 2;
  generatedAt: string;
  puzzles: ScriptedPuzzle[];
}
