// Shared 304dle types.

import type { CardId, Suit } from './engine/card';
import type { Seat } from './engine/seating';

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
}

export interface PuzzleFile {
  version: 1;
  year: number;
  generatedAt: string;
  puzzles: DailyPuzzle[];
}
