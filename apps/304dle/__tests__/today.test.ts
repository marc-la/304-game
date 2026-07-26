// Guard on the shipped puzzle content. Every per-date file under
// site/public/puzzles/ is a day someone will actually play, so all of
// them are replayed end-to-end here — not just a sample. The directory
// is intentionally optional; fresh checkouts won't have it.

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScriptedPuzzle } from '../types';
import {
  applyScriptedPlay,
  isGameOver,
  newRuntime,
  resolveRound,
  whoseTurn,
} from '../runtime';

const PUZZLE_DIR = resolve(__dirname, '../../../site/public/puzzles');

const datedFiles = (): string[] => {
  if (!existsSync(PUZZLE_DIR)) return [];
  return readdirSync(PUZZLE_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
};

describe('shipped daily puzzles', () => {
  const files = datedFiles();

  it.skipIf(files.length === 0)('index.json matches the files on disk', () => {
    const idx = JSON.parse(
      readFileSync(resolve(PUZZLE_DIR, 'index.json'), 'utf-8'),
    ) as { schemaVersion: number; dates: string[] };
    expect(idx.schemaVersion).toBe(2);
    expect(idx.dates).toEqual(files.map(f => f.replace('.json', '')));
  });

  // Each replay runs the CSP obligation tracker on all 32 plays, so a
  // full horizon of puzzles takes well past the 5s default.
  it.skipIf(files.length === 0)('every dated puzzle replays end-to-end', () => {
    for (const file of files) {
      const puzzle = JSON.parse(
        readFileSync(resolve(PUZZLE_DIR, file), 'utf-8'),
      ) as ScriptedPuzzle;

      expect(puzzle.schemaVersion, file).toBe(2);
      expect(puzzle.date, file).toBe(file.replace('.json', ''));
      expect(puzzle.script.length, file).toBe(32);
      // The whole puzzle is the caps call; a puzzle whose obligation
      // never arises, or arises on round 8, is unplayable.
      expect(puzzle.obligation.round, file).toBeGreaterThanOrEqual(1);
      expect(puzzle.obligation.round, file).toBeLessThanOrEqual(7);

      const rt = newRuntime({
        hands: puzzle.hands,
        trumpSuit: puzzle.trump.suit,
        trumpCard: puzzle.trump.card,
        trumperSeat: puzzle.trump.trumper,
        priority: puzzle.priority,
        script: puzzle.script,
        mode: puzzle.trump.mode,
      });
      // applyScriptedPlay validates each play against the engine's
      // legal-play set, so this loop is also a legality audit.
      while (!isGameOver(rt)) {
        if (whoseTurn(rt) === null) {
          resolveRound(rt);
          continue;
        }
        applyScriptedPlay(rt);
      }
      expect(rt.completedRounds.length, file).toBe(8);
      expect(rt.pointsWon.team_a + rt.pointsWon.team_b, file).toBe(304);
      // South must actually become caps-obligated during the replay,
      // or the day has no correct answer.
      expect(rt.capsObligations.has('south'), file).toBe(true);
    }
  }, 120_000);
});
