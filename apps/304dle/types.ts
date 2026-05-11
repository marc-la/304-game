// Shared 304dle types.

import type { CardId, Suit } from '@engine/card';
import type { Seat } from '@engine/seating';

export const SUIT_SYMBOLS: Record<Suit, string> = {
  c: '♣', // ♣
  d: '♦', // ♦
  h: '♥', // ♥
  s: '♠', // ♠
};

// One puzzle the player faces. Used by both the legacy generated
// year-file format and the curated pool.
export interface DailyPuzzle {
  date: string;
  seed: number;
  hands: Record<Seat, CardId[]>;
  trump: { suit: Suit; card: CardId; trumper: 'south' };
  botSeed: number;
  difficulty: 'monday' | 'wednesday' | 'friday' | 'sunday';
  classification: {
    capsAchievable: boolean;
    optimalCallRound: number | null;
    parScore: number;
  };
  // Curation provenance — present iff the puzzle came from the
  // hand-curated pool. Generated puzzles leave this undefined.
  // Schema for this is provisional; the next session locks the
  // exact JSON shape Marc will batch-produce in.
  curation?: {
    id: string;                  // e.g. "C-2026-001"
    note?: string;                // curator's prose
    skillFocus?: string;          // freeform tag, e.g. "multi-suit", "minus-tracking"
    witnessOrder?: CardId[];      // optional canonical winning order
  };
}

// Legacy: one year-file per year, indexed by `date === today`.
// Kept as fallback while the curated pool is being populated.
export interface PuzzleFile {
  version: 1;
  year: number;
  generatedAt: string;
  puzzles: DailyPuzzle[];
}

// New: a single curated pool file. Daily selection is a
// date-seeded shuffle (see daily-selector.ts), not a date-key
// lookup — so the same pool serves any number of days.
export interface CuratedPuzzleFile {
  version: 1;
  generatedAt: string;
  puzzles: DailyPuzzle[];
}
