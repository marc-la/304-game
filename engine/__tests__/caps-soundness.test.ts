// Soundness of the caps-obligation predicate.
//
// `checkCapsObligation` is a CSP over an information set: it reasons
// about opponents as a shared pool with per-seat sizes and suit
// exhaustion, never materialising a world. That relaxation is fast and
// was twice unsound in ways no unit test caught, because both defects
// only appeared mid-trick on real deals.
//
// This test checks the predicate against its own definition the slow,
// literal way: enumerate every world consistent with the caller's
// information set and solve each one adaptively. Caps means `∀W ∃σ_W`
// (caps_formalism.md §5), so a single consistent world in which the
// caller cannot sweep refutes an "obligated" answer.

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CardId } from '@engine/card';
import { checkCapsObligation } from '@engine/caps';
import { worldSweepsAdaptive } from '@engine/dd';
import { buildInfoSet, enumerateWorlds } from '@engine/info';
import type { Seat } from '@engine/seating';
import { SEATS_BY_INDEX } from '@engine/seating';
import type { ScriptedPuzzle } from '@apps/304dle/types';
import {
  applyScriptedPlay,
  newRuntime,
  resolveRound,
  toEngineState,
  whoseTurn,
} from '@apps/304dle/runtime';

const PUZZLE_DIR = resolve(__dirname, '../../site/public/puzzles');

const datedFiles = (): string[] => {
  if (!existsSync(PUZZLE_DIR)) return [];
  return readdirSync(PUZZLE_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
};

describe('caps obligation is sound on shipped puzzles', () => {
  const files = datedFiles();

  it.skipIf(files.length === 0)(
    'no puzzle claims obligation at a state with a non-sweep world',
    () => {
      const violations: string[] = [];

      for (const file of files) {
        const p = JSON.parse(
          readFileSync(resolve(PUZZLE_DIR, file), 'utf-8'),
        ) as ScriptedPuzzle;
        const rt = newRuntime({
          hands: p.hands,
          trumpSuit: p.trump.suit,
          trumpCard: p.trump.card,
          trumperSeat: p.trump.trumper,
          priority: p.priority,
          script: p.script,
          mode: p.trump.mode,
        });

        // Advance to the first round at which the engine stamps south
        // as obligated (checked with the round on the table, which is
        // the state the player is looking at when they press).
        let par = 0;
        for (let r = 1; r <= 7; r++) {
          while (whoseTurn(rt) !== null) applyScriptedPlay(rt);
          if (checkCapsObligation(toEngineState(rt), 'south')) { par = r; break; }
          resolveRound(rt);
        }
        if (par === 0) continue;

        // Enumerating worlds is only tractable for a short hand, which
        // is also where the mid-trick short-circuits live.
        if (rt.hands.south.length > 4) continue;

        const state = toEngineState(rt);
        const info = buildInfoSet(state, 'south');
        const inProgress = rt.currentRound
          .filter(e => e.card !== null)
          .map(e => [e.seat, e.card as CardId] as const);
        const roundsRemaining = 8 - rt.completedRounds.length;

        for (const w of enumerateWorlds(info, { maxWorlds: 3000 })) {
          const hands = new Map<Seat, ReadonlyArray<CardId>>();
          for (let i = 0; i < 4; i++) hands.set(SEATS_BY_INDEX[i], w.hands[i]);
          const sweeps = worldSweepsAdaptive({
            hands,
            callerSeat: 'south',
            leader: rt.priority,
            inProgress,
            roundsRemaining,
            trumpSuit: p.trump.suit,
          });
          if (!sweeps) {
            violations.push(
              `${file} par R${par}: south holds [${rt.hands.south.join(' ')}] but ` +
              `cannot sweep vs N[${w.hands[0].join(' ')}] ` +
              `W[${w.hands[1].join(' ')}] E[${w.hands[3].join(' ')}]`,
            );
            break;
          }
        }
      }

      expect(violations).toEqual([]);
    },
    240_000,
  );
});
