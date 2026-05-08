// Inspect a pool JSONL file. Without arguments, prints distributions
// across labour / round / suit-span / scenario cells (the cluster
// diagnostics the curator was designed to support). With an id or
// index, prints the full puzzle.
//
// Usage:
//   tsx tools/inspect-pool.ts <path>             # summary
//   tsx tools/inspect-pool.ts <path> <id|idx>    # one puzzle

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankOf, suitOf } from '../frontend/src/304dle/engine/card';
import type { CardId } from '../frontend/src/304dle/engine/card';
import type { Seat } from '../frontend/src/304dle/engine/seating';
import type { CuratedPuzzle } from './curate/types';

const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

const fmtCard = (c: CardId): string => `${rankOf(c)}${SUIT_GLYPH[suitOf(c)]}`;
const fmtHand = (cs: ReadonlyArray<CardId>): string =>
  [...cs]
    .sort((a, b) => suitOf(a).localeCompare(suitOf(b)) || rankOf(a).localeCompare(rankOf(b)))
    .map(fmtCard)
    .join(' ');

const hist = (xs: number[]): string => {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v}`).join(' ');
};

const histStr = (xs: string[]): string => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort()
    .map(([k, v]) => `${k}:${v}`).join(' ');
};

const printSummary = (puzzles: CuratedPuzzle[]) => {
  console.log(`Pool: ${puzzles.length} puzzles`);
  console.log();

  const labours = puzzles.map(p => p.metadata.L3.labour);
  const rounds = puzzles.map(p => p.metadata.L4.optimalCallRound);
  const spans = puzzles.map(p => p.metadata.L3.witnessSuitSpan);

  console.log(`Labour:    ${hist(labours)}`);
  console.log(`Round:     ${hist(rounds)}`);
  console.log(`Suit span: ${hist(spans)}`);
  console.log();

  const trumpers = puzzles.map(p => p.scenario?.trumperSeat ?? p.trump.trumper);
  const modes = puzzles.map(p =>
    p.scenario ? (p.scenario.isOpen ? 'open' : 'closed') : 'open',
  );
  const types = puzzles.map(p => p.scenario?.capsType ?? 'internal');
  const positions = puzzles.map(p => p.scenario?.southPositionR1 ?? 1);

  console.log(`Trumper seat:    ${histStr(trumpers)}`);
  console.log(`Trump mode:      ${histStr(modes)}`);
  console.log(`Caps type:       ${histStr(types)}`);
  console.log(`South R1 pos:    ${hist(positions)}`);
  console.log();

  const cells: Record<string, number> = {};
  for (const p of puzzles) {
    if (!p.scenario) continue;
    const k = `${p.scenario.trumperSeat}-${p.scenario.isOpen ? 'open' : 'closed'}`;
    cells[k] = (cells[k] ?? 0) + 1;
  }
  console.log(`Scenario cells:`);
  for (const [k, v] of Object.entries(cells).sort()) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }

  // South-hand-shape diversity.
  const shapeCounts: Record<string, number> = {};
  for (const p of puzzles) {
    const counts: Record<string, number> = { c: 0, d: 0, h: 0, s: 0 };
    for (const c of p.hands.south) counts[suitOf(c)]++;
    const k = Object.values(counts).sort((a, b) => b - a).join(',');
    shapeCounts[k] = (shapeCounts[k] ?? 0) + 1;
  }
  console.log();
  console.log(`Top south-hand shapes:`);
  const top = Object.entries(shapeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [shape, n] of top) console.log(`  ${shape.padEnd(12)} ${n}`);
};

const printPuzzle = (p: CuratedPuzzle) => {
  console.log(`=== ${p.id} ===`);
  console.log(`seed=${p.seed} botSeed=${p.botSeed}`);
  console.log(`trumper: ${p.trump.trumper}  trump: ${SUIT_GLYPH[p.trump.suit]} (${fmtCard(p.trump.card)})  on table: ${!p.trump.trumpCardInHand}`);
  if (p.scenario) {
    console.log(`scenario: type=${p.scenario.capsType} mode=${p.scenario.isOpen ? 'open' : 'closed'} south-R1-pos=${p.scenario.southPositionR1}`);
  }
  console.log();
  console.log(`Hands:`);
  for (const seat of ['north', 'west', 'south', 'east'] as Seat[]) {
    const star = seat === p.trump.trumper ? ' (trumper)' : '';
    console.log(`  ${seat.padEnd(6)}: ${fmtHand(p.hands[seat])}${star}`);
  }
  console.log();
  console.log(`L1: hcp=${p.metadata.L1.hcp} trumpLen=${p.metadata.L1.trumpLen} trumpTop=${p.metadata.L1.trumpTopCount} shape=[${p.metadata.L1.shape.join(',')}]`);
  console.log(`L3: labour=${p.metadata.L3.labour} witnessSuitSpan=${p.metadata.L3.witnessSuitSpan}`);
  console.log(`L4: optimalCallRound=${p.metadata.L4.optimalCallRound} trajRoundDist=[${p.metadata.L4.trajectoryRoundDistribution.join(',')}]`);
  console.log(`witness: ${p.metadata.L2.witnessOrder.map(fmtCard).join(' → ') || '(none)'}`);
};

const main = () => {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('usage: inspect-pool <path> [id-or-index]');
    process.exit(2);
  }
  const path = resolve(args[0]);
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const puzzles: CuratedPuzzle[] = lines.map(l => JSON.parse(l));

  if (args.length < 2) {
    printSummary(puzzles);
    return;
  }
  const ref = args[1];
  const p = /^\d+$/.test(ref)
    ? puzzles[parseInt(ref, 10)]
    : puzzles.find(x => x.id === ref);
  if (!p) {
    console.error(`puzzle not found: ${ref}`);
    process.exit(1);
  }
  printPuzzle(p);
};

main();
