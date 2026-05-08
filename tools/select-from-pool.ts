// Select a subset of puzzles from a pool JSONL based on filters.
// Reads pool.jsonl line-by-line, applies criteria, writes a selected
// JSON file with the same per-puzzle shape (ready to be consumed by
// the runtime / scoring / bucketing in your other session).
//
// Usage:
//   tsx tools/select-from-pool.ts \
//     --in pool.jsonl --out selected.json [-n 730] \
//     [--type internal|external] \
//     [--trumper north,south] \
//     [--mode open|closed] \
//     [--labour 4-20] [--round 3-7] [--suit-span 2-4] \
//     [--unique-shapes] [--unique-trumper-balance]
//
// Filters compose as AND. `--n` truncates after filtering. `--unique-shapes`
// keeps only the first puzzle per south-hand shape vector. `--unique-
// trumper-balance` rebalances to roughly equal counts per trumper.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CardId } from '../frontend/src/304dle/engine/card';
import type { Seat } from '../frontend/src/304dle/engine/seating';
import type { CuratedPuzzle } from './curate/types';

interface RangeFilter { min?: number; max?: number }

interface SelectArgs {
  inPath: string;
  outPath: string;
  n?: number;
  type?: Set<'internal' | 'external'>;
  trumper?: Set<Seat>;
  mode?: Set<'open' | 'closed'>;
  labour?: RangeFilter;
  round?: RangeFilter;
  suitSpan?: RangeFilter;
  uniqueShapes?: boolean;
  uniqueTrumperBalance?: boolean;
}

const parseRange = (s: string): RangeFilter => {
  const m = s.match(/^(\d+)?-(\d+)?$/);
  if (!m) throw new Error(`bad range: ${s}`);
  return {
    min: m[1] !== undefined ? parseInt(m[1], 10) : undefined,
    max: m[2] !== undefined ? parseInt(m[2], 10) : undefined,
  };
};

const parseArgs = (): SelectArgs => {
  const args = process.argv.slice(2);
  const out: SelectArgs = { inPath: '', outPath: '' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case '--in': out.inPath = resolve(next()); break;
      case '--out': out.outPath = resolve(next()); break;
      case '-n':
      case '--n': out.n = parseInt(next(), 10); break;
      case '--type':
        out.type = new Set(next().split(',') as Array<'internal' | 'external'>);
        break;
      case '--trumper':
        out.trumper = new Set(next().split(',') as Seat[]);
        break;
      case '--mode':
        out.mode = new Set(next().split(',') as Array<'open' | 'closed'>);
        break;
      case '--labour': out.labour = parseRange(next()); break;
      case '--round': out.round = parseRange(next()); break;
      case '--suit-span': out.suitSpan = parseRange(next()); break;
      case '--unique-shapes': out.uniqueShapes = true; break;
      case '--unique-trumper-balance': out.uniqueTrumperBalance = true; break;
      default:
        console.error(`unknown flag: ${a}`); process.exit(2);
    }
  }
  if (!out.inPath || !out.outPath) {
    console.error('--in and --out are required');
    process.exit(2);
  }
  return out;
};

const inRange = (v: number, r: RangeFilter | undefined): boolean => {
  if (!r) return true;
  if (r.min !== undefined && v < r.min) return false;
  if (r.max !== undefined && v > r.max) return false;
  return true;
};

const passes = (p: CuratedPuzzle, args: SelectArgs): boolean => {
  const sc = p.scenario;
  if (args.type && sc) {
    if (!args.type.has(sc.capsType)) return false;
  }
  if (args.trumper && sc) {
    if (!args.trumper.has(sc.trumperSeat)) return false;
  }
  if (args.mode && sc) {
    const mode = sc.isOpen ? 'open' : 'closed';
    if (!args.mode.has(mode)) return false;
  }
  if (!inRange(p.metadata.L3.labour, args.labour)) return false;
  if (!inRange(p.metadata.L4.optimalCallRound, args.round)) return false;
  if (!inRange(p.metadata.L3.witnessSuitSpan, args.suitSpan)) return false;
  return true;
};

const shapeKey = (hand: ReadonlyArray<CardId>): string => {
  const counts: Record<string, number> = { c: 0, d: 0, h: 0, s: 0 };
  for (const c of hand) counts[c[c.length - 1]]++;
  return Object.values(counts).sort((a, b) => b - a).join(',');
};

const main = () => {
  const args = parseArgs();
  const lines = readFileSync(args.inPath, 'utf-8').split('\n').filter(Boolean);
  const puzzles: CuratedPuzzle[] = lines.map(l => JSON.parse(l));

  let kept = puzzles.filter(p => passes(p, args));

  if (args.uniqueShapes) {
    const seen = new Set<string>();
    kept = kept.filter(p => {
      const k = shapeKey(p.hands.south);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  if (args.uniqueTrumperBalance) {
    const target = args.n !== undefined ? args.n : kept.length;
    const perSeat = Math.floor(target / 4);
    const buckets: Record<Seat, CuratedPuzzle[]> = {
      north: [], west: [], south: [], east: [],
    };
    for (const p of kept) {
      const s = p.scenario?.trumperSeat ?? p.trump.trumper;
      buckets[s].push(p);
    }
    kept = [];
    for (const seat of ['north', 'west', 'south', 'east'] as Seat[]) {
      kept.push(...buckets[seat].slice(0, perSeat));
    }
  }

  if (args.n !== undefined) kept = kept.slice(0, args.n);

  const out = {
    version: 1,
    criterion: 'hard-caps-selected-v1' as const,
    sourcePool: args.inPath,
    selectedAt: new Date().toISOString(),
    filters: {
      type: args.type ? [...args.type] : undefined,
      trumper: args.trumper ? [...args.trumper] : undefined,
      mode: args.mode ? [...args.mode] : undefined,
      labour: args.labour,
      round: args.round,
      suitSpan: args.suitSpan,
      uniqueShapes: args.uniqueShapes,
      uniqueTrumperBalance: args.uniqueTrumperBalance,
      n: args.n,
    },
    count: kept.length,
    puzzles: kept,
  };
  writeFileSync(args.outPath, JSON.stringify(out));
  console.log(`Selected ${kept.length} of ${puzzles.length} from ${args.inPath}`);
  console.log(`Wrote ${args.outPath}`);

  // Quick distributions for spot-checking.
  const byTrumper: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const p of kept) {
    const s = p.scenario;
    if (!s) continue;
    byTrumper[s.trumperSeat] = (byTrumper[s.trumperSeat] ?? 0) + 1;
    byMode[s.isOpen ? 'open' : 'closed'] = (byMode[s.isOpen ? 'open' : 'closed'] ?? 0) + 1;
    byType[s.capsType] = (byType[s.capsType] ?? 0) + 1;
  }
  console.log(`Selected distributions:`);
  console.log(`  trumper:`, byTrumper);
  console.log(`  mode:`, byMode);
  console.log(`  type:`, byType);
};

main();
