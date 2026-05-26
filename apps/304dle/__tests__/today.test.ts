// Smoke test: if a scripts.json file has been generated, verify one
// puzzle parses + plays end-to-end via the script driver. The file
// is intentionally optional — fresh checkouts won't have it.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScriptedPuzzleFile } from '../types';
import {
  applyScriptedPlay,
  isGameOver,
  newRuntime,
  resolveRound,
  whoseTurn,
} from '../runtime';

const SCRIPTS_PATH = resolve(__dirname, '../../../site/public/puzzles/scripts.json');

describe('scripted puzzle file', () => {
  it.skipIf(!existsSync(SCRIPTS_PATH))('parses and replays end-to-end', () => {
    const raw = readFileSync(SCRIPTS_PATH, 'utf-8');
    const data = JSON.parse(raw) as ScriptedPuzzleFile;
    expect(data.schemaVersion).toBe(2);
    expect(data.puzzles.length).toBeGreaterThan(0);

    const puzzle = data.puzzles[0];
    expect(puzzle.script.length).toBe(32);

    const rt = newRuntime({
      hands: puzzle.hands,
      trumpSuit: puzzle.trump.suit,
      trumpCard: puzzle.trump.card,
      trumperSeat: puzzle.trump.trumper,
      priority: puzzle.priority,
      script: puzzle.script,
      mode: puzzle.trump.mode,
    });
    while (!isGameOver(rt)) {
      const t = whoseTurn(rt);
      if (t === null) {
        resolveRound(rt);
        continue;
      }
      applyScriptedPlay(rt);
    }
    expect(rt.completedRounds.length).toBe(8);
    expect(rt.pointsWon.team_a + rt.pointsWon.team_b).toBe(304);
  });
});
