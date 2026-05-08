// CLI inspector for a curated hard-caps JSON file. Pretty-prints one
// puzzle's metadata so you can spot-check whether the deduction
// labour signal is producing puzzles that look hard.
//
// Usage:
//   tsx tools/inspect-hard-caps.ts <path> <id-or-index>
// e.g.
//   tsx tools/inspect-hard-caps.ts frontend/public/puzzles/hard-caps-curated.json hc-0001
//   tsx tools/inspect-hard-caps.ts frontend/public/puzzles/hard-caps-curated.json 0
//   tsx tools/inspect-hard-caps.ts frontend/public/puzzles/hard-caps-curated.json   (no id → summary)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankOf, suitOf } from '../frontend/src/304dle/engine/card';
import type { CardId } from '../frontend/src/304dle/engine/card';
import type { Seat } from '../frontend/src/304dle/engine/seating';
import type { CuratedPuzzle } from './curate/types';

interface PuzzleFile {
  version: 1;
  criterion: string;
  thresholds: Record<string, number>;
  generatedAt: string;
  masterSeed: number;
  stats: { attempts: number; rejection: Record<string, number> };
  puzzles: CuratedPuzzle[];
}

const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

const fmtCard = (c: CardId): string => `${rankOf(c)}${SUIT_GLYPH[suitOf(c)]}`;
const fmtHand = (cs: ReadonlyArray<CardId>): string =>
  [...cs]
    .sort((a, b) => suitOf(a).localeCompare(suitOf(b)) || rankOf(a).localeCompare(rankOf(b)))
    .map(fmtCard)
    .join(' ');

const printSummary = (f: PuzzleFile) => {
  console.log(`Curated file: ${f.puzzles.length} puzzles, criterion=${f.criterion}`);
  console.log(`Generated: ${f.generatedAt}, master-seed=${f.masterSeed}`);
  console.log(`Thresholds:`, f.thresholds);
  console.log(`Stats:`, f.stats);
  console.log();
  // Distribution snapshots.
  const labours = f.puzzles.map(p => p.metadata.L3.labour);
  const rounds = f.puzzles.map(p => p.metadata.L4.optimalCallRound);
  const spans = f.puzzles.map(p => p.metadata.L3.witnessSuitSpan);
  const hist = (xs: number[]): string => {
    const m = new Map<number, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
  };
  console.log(`Labour distribution: ${hist(labours)}`);
  console.log(`Optimal-call-round distribution: ${hist(rounds)}`);
  console.log(`Witness-suit-span distribution: ${hist(spans)}`);
};

const printPuzzle = (p: CuratedPuzzle) => {
  console.log(`=== ${p.id} ===`);
  console.log(`seed=${p.seed} botSeed=${p.botSeed}`);
  console.log(`trump: ${SUIT_GLYPH[p.trump.suit]} (${fmtCard(p.trump.card)})`);
  console.log();
  console.log(`Hands (open trump, south is trumper and leads):`);
  for (const seat of ['north', 'west', 'south', 'east'] as Seat[]) {
    console.log(`  ${seat.padEnd(6)}: ${fmtHand(p.hands[seat])}`);
  }
  console.log();
  console.log(`L1 (hand-strength):`);
  console.log(`  hcp=${p.metadata.L1.hcp}  trumpLen=${p.metadata.L1.trumpLen}  trumpTop=${p.metadata.L1.trumpTopCount}`);
  console.log(`  shape=[${p.metadata.L1.shape.join(',')}]  topHonors=${p.metadata.L1.topHonors}`);
  console.log();
  console.log(`L2 (DDS double-dummy):`);
  console.log(`  tightness=${p.metadata.L2.tightness} (distinct winning leads)`);
  console.log(`  witness: ${p.metadata.L2.witnessOrder.map(fmtCard).join(' → ')}`);
  console.log();
  console.log(`L3 (deduction labour):`);
  console.log(`  labour=${p.metadata.L3.labour}  witnessSuitSpan=${p.metadata.L3.witnessSuitSpan}`);
  console.log(`  loadBearingCardCount=${p.metadata.L3.loadBearingCardCount}`);
  console.log();
  console.log(`L4 (reachability):`);
  console.log(`  optimalCallRound=${p.metadata.L4.optimalCallRound}`);
  console.log(`  trajectoryRoundDistribution=[${p.metadata.L4.trajectoryRoundDistribution.join(',')}]`);
};

const main = () => {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('usage: inspect-hard-caps <path> [id-or-index]');
    process.exit(2);
  }
  const path = resolve(args[0]);
  const f = JSON.parse(readFileSync(path, 'utf-8')) as PuzzleFile;

  if (args.length < 2) {
    printSummary(f);
    return;
  }
  const ref = args[1];
  let p: CuratedPuzzle | undefined;
  if (/^\d+$/.test(ref)) {
    p = f.puzzles[parseInt(ref, 10)];
  } else {
    p = f.puzzles.find(x => x.id === ref);
  }
  if (!p) {
    console.error(`puzzle not found: ${ref}`);
    process.exit(1);
  }
  printPuzzle(p);
};

main();
