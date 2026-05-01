// Smoke test: verify a puzzle for today's date can be loaded and plays.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PuzzleFile } from '../types';
import {
  applyPlay,
  isGameOver,
  newRuntime,
  playBotTurn,
  resolveRound,
  whoseTurn,
} from '../runtime';

const PUZZLES_PATH = resolve(__dirname, '../../../public/puzzles/2026.json');

describe('puzzle file', () => {
  it('exists, parses, and has 365 entries', () => {
    const raw = readFileSync(PUZZLES_PATH, 'utf-8');
    const data = JSON.parse(raw) as PuzzleFile;
    expect(data.version).toBe(1);
    expect(data.year).toBe(2026);
    expect(data.puzzles.length).toBe(365);
  });

  it('todays puzzle is playable end-to-end', () => {
    const raw = readFileSync(PUZZLES_PATH, 'utf-8');
    const data = JSON.parse(raw) as PuzzleFile;
    // Pick May 1 — chosen because the bootstrap fixture run targeted it.
    const puzzle = data.puzzles.find(p => p.date === '2026-05-01')!;
    expect(puzzle).toBeTruthy();
    const rt = newRuntime({
      hands: puzzle.hands,
      trumpSuit: puzzle.trump.suit,
      trumpCard: puzzle.trump.card,
      botSeed: puzzle.botSeed,
    });
    while (!isGameOver(rt)) {
      const t = whoseTurn(rt);
      if (t === null) {
        resolveRound(rt);
        continue;
      }
      if (t === 'south') {
        applyPlay(rt, 'south', rt.hands.south[0]);
      } else {
        playBotTurn(rt, t);
      }
    }
    expect(rt.completedRounds.length).toBe(8);
    expect(rt.pointsWon.team_a + rt.pointsWon.team_b).toBe(304);
  });
});
